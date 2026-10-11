/**
 * The geometry of the frontal-photo face metrics. Each metric is a small pure function of a frame's named points
 * (src/vision/types.ts, image pixels) that follows the `howMeasured` text of its catalog entry.
 *
 * Conventions
 *  - "L"/"R" are the subject's left/right (the larger/smaller x on a non-mirrored image).
 *  - Widths and heights are measured in the pupil-line frame: x along the line from the right pupil to the left pupil,
 *    y perpendicular to it, pointing down. Head roll therefore cancels out of every ratio (the catalog says the same
 *    for canthal tilt) and the only reference is the face itself. Symmetry (F05) uses a best-fit midline instead.
 *  - A function returns null when the geometry is implausible (a zero or negative distance, an out-of-order pair of
 *    points). Nothing here substitutes a default: no value means no number.
 *
 * Uncertainty. The reported uncertainty of a metric is the larger of
 *   - the sample standard deviation of the per-frame values across the burst, and
 *   - the landmark-error FLOOR below: first-order propagation of an assumed landmark error through the metric's own
 *     formula, expressed in the metric's unit, plus (F23 only) the published error of iris scaling.
 * The floor exists because a still burst repeats almost exactly: its spread measures how steady the hand was, not how
 * accurately the mesh sits on the anatomy, and most of the placement error is the same in every frame.
 */
import { getMetric } from '../catalog'
import type { Method } from '../catalog/schema'
import { IRIS_DIAMETER_MM, dist } from '../vision/geometry'
import { MESH } from '../vision/namedPoints'
import { NAMED_POINTS } from '../vision/types'
import type { FaceFrame, NamedPoint, NamedPoints, Point2 } from '../vision/types'
import { clamp, median, quadrature, round, sampleStd } from './stats'

// ───────────────────────────── inputs ─────────────────────────────

/** What a metric reads from one frame. */
export interface GeoInput {
  pts: NamedPoints
  /** The 36 face-oval vertices of the mesh in image pixels (F01's outline); null when the frame carries no mesh. */
  oval: readonly Point2[] | null
  /** Mean iris diameter in pixels (F23's scale). */
  irisPx: number
}

const finite = (p: Point2 | undefined): p is Point2 => p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y)

/** The oval of a mesh, or null when the point list is not the full mesh or a vertex is not a number. */
export function ovalOf(points: readonly Point2[] | undefined): Point2[] | null {
  if (!points) return null
  const oval: Point2[] = []
  for (const id of MESH.faceOval) {
    const p = points[id]
    if (!finite(p)) return null
    oval.push({ x: p.x, y: p.y })
  }
  return oval
}

/** Null when any named point is missing or not a number. */
export function geoFromFrame(frame: FaceFrame): GeoInput | null {
  const named = frame?.named as Partial<Record<NamedPoint, Point2>> | undefined
  if (!named) return null
  const pts = {} as NamedPoints
  for (const key of NAMED_POINTS) {
    const p = named[key]
    if (!finite(p)) return null
    pts[key] = { x: p.x, y: p.y }
  }
  return { pts, oval: ovalOf(frame.landmarks?.points), irisPx: frame.irisPx }
}

/** Per-coordinate median of several frames: a "typical" face for the floor and for the stored inputs. */
export function medianGeo(geos: readonly GeoInput[]): GeoInput {
  const pts = {} as NamedPoints
  for (const key of NAMED_POINTS) {
    pts[key] = { x: median(geos.map((g) => g.pts[key].x)), y: median(geos.map((g) => g.pts[key].y)) }
  }
  const ovals = geos.map((g) => g.oval)
  const oval =
    ovals.length > 0 && ovals.every((o): o is readonly Point2[] => o !== null)
      ? ovals[0]!.map((_, i) => ({ x: median(ovals.map((o) => o[i]!.x)), y: median(ovals.map((o) => o[i]!.y)) }))
      : null
  return { pts, oval, irisPx: median(geos.map((g) => g.irisPx)) }
}

// ───────────────────────────── landmark error assumptions ─────────────────────────────

/**
 * Assumed landmark error (one standard deviation, per coordinate) as a fraction of the pupil distance. ASSUMPTIONS, not
 * measurements: the repeatability of this mesh on a still face is well under a pixel at the face sizes the protocol
 * produces (pupil distance about 60–130 px), and its placement against the true anatomy is several times worse, so the
 * figures are deliberately generous. A fraction of the pupil distance is the natural unit: the same fraction is the same
 * error in every ratio whatever the camera resolution. Replace them with the user's own measured repeatability once
 * calibration day (M2) exists.
 */
export const LANDMARK_SIGMA_OF_IPD = {
  /** Iris centres and the pupil: a round, high-contrast target the model locks onto well. */
  iris: 0.005,
  /** Eye corners and lid midpoints: small targets, but sharp ones. */
  eye: 0.01,
  /** Brow points: the brow has no edge, so the model places it by context. */
  brow: 0.015,
  /** Nose points: nose wings and the base move with light and the exact view. */
  nose: 0.01,
  /** Lip edges: their position depends on light and on how the lips rest. */
  lip: 0.012,
  /** Chin tip: the lowest vertex of a rounded outline, easily one contour step off. */
  chin: 0.015,
  /** Face-outline points (cheek, jaw corner, outline extremes): the model slides along a contour with no landmark on it. */
  contour: 0.025,
} as const

const POINT_CLASS: Record<NamedPoint, keyof typeof LANDMARK_SIGMA_OF_IPD> = {
  pupilL: 'iris', pupilR: 'iris', irisCenterL: 'iris', irisCenterR: 'iris',
  eyeInnerL: 'eye', eyeInnerR: 'eye', eyeOuterL: 'eye', eyeOuterR: 'eye', eyeTopL: 'eye', eyeTopR: 'eye', eyeBottomL: 'eye', eyeBottomR: 'eye',
  browInnerL: 'brow', browInnerR: 'brow', browOuterL: 'brow', browOuterR: 'brow', browMidL: 'brow', browMidR: 'brow',
  zygionL: 'contour', zygionR: 'contour', gonionL: 'contour', gonionR: 'contour',
  noseTip: 'nose', subnasale: 'nose', nasion: 'nose', alarL: 'nose', alarR: 'nose',
  cupidBow: 'lip', upperLipTop: 'lip', upperLipBottom: 'lip', lowerLipTop: 'lip', lowerLipBottom: 'lip', cheilionL: 'lip', cheilionR: 'lip',
  chinTip: 'chin', menton: 'chin',
  // An extrapolation from the mesh, never a detected hairline. No M1 metric reads it, and it is classed with the
  // outline points so that a future metric that does read it cannot get a floor smaller than a contour point's.
  trichion: 'contour',
  faceTop: 'contour', faceLeft: 'contour', faceRight: 'contour', faceBottom: 'contour',
}

/** Published error of scaling pixels to millimetres by the iris (src/catalog/data/face.ts F23: "about 3–4% on average"). */
export const IRIS_SCALE_REL_ERROR = 0.035

// ───────────────────────────── geometry helpers ─────────────────────────────

interface PupilFrame {
  ipd: number
  X(p: Point2): number
  Y(p: Point2): number
}

/** The pupil-line frame (see the header). Null when the pupils coincide or are not numbers. */
function pupilFrame(pts: NamedPoints): PupilFrame | null {
  const a = pts.pupilR
  const b = pts.pupilL
  const dx = b.x - a.x
  const dy = b.y - a.y
  const ipd = Math.hypot(dx, dy)
  if (!(ipd > 0) || !Number.isFinite(ipd)) return null
  const ux = dx / ipd
  const uy = dy / ipd
  const ox = (a.x + b.x) / 2
  const oy = (a.y + b.y) / 2
  return {
    ipd,
    X: (p) => (p.x - ox) * ux + (p.y - oy) * uy,
    Y: (p) => -(p.x - ox) * uy + (p.y - oy) * ux,
  }
}

const RAD = 180 / Math.PI

/** Smallest height or width, as a share of the pupil distance, that is accepted as a real distance and not mesh noise. */
export const MIN_SEGMENT_OF_IPD = 0.01

export interface Computed {
  value: number
  inputs: Record<string, number>
}

// ───────────────────────────── F05 symmetry ─────────────────────────────

/** Left/right landmark pairs mirrored about the midline. */
export const SYMMETRY_PAIRS: readonly (readonly [NamedPoint, NamedPoint])[] = [
  ['pupilL', 'pupilR'],
  ['eyeInnerL', 'eyeInnerR'],
  ['eyeOuterL', 'eyeOuterR'],
  ['eyeTopL', 'eyeTopR'],
  ['eyeBottomL', 'eyeBottomR'],
  ['browInnerL', 'browInnerR'],
  ['browMidL', 'browMidR'],
  ['browOuterL', 'browOuterR'],
  ['zygionL', 'zygionR'],
  ['gonionL', 'gonionR'],
  ['alarL', 'alarR'],
  ['cheilionL', 'cheilionR'],
]

/** Landmarks that sit on the midline (cupidBow stands for the upper-lip vertex, chinTip for the menton: same mesh vertex). */
export const MIDLINE_POINTS: readonly NamedPoint[] = ['nasion', 'noseTip', 'subnasale', 'cupidBow', 'upperLipBottom', 'lowerLipBottom', 'chinTip']

export interface Midline {
  /** A point on the line (the mean of all pair midpoints and midline landmarks). */
  c: Point2
  /** Unit direction of the line. */
  u: Point2
}

/**
 * The line that best mirrors the face onto itself: the one that minimises the sum of squared gaps |L − mirror(R)| over
 * all pairs, midline landmarks counting as pairs of themselves. With d = L − R and m = the pair's midpoint, a line with
 * direction u through c leaves the gap² (d·u)² + 4((m − c)·n)², n ⟂ u. The best c is the mean of the m, and the best u is
 * the eigenvector of the smaller eigenvalue of A + 4JᵀBJ, A = Σ d dᵀ, B = Σ (m − m̄)(m − m̄)ᵀ, J = a quarter turn.
 * The image centre or the pupil line are NOT used: a face turned slightly in the frame is mirrored about its own axis.
 */
export function bestFitMidline(pairs: readonly (readonly [Point2, Point2])[], axis: readonly Point2[]): Midline | null {
  const items = [
    ...pairs.map(([l, r]) => ({ dx: l.x - r.x, dy: l.y - r.y, mx: (l.x + r.x) / 2, my: (l.y + r.y) / 2 })),
    ...axis.map((p) => ({ dx: 0, dy: 0, mx: p.x, my: p.y })),
  ]
  const n = items.length
  if (n < 2) return null
  const cx = items.reduce((s, i) => s + i.mx, 0) / n
  const cy = items.reduce((s, i) => s + i.my, 0) / n
  let axx = 0
  let axy = 0
  let ayy = 0
  let bxx = 0
  let bxy = 0
  let byy = 0
  for (const i of items) {
    axx += i.dx * i.dx
    axy += i.dx * i.dy
    ayy += i.dy * i.dy
    bxx += (i.mx - cx) ** 2
    bxy += (i.mx - cx) * (i.my - cy)
    byy += (i.my - cy) ** 2
  }
  // S = A + 4·JᵀBJ with JᵀBJ = [[byy, −bxy], [−bxy, bxx]]
  const a = axx + 4 * byy
  const b = axy - 4 * bxy
  const c = ayy + 4 * bxx
  if (![a, b, c, cx, cy].every(Number.isFinite)) return null
  const lambda = (a + c) / 2 - Math.hypot((a - c) / 2, b)
  const first = { x: b, y: lambda - a }
  const second = { x: lambda - c, y: b }
  const pick = Math.hypot(first.x, first.y) >= Math.hypot(second.x, second.y) ? first : second
  const len = Math.hypot(pick.x, pick.y)
  // A multiple of the identity: every direction fits equally; take the image vertical, the face's own axis.
  const u = len > 1e-12 ? { x: pick.x / len, y: pick.y / len } : { x: 0, y: 1 }
  return { c: { x: cx, y: cy }, u }
}

/** The reflection of p across the line. */
export function mirrorAcross(line: Midline, p: Point2): Point2 {
  const rx = p.x - line.c.x
  const ry = p.y - line.c.y
  const along = rx * line.u.x + ry * line.u.y
  return { x: line.c.x + 2 * along * line.u.x - rx, y: line.c.y + 2 * along * line.u.y - ry }
}

/** Angle in degrees from "perpendicular to the pupil line, pointing down" to the midline, wrapped to (−90, 90]. */
function midlineTilt(u: Point2, pts: NamedPoints): number {
  const dx = pts.pupilL.x - pts.pupilR.x
  const dy = pts.pupilL.y - pts.pupilR.y
  const len = Math.hypot(dx, dy)
  const vx = -dy / len
  const vy = dx / len
  let angle = Math.atan2(vx * u.y - vy * u.x, vx * u.x + vy * u.y) * RAD
  if (angle > 90) angle -= 180
  else if (angle <= -90) angle += 180
  return angle
}

function symmetry(g: GeoInput): Computed | null {
  const { pts } = g
  const ipd = dist(pts.pupilL, pts.pupilR)
  if (!(ipd > 0)) return null
  const pairs = SYMMETRY_PAIRS.map(([l, r]) => [pts[l], pts[r]] as const)
  const axis = MIDLINE_POINTS.map((k) => pts[k])
  const line = bestFitMidline(pairs, axis)
  if (!line) return null
  const gaps = [
    ...pairs.map(([l, r]) => dist(l, mirrorAcross(line, r))),
    // A midline landmark's partner is itself: its gap is the distance to its own mirror image, twice its offset from the line.
    ...axis.map((p) => dist(p, mirrorAcross(line, p))),
  ]
  const meanGap = gaps.reduce((s, x) => s + x, 0) / gaps.length
  return {
    value: (meanGap / ipd) * 100,
    inputs: {
      meanMismatchPx: meanGap,
      pupilDistancePx: ipd,
      landmarksCompared: gaps.length,
      // Tilt of the fitted midline from the line perpendicular to the pupil line, degrees; close to the head roll for a face with level eyes.
      midlineTiltDeg: midlineTilt(line.u, pts),
    },
  }
}

// ───────────────────────────── F01 facial adiposity ─────────────────────────────

/**
 * The F01 composite. Two face-shape cues that Coetzee et al. (2010) linked to BMI (catalog F01), each turned into a
 * z-like number and averaged:
 *
 *   outline  = face-outline length ÷ √(outline area)           (the catalog's perimeter ÷ area, made scale-free:
 *                                                               a plain perimeter ÷ area shrinks as the face gets
 *                                                               bigger in the picture, this does not)
 *   cheekJaw = cheek width ÷ jaw width                        (the same ratio as F17)
 *   index    = 50 + INDEX_POINTS_PER_SD · (z_outline + z_cheekJaw) / 2,   z = (reference − measured) / SD, clamped 0–100
 *
 * Both cues FALL as the lower face fills out (a fuller outline is rounder, which lowers length ÷ √area, and a wider jaw
 * lowers cheek ÷ jaw), so a higher index means a fuller-looking face, matching "lower = leaner-looking" in the catalog.
 *
 * What this is NOT. It is a PROXY for the look of face fat, not a body-fat or BMI reading. The composite as a whole is
 * not validated by any cited source (catalog evidenceNote), and the reference values below only fix the origin and the
 * unit of the index: the metric is scored against the user's own first scan (personal_baseline), never against these.
 * REFERENCE values are the two measurements taken on the single stock portrait of the test fixtures; the SDs and the
 * 15 points per SD are assumptions. Changing any of them moves every index by the same affine map and invalidates
 * stored baselines, so it needs a new ALGO_VERSION.
 */
export const F01_COMPOSITE = {
  outlineReference: 3.63,
  outlineSd: 0.06,
  cheekJawReference: 1.25,
  cheekJawSd: 0.07,
  indexPointsPerSd: 15,
} as const

/** Shoelace area and edge-length sum of a closed polygon. */
export function polygonStats(poly: readonly Point2[]): { area: number; perimeter: number } | null {
  if (poly.length < 3) return null
  let twice = 0
  let perimeter = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    twice += p.x * q.y - q.x * p.y
    perimeter += dist(p, q)
  }
  const area = Math.abs(twice) / 2
  return area > 0 && perimeter > 0 ? { area, perimeter } : null
}

function adiposity(g: GeoInput): Computed | null {
  if (!g.oval) return null
  const frame = pupilFrame(g.pts)
  const poly = polygonStats(g.oval)
  if (!frame || !poly) return null
  const cheek = Math.abs(frame.X(g.pts.zygionL) - frame.X(g.pts.zygionR))
  const jaw = Math.abs(frame.X(g.pts.gonionL) - frame.X(g.pts.gonionR))
  if (!(jaw > MIN_SEGMENT_OF_IPD * frame.ipd) || !(cheek > 0)) return null
  const outline = poly.perimeter / Math.sqrt(poly.area)
  const cheekJaw = cheek / jaw
  const c = F01_COMPOSITE
  const zOutline = (c.outlineReference - outline) / c.outlineSd
  const zCheekJaw = (c.cheekJawReference - cheekJaw) / c.cheekJawSd
  return {
    value: clamp(50 + (c.indexPointsPerSd * (zOutline + zCheekJaw)) / 2, 0, 100),
    inputs: {
      outlineLengthOverRootArea: outline,
      cheekToJawRatio: cheekJaw,
      outlineZ: zOutline,
      cheekJawZ: zCheekJaw,
      outlineLengthPx: poly.perimeter,
      outlineAreaPx2: poly.area,
    },
  }
}

// ───────────────────────────── the proportion metrics ─────────────────────────────

function fifths(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  const gap = Math.abs(f.X(pts.eyeInnerL) - f.X(pts.eyeInnerR))
  const eyeWidth = (Math.abs(f.X(pts.eyeOuterL) - f.X(pts.eyeInnerL)) + Math.abs(f.X(pts.eyeOuterR) - f.X(pts.eyeInnerR))) / 2
  if (!(eyeWidth > MIN_SEGMENT_OF_IPD * f.ipd) || !(gap > 0)) return null
  return { value: gap / eyeWidth, inputs: { innerEyeGapPx: gap, eyeWidthPx: eyeWidth, pupilDistancePx: f.ipd } }
}

function eyeSpacing(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const width = Math.abs(f.X(g.pts.zygionL) - f.X(g.pts.zygionR))
  if (!(width > 0)) return null
  return { value: (f.ipd / width) * 100, inputs: { pupilDistancePx: f.ipd, faceWidthPx: width } }
}

function fwhr(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  const width = Math.abs(f.X(pts.zygionL) - f.X(pts.zygionR))
  const browLine = (f.Y(pts.browMidL) + f.Y(pts.browMidR)) / 2
  const height = f.Y(pts.upperLipTop) - browLine
  if (!(width > 0) || !(height > MIN_SEGMENT_OF_IPD * f.ipd)) return null
  return { value: width / height, inputs: { faceWidthPx: width, browToUpperLipPx: height } }
}

function midface(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  // The pupil line is y = 0 in this frame, so the upper lip's y is the pupil-to-lip height.
  const height = f.Y(g.pts.upperLipTop)
  if (!(height > MIN_SEGMENT_OF_IPD * f.ipd)) return null
  return { value: f.ipd / height, inputs: { pupilDistancePx: f.ipd, pupilToUpperLipPx: height } }
}

function canthalTilt(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  // Positive = the outer corner is higher (smaller y) than the inner corner, measured against the pupil line.
  const tilt = (inner: Point2, outer: Point2): number | null => {
    const run = Math.abs(f.X(outer) - f.X(inner))
    if (!(run > MIN_SEGMENT_OF_IPD * f.ipd)) return null
    return Math.atan2(f.Y(inner) - f.Y(outer), run) * RAD
  }
  const left = tilt(pts.eyeInnerL, pts.eyeOuterL)
  const right = tilt(pts.eyeInnerR, pts.eyeOuterR)
  if (left === null || right === null) return null
  return { value: (left + right) / 2, inputs: { tiltLeftEyeDeg: left, tiltRightEyeDeg: right } }
}

function noseWidth(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  const nose = Math.abs(f.X(pts.alarL) - f.X(pts.alarR))
  const gap = Math.abs(f.X(pts.eyeInnerL) - f.X(pts.eyeInnerR))
  if (!(gap > MIN_SEGMENT_OF_IPD * f.ipd) || !(nose > 0)) return null
  return { value: nose / gap, inputs: { noseWidthPx: nose, innerEyeGapPx: gap } }
}

function lipProportion(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  const upper = f.Y(pts.upperLipBottom) - f.Y(pts.upperLipTop)
  const lower = f.Y(pts.lowerLipBottom) - f.Y(pts.lowerLipTop)
  const min = MIN_SEGMENT_OF_IPD * f.ipd
  if (!(upper > min) || !(lower > min)) return null
  return { value: lower / upper, inputs: { upperLipHeightPx: upper, lowerLipHeightPx: lower } }
}

/** The mouth line: where the lips meet (the middle of the two inner-lip vertices). */
const stomionY = (f: PupilFrame, pts: NamedPoints): number => (f.Y(pts.upperLipBottom) + f.Y(pts.lowerLipTop)) / 2

function lowerThird(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  const mouth = stomionY(f, pts)
  const upper = mouth - f.Y(pts.subnasale)
  const lower = f.Y(pts.chinTip) - mouth
  const min = MIN_SEGMENT_OF_IPD * f.ipd
  if (!(upper > min) || !(lower > min)) return null
  return { value: lower / upper, inputs: { noseBaseToMouthPx: upper, mouthToChinPx: lower } }
}

function cheekbones(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  const cheek = Math.abs(f.X(pts.zygionL) - f.X(pts.zygionR))
  const jaw = Math.abs(f.X(pts.gonionL) - f.X(pts.gonionR))
  if (!(jaw > MIN_SEGMENT_OF_IPD * f.ipd) || !(cheek > 0)) return null
  return { value: cheek / jaw, inputs: { cheekboneWidthPx: cheek, jawWidthPx: jaw } }
}

function philtrum(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const length = f.Y(g.pts.upperLipTop) - f.Y(g.pts.subnasale)
  if (!(length > MIN_SEGMENT_OF_IPD * f.ipd)) return null
  return { value: (length / f.ipd) * 100, inputs: { philtrumLengthPx: length, pupilDistancePx: f.ipd } }
}

function ipdMillimetres(g: GeoInput): Computed | null {
  const ipd = dist(g.pts.pupilL, g.pts.pupilR)
  if (!(ipd > 0) || !(g.irisPx > 0) || !Number.isFinite(g.irisPx)) return null
  return { value: (ipd * IRIS_DIAMETER_MM) / g.irisPx, inputs: { pupilDistancePx: ipd, irisDiameterPx: g.irisPx, assumedIrisMm: IRIS_DIAMETER_MM } }
}

/** The golden ratio the "phi mask" claims. */
export const PHI = (1 + Math.sqrt(5)) / 2

/**
 * F21 – the golden-ratio "phi mask" fit. Computed from the same points as the other metrics (nose width as in F14, the
 * mouth-to-chin split as in F16). The catalog calls the whole idea a MYTH and the metric is never scored; the number is
 * shown for curiosity only. The original mask needs a hairline, which the mesh cannot give, so only two of its ratios
 * can be read, and the value is the mean absolute deviation from 1.618 (in percent) over those two:
 *   mouth width ÷ nose width                          (alar to alar)
 *   nose base to chin ÷ mouth line to chin
 * 0 = both ratios exactly 1.618.
 */
function phiFit(g: GeoInput): Computed | null {
  const f = pupilFrame(g.pts)
  if (!f) return null
  const { pts } = g
  const mouth = Math.abs(f.X(pts.cheilionL) - f.X(pts.cheilionR))
  const nose = Math.abs(f.X(pts.alarL) - f.X(pts.alarR))
  const mouthY = stomionY(f, pts)
  const baseToChin = f.Y(pts.chinTip) - f.Y(pts.subnasale)
  const mouthToChin = f.Y(pts.chinTip) - mouthY
  const min = MIN_SEGMENT_OF_IPD * f.ipd
  if (!(nose > min) || !(mouth > 0) || !(mouthToChin > min) || !(baseToChin > mouthToChin)) return null
  const r1 = mouth / nose
  const r2 = baseToChin / mouthToChin
  const deviation = (Math.abs(r1 - PHI) / PHI + Math.abs(r2 - PHI) / PHI) / 2
  return { value: deviation * 100, inputs: { mouthOverNoseWidth: r1, noseBaseToChinOverMouthToChin: r2, goldenRatio: PHI } }
}

// ───────────────────────────── the registry ─────────────────────────────

export const FRONTAL_METRIC_IDS = ['F01', 'F05', 'F07', 'F08', 'F10', 'F11', 'F12', 'F14', 'F15', 'F16', 'F17', 'F21', 'F22', 'F23'] as const
export type FrontalMetricId = (typeof FRONTAL_METRIC_IDS)[number]

export interface FrontalDef {
  id: FrontalMetricId
  method: Method
  /** The unit stored with the measurement: the catalog's, except F21 (see below). */
  unit: string
  /** Every named point the formula reads, including those that fix the pupil-line frame. A test checks this list is exact. */
  uses: readonly NamedPoint[]
  usesOval: boolean
  usesIris: boolean
  /** Share of the value that the method adds as error regardless of landmarks (F23's iris scaling). */
  methodRelError: number
  /** What it means when the formula returns null, for the refusal text. */
  implausible: string
  compute(g: GeoInput): Computed | null
}

const PUPILS: readonly NamedPoint[] = ['pupilL', 'pupilR']
const catalogUnit = (id: string): string => getMetric(id)?.scale.unit ?? ''

const def = (d: Omit<FrontalDef, 'unit' | 'usesOval' | 'usesIris' | 'methodRelError' | 'method'> & Partial<Pick<FrontalDef, 'usesOval' | 'usesIris' | 'methodRelError' | 'method' | 'unit'>>): FrontalDef => ({
  method: 'AUTO_FRONTAL_PHOTO',
  unit: catalogUnit(d.id),
  usesOval: false,
  usesIris: false,
  methodRelError: 0,
  ...d,
})

export const FRONTAL_DEFS: Record<FrontalMetricId, FrontalDef> = {
  F01: def({
    id: 'F01',
    uses: [...PUPILS, 'zygionL', 'zygionR', 'gonionL', 'gonionR'],
    usesOval: true,
    implausible: 'the face outline or the jaw width could not be measured',
    compute: adiposity,
  }),
  F05: def({
    id: 'F05',
    uses: [...new Set<NamedPoint>([...SYMMETRY_PAIRS.flat(), ...MIDLINE_POINTS])],
    implausible: 'the midline could not be fitted',
    compute: symmetry,
  }),
  F07: def({
    id: 'F07',
    uses: [...PUPILS, 'eyeInnerL', 'eyeInnerR', 'eyeOuterL', 'eyeOuterR'],
    implausible: 'the eye corners were out of order or collapsed',
    compute: fifths,
  }),
  F08: def({
    id: 'F08',
    uses: [...PUPILS, 'zygionL', 'zygionR'],
    implausible: 'the cheekbone points collapsed',
    compute: eyeSpacing,
  }),
  F10: def({
    id: 'F10',
    uses: [...PUPILS, 'zygionL', 'zygionR', 'browMidL', 'browMidR', 'upperLipTop'],
    implausible: 'the brow line was not above the upper lip',
    compute: fwhr,
  }),
  F11: def({
    id: 'F11',
    uses: [...PUPILS, 'upperLipTop'],
    implausible: 'the upper lip was not below the pupil line',
    compute: midface,
  }),
  F12: def({
    id: 'F12',
    uses: [...PUPILS, 'eyeInnerL', 'eyeInnerR', 'eyeOuterL', 'eyeOuterR'],
    implausible: 'the eye corners were out of order or collapsed',
    compute: canthalTilt,
  }),
  F14: def({
    id: 'F14',
    uses: [...PUPILS, 'alarL', 'alarR', 'eyeInnerL', 'eyeInnerR'],
    implausible: 'the nose-wing or inner-eye points collapsed',
    compute: noseWidth,
  }),
  F15: def({
    id: 'F15',
    uses: [...PUPILS, 'upperLipTop', 'upperLipBottom', 'lowerLipTop', 'lowerLipBottom'],
    implausible: 'the lip edges were out of order (upper lip top, where the lips meet, lower lip bottom)',
    compute: lipProportion,
  }),
  F16: def({
    id: 'F16',
    uses: [...PUPILS, 'subnasale', 'upperLipBottom', 'lowerLipTop', 'chinTip'],
    implausible: 'the nose base, mouth line and chin were out of order',
    compute: lowerThird,
  }),
  F17: def({
    id: 'F17',
    uses: [...PUPILS, 'zygionL', 'zygionR', 'gonionL', 'gonionR'],
    implausible: 'the jaw-corner points collapsed',
    compute: cheekbones,
  }),
  F21: def({
    id: 'F21',
    method: 'COMPUTED_FROM_OTHER_METRICS',
    // The catalog's unit for this myth card is "n/a", which cannot describe a number.
    unit: '% from 1.618',
    uses: [...PUPILS, 'cheilionL', 'cheilionR', 'alarL', 'alarR', 'subnasale', 'upperLipBottom', 'lowerLipTop', 'chinTip'],
    implausible: 'the nose, mouth and chin points were out of order',
    compute: phiFit,
  }),
  F22: def({
    id: 'F22',
    uses: [...PUPILS, 'subnasale', 'upperLipTop'],
    implausible: 'the upper lip was not below the base of the nose',
    compute: philtrum,
  }),
  F23: def({
    id: 'F23',
    uses: [...PUPILS],
    usesIris: true,
    methodRelError: IRIS_SCALE_REL_ERROR,
    implausible: 'the pupils or the iris could not be measured',
    compute: ipdMillimetres,
  }),
}

// ───────────────────────────── per-frame values, the floor, the combination ─────────────────────────────

export function frameValue(d: FrontalDef, g: GeoInput): number | null {
  const v = d.compute(g)?.value
  return v !== undefined && Number.isFinite(v) ? v : null
}

function movePoint(g: GeoInput, key: NamedPoint, axis: 'x' | 'y', delta: number): GeoInput {
  const p = g.pts[key]
  return { ...g, pts: { ...g.pts, [key]: { x: p.x + (axis === 'x' ? delta : 0), y: p.y + (axis === 'y' ? delta : 0) } } }
}

function moveOval(g: GeoInput, index: number, axis: 'x' | 'y', delta: number): GeoInput {
  const oval = (g.oval as readonly Point2[]).map((p, i) => (i === index ? { x: p.x + (axis === 'x' ? delta : 0), y: p.y + (axis === 'y' ? delta : 0) } : p))
  return { ...g, oval }
}

/**
 * Landmark-error floor of a metric at geometry `g`, in the metric's unit. Every input coordinate is moved by ±its assumed
 * error (LANDMARK_SIGMA_OF_IPD × the pupil distance) and the root-mean-square change of the metric is taken; the
 * contributions of all coordinates are then added in quadrature (errors treated as independent). A one-sided RMS rather
 * than a derivative is used on purpose: for F05 the metric sits at a kink (a perfectly symmetric face has zero gaps and
 * any jitter can only raise them), where a derivative would give zero. F23 adds its iris-scaling error.
 */
export function landmarkFloor(d: FrontalDef, g: GeoInput): number | null {
  const centre = frameValue(d, g)
  if (centre === null) return null
  const ipd = dist(g.pts.pupilL, g.pts.pupilR)
  const terms: number[] = []
  const rms = (move: (delta: number) => GeoInput, sigma: number): number => {
    let acc = 0
    for (const sign of [1, -1]) {
      const v = frameValue(d, move(sign * sigma))
      if (v !== null) acc += (v - centre) ** 2
    }
    return Math.sqrt(acc / 2)
  }
  for (const key of d.uses) {
    const sigma = LANDMARK_SIGMA_OF_IPD[POINT_CLASS[key]] * ipd
    for (const axis of ['x', 'y'] as const) terms.push(rms((delta) => movePoint(g, key, axis, delta), sigma))
  }
  if (d.usesOval && g.oval) {
    const sigma = LANDMARK_SIGMA_OF_IPD.contour * ipd
    g.oval.forEach((_, i) => {
      for (const axis of ['x', 'y'] as const) terms.push(rms((delta) => moveOval(g, i, axis, delta), sigma))
    })
  }
  if (d.usesIris) {
    // The iris diameter is the mean of two eyes whose edge points each carry the iris-class error.
    const sigma = LANDMARK_SIGMA_OF_IPD.iris * ipd
    terms.push(rms((delta) => ({ ...g, irisPx: g.irisPx + delta }), sigma))
  }
  return quadrature([quadrature(terms), d.methodRelError * Math.abs(centre)])
}

export interface Combined {
  /** Median of the per-frame values. */
  value: number
  /** Sample standard deviation of the per-frame values; 0 when only one frame gave a value. */
  spread: number
  /** Landmark-error floor at the median geometry, in the metric's unit. */
  floor: number
  /** max(spread, floor). */
  uncertainty: number
  /** Frames that gave a value. */
  nFrames: number
  values: number[]
  /** The median geometry the floor and the stored inputs were taken at. */
  geo: GeoInput
  inputs: Record<string, number>
}

/** Combines the burst: per-frame values → median value, spread, floor, uncertainty. Null if no frame gave a value. */
export function combineFrames(d: FrontalDef, geos: readonly GeoInput[]): Combined | null {
  const usable = geos.filter((g) => frameValue(d, g) !== null)
  if (usable.length === 0) return null
  const values = usable.map((g) => frameValue(d, g) as number)
  const value = median(values)
  const std = sampleStd(values)
  const spread = Number.isFinite(std) ? std : 0
  const geo = medianGeo(usable)
  const floor = landmarkFloor(d, geo) ?? 0
  const inputs = d.compute(geo)?.inputs ?? {}
  return {
    value: round(value),
    spread: round(spread),
    floor: round(floor),
    uncertainty: round(Math.max(spread, floor)),
    nFrames: usable.length,
    values,
    geo,
    inputs,
  }
}
