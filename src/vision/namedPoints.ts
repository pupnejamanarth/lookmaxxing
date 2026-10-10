/**
 * Maps the 478-point MediaPipe face mesh to the named anatomical points of src/vision/types.ts.
 *
 * Mesh ids are the canonical MediaPipe Face Mesh vertex numbers (468 face vertices + 2×5 iris vertices).
 * Sides follow types.ts: "L" = the SUBJECT's left = the viewer's right on a non-mirrored image (larger x),
 * so subject-left mesh ids are the ones MediaPipe calls "left" (263, 362, 473 …).
 *
 * All of these are SOFT-TISSUE points on a model fit, not bone landmarks:
 *  - zygion / gonion are the widest cheek point and the jaw-corner vertex on the visible face contour,
 *    not the bones those words name in anthropometry;
 *  - nasion is the mesh vertex at the root of the nose between the eyes;
 *  - trichion is an ESTIMATE, see estimateTrichion().
 * Verified by eye on tests/fixtures/portrait.jpg (tests/e2e/vision.spec.ts draws every point with its label).
 */
import { midpoint } from './geometry'
import { NAMED_POINTS } from './types'
import type { FaceLandmarks, NamedPoint, NamedPoints, Point2 } from './types'

export const MESH_POINT_COUNT = 478

/** Canonical mesh vertex ids, grouped by facial feature. R = subject's right (viewer's left), L = subject's left. */
export const MESH = {
  irisCenterR: 468,
  irisCenterL: 473,
  irisRingR: [469, 470, 471, 472],
  irisRingL: [474, 475, 476, 477],

  eyeOuterR: 33,
  eyeInnerR: 133,
  eyeOuterL: 263,
  eyeInnerL: 362,
  /** Middle of the upper / lower lid margin. */
  eyeTopR: 159,
  eyeBottomR: 145,
  eyeTopL: 386,
  eyeBottomL: 374,

  /** Brow ends and middle, each as [upper edge, lower edge]; the named point is the centre line between the two. */
  browInnerR: [107, 55],
  browMidR: [105, 52],
  browOuterR: [70, 46],
  browInnerL: [336, 285],
  browMidL: [334, 282],
  browOuterL: [300, 276],

  noseTip: 1,
  subnasale: 2,
  nasion: 168,
  alarR: 129,
  alarL: 358,

  /** Centre of the upper-lip vermilion border (the bow's central notch), top of the upper lip. */
  upperLipTop: 0,
  /** Where the lips meet, upper side / lower side. */
  upperLipBottom: 13,
  lowerLipTop: 14,
  lowerLipBottom: 17,
  cheilionR: 61,
  cheilionL: 291,

  chinTip: 152,
  faceTop: 10,
  /** Forehead vertices used to extend the face upward when estimating the hairline. */
  glabella: 9,

  /**
   * Widest points of the cheek on the face oval, at about the level of the nose base, just in front of the ear.
   * A fixed vertex (not "whichever oval vertex is widest") so the same point is measured scan after scan.
   */
  zygionR: 234,
  zygionL: 454,
  /** Jaw-corner vertices: where the jaw outline turns from rising toward the ear to running toward the chin. */
  gonionR: 172,
  gonionL: 397,
  /** The whole face oval (36 vertices), used for the outline extremes. */
  faceOval: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ],
} as const

/**
 * How far above the mesh's top vertex (10) the hairline is assumed to sit, as a fraction of the distance from the
 * glabella (9, between the brows) up to vertex 10.
 *
 * The mesh stops inside the forehead and nothing in the image says where the hair starts, so the hairline is a
 * geometric extrapolation, not a detection. 0.6 is the value that lands on the visible hairline of the one fixture
 * photo (tests/fixtures/portrait.jpg: the hairline sits 0.65 of that segment above vertex 10; 0.6 was kept slightly
 * short). That is a single face: the error on any other forehead is UNMEASURED and certainly not smaller than the spread
 * of real hairline heights between men (order of 10 mm), and it is unbounded for a receding or very low hairline or
 * hair or a hat over the forehead. Never score it as a hairline measurement; anything that uses it must say "estimated
 * from the face mesh, not the visible hairline".
 */
export const TRICHION_EXTENSION = 0.6

function at(points: readonly Point2[], id: number): Point2 {
  const p = points[id]
  if (!p) throw new RangeError(`face mesh has no vertex ${id}`)
  return { x: p.x, y: p.y }
}

function mean(points: readonly Point2[], ids: readonly number[]): Point2 {
  let x = 0
  let y = 0
  for (const id of ids) {
    const p = at(points, id)
    x += p.x
    y += p.y
  }
  return { x: x / ids.length, y: y / ids.length }
}

/** Iris centre, averaged with the centroid of its four edge points to halve single-vertex jitter. */
function pupilOf(points: readonly Point2[], center: number, ring: readonly number[]): Point2 {
  return midpoint(at(points, center), mean(points, ring))
}

/** Hairline estimate; see TRICHION_EXTENSION for what it is and how wrong it can be. */
export function estimateTrichion(faceTop: Point2, glabella: Point2): Point2 {
  return {
    x: faceTop.x + (faceTop.x - glabella.x) * TRICHION_EXTENSION,
    y: faceTop.y + (faceTop.y - glabella.y) * TRICHION_EXTENSION,
  }
}

/** Every NamedPoint in image pixels. Throws RangeError if the mesh is not the 478-point one. */
export function namedPointsFromLandmarks(lm: FaceLandmarks): NamedPoints {
  const pts = lm.points
  if (pts.length < MESH_POINT_COUNT) {
    throw new RangeError(`expected ${MESH_POINT_COUNT} face-mesh points, got ${pts.length}`)
  }
  const p = (id: number) => at(pts, id)

  const pupilR = pupilOf(pts, MESH.irisCenterR, MESH.irisRingR)
  const pupilL = pupilOf(pts, MESH.irisCenterL, MESH.irisRingL)

  // Extremes of the face oval along the image axes. y grows downward, so "top" is the smallest y; the subject's
  // left is the larger x (types.ts), so faceLeft is the largest x.
  const oval = MESH.faceOval.map(p)
  const extreme = (better: (a: Point2, b: Point2) => boolean): Point2 => oval.reduce((best, q) => (better(q, best) ? q : best))
  const ovalTop = extreme((a, b) => a.y < b.y)
  const ovalBottom = extreme((a, b) => a.y > b.y)
  const ovalLeft = extreme((a, b) => a.x > b.x)
  const ovalRight = extreme((a, b) => a.x < b.x)

  const faceTop = p(MESH.faceTop)

  const named: NamedPoints = {
    pupilL,
    pupilR,
    irisCenterL: p(MESH.irisCenterL),
    irisCenterR: p(MESH.irisCenterR),

    eyeInnerL: p(MESH.eyeInnerL),
    eyeInnerR: p(MESH.eyeInnerR),
    eyeOuterL: p(MESH.eyeOuterL),
    eyeOuterR: p(MESH.eyeOuterR),
    eyeTopL: p(MESH.eyeTopL),
    eyeTopR: p(MESH.eyeTopR),
    eyeBottomL: p(MESH.eyeBottomL),
    eyeBottomR: p(MESH.eyeBottomR),

    browInnerL: mean(pts, MESH.browInnerL),
    browInnerR: mean(pts, MESH.browInnerR),
    browOuterL: mean(pts, MESH.browOuterL),
    browOuterR: mean(pts, MESH.browOuterR),
    browMidL: mean(pts, MESH.browMidL),
    browMidR: mean(pts, MESH.browMidR),

    zygionL: p(MESH.zygionL),
    zygionR: p(MESH.zygionR),
    gonionL: p(MESH.gonionL),
    gonionR: p(MESH.gonionR),

    noseTip: p(MESH.noseTip),
    subnasale: p(MESH.subnasale),
    nasion: p(MESH.nasion),
    alarL: p(MESH.alarL),
    alarR: p(MESH.alarR),

    // The mesh has one vertex at the bow's central notch; the two bow peaks are not exposed, so the
    // bow and the top of the upper lip are the same point.
    cupidBow: p(MESH.upperLipTop),
    upperLipTop: p(MESH.upperLipTop),
    upperLipBottom: p(MESH.upperLipBottom),
    lowerLipTop: p(MESH.lowerLipTop),
    lowerLipBottom: p(MESH.lowerLipBottom),
    cheilionL: p(MESH.cheilionL),
    cheilionR: p(MESH.cheilionR),

    // Frontal 2D has no separate pogonion; the lowest chin vertex is both the chin tip and the menton.
    chinTip: p(MESH.chinTip),
    menton: p(MESH.chinTip),

    trichion: estimateTrichion(faceTop, p(MESH.glabella)),

    faceTop: ovalTop,
    faceBottom: ovalBottom,
    faceLeft: ovalLeft,
    faceRight: ovalRight,
  }

  // The record must carry exactly the contract's keys, nothing missing and nothing extra.
  const keys = Object.keys(named)
  if (keys.length !== NAMED_POINTS.length || !NAMED_POINTS.every((k: NamedPoint) => k in named)) {
    throw new Error('namedPointsFromLandmarks does not match NAMED_POINTS')
  }
  return named
}
