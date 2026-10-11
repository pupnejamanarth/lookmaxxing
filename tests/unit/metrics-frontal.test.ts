/**
 * Frontal metrics on SYNTHETIC faces only: a face built from analytic geometry with chosen proportions, so every metric
 * has a known right answer, plus controlled perturbations. No photo, no real person.
 */
import { describe, expect, it } from 'vitest'
import { NEUTRAL_RULES, QC_LIMITS, assumedHfovDeg } from '../../src/capture/qc'
import { getMetric } from '../../src/catalog'
import type { Measurement, QcCheck, ScanRecord, ShotQc } from '../../src/domain/types'
import {
  ALGO_VERSION,
  FRONTAL_DEFS,
  FRONTAL_METRIC_IDS,
  GATE_PROFILES,
  computeFrontalMetrics,
  landmarkFloor,
} from '../../src/metrics'
import {
  F01_COMPOSITE,
  IRIS_SCALE_REL_ERROR,
  LANDMARK_SIGMA_OF_IPD,
  PHI,
  bestFitMidline,
  geoFromFrame,
  mirrorAcross,
} from '../../src/metrics/frontal'
import type { FrontalMetricId } from '../../src/metrics/frontal'
import {
  QC_FACTOR,
  analyseScan,
  distanceFactor,
  gateProfileFor,
  qcFactorFor,
} from '../../src/metrics/refusals'
import { sampleStd } from '../../src/metrics/stats'
import { lintTone, renderRefusal, scoreMetric, scoreScan } from '../../src/scoring'
import { verifyScanRows } from '../../src/store/scans'
import { MESH } from '../../src/vision/namedPoints'
import { NAMED_POINTS } from '../../src/vision/types'
import type { FaceFrame, NamedPoint, NamedPoints, Point2, Point3 } from '../../src/vision/types'

// ───────────────────────────── a synthetic face from analytic geometry ─────────────────────────────

const W = 1080
const H = 1920
const FOCAL_PX = W / 2 / Math.tan((assumedHfovDeg(W, H) / 2) * (Math.PI / 180))
/** Pupil distance in px of a 63 mm pupil distance at `d` metres, with the capture module's assumed field of view. */
const ipdPxAt = (d: number): number => (FOCAL_PX * 0.063) / d
const RAD = Math.PI / 180

/** The proportions a face is built from. Each field is the KNOWN ANSWER of the metric named in its comment. */
interface FaceSpec {
  /** F07: inner-eye gap ÷ eye width */
  fifths: number
  /** F08: pupil distance as % of the cheekbone width */
  eyeSpacing: number
  /** F10: cheekbone width ÷ (mid-brow to upper lip) */
  fwhr: number
  /** F11: pupil distance ÷ (pupil line to upper lip) */
  midface: number
  /** F12: canthal tilt, degrees */
  tilt: number
  /** F14: nose-wing width ÷ inner-eye gap */
  noseOverGap: number
  /** F15: lower-lip height ÷ upper-lip height */
  lipRatio: number
  /** F16: (mouth line to chin) ÷ (nose base to mouth line) */
  thirds: number
  /** F17: cheekbone width ÷ jaw width */
  cheekJaw: number
  /** F22: philtrum length as % of pupil distance */
  philtrum: number
  /** F21 input: mouth width ÷ nose width */
  mouthOverNose: number
}

const BASE: FaceSpec = {
  fifths: 1.1,
  eyeSpacing: 46,
  fwhr: 1.6,
  midface: 1.0,
  tilt: 3,
  noseOverGap: 1.05,
  lipRatio: 1.6,
  thirds: 2.0,
  cheekJaw: 1.3,
  philtrum: 24,
  mouthOverNose: 1.6,
}

const OTHER: FaceSpec = {
  fifths: 1.25,
  eyeSpacing: 44,
  fwhr: 1.9,
  midface: 1.12,
  tilt: -3.5,
  noseOverGap: 1.3,
  lipRatio: 1.4,
  thirds: 2.3,
  cheekJaw: 1.36,
  philtrum: 27,
  mouthOverNose: 1.45,
}

type Pt = [number, number]
/** Geometry in units where the pupil distance is 100 and the origin is the middle of the pupils (y down). */
interface UnitFace {
  named: Record<NamedPoint, Pt>
  oval: Pt[]
  yTop: number
  yChin: number
  yMouth: number
  ySubnasale: number
  yUpperLip: number
}

function unitFace(s: FaceSpec): UnitFace {
  const eye = 45
  const gap = s.fifths * eye
  const cheek = 100 / (s.eyeSpacing / 100)
  const jaw = cheek / s.cheekJaw
  const yUL = 100 / s.midface
  const ySn = yUL - s.philtrum
  const upperLip = 7
  const yMouth = yUL + upperLip
  const yLowerBottom = yMouth + s.lipRatio * upperLip
  const yChin = yMouth + s.thirds * (yMouth - ySn)
  const browY = yUL - cheek / s.fwhr
  const noseW = s.noseOverGap * gap
  const mouthW = s.mouthOverNose * noseW
  const dy = (eye / 2) * Math.tan(s.tilt * RAD)

  const yTop = -95
  const cy = (yTop + yChin) / 2
  const a = cheek / 2
  const b = (yChin - yTop) / 2
  const oval: Pt[] = Array.from({ length: 36 }, (_, k) => {
    const t = (-90 + 10 * k) * RAD
    return [a * Math.cos(t), cy + b * Math.sin(t)] as Pt
  })

  const pair = (name: string, x: number, y: number): Record<string, Pt> => ({ [`${name}L`]: [x, y], [`${name}R`]: [-x, y] })
  const named = {
    ...pair('pupil', 50, 0),
    ...pair('irisCenter', 50, 0),
    ...pair('eyeInner', gap / 2, dy),
    ...pair('eyeOuter', gap / 2 + eye, -dy),
    ...pair('eyeTop', 50, -6),
    ...pair('eyeBottom', 50, 6),
    ...pair('browInner', 24, -30),
    ...pair('browMid', 55, browY),
    ...pair('browOuter', 85, -28),
    ...pair('zygion', cheek / 2, 50),
    ...pair('gonion', jaw / 2, 130),
    ...pair('alar', noseW / 2, ySn - 3),
    ...pair('cheilion', mouthW / 2, yMouth),
    noseTip: [0, ySn - 8],
    subnasale: [0, ySn],
    nasion: [0, -6],
    cupidBow: [0, yUL],
    upperLipTop: [0, yUL],
    upperLipBottom: [0, yMouth],
    lowerLipTop: [0, yMouth],
    lowerLipBottom: [0, yLowerBottom],
    chinTip: [0, yChin],
    menton: [0, yChin],
    trichion: [0, -135],
    faceTop: [0, yTop],
    faceBottom: [0, yChin],
    faceLeft: [a, cy],
    faceRight: [-a, cy],
  } as Record<NamedPoint, Pt>
  return { named, oval, yTop, yChin, yMouth, ySubnasale: ySn, yUpperLip: yUL }
}

const neutralBlendshapes = (): Record<string, number> => Object.fromEntries(NEUTRAL_RULES.flatMap((r) => r.keys).map((k) => [k, 0.03]))

interface FrameOptions {
  distanceM?: number
  ipdPx?: number
  centre?: Point2
  pose?: Partial<FaceFrame['pose']>
  /** Rotation of the drawn face, degrees clockwise on screen. Defaults to the pose roll. */
  rotateDeg?: number
  blendshapes?: Record<string, number>
  /** Applied to the named points in pixels after the face is placed. */
  edit?: (named: NamedPoints) => void
  noMesh?: boolean
  irisPx?: number
  irisRingPx?: { left: number; right: number }
}

function makeFrame(spec: FaceSpec, o: FrameOptions = {}): FaceFrame {
  const u = unitFace(spec)
  const ipdPx = o.ipdPx ?? ipdPxAt(o.distanceM ?? 1.6)
  const k = ipdPx / 100
  const phi = (o.rotateDeg ?? o.pose?.roll ?? 0) * RAD
  const centre = o.centre ?? { x: W / 2, y: 900 }
  const place = ([x, y]: Pt): Point2 => ({
    x: centre.x + k * (x * Math.cos(phi) - y * Math.sin(phi)),
    y: centre.y + k * (x * Math.sin(phi) + y * Math.cos(phi)),
  })
  const named = {} as NamedPoints
  for (const name of NAMED_POINTS) named[name] = place(u.named[name])
  o.edit?.(named)

  const irisPx = o.irisPx ?? (ipdPx * 11.7) / 63
  const points: Point3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }))
  if (!o.noMesh) {
    MESH.faceOval.forEach((id, i) => {
      const p = place(u.oval[i] as Pt)
      points[id] = { x: p.x, y: p.y, z: 0 }
    })
    const ring = o.irisRingPx ?? { left: irisPx, right: irisPx }
    const setRing = (centreId: number, pair: readonly number[], diameter: number, at: Point2) => {
      points[centreId] = { x: at.x, y: at.y, z: 0 }
      points[pair[0] as number] = { x: at.x - diameter / 2, y: at.y, z: 0 }
      points[pair[1] as number] = { x: at.x + diameter / 2, y: at.y, z: 0 }
    }
    setRing(MESH.irisCenterL, [474, 476], ring.left, named.pupilL)
    setRing(MESH.irisCenterR, [469, 471], ring.right, named.pupilR)
  }
  return {
    landmarks: { points: o.noMesh ? [] : points, width: W, height: H, blendshapes: o.blendshapes ?? neutralBlendshapes(), transform: null },
    pose: { yaw: 0, pitch: 0, roll: (o.rotateDeg ?? 0) !== 0 && o.pose?.roll === undefined ? 0 : (o.pose?.roll ?? 0), ...o.pose },
    irisPx,
    named,
  }
}

const check = (id: QcCheck['id'], ok: boolean, value: number | null): QcCheck => ({ id, ok, value, limit: 'limit', hint: ok ? 'fine' : 'fix it' })

function shotQc(over: Partial<ShotQc> = {}): ShotQc {
  return {
    shot: 'frontal_neutral',
    framesTried: 5,
    framesKept: 5,
    checks: [check('sharpness', true, 120), check('lighting', true, 0.05)],
    burstSpread: 0.01,
    estimatedDistanceM: 1.6,
    irisPx: (ipdPxAt(1.6) * 11.7) / 63,
    greyCard: false,
    ...over,
  }
}

interface RunOptions {
  n?: number
  frame?: (i: number) => FrameOptions
  frames?: FaceFrame[]
  shotQc?: Partial<ShotQc>
  conditions?: ScanRecord['conditions']
}

let counter = 0
const nextId = (): string => `id-${++counter}`

function runAll(spec: FaceSpec = BASE, o: RunOptions = {}): Measurement[] {
  const frames = o.frames ?? Array.from({ length: o.n ?? 5 }, (_, i) => makeFrame(spec, o.frame?.(i) ?? {}))
  return computeFrontalMetrics({ scanId: 'scan-1', frames, shotQc: shotQc(o.shotQc), uuid: nextId, conditions: o.conditions })
}

function run(spec: FaceSpec = BASE, o: RunOptions = {}): Record<string, Measurement> {
  return Object.fromEntries(runAll(spec, o).map((m) => [m.metricId, m]))
}

const value = (m: Measurement | undefined): number => {
  if (!m || m.value === null) throw new Error(`${m?.metricId ?? 'metric'} has no value: ${m?.refusal?.reasons.join(' | ')}`)
  return m.value
}

const refusalText = (m: Measurement | undefined): string => (m?.refusal ? [...m.refusal.reasons, ...m.refusal.recapture].join(' || ') : '')

/** All metrics a refusal applies to, from the result. */
const refusedIds = (r: Record<string, Measurement>): string[] => Object.values(r).filter((m) => m.refusal).map((m) => m.metricId)

const ALL_IDS = [...FRONTAL_METRIC_IDS, 'V06']

// ───────────────────────────── the answers ─────────────────────────────

/** Independent re-computation of the F01 index from the unit-face outline (shoelace area, edge-length sum). */
function expectedAdiposity(spec: FaceSpec): number {
  const { oval } = unitFace(spec)
  let twice = 0
  let perimeter = 0
  oval.forEach(([x, y], i) => {
    const [x2, y2] = oval[(i + 1) % oval.length] as Pt
    twice += x * y2 - x2 * y
    perimeter += Math.hypot(x2 - x, y2 - y)
  })
  const outline = perimeter / Math.sqrt(Math.abs(twice) / 2)
  const c = F01_COMPOSITE
  return 50 + (c.indexPointsPerSd * ((c.outlineReference - outline) / c.outlineSd + (c.cheekJawReference - spec.cheekJaw) / c.cheekJawSd)) / 2
}

function expectedPhi(spec: FaceSpec): number {
  const r2 = (1 + spec.thirds) / spec.thirds
  return (((Math.abs(spec.mouthOverNose - PHI) + Math.abs(r2 - PHI)) / PHI) / 2) * 100
}

function expectEveryMetric(r: Record<string, Measurement>, spec: FaceSpec, digits = 6): void {
  expect(value(r.F01)).toBeCloseTo(expectedAdiposity(spec), digits)
  expect(value(r.F05)).toBeCloseTo(0, digits)
  expect(value(r.F07)).toBeCloseTo(spec.fifths, digits)
  expect(value(r.F08)).toBeCloseTo(spec.eyeSpacing, digits)
  expect(value(r.F10)).toBeCloseTo(spec.fwhr, digits)
  expect(value(r.F11)).toBeCloseTo(spec.midface, digits)
  expect(value(r.F12)).toBeCloseTo(spec.tilt, digits)
  expect(value(r.F14)).toBeCloseTo(spec.noseOverGap, digits)
  expect(value(r.F15)).toBeCloseTo(spec.lipRatio, digits)
  expect(value(r.F16)).toBeCloseTo(spec.thirds, digits)
  expect(value(r.F17)).toBeCloseTo(spec.cheekJaw, digits)
  expect(value(r.F21)).toBeCloseTo(expectedPhi(spec), digits)
  expect(value(r.F22)).toBeCloseTo(spec.philtrum, digits)
  expect(value(r.F23)).toBeCloseTo(63, digits)
}

describe('a perfectly symmetric synthetic face gives the known answer for every metric', () => {
  it('base proportions, face level, 1.6 m', () => {
    const r = run(BASE)
    expectEveryMetric(r, BASE)
    expect(Object.keys(r)).toEqual(ALL_IDS)
  })

  it('a second set of proportions, including a downward canthal tilt', () => {
    expectEveryMetric(run(OTHER), OTHER)
  })

  it('does not depend on where the face sits, how big it is, or head roll (the pupil-line frame cancels it)', () => {
    const r = run(BASE, {
      frame: () => ({ distanceM: 1.9, centre: { x: 600, y: 1000 }, rotateDeg: 2.5, pose: { roll: 2.5 } }),
      shotQc: { estimatedDistanceM: 1.9 },
    })
    expectEveryMetric(r, BASE, 5)
  })

  it('reports the catalog unit for every metric except the F21 myth card, which has no unit in the catalog', () => {
    const r = run(BASE)
    for (const id of FRONTAL_METRIC_IDS) {
      const m = r[id] as Measurement
      expect(m.unit).toBe(id === 'F21' ? '% from 1.618' : getMetric(id)?.scale.unit)
      expect(m.unit.length).toBeGreaterThan(0)
    }
    expect(getMetric('F21')?.scale.unit).toBe('n/a')
    expect((r.V06 as Measurement).unit).toBe(getMetric('V06')?.scale.unit)
  })

  it('stamps the contract fields: scan id, algorithm version, method, unique ids, frame count', () => {
    const list = runAll(BASE)
    expect(new Set(list.map((m) => m.id)).size).toBe(list.length)
    for (const m of list) {
      expect(m.scanId).toBe('scan-1')
      expect(m.algoVersion).toBe(ALGO_VERSION)
      expect(ALGO_VERSION).toBe('m1.0')
      expect(m.method).toBe(m.metricId === 'F21' ? 'COMPUTED_FROM_OTHER_METRICS' : 'AUTO_FRONTAL_PHOTO')
      expect(m.nFrames).toBe(5)
      expect(m.qcFactor).toBeGreaterThan(0)
      expect(m.qcFactor).toBeLessThanOrEqual(1)
      expect(m.refusal).toBeUndefined()
    }
  })

  it('uses real random ids when no uuid function is given, and the same input gives the same numbers', () => {
    const frames = Array.from({ length: 5 }, () => makeFrame(BASE))
    const a = computeFrontalMetrics({ scanId: 's', frames, shotQc: shotQc() })
    const b = computeFrontalMetrics({ scanId: 's', frames, shotQc: shotQc() })
    expect(a[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a[0]?.id).not.toBe(b[0]?.id)
    expect(a.map((m) => [m.metricId, m.value, m.uncertainty])).toEqual(b.map((m) => [m.metricId, m.value, m.uncertainty]))
  })

  it('F12 averages the two eyes and reads a rising outer corner as positive', () => {
    const frames = Array.from({ length: 5 }, () =>
      makeFrame(BASE, {
        edit: (n) => {
          // Left eye: outer corner 4.0° above the pupil line direction; right eye: 2.0°.
          const k = ipdPxAt(1.6) / 100
          const run = 45 * k
          n.eyeOuterL = { x: n.eyeInnerL.x + run, y: n.eyeInnerL.y - run * Math.tan(4 * RAD) }
          n.eyeOuterR = { x: n.eyeInnerR.x - run, y: n.eyeInnerR.y - run * Math.tan(2 * RAD) }
        },
      }),
    )
    const m = run(BASE, { frames }).F12 as Measurement
    expect(value(m)).toBeCloseTo(3, 6)
    expect(m.inputs?.tiltLeftEyeDeg).toBeCloseTo(4, 5)
    expect(m.inputs?.tiltRightEyeDeg).toBeCloseTo(2, 5)
  })
})

describe('F01 facial adiposity is a proxy for the look of face fat', () => {
  it('rises when the lower face fills out (rounder outline, wider jaw) and falls when it thins', () => {
    const lean = value(run({ ...BASE, cheekJaw: 1.4 }).F01)
    const base = value(run(BASE).F01)
    const full = value(run({ ...BASE, cheekJaw: 1.2 }).F01)
    expect(full).toBeGreaterThan(base)
    expect(base).toBeGreaterThan(lean)
    // 0.1 of cheek ÷ jaw is 1/0.07 SD for that cue, averaged with the outline cue that does not change.
    expect((full - lean) / 2).toBeCloseTo(((F01_COMPOSITE.indexPointsPerSd / F01_COMPOSITE.cheekJawSd) * 0.2) / 2 / 2, 0)
  })

  it('stays inside its 0–100 scale', () => {
    const extreme = value(run({ ...BASE, cheekJaw: 3 }).F01)
    expect(extreme).toBeGreaterThanOrEqual(0)
    expect(extreme).toBeLessThanOrEqual(100)
  })

  it('records the two cues it combines', () => {
    const m = run(BASE).F01 as Measurement
    expect(m.inputs?.cheekToJawRatio).toBeCloseTo(BASE.cheekJaw, 6)
    expect(m.inputs?.outlineLengthOverRootArea).toBeGreaterThan(3.54)
    expect(m.inputs?.outlineLengthOverRootArea).toBeLessThan(3.8)
  })

  it('is refused, never guessed, when the frames carry no face mesh (no outline to measure)', () => {
    const r = run(BASE, { frame: () => ({ noMesh: true }) })
    expect(r.F01?.value).toBeNull()
    expect(refusalText(r.F01)).toContain('the face outline or the jaw width could not be measured')
    expect(value(r.F07)).toBeCloseTo(BASE.fifths, 6)
  })
})

// ───────────────────────────── F05 symmetry ─────────────────────────────

describe('F05 symmetry about the best-fit midline', () => {
  const N = 19 // 12 mirrored pairs + 7 midline landmarks
  const ipdPx = ipdPxAt(1.6)

  it('compares 19 landmarks', () => {
    expect((run(BASE).F05 as Measurement).inputs?.landmarksCompared).toBe(N)
  })

  it('is exactly zero for a symmetric face turned in the frame: the midline is fitted, not the image centre', () => {
    for (const roll of [0, 1.5, -2.8]) {
      const m = run(BASE, { frame: () => ({ rotateDeg: roll, pose: { roll }, centre: { x: 300 + 200 * roll, y: 800 } }) }).F05 as Measurement
      expect(value(m)).toBeCloseTo(0, 7)
    }
  })

  it('rises by the injected amount (one pair member moved along the face by 4% of the pupil distance → 4% ÷ 19)', () => {
    const inject = (pct: number) =>
      value(
        run(BASE, {
          frame: () => ({
            edit: (n) => {
              n.eyeOuterL = { x: n.eyeOuterL.x, y: n.eyeOuterL.y + (pct / 100) * ipdPx }
            },
          }),
        }).F05,
      )
    const four = inject(4)
    const eight = inject(8)
    // Fitting the midline absorbs a few percent of the displacement by tilting a little, so allow 10%.
    expect(four).toBeGreaterThan((4 / N) * 0.9)
    expect(four).toBeLessThan((4 / N) * 1.1)
    expect(eight / four).toBeGreaterThan(1.9)
    expect(eight / four).toBeLessThan(2.1)
  })

  it('counts a landmark that leaves the midline: a nose shifted sideways raises F05', () => {
    const shifted = value(
      run(BASE, {
        frame: () => ({
          edit: (n) => {
            n.noseTip = { x: n.noseTip.x + 0.05 * ipdPx, y: n.noseTip.y }
            n.subnasale = { x: n.subnasale.x + 0.05 * ipdPx, y: n.subnasale.y }
          },
        }),
      }).F05,
    )
    expect(shifted).toBeGreaterThan(0.2)
  })

  it('the fitted line is the mirror line of a perfectly symmetric set, whatever its position and tilt', () => {
    const tilt = 0.2 // radians
    const rot = (x: number, y: number): Point2 => ({ x: 40 + x * Math.cos(tilt) - y * Math.sin(tilt), y: 70 + x * Math.sin(tilt) + y * Math.cos(tilt) })
    const pairs = [
      [rot(30, 0), rot(-30, 0)],
      [rot(50, 40), rot(-50, 40)],
      [rot(20, 90), rot(-20, 90)],
    ] as const
    const line = bestFitMidline(pairs, [rot(0, 10), rot(0, 60)])
    expect(line).not.toBeNull()
    // Direction is the rotated vertical (up to sign).
    const along = Math.abs(line!.u.x * -Math.sin(tilt) + line!.u.y * Math.cos(tilt))
    expect(along).toBeCloseTo(1, 9)
    for (const [l, r] of pairs) {
      const m = mirrorAcross(line!, r)
      expect(m.x).toBeCloseTo(l.x, 9)
      expect(m.y).toBeCloseTo(l.y, 9)
    }
  })

  it('a mirrored point is its own mirror image twice over', () => {
    const line = { c: { x: 5, y: 5 }, u: { x: 0, y: 1 } }
    const p = { x: 9, y: 2 }
    const twice = mirrorAcross(line, mirrorAcross(line, p))
    expect(twice.x).toBeCloseTo(p.x, 12)
    expect(twice.y).toBeCloseTo(p.y, 12)
    expect(mirrorAcross(line, p).x).toBeCloseTo(1, 12)
  })
})

// ───────────────────────────── uncertainty ─────────────────────────────

describe('median and uncertainty across the burst', () => {
  const k = ipdPxAt(1.6) / 100
  const gapPx = BASE.fifths * 45 * k
  const eyePx = 45 * k
  /** F07 of a frame whose left outer eye corner is moved `dx` px outward: only the eye width changes, by dx/2. */
  const f07 = (dx: number) => gapPx / (eyePx + dx / 2)
  const widen = (dx: number): FrameOptions => ({
    edit: (n) => {
      n.eyeOuterL = { x: n.eyeOuterL.x + dx, y: n.eyeOuterL.y }
    },
  })

  it('the value is the median of the per-frame values, not the mean', () => {
    const dxs = [0, 0.4, -0.3, 0.9, 6] // the last frame is a wild one
    const m = run(BASE, { frame: (i) => widen(dxs[i] as number) }).F07 as Measurement
    const per = dxs.map(f07)
    const sorted = [...per].sort((a, b) => a - b)
    expect(value(m)).toBeCloseTo(sorted[2] as number, 6)
    const mean = per.reduce((s, x) => s + x, 0) / per.length
    expect(Math.abs(value(m) - mean)).toBeGreaterThan(1e-3)
  })

  it('an even number of frames takes the mean of the two middle values', () => {
    const dxs = [0, 1, 2, 3]
    const m = run(BASE, { n: 4, frame: (i) => widen(dxs[i] as number) }).F07 as Measurement
    const per = dxs.map(f07).sort((a, b) => a - b)
    expect(value(m)).toBeCloseTo(((per[1] as number) + (per[2] as number)) / 2, 6)
    expect(m.nFrames).toBe(4)
  })

  it('uncertainty is the sample standard deviation when the frames disagree more than the landmark floor', () => {
    const dxs = [-8, -4, 0, 4, 8]
    const m = run(BASE, { frame: (i) => widen(dxs[i] as number) }).F07 as Measurement
    const std = sampleStd(dxs.map(f07))
    expect(m.inputs?.valueSpread).toBeCloseTo(std, 5)
    expect(m.inputs?.landmarkFloor as number).toBeLessThan(std)
    expect(m.uncertainty).toBeCloseTo(std, 5)
  })

  it('uncertainty is the landmark floor when five frames are identical: a still burst repeats exactly but is not exact', () => {
    const m = run(BASE).F07 as Measurement
    expect(m.inputs?.valueSpread).toBe(0)
    expect(m.uncertainty).toBe(m.inputs?.landmarkFloor)
    expect(m.uncertainty as number).toBeGreaterThan(0.02)
    expect(m.uncertainty as number).toBeLessThan(0.15)
  })

  it('never reports less than the floor, and never less than the spread', () => {
    for (const dxs of [[0, 0, 0, 0, 0], [0, 1, 0, 1, 0], [-30, 30, -30, 30, 0]]) {
      const m = run(BASE, { frame: (i) => widen(dxs[i] as number) }).F07 as Measurement
      expect(m.uncertainty as number).toBeGreaterThanOrEqual((m.inputs?.landmarkFloor as number) - 1e-6)
      expect(m.uncertainty as number).toBeGreaterThanOrEqual((m.inputs?.valueSpread as number) - 1e-6)
    }
  })

  it('the floor is the same in the metric\'s own unit at any picture size (landmark error is a fraction of the pupil distance)', () => {
    const near = run(BASE, { frame: () => ({ distanceM: 1.3 }), shotQc: { estimatedDistanceM: 1.3 } })
    const far = run(BASE, { frame: () => ({ distanceM: 2.0 }), shotQc: { estimatedDistanceM: 2.0 } })
    for (const id of ['F05', 'F07', 'F08', 'F12', 'F15', 'F16', 'F22']) {
      expect((far[id] as Measurement).uncertainty as number).toBeCloseTo((near[id] as Measurement).uncertainty as number, 5)
    }
  })

  it('F08 floor matches first-order propagation by hand: v·sqrt(2(σ_cheek/W)² + 2(σ_pupil/IPD)²)', () => {
    const geo = geoFromFrame(makeFrame(BASE))!
    const v = BASE.eyeSpacing
    const widthOverIpd = 100 / BASE.eyeSpacing
    const expected = v * Math.sqrt(2 * (LANDMARK_SIGMA_OF_IPD.contour / widthOverIpd) ** 2 + 2 * LANDMARK_SIGMA_OF_IPD.iris ** 2)
    const floor = landmarkFloor(FRONTAL_DEFS.F08, geo) as number
    expect(floor / expected).toBeGreaterThan(0.97)
    expect(floor / expected).toBeLessThan(1.03)
  })

  it('F23 floor carries the published 3–4% iris-scaling error plus the iris and pupil landmark error', () => {
    const geo = geoFromFrame(makeFrame(BASE))!
    const sIris = LANDMARK_SIGMA_OF_IPD.iris
    // value = ipd·11.7/iris; ipd 100 units ↔ iris 18.57 units. 1 unit of ipd is 0.63 mm.
    const irisUnits = (100 * 11.7) / 63
    const expected = Math.sqrt(
      (IRIS_SCALE_REL_ERROR * 63) ** 2 + (63 * ((sIris * 100) / irisUnits)) ** 2 + 2 * (63 * sIris) ** 2,
    )
    const floor = landmarkFloor(FRONTAL_DEFS.F23, geo) as number
    expect(IRIS_SCALE_REL_ERROR).toBeGreaterThanOrEqual(0.03)
    expect(IRIS_SCALE_REL_ERROR).toBeLessThanOrEqual(0.04)
    expect(floor / expected).toBeGreaterThan(0.98)
    expect(floor / expected).toBeLessThan(1.02)
    const m = run(BASE).F23 as Measurement
    expect(m.uncertainty as number).toBeGreaterThan(IRIS_SCALE_REL_ERROR * 63)
  })

  it('F05 has a non-zero floor even for a perfectly symmetric face: any jitter can only raise the gaps', () => {
    const m = run(BASE).F05 as Measurement
    expect(value(m)).toBeCloseTo(0, 9)
    expect(m.uncertainty as number).toBeGreaterThan(0.2)
  })

  it('a landmark class with more assumed error gives a larger floor (contour points > eye corners)', () => {
    expect(LANDMARK_SIGMA_OF_IPD.contour).toBeGreaterThan(LANDMARK_SIGMA_OF_IPD.eye)
    expect(LANDMARK_SIGMA_OF_IPD.eye).toBeGreaterThan(LANDMARK_SIGMA_OF_IPD.iris)
  })
})

// ───────────────────────────── declared inputs ─────────────────────────────

describe('each metric reads exactly the points it declares', () => {
  const geo = geoFromFrame(makeFrame(OTHER))!
  const value = (id: FrontalMetricId, g = geo) => FRONTAL_DEFS[id].compute(g)!.value

  it.each(FRONTAL_METRIC_IDS)('%s', (id) => {
    const def = FRONTAL_DEFS[id]
    const base = value(id)
    for (const key of NAMED_POINTS) {
      const moved = [
        { ...geo, pts: { ...geo.pts, [key]: { x: geo.pts[key].x + 5, y: geo.pts[key].y } } },
        { ...geo, pts: { ...geo.pts, [key]: { x: geo.pts[key].x, y: geo.pts[key].y + 5 } } },
      ].map((g) => value(id, g))
      const changed = moved.some((v) => Math.abs(v - base) > 1e-9)
      if (def.uses.includes(key)) expect(changed, `${id} should read ${key}`).toBe(true)
      else expect(changed, `${id} should not read ${key}`).toBe(false)
    }
    const ovalMoved = { ...geo, oval: geo.oval!.map((p, i) => (i === 5 ? { x: p.x + 5, y: p.y + 5 } : p)) }
    expect(Math.abs(value(id, ovalMoved) - base) > 1e-9, `${id} oval`).toBe(def.usesOval)
    const irisMoved = { ...geo, irisPx: geo.irisPx + 2 }
    expect(Math.abs(value(id, irisMoved) - base) > 1e-9, `${id} iris`).toBe(def.usesIris)
  })
})

// ───────────────────────────── quality factor ─────────────────────────────

describe('qcFactor is the product of the pose, distance, centring and expression factors', () => {
  const diagnose = (o: RunOptions = {}) => {
    const frames = o.frames ?? Array.from({ length: o.n ?? 5 }, (_, i) => makeFrame(BASE, o.frame?.(i) ?? {}))
    return analyseScan({ frames, shotQc: shotQc(o.shotQc) })
  }

  it('a clean capture at the protocol distance scores 1', () => {
    const m = run(BASE, { frame: () => ({ distanceM: 1.5 }), shotQc: { estimatedDistanceM: 1.5 } }).F08 as Measurement
    expect(m.qcFactor).toBe(1)
  })

  it('applies each named constant', () => {
    const o: RunOptions = {
      frame: () => ({ pose: { yaw: 2, roll: 2, pitch: 3 }, rotateDeg: 0, distanceM: 1.35 }),
      shotQc: { estimatedDistanceM: 1.35 },
    }
    const diag = diagnose(o)
    const yaw = 1 - (1 - QC_FACTOR.yaw.atLimit) * ((2 - QC_FACTOR.yaw.clean) / (QC_LIMITS.maxYawDeg - QC_FACTOR.yaw.clean))
    const pitch = 1 - (1 - QC_FACTOR.pitch.atLimit) * ((3 - QC_FACTOR.pitch.clean) / (QC_LIMITS.maxPitchDeg - QC_FACTOR.pitch.clean))
    const distance = 1 - (1 - QC_FACTOR.distance.atEnds) * ((1.5 - 1.35) / (1.5 - QC_LIMITS.minDistanceM))
    expect(distanceFactor(1.35, QC_LIMITS.minDistanceM)).toBeCloseTo(distance, 12)
    const expected = yaw * yaw * pitch * distance // roll has the same constants as yaw
    expect(qcFactorFor(GATE_PROFILES.F08, diag)).toBeCloseTo(expected, 3)
    expect(qcFactorFor(GATE_PROFILES.F08, diag)).toBeCloseTo((run(BASE, o).F08 as Measurement).qcFactor, 12)
  })

  it('distance factor: 1 from 1.5 to 1.9 m, 0.85 at the nearest allowed and at the far QC limit, linear between', () => {
    expect(distanceFactor(1.5, 1.2)).toBe(1)
    expect(distanceFactor(1.9, 1.2)).toBe(1)
    expect(distanceFactor(1.2, 1.2)).toBeCloseTo(0.85, 12)
    expect(distanceFactor(1.35, 1.2)).toBeCloseTo(0.925, 12)
    expect(distanceFactor(QC_LIMITS.maxDistanceM, 1.2)).toBeCloseTo(0.85, 12)
    expect(distanceFactor(2.05, 1.2)).toBeCloseTo(0.925, 12)
    expect(distanceFactor(1.5, 1.5)).toBe(1)
    expect(distanceFactor(Number.NaN, 1.2)).toBeNaN()
  })

  it('a capture sitting on every limit gets a LOW factor, not a refusal', () => {
    const o: RunOptions = {
      frame: () => ({ pose: { yaw: 3, roll: 3, pitch: 4 }, distanceM: 1.2, centre: { x: W * 0.4, y: 900 } }),
      shotQc: { estimatedDistanceM: 1.2 },
    }
    const m = run(BASE, o).F08 as Measurement
    expect(m.refusal).toBeUndefined()
    expect(m.qcFactor).toBeLessThan(0.65)
    expect(m.qcFactor).toBeGreaterThan(0.4)
  })

  it('the expression factor falls as the worst neutral-expression signal approaches its limit', () => {
    const calm = run(BASE).F15 as Measurement
    const smileLimit = NEUTRAL_RULES.find((r) => r.keys.includes('mouthSmileLeft'))!.limit
    const tense = run(BASE, { frame: () => ({ blendshapes: { ...neutralBlendshapes(), mouthSmileLeft: smileLimit * 0.9, mouthSmileRight: smileLimit * 0.9 } }) }).F15 as Measurement
    expect(tense.refusal).toBeUndefined()
    expect(tense.qcFactor).toBeLessThan(calm.qcFactor)
    expect(tense.qcFactor).toBeCloseTo(1 - (1 - QC_FACTOR.expression.atLimit) * ((0.9 - QC_FACTOR.expression.clean) / (1 - QC_FACTOR.expression.clean)), 3)
  })
})

// ───────────────────────────── refusals ─────────────────────────────

const POSE_SENSITIVE = ['F01', 'F05', 'F07', 'F08', 'F10', 'F11', 'F12', 'F14', 'F15', 'F16', 'F17', 'F22', 'F23']

describe('refusals carry the measured value and the limit, and say what to re-capture', () => {
  it('head yaw: mean |yaw| of 4.2° over 5 frames is refused with those numbers', () => {
    const r = run(BASE, { frame: (i) => ({ pose: { yaw: [4.2, 4.2, 4.2, 4.2, 4.2][i] as number } }) })
    for (const id of [...POSE_SENSITIVE, 'F21']) {
      const m = r[id] as Measurement
      expect(m.value, id).toBeNull()
      expect(m.uncertainty).toBeNull()
      expect(m.qcFactor).toBe(0)
      expect(m.refusal?.reasons.join(' ')).toContain('Head yaw averaged 4.2° over 5 frames (limit 3°)')
      expect(m.refusal?.recapture.join(' ')).toContain('turn your head 4.2° back to your right')
    }
    // V06 judges technique instead of refusing on pose: it scores and fails the head-level item.
    expect((r.V06 as Measurement).refusal).toBeUndefined()
    expect((r.V06 as Measurement).inputs?.pose).toBe(0)
  })

  it('uses the mean of |yaw|, not of yaw: +4° and −4° frames do not cancel', () => {
    const r = run(BASE, { frame: (i) => ({ pose: { yaw: i % 2 === 0 ? 4 : -4 } }) })
    expect(refusalText(r.F08)).toContain('Head yaw averaged 4.0° over 5 frames (limit 3°)')
  })

  it('head roll and pitch, with the direction to correct', () => {
    const roll = run(BASE, { frame: () => ({ pose: { roll: -3.6 }, rotateDeg: -3.6 }) })
    expect(refusalText(roll.F07)).toContain('Head roll averaged 3.6° over 5 frames (limit 3°)')
    expect(refusalText(roll.F07)).toContain('tilt your head 3.6° to your left')
    const down = run(BASE, { frame: () => ({ pose: { pitch: 5.5 } }) })
    expect(refusalText(down.F16)).toContain('Head pitch averaged 5.5° over 5 frames (limit 4°)')
    expect(refusalText(down.F16)).toContain('raise your chin 5.5°')
    const up = run(BASE, { frame: () => ({ pose: { pitch: -4.5 } }) })
    expect(refusalText(up.F16)).toContain('lower your chin 4.5°')
  })

  it('a limit is a limit: exactly 3°, 3° and 4° pass, a hair more does not', () => {
    const at = run(BASE, { frame: () => ({ pose: { yaw: 3, roll: 3, pitch: 4 }, rotateDeg: 3 }) })
    expect((at.F08 as Measurement).refusal).toBeUndefined()
    const over = run(BASE, { frame: () => ({ pose: { yaw: 3.01 } }) })
    expect((over.F08 as Measurement).refusal).toBeDefined()
    const pitchOver = run(BASE, { frame: () => ({ pose: { pitch: 4.01 } }) })
    expect((pitchOver.F08 as Measurement).refusal).toBeDefined()
  })

  it('the stock-portrait case: 3.9° of pitch passes (the catalog\'s 2° starts the quality penalty, not a refusal)', () => {
    const m = run(BASE, { frame: () => ({ pose: { pitch: 3.87 } }) }).F08 as Measurement
    expect(m.refusal).toBeUndefined()
    expect(m.qcFactor).toBeLessThan(0.9)
  })

  it('camera distance under 1.2 m refuses the proportion metrics and under 1.5 m also the nose metrics', () => {
    const close = run(BASE, { frame: () => ({ distanceM: 1.1 }), shotQc: { estimatedDistanceM: 1.1 } })
    for (const id of [...POSE_SENSITIVE, 'F21']) {
      expect(refusalText(close[id]), id).toContain('Estimated camera distance 1.10 m (minimum')
    }
    expect(refusalText(close.F08)).toContain('(minimum 1.2 m;')
    expect(refusalText(close.F08)).toContain('good to about 15%')
    expect(refusalText(close.F08)).toContain('move the camera back to about 1.5 m from your face (now about 1.1 m)')
    // 1.35 m: ordinary proportions pass, nose width / FWHR / phi-fit (which reads the nose) do not.
    const mid = run(BASE, { frame: () => ({ distanceM: 1.35 }), shotQc: { estimatedDistanceM: 1.35 } })
    expect(refusedIds(mid).sort()).toEqual(['F10', 'F14', 'F21'])
    expect(refusalText(mid.F14)).toContain('Estimated camera distance 1.35 m (minimum 1.5 m;')
    expect(refusalText(mid.F10)).toContain('(minimum 1.5 m;')
    expect(value(mid.F07)).toBeCloseTo(BASE.fifths, 6)
  })

  it('without a distance in the capture record it is estimated from the iris of the frames', () => {
    const r = run(BASE, { shotQc: { estimatedDistanceM: null }, frame: () => ({ distanceM: 1.1 }) })
    expect(refusalText(r.F08)).toContain('Estimated camera distance 1.10 m')
    const ok = run(BASE, { shotQc: { estimatedDistanceM: null }, frame: () => ({ distanceM: 1.7 }) })
    expect((ok.F08 as Measurement).refusal).toBeUndefined()
    expect(((ok.F08 as Measurement).inputs?.distanceM as number)).toBeCloseTo(1.7, 4)
  })

  it('a face outside the central 50% of the frame is refused with how far outside', () => {
    // Face pushed to the left: the outline's left edge is at x < 25% of the width.
    const centre = { x: 230, y: 900 }
    const frame = makeFrame(BASE, { centre })
    const left = Math.min(frame.named.faceLeft.x, frame.named.faceRight.x)
    const share = (W * 0.25 - left) / W
    expect(share).toBeGreaterThan(0)
    const r = run(BASE, { frames: Array.from({ length: 5 }, () => makeFrame(BASE, { centre })) })
    const expectedPct = `${Math.round(share * 1000) / 10}%`
    for (const id of [...POSE_SENSITIVE, 'F21']) {
      expect(refusalText(r[id]), id).toContain(`The face reaches ${expectedPct} of the frame width outside the central 50% of the frame (left edge)`)
    }
    expect(refusalText(r.F08)).toContain('centre your face in the frame by moving the phone, not your head')
    const high = run(BASE, { frame: () => ({ centre: { x: W / 2, y: 330 } }) })
    expect(refusalText(high.F08)).toMatch(/of the frame height outside the central 50% of the frame \(top edge\)/)
  })

  describe('a face that is not neutral', () => {
    const smile = { ...neutralBlendshapes(), mouthSmileLeft: 0.62, mouthSmileRight: 0.58 }

    it('a smile refuses the lip, nose, outline and eye metrics with the signal and its limit', () => {
      const r = run(BASE, { frame: () => ({ blendshapes: smile }) })
      const limit = NEUTRAL_RULES.find((x) => x.keys.includes('mouthSmileLeft'))!.limit
      for (const id of ['F01', 'F05', 'F07', 'F08', 'F10', 'F11', 'F12', 'F14', 'F15', 'F16', 'F17', 'F21', 'F22']) {
        expect(refusalText(r[id]), id).toContain(`Expression is not neutral: smile signal 0.60 (limit ${limit.toFixed(2)})`)
        expect(refusalText(r[id]), id).toContain('relax your smile')
      }
      // The pupil distance in mm does not depend on the mouth.
      expect(value(r.F23)).toBeCloseTo(63, 6)
    })

    it('an open mouth and pressed lips are named separately', () => {
      const r = run(BASE, { frame: () => ({ blendshapes: { ...neutralBlendshapes(), jawOpen: 0.4, mouthPressLeft: 0.9, mouthPressRight: 0.9 } }) })
      expect(refusalText(r.F15)).toContain('Expression is not neutral: mouth open signal 0.40 (limit 0.10)')
      expect(refusalText(r.F15)).toContain('Expression is not neutral: lips pressed together signal 0.90 (limit 0.50)')
    })

    it('closed or squinting eyes refuse the eye metrics (F07 F08 F12 F23) but not the mouth-only ones', () => {
      const r = run(BASE, { frame: () => ({ blendshapes: { ...neutralBlendshapes(), eyeBlinkLeft: 0.8, eyeBlinkRight: 0.8 } }) })
      for (const id of ['F07', 'F08', 'F12', 'F23']) {
        expect(refusalText(r[id]), id).toContain('Expression is not neutral: eyes closing signal 0.80 (limit 0.50)')
      }
      expect(refusedIds(r).sort()).toEqual(['F07', 'F08', 'F12', 'F23'])
    })

    it('raised brows refuse the neutral-face metrics but not F23', () => {
      const r = run(BASE, { frame: () => ({ blendshapes: { ...neutralBlendshapes(), browInnerUp: 0.7 } }) })
      expect(refusalText(r.F10)).toContain('Expression is not neutral: brows raised signal 0.70 (limit 0.40)')
      expect((r.F23 as Measurement).refusal).toBeUndefined()
    })

    it('uses the median of the burst: one smiling frame in five does not refuse', () => {
      const r = run(BASE, { frame: (i) => ({ blendshapes: i === 2 ? smile : neutralBlendshapes() }) })
      expect(refusedIds(r)).toEqual([])
    })

    it('an expression that cannot be read cannot be confirmed neutral', () => {
      const r = run(BASE, { frame: () => ({ blendshapes: {} }) })
      expect(refusalText(r.F15)).toContain('The expression could not be read from the face model, so a neutral face cannot be confirmed')
      expect(refusalText(r.F23)).toContain('The expression could not be read')
    })
  })

  it('uneven light refuses symmetry only, with the imbalance and the limit', () => {
    const r = run(BASE, { shotQc: { checks: [check('sharpness', true, 120), check('lighting', false, 0.31)] } })
    expect(refusedIds(r)).toEqual(['F05'])
    expect(refusalText(r.F05)).toContain('Uneven light: the two halves of the face differ by 31% in brightness (limit 20%)')
    const dark = run(BASE, { shotQc: { checks: [check('sharpness', true, 120), check('lighting', false, null)] } })
    expect(refusalText(dark.F05)).toContain('The light could not be judged because the face is too dark')
  })

  it('misread irises refuse the pupil distance in mm', () => {
    const r = run(BASE, { frame: () => ({ irisRingPx: { left: 18.6, right: 9.3 } }) })
    expect(refusedIds(r)).toEqual(['F23'])
    expect(refusalText(r.F23)).toContain('The two irises disagree: left 18.6 px, right 9.3 px, a 66.7% difference (limit 25%)')
  })

  it('declared conditions: a beard spoils the jaw and chin, stubble the lip edge, illness or drinking the face fat', () => {
    const beard = run(BASE, { conditions: { facialHair: 'beard' } })
    expect(refusedIds(beard).sort()).toEqual(['F01', 'F16', 'F17', 'F22'])
    expect(refusalText(beard.F01)).toContain('A beard was declared for this scan, so the jaw edge and the jaw corners cannot be located')
    expect(refusalText(beard.F16)).toContain('the chin tip cannot be located')
    expect(refusalText(beard.F22)).toContain('A beard was declared for this scan, and a moustache or stubble hides the upper-lip edge')
    const stubble = run(BASE, { conditions: { facialHair: 'stubble' } })
    expect(refusedIds(stubble)).toEqual(['F22'])
    expect(refusalText(stubble.F22)).toContain('Stubble was declared')
    const ill = run(BASE, { conditions: { illness: true } })
    expect(refusedIds(ill)).toEqual(['F01'])
    expect(refusalText(ill.F01)).toContain('Illness was declared for this scan')
    const drink = run(BASE, { conditions: { alcoholLastNight: true } })
    expect(refusalText(drink.F01)).toContain('Alcohol the night before was declared')
    expect(refusedIds(run(BASE, { conditions: { facialHair: 'clean', illness: false } }))).toEqual([])
  })

  it('several failures are all reported, each with its own instruction', () => {
    const r = run(BASE, { frame: () => ({ pose: { yaw: 5, roll: 4, pitch: 6 }, rotateDeg: 4, distanceM: 1.0 }), shotQc: { estimatedDistanceM: 1.0 } })
    const m = r.F08 as Measurement
    expect(m.refusal?.reasons.length).toBe(4)
    expect(m.refusal?.recapture.length).toBe(4)
    expect(m.refusal?.reasons.join(' ')).toMatch(/yaw.*roll.*pitch.*distance/)
  })
})

describe('refusals when the burst itself is unusable', () => {
  const only = (n: number, bad: (f: FaceFrame, i: number) => void, total = 5): FaceFrame[] => {
    const frames = Array.from({ length: total }, () => makeFrame(BASE))
    frames.slice(n).forEach((f, i) => bad(f, i))
    return frames
  }

  it('fewer than 3 usable frames refuses every metric, naming the count and why', () => {
    const frames = only(2, (f) => {
      f.named.chinTip = { x: Number.NaN, y: Number.NaN }
    })
    const r = run(BASE, { frames })
    for (const m of Object.values(r)) {
      expect(m.value, m.metricId).toBeNull()
      expect(m.nFrames).toBe(2)
      expect(m.refusal?.reasons.join(' ')).toContain('Only 2 of 5 frames had a complete, plausible face mesh (minimum 3): landmark chinTip is missing')
      expect(m.refusal?.recapture.join(' ')).toContain('hold still for the whole burst')
    }
  })

  it('exactly 3 usable frames is enough, and the others do not leak into the median', () => {
    const frames = only(3, (f) => {
      f.named.cupidBow = undefined as unknown as Point2
    })
    const r = run(BASE, { frames })
    expect(refusedIds(r)).toEqual([])
    expect((r.F07 as Measurement).nFrames).toBe(3)
    expect((r.F07 as Measurement).inputs?.framesUsable).toBe(3)
    expect((r.F07 as Measurement).inputs?.framesTotal).toBe(5)
  })

  it('no frames at all', () => {
    const r = run(BASE, { frames: [] })
    expect(refusalText(r.F08)).toContain('Only 0 of 0 frames had a complete, plausible face mesh (minimum 3)')
  })

  it('the capture record says fewer than 3 frames passed its checks', () => {
    const r = run(BASE, { shotQc: { framesKept: 2, framesTried: 5 } })
    expect(refusalText(r.F08)).toContain('Only 2 of 5 frames passed the capture checks (minimum 3)')
  })

  it('a shot that is not the frontal neutral shot', () => {
    const r = run(BASE, { shotQc: { shot: 'frontal_smile' } })
    for (const m of Object.values(r)) expect(refusalText(m)).toContain('The capture is a frontal smile shot, and this metric is measured on the frontal neutral shot')
  })

  it('an unknown head pose, a missing iris and a missing image size each make a frame unusable', () => {
    const frames = [
      makeFrame(BASE, { pose: { yaw: Number.NaN } }),
      makeFrame(BASE, { irisPx: 0 }),
      makeFrame(BASE),
      makeFrame(BASE),
      makeFrame(BASE),
    ]
    const diag = analyseScan({ frames, shotQc: shotQc() })
    expect(diag.usable.length).toBe(3)
    expect(diag.rejected.map((x) => x.why)).toEqual(['head pose could not be measured', 'iris not detected'])
  })

  it('a pupil distance of a few pixels, a scrambled or upside-down face, and absurd proportions are rejected, not measured', () => {
    const cases: [string, (n: NamedPoints) => void, RegExp][] = [
      ['pupils together', (n) => { n.pupilL = { ...n.pupilR } }, /pupil distance is 0 px/],
      ['chin above the lips', (n) => { n.chinTip = { x: n.chinTip.x, y: n.lowerLipBottom.y - 20 } }, /out of order \(expected lower lip above the chin\)/],
      ['upside down', (n) => { for (const k of NAMED_POINTS) n[k] = { x: n[k].x, y: 1800 - n[k].y } }, /out of order/],
      ['cheeks far too narrow', (n) => { n.zygionL = { x: n.pupilL.x + 1, y: n.zygionL.y }; n.zygionR = { x: n.pupilR.x - 1, y: n.zygionR.y } }, /% of the cheekbone width/],
      ['chin far too low', (n) => { n.chinTip = { x: n.chinTip.x, y: n.chinTip.y + 700 } }, /pupil distances below the pupil line/],
    ]
    for (const [label, edit, why] of cases) {
      const frames = Array.from({ length: 5 }, () => makeFrame(BASE, { edit }))
      const diag = analyseScan({ frames, shotQc: shotQc() })
      expect(diag.usable.length, label).toBe(0)
      expect(diag.rejected[0]?.why, label).toMatch(why)
      expect(refusalText(run(BASE, { frames }).F08), label).toMatch(why)
    }
  })

  it('a metric whose own geometry is implausible is refused while the others are still measured', () => {
    // Upper lip height negative in every frame: F15 has no valid reading; nothing else reads those points that way.
    const frames = Array.from({ length: 5 }, () =>
      makeFrame(BASE, {
        edit: (n) => {
          n.upperLipBottom = { x: n.upperLipBottom.x, y: n.upperLipTop.y - 2 }
        },
      }),
    )
    const r = run(BASE, { frames })
    expect(r.F15?.value).toBeNull()
    expect(refusalText(r.F15)).toContain('Only 0 of 5 usable frames gave a plausible reading (minimum 3): the lip edges were out of order')
    expect(value(r.F07)).toBeCloseTo(BASE.fifths, 6)
  })

  it('F21 is refused when a metric it is computed from could not be measured', () => {
    // Inner eye corners almost touching: F14 (nose ÷ eye gap) has no reading, F21 does not use those points.
    const frames = Array.from({ length: 5 }, () =>
      makeFrame(BASE, {
        edit: (n) => {
          const mid = (n.eyeInnerL.x + n.eyeInnerR.x) / 2
          n.eyeInnerL = { x: mid + 0.2, y: n.eyeInnerL.y }
          n.eyeInnerR = { x: mid - 0.2, y: n.eyeInnerR.y }
        },
      }),
    )
    const r = run(BASE, { frames })
    expect(r.F14?.refusal).toBeDefined()
    expect(refusalText(r.F21)).toContain('This value is computed from F14 and F16, and F14 could not be measured on this capture')
    expect(value(r.F16)).toBeCloseTo(BASE.thirds, 6)
  })

  it('malformed frames never throw', () => {
    const garbage = [null, undefined, {}, { named: {} }, { named: null, pose: null }, 7] as unknown as FaceFrame[]
    const r = run(BASE, { frames: [...garbage, makeFrame(BASE), makeFrame(BASE), makeFrame(BASE)] })
    expect(refusedIds(r)).toEqual([])
    const allBad = run(BASE, { frames: garbage })
    expect(Object.values(allBad).every((m) => m.refusal !== undefined)).toBe(true)
  })
})

// ───────────────────────────── contract ─────────────────────────────

describe('what comes out is always valid', () => {
  const scenarios: [string, RunOptions][] = [
    ['good', {}],
    ['yaw', { frame: () => ({ pose: { yaw: 6 } }) }],
    ['close', { frame: () => ({ distanceM: 1.0 }), shotQc: { estimatedDistanceM: 1.0 } }],
    ['smile', { frame: () => ({ blendshapes: { ...neutralBlendshapes(), mouthSmileLeft: 0.9, mouthSmileRight: 0.9 } }) }],
    ['two frames', { n: 2 }],
    ['no mesh', { frame: () => ({ noMesh: true }) }],
    ['beard and light', { conditions: { facialHair: 'beard' as const }, shotQc: { checks: [check('sharpness', true, 120), check('lighting', false, 0.4)] } }],
  ]

  it.each(scenarios)('%s: a refusal has no value, a value has no refusal, numbers are finite, text is within the store\'s limits', (_label, o) => {
    for (const m of runAll(BASE, o)) {
      expect(m.qcFactor).toBeGreaterThanOrEqual(0)
      expect(m.qcFactor).toBeLessThanOrEqual(1)
      expect(Number.isInteger(m.nFrames)).toBe(true)
      for (const v of Object.values(m.inputs ?? {})) expect(Number.isFinite(v)).toBe(true)
      for (const key of Object.keys(m.inputs ?? {})) expect(key.length).toBeLessThanOrEqual(64)
      if (m.refusal) {
        expect(m.value).toBeNull()
        expect(m.uncertainty).toBeNull()
        expect(m.refusal.reasons.length).toBeGreaterThan(0)
        expect(m.refusal.recapture.length).toBeGreaterThan(0)
        for (const line of [...m.refusal.reasons, ...m.refusal.recapture]) {
          expect(line.trim().length).toBeGreaterThan(0)
          expect(line.length).toBeLessThanOrEqual(500)
        }
      } else {
        expect(Number.isFinite(m.value as number)).toBe(true)
        expect(m.uncertainty).not.toBeNull()
        expect(m.uncertainty as number).toBeGreaterThanOrEqual(0)
        expect(m.nFrames).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('every refusal and every reason passes the tone linter: no softeners, compliments, slang or exclamation marks', () => {
    const lines = new Set<string>()
    for (const [, o] of scenarios) {
      for (const m of runAll(BASE, o)) for (const line of [...(m.refusal?.reasons ?? []), ...(m.refusal?.recapture ?? [])]) lines.add(line)
    }
    for (const o of [
      { frame: () => ({ pose: { roll: -4, pitch: -6 } }) },
      { frame: () => ({ centre: { x: 200, y: 300 } }) },
      { frame: () => ({ irisRingPx: { left: 20, right: 9 } }) },
      { frame: () => ({ blendshapes: { ...neutralBlendshapes(), jawOpen: 0.5, browDownLeft: 0.9, browDownRight: 0.9, eyeSquintLeft: 0.9, eyeSquintRight: 0.9, eyeLookUpLeft: 0.9, eyeLookInRight: 0.9, mouthPucker: 0.9, mouthFrownLeft: 0.9, mouthFrownRight: 0.9, cheekSquintLeft: 0.9, cheekSquintRight: 0.9, eyeWideLeft: 0.9, eyeWideRight: 0.9 } }) },
      { shotQc: { shot: 'profile_left' as const, framesKept: 1 } },
      { conditions: { facialHair: 'beard' as const, illness: true } },
      { frame: () => ({ blendshapes: {} }) },
    ] satisfies RunOptions[]) {
      for (const m of runAll(BASE, o)) for (const line of [...(m.refusal?.reasons ?? []), ...(m.refusal?.recapture ?? [])]) lines.add(line)
    }
    expect(lines.size).toBeGreaterThan(30)
    for (const line of lines) {
      expect(lintTone(line), line).toEqual([])
      expect(line).not.toMatch(/!/)
    }
  })

  it('scoring turns each refusal into NOT SCORED with the re-capture instruction, and never scores it', () => {
    const r = run(BASE, { frame: () => ({ pose: { yaw: 4.2 } }) })
    const { score } = scoreMetric(r.F08 as Measurement, { baselines: {}, uuid: nextId })
    expect(score.score).toBeNull()
    expect(score.confidence.band).toBe('REFUSED')
    expect(score.reason).toContain('NOT SCORED')
    expect(score.reason).toContain('Head yaw averaged 4.2° over 5 frames (limit 3°)')
    expect(score.reason).toContain('Re-capture')
    expect(score.reason).toBe(renderRefusal({
      metricName: getMetric('F08')!.name,
      shotLabel: score.reason.match(/Re-capture ([^:]+):/)![1]!,
      reasons: (r.F08 as Measurement).refusal!.reasons,
      recapture: (r.F08 as Measurement).refusal!.recapture,
    }))
  })

  it('end to end: a good capture scores, F01 sets its baseline, the overall is honestly not available, the store accepts the rows', async () => {
    const measurements = runAll(BASE)
    const result = scoreScan({ scanId: 'scan-1', measurements, baselines: {}, uuid: nextId })
    const byId = Object.fromEntries(result.scores.map((s) => [s.metricId, s]))
    // The personal-baseline metric has no norm anchor: the first scan sets the baseline and is not scored.
    expect(byId.F01?.score).toBeNull()
    expect(byId.F01?.reason).toContain('BASELINE SET')
    expect(result.baselinesToStore.map((b) => b.metricId)).toEqual(['F01'])
    // Weight-0 metrics are measured and shown, never scored.
    for (const id of ['F10', 'F11', 'F12', 'F17', 'F21', 'F22', 'F23']) {
      expect(byId[id]?.score, id).toBeNull()
      expect(byId[id]?.reason, id).toContain('NOT SCORED')
    }
    // The scored ones carry facts and a reason.
    for (const id of ['F05', 'F07', 'F08', 'F14', 'F15', 'F16', 'V06']) {
      expect(byId[id]?.score, id).not.toBeNull()
      expect(byId[id]?.facts, id).not.toBeNull()
      expect(byId[id]?.confidence.band, id).not.toBe('REFUSED')
    }
    expect(byId.F08?.confidence.band).toBe('HIGH')
    expect(result.overall.status).toBe('NOT_AVAILABLE')
    expect(result.overall.appearance).toBeNull()
    expect(result.overall.coverage).toBeLessThan(0.5)
    await expect(
      verifyScanRows({
        scans: [{ id: 'scan-1', takenAt: 1, kind: 'quick', conditions: {}, algoVersion: ALGO_VERSION }],
        measurements,
        scores: result.scores,
        overall: [result.overall],
        baselines: result.baselinesToStore.map((b) => ({ ...b, setAt: 1, scanId: 'scan-1' })),
      }),
    ).resolves.toBeUndefined()
  })

  it('a refused scan is accepted by the store too: a missing number carries its stated reason', async () => {
    const measurements = runAll(BASE, { frame: () => ({ pose: { yaw: 7 } }) })
    const result = scoreScan({ scanId: 'scan-1', measurements, baselines: {}, uuid: nextId })
    await expect(
      verifyScanRows({
        scans: [{ id: 'scan-1', takenAt: 1, kind: 'quick', conditions: {}, algoVersion: ALGO_VERSION }],
        measurements,
        scores: result.scores,
        overall: [result.overall],
      }),
    ).resolves.toBeUndefined()
  })
})

// ───────────────────────────── V06 photo technique ─────────────────────────────

describe('V06 photo technique', () => {
  const items = getMetric('V06')!.scoring.kind === 'checklist' ? (getMetric('V06')!.scoring as { items: { id: string }[] }).items.map((i) => i.id) : []

  it('records one pass/fail input per item of the catalog checklist, under the catalog\'s item ids', () => {
    const m = run(BASE).V06 as Measurement
    expect(items.sort()).toEqual(['distance', 'expression', 'height', 'light', 'pose', 'sharp'])
    for (const id of items) expect([0, 1], id).toContain(m.inputs?.[id])
  })

  it('all six pass: 100 %, no uncertainty away from the distance threshold', () => {
    const m = run(BASE).V06 as Measurement
    expect(m.value).toBe(100)
    expect(m.uncertainty).toBe(0)
    expect(m.method).toBe('AUTO_FRONTAL_PHOTO')
  })

  it('each failing item costs one sixth', () => {
    const cases: [string, RunOptions][] = [
      ['distance', { frame: () => ({ distanceM: 1.25 }), shotQc: { estimatedDistanceM: 1.25 } }],
      ['sharp', { shotQc: { checks: [check('sharpness', false, 12), check('lighting', true, 0.05)] } }],
      ['light', { shotQc: { checks: [check('sharpness', true, 120), check('lighting', false, 0.3)] } }],
      ['height', { frame: () => ({ pose: { pitch: 4.5 } }) }],
      ['pose', { frame: () => ({ pose: { yaw: 3.5 } }) }],
      ['expression', { frame: () => ({ blendshapes: { ...neutralBlendshapes(), mouthSmileLeft: 0.8, mouthSmileRight: 0.8 } }) }],
    ]
    for (const [item, o] of cases) {
      const m = run(BASE, o).V06 as Measurement
      expect(m.refusal, item).toBeUndefined()
      expect(m.inputs?.[item], item).toBe(0)
      expect(m.value, item).toBeCloseTo((5 / 6) * 100, 5)
    }
  })

  it('a critical failure is visible to the scorer as a capped score', () => {
    const m = run(BASE, { frame: () => ({ distanceM: 1.25 }), shotQc: { estimatedDistanceM: 1.25 } }).V06 as Measurement
    const { score } = scoreMetric(m, { baselines: {}, uuid: nextId })
    expect(score.score).toBeLessThanOrEqual(60)
    expect(score.score).not.toBeNull()
  })

  it('a distance within the ±15% error of the 1.5 m threshold is flagged as one item of uncertainty', () => {
    const m = run(BASE, { frame: () => ({ distanceM: 1.6 }), shotQc: { estimatedDistanceM: 1.6 } }).V06 as Measurement
    expect(m.uncertainty).toBeCloseTo(100 / 6, 5)
    const far = run(BASE, { frame: () => ({ distanceM: 1.9 }), shotQc: { estimatedDistanceM: 1.9 } }).V06 as Measurement
    expect(far.uncertainty).toBe(0)
  })

  it('is refused when an item cannot be judged: no sharpness or lighting reading in the capture record', () => {
    const r = run(BASE, { shotQc: { checks: [] } }).V06 as Measurement
    expect(r.value).toBeNull()
    expect(r.refusal?.reasons).toEqual([
      'The capture record has no sharpness reading, so sharpness cannot be judged',
      'The capture record has no lighting reading, so even light cannot be judged',
    ])
  })

  it('is refused for the catalog\'s frame conditions: face too small, face cropped', () => {
    // The face at ~2.1 m is under 15% of the shorter side.
    const small = run(BASE, { frame: () => ({ distanceM: 2.1 }), shotQc: { estimatedDistanceM: 2.1 } }).V06 as Measurement
    expect(small.refusal?.reasons.join(' ')).toMatch(/The face is 1[0-4]\.\d% of the shorter frame side \(minimum 15%\)/)
    const cropped = run(BASE, { frame: () => ({ centre: { x: W / 2, y: 120 } }) }).V06 as Measurement
    expect(cropped.refusal?.reasons.join(' ')).toContain('The face outline touches the edge of the frame')
  })

  it('shares the burst-level refusals (too few frames, wrong shot) with the other metrics', () => {
    expect(refusalText(run(BASE, { n: 2 }).V06)).toContain('Only 2 of 2 frames had a complete, plausible face mesh')
    expect(refusalText(run(BASE, { shotQc: { shot: 'profile_left' } }).V06)).toContain('profile left shot')
  })
})

// ───────────────────────────── the catalog ─────────────────────────────

describe('the metrics agree with the catalog', () => {
  it.each(FRONTAL_METRIC_IDS)('%s is a catalog metric of phase M1 captured on the frontal neutral shot', (id) => {
    const metric = getMetric(id)
    expect(metric).toBeDefined()
    expect(metric?.phase).toBe('M1')
    expect(metric?.captureRequirements).toEqual(['frontal_neutral'])
    expect(metric?.category).toBe('face')
  })

  it('F10, F11 and F21 are computed but flagged by the catalog: pseudoscience or myth, weight 0, never scored', () => {
    const r = run(BASE)
    expect(getMetric('F10')?.evidence).toBe('PSEUDOSCIENCE')
    expect(getMetric('F11')?.evidence).toBe('PSEUDOSCIENCE')
    expect(getMetric('F21')?.evidence).toBe('MYTH')
    for (const id of ['F10', 'F11', 'F21']) {
      expect(getMetric(id)?.weight).toBe(0)
      expect(getMetric(id)?.scoring.kind).toBe('none')
      expect((r[id] as Measurement).value, id).not.toBeNull()
      expect((r[id] as Measurement).refusal).toBeUndefined()
    }
    expect(value(r.F10)).toBeCloseTo(BASE.fwhr, 6)
    expect(value(r.F11)).toBeCloseTo(BASE.midface, 6)
  })

  it('F21 is the mean deviation from 1.618 over the two ratios the mesh can give', () => {
    const exact = run({ ...BASE, mouthOverNose: PHI, thirds: 1 / (PHI - 1) })
    // thirds = 1/0.618 = 1.618: (1 + 1.618) / 1.618 = 1.618 – both ratios are exactly the golden ratio.
    expect(value(exact.F21)).toBeCloseTo(0, 6)
    const m = run(BASE).F21 as Measurement
    expect(m.inputs?.mouthOverNoseWidth).toBeCloseTo(BASE.mouthOverNose, 6)
    expect(m.inputs?.noseBaseToChinOverMouthToChin).toBeCloseTo(1.5, 6)
    expect(m.method).toBe('COMPUTED_FROM_OTHER_METRICS')
  })

  it('the gate profiles mirror each metric\'s refusalConditions in the catalog', () => {
    const has = (conditions: string[], text: string | RegExp) => conditions.some((c) => (typeof text === 'string' ? c === text : text.test(c)))
    for (const id of FRONTAL_METRIC_IDS) {
      if (id === 'F21') continue
      const conditions = getMetric(id)!.refusalConditions
      const p = gateProfileFor(id)
      expect(p.pose, `${id} pose`).toBe(has(conditions, 'head yaw or roll above 3°'))
      expect(has(conditions, 'head yaw or roll above 3°') === has(conditions, 'head pitch above 2° from level'), `${id} pitch`).toBe(true)
      expect(p.centred, `${id} centred`).toBe(has(conditions, 'face outside the central 50% of the frame'))
      const wants15 = has(conditions, 'estimated camera distance under 1.5 m')
      const wants12 = has(conditions, 'estimated camera distance under 1.2 m')
      expect(p.minDistanceM, `${id} distance`).toBe(wants15 ? 1.5 : wants12 ? 1.2 : null)
      const neutral = has(conditions, /^expression not neutral/)
      expect(p.expression.includes('mouth') && p.expression.includes('brow'), `${id} neutral`).toBe(neutral)
      expect(p.expression.includes('eye'), `${id} eyes`).toBe(has(conditions, 'eyes closed, squinting or looking away from the lens'))
      expect(p.extra.includes('lighting'), `${id} lighting`).toBe(has(conditions, /^uneven lighting/))
      expect(p.extra.includes('jawHidden'), `${id} jaw`).toBe(has(conditions, /^jaw (edge|corners) hidden/))
      expect(p.extra.includes('chinHidden'), `${id} chin`).toBe(has(conditions, /^beard hiding the chin tip/))
      expect(p.extra.includes('lipEdgeHidden'), `${id} lip edge`).toBe(has(conditions, /^moustache or stubble hiding the upper-lip edge/))
      expect(p.extra.includes('illness'), `${id} illness`).toBe(has(conditions, /^user reports swelling, illness or heavy drinking/))
      expect(p.extra.includes('bothIrises'), `${id} irises`).toBe(has(conditions, /^iris not detected in both eyes/))
    }
    expect(Object.keys(GATE_PROFILES).sort()).toEqual(FRONTAL_METRIC_IDS.filter((id) => id !== 'F21').sort())
  })

  it('the pitch limit is the QC limit (4°) and the quality penalty starts at the catalog\'s 2°', () => {
    expect(QC_LIMITS.maxPitchDeg).toBe(4)
    expect(QC_FACTOR.pitch.clean).toBe(2)
    expect(getMetric('F05')?.refusalConditions).toContain('head pitch above 2° from level')
  })

  it('F21 inherits the gates of the metrics it is computed from', () => {
    const p = gateProfileFor('F21')
    expect(p.minDistanceM).toBe(1.5)
    expect(p.extra).toContain('chinHidden')
    expect(p.pose).toBe(true)
  })

  it('every id in the output is a catalog metric', () => {
    for (const id of ALL_IDS) expect(getMetric(id), id).toBeDefined()
  })
})
