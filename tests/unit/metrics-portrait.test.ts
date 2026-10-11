/**
 * The metrics on the REAL face mesh of the one official sample portrait (tests/fixtures/portrait.jpg, a stock portrait
 * from Google's Apache-2.0 MediaPipe assets; never anyone's own photo). The synthetic faces of metrics-frontal.test.ts give
 * every metric a known answer, but only a real mesh can show that real landmark output passes the plausibility checks and
 * that the refusals fire on real numbers.
 *
 * The data below is landmark COORDINATES only (the named points, the 36 face-outline vertices, four iris-ring vertices, the
 * blendshape scores the neutral-face rules read), read once from the real detector in the browser harness
 * (harness/vision-harness.ts) and rounded to 0.01 px. No image is stored here.
 */
import { describe, expect, it } from 'vitest'
import type { Measurement, ShotQc } from '../../src/domain/types'
import { computeFrontalMetrics } from '../../src/metrics'
import { F01_COMPOSITE } from '../../src/metrics/frontal'
import { MESH } from '../../src/vision/namedPoints'
import { NAMED_POINTS } from '../../src/vision/types'
import type { FaceFrame, NamedPoint, NamedPoints, Point3 } from '../../src/vision/types'

// ───────────────────────────── the portrait's mesh ─────────────────────────────

const PORTRAIT = {
  width: 820,
  height: 1024,
  pose: { yaw: 1.85, pitch: 3.87, roll: -0.89 },
  irisPx: 17.04,
  named: {
    pupilL: [449.64, 174.36],
    pupilR: [363.1, 175.16],
    irisCenterL: [449.72, 174.38],
    irisCenterR: [363.1, 175.14],
    eyeInnerL: [429.63, 177.78],
    eyeInnerR: [382.79, 178.4],
    eyeOuterL: [464.6, 176.04],
    eyeOuterR: [348, 177.61],
    eyeTopL: [450.04, 170.4],
    eyeTopR: [362.63, 171.1],
    eyeBottomL: [447.8, 177.85],
    eyeBottomR: [364.75, 179.19],
    browInnerL: [422.82, 156.34],
    browInnerR: [390.16, 156.86],
    browOuterL: [480.14, 163.06],
    browOuterR: [330.9, 165.07],
    browMidL: [458.45, 152.84],
    browMidR: [353.91, 154.29],
    zygionL: [497.69, 204.34],
    zygionR: [308.4, 206.01],
    gonionL: [480.82, 290.24],
    gonionR: [329.17, 292.43],
    noseTip: [407.22, 231.4],
    subnasale: [406.95, 238.56],
    nasion: [406.5, 170.75],
    alarL: [439.92, 221.52],
    alarR: [372.52, 222.61],
    cupidBow: [406.93, 256.34],
    upperLipTop: [406.93, 256.34],
    upperLipBottom: [407.08, 263.24],
    lowerLipTop: [406.77, 280.66],
    lowerLipBottom: [407.34, 294.15],
    cheilionL: [457.29, 258.87],
    cheilionR: [357.02, 262.83],
    chinTip: [407.27, 347.75],
    menton: [407.27, 347.75],
    trichion: [405.35, 72.58],
    faceTop: [405.71, 102.21],
    faceBottom: [407.27, 347.75],
    faceLeft: [498.74, 183.82],
    faceRight: [307.04, 185.44],
  } as Record<NamedPoint, [number, number]>,
  points: {
    10: [405.71, 102.21],
    21: [312.23, 146.83],
    54: [320.87, 130.62],
    58: [320.25, 273.38],
    67: [356.68, 107.8],
    93: [310.23, 227.08],
    103: [335.22, 117.25],
    109: [379.24, 103.16],
    127: [307.04, 185.44],
    132: [314.02, 249.46],
    136: [338.91, 306.8],
    148: [388.48, 346.17],
    149: [361.81, 330.92],
    150: [351.12, 320.68],
    152: [407.27, 347.75],
    162: [308.14, 164],
    172: [329.17, 292.43],
    176: [373.83, 339.86],
    234: [308.4, 206.01],
    251: [494.74, 145.67],
    284: [487.03, 129.73],
    288: [488.77, 271.42],
    297: [453.36, 107.35],
    323: [496.43, 225.51],
    332: [473.68, 116.58],
    338: [431.68, 102.84],
    356: [498.74, 183.82],
    361: [493.87, 247.82],
    365: [471.94, 304.19],
    377: [425.65, 345.13],
    378: [450.76, 328.71],
    379: [460.62, 318.08],
    389: [498.23, 162.48],
    397: [480.82, 290.24],
    400: [439.71, 338.11],
    454: [497.69, 204.34],
    469: [371.56, 174.99],
    471: [354.63, 175.3],
    474: [458.16, 174.27],
    476: [441.01, 174.34],
  } as Record<number, [number, number]>,
  blendshapes: {
    mouthSmileLeft: 0.96,
    mouthSmileRight: 0.93,
    cheekSquintLeft: 0,
    cheekSquintRight: 0,
    jawOpen: 0.12,
    mouthPressLeft: 0.16,
    mouthPressRight: 0.1,
    mouthPucker: 0,
    mouthFrownLeft: 0,
    mouthFrownRight: 0,
    eyeBlinkLeft: 0.27,
    eyeBlinkRight: 0.26,
    eyeSquintLeft: 0.74,
    eyeSquintRight: 0.66,
    eyeWideLeft: 0,
    eyeWideRight: 0,
    browDownLeft: 0.84,
    browDownRight: 0.82,
    browInnerUp: 0,
    browOuterUpLeft: 0,
    browOuterUpRight: 0,
    eyeLookUpLeft: 0.1,
    eyeLookUpRight: 0.12,
    eyeLookDownLeft: 0.15,
    eyeLookDownRight: 0.18,
    eyeLookOutLeft: 0.18,
    eyeLookInRight: 0.14,
    eyeLookInLeft: 0.03,
    eyeLookOutRight: 0.07,
  } as Record<string, number>,
}

// ───────────────────────────── building frames from it ─────────────────────────────

interface Placement {
  /** Scale about the pupil midpoint: the same face seen from a greater distance (a smaller face and iris in the picture). */
  scale: number
  /** Where the pupil midpoint lands, as a share of the picture's width and height; null leaves the face where it was shot. */
  at: { x: number; y: number } | null
  neutral: boolean
}

const AS_SHOT: Placement = { scale: 1, at: null, neutral: false }

function portraitFrame(placement: Placement): FaceFrame {
  const { scale, at } = placement
  const pupilMid = {
    x: (PORTRAIT.named.pupilL[0] + PORTRAIT.named.pupilR[0]) / 2,
    y: (PORTRAIT.named.pupilL[1] + PORTRAIT.named.pupilR[1]) / 2,
  }
  const target = at ? { x: at.x * PORTRAIT.width, y: at.y * PORTRAIT.height } : pupilMid
  const move = ([x, y]: [number, number]): { x: number; y: number } => ({
    x: target.x + scale * (x - pupilMid.x),
    y: target.y + scale * (y - pupilMid.y),
  })

  const named = {} as NamedPoints
  for (const key of NAMED_POINTS) named[key] = move(PORTRAIT.named[key])
  const points: Point3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }))
  for (const [id, p] of Object.entries(PORTRAIT.points)) points[Number(id)] = { ...move(p), z: 0 }

  const blendshapes = placement.neutral ? Object.fromEntries(Object.keys(PORTRAIT.blendshapes).map((k) => [k, 0.02])) : { ...PORTRAIT.blendshapes }
  return {
    landmarks: { points, width: PORTRAIT.width, height: PORTRAIT.height, blendshapes, transform: null },
    pose: { ...PORTRAIT.pose },
    irisPx: PORTRAIT.irisPx * scale,
    named,
  }
}

const shotQc = (irisPx: number, estimatedDistanceM: number | null): ShotQc => ({
  shot: 'frontal_neutral',
  framesTried: 5,
  framesKept: 5,
  checks: [
    { id: 'sharpness', ok: true, value: 100, limit: 'limit', hint: 'fine' },
    { id: 'lighting', ok: true, value: 0.05, limit: 'limit', hint: 'fine' },
  ],
  burstSpread: 0.01,
  estimatedDistanceM,
  irisPx,
  greyCard: false,
})

let counter = 0
const measure = (placement: Placement, distance: number | null = null): Record<string, Measurement> => {
  const frame = portraitFrame(placement)
  return Object.fromEntries(
    computeFrontalMetrics({
      scanId: 'portrait',
      frames: Array.from({ length: 5 }, () => frame),
      shotQc: shotQc(frame.irisPx, distance),
      uuid: () => `p-${++counter}`,
    }).map((m) => [m.metricId, m]),
  )
}

const text = (m: Measurement | undefined): string => (m?.refusal ? [...m.refusal.reasons, ...m.refusal.recapture].join(' || ') : '')

// ───────────────────────────── tests ─────────────────────────────

describe('the real portrait, as it was shot', () => {
  const r = measure(AS_SHOT)

  it('is refused for what is really wrong with it: it smiles, the camera is close, the head sits high in the frame', () => {
    for (const id of ['F01', 'F05', 'F07', 'F08', 'F10', 'F11', 'F12', 'F14', 'F15', 'F16', 'F17', 'F21', 'F22', 'F23']) {
      expect(r[id]?.value, id).toBeNull()
      expect(r[id]?.refusal, id).toBeDefined()
    }
    expect(text(r.F08)).toMatch(/Estimated camera distance 0\.5\d m \(minimum 1\.2 m;/)
    expect(text(r.F08)).toMatch(/The face reaches \d+(\.\d)?% of the frame height outside the central 50% of the frame \(top edge\)/)
    expect(text(r.F08)).toMatch(/Expression is not neutral: smile signal 0\.9\d \(limit 0\.25\)/)
    expect(text(r.F08)).toMatch(/Expression is not neutral: brows pulled down signal 0\.8\d \(limit 0\.60\)/)
    // The pupil distance in mm does not depend on the mouth or the brows, only on the eyes.
    expect(text(r.F23)).not.toContain('smile')
    expect(text(r.F23)).toMatch(/eyes squinting signal 0\.7\d \(limit 0\.50\)/)
  })

  it('does not refuse the head pose: a real mesh at 1.9° yaw, 0.9° roll and 3.9° pitch is inside the limits', () => {
    for (const m of Object.values(r)) expect(text(m)).not.toMatch(/Head (yaw|roll|pitch)/)
  })

  it('judges the photo technique: close, and a smile (not neutral), so two of the six items fail', () => {
    const v = r.V06 as Measurement
    expect(v.refusal).toBeUndefined()
    expect(v.inputs?.distance).toBe(0)
    expect(v.inputs?.expression).toBe(0)
    expect(v.value).toBeCloseTo((4 / 6) * 100, 4)
  })
})

describe('the same real mesh, re-framed, farther away and with a neutral expression score', () => {
  // The coordinates are the portrait's, so the lips and the philtrum are those of a smile: this checks the pipeline on real
  // landmarks, not what a neutral face measures.
  const placement: Placement = { scale: 0.35, at: { x: 0.5, y: 0.45 }, neutral: true }
  const r = measure(placement)
  const ids = ['F01', 'F05', 'F07', 'F08', 'F10', 'F11', 'F12', 'F14', 'F15', 'F16', 'F17', 'F21', 'F22', 'F23', 'V06']

  it('every metric is measured, none refused', () => {
    for (const id of ids) {
      expect(text(r[id]), id).toBe('')
      expect(r[id]?.value, id).not.toBeNull()
      expect(r[id]?.nFrames, id).toBe(5)
    }
    expect((r.F08 as Measurement).inputs?.distanceM).toBeGreaterThan(1.5)
  })

  it('lands in human ranges, with the uncertainty the landmark floor gives', () => {
    const v = (id: string): number => (r[id] as Measurement).value as number
    expect(v('F08')).toBeGreaterThan(44)
    expect(v('F08')).toBeLessThan(47.5)
    expect(v('F07')).toBeGreaterThan(1.2)
    expect(v('F07')).toBeLessThan(1.45)
    expect(v('F10')).toBeGreaterThan(1.6)
    expect(v('F10')).toBeLessThan(2.1)
    expect(v('F11')).toBeGreaterThan(0.95)
    expect(v('F11')).toBeLessThan(1.15)
    expect(v('F14')).toBeGreaterThan(1.3)
    expect(v('F14')).toBeLessThan(1.6)
    expect(v('F16')).toBeGreaterThan(2.0)
    expect(v('F16')).toBeLessThan(2.5)
    expect(v('F17')).toBeGreaterThan(1.15)
    expect(v('F17')).toBeLessThan(1.35)
    expect(v('F22')).toBeGreaterThan(17)
    expect(v('F22')).toBeLessThan(24)
    expect(v('F23')).toBeGreaterThan(55)
    expect(v('F23')).toBeLessThan(63)
    expect(Math.abs(v('F12'))).toBeLessThan(5)
    expect(v('F05')).toBeGreaterThan(0.5)
    expect(v('F05')).toBeLessThan(3)
    for (const id of ids.filter((x) => x !== 'V06')) {
      const m = r[id] as Measurement
      expect(m.uncertainty as number, id).toBeGreaterThan(0)
      expect(m.qcFactor, id).toBeGreaterThan(0.5)
    }
  })

  it('is scale-free: the same face at another distance gives the same proportions', () => {
    const far = measure({ scale: 0.3, at: { x: 0.5, y: 0.45 }, neutral: true })
    expect((far.F08 as Measurement).inputs?.distanceM).toBeGreaterThan((r.F08 as Measurement).inputs?.distanceM as number)
    for (const id of ['F01', 'F05', 'F07', 'F08', 'F10', 'F11', 'F12', 'F14', 'F15', 'F16', 'F17', 'F21', 'F22', 'F23']) {
      const a = (r[id] as Measurement).value as number
      const b = (far[id] as Measurement).value as number
      expect(Math.abs(a - b) / Math.max(Math.abs(a), 1e-9), id).toBeLessThan(1e-4)
    }
  })

  it('F01 reads 50 on the portrait: its two reference numbers are this face\'s own measurements', () => {
    expect((r.F01 as Measurement).value).toBeCloseTo(50, 0)
    expect(F01_COMPOSITE.outlineReference).toBeCloseTo(((r.F01 as Measurement).inputs?.outlineLengthOverRootArea as number), 1)
    expect(F01_COMPOSITE.cheekJawReference).toBeCloseTo(((r.F01 as Measurement).inputs?.cheekToJawRatio as number), 1)
  })

  it('reads the left and right the way the catalog does: the subject\'s left is the larger x', () => {
    expect(PORTRAIT.named.pupilL[0]).toBeGreaterThan(PORTRAIT.named.pupilR[0])
    expect(PORTRAIT.named.eyeOuterL[0]).toBeGreaterThan(PORTRAIT.named.eyeInnerL[0])
    expect(MESH.faceOval).toHaveLength(36)
    for (const id of MESH.faceOval) expect(PORTRAIT.points[id], String(id)).toBeDefined()
  })
})
