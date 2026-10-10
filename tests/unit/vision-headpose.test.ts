import { describe, expect, it } from 'vitest'
import { NEUTRAL_AXIS_LEAN_DEG, headPoseFromTransform } from '../../src/vision/headPose'
import type { FaceLandmarks, Point3 } from '../../src/vision/types'

const RAD = Math.PI / 180

// ───────────────────────────── independent rotation builders ─────────────────────────────
// Camera frame: x to the image's right, y up, z toward the viewer (what MediaPipe's matrix uses).
// Rotations are built from elementary right-handed rotations, NOT from the formulas in headPose.ts.

type Vec = [number, number, number]
type Mat = [Vec, Vec, Vec]

const rx = (a: number): Mat => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]
const ry = (a: number): Mat => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]
const rz = (a: number): Mat => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]

function mul(a: Mat, b: Mat): Mat {
  return a.map((row) => [0, 1, 2].map((j) => row[0]! * b[0]![j]! + row[1]! * b[1]![j]! + row[2]! * b[2]![j]!)) as Mat
}
const apply = (m: Mat, v: Vec): Vec => m.map((row) => row[0]! * v[0] + row[1]! * v[1] + row[2]! * v[2]) as Vec

/** Head that turns by `yaw`, then nods by `pitch`, then tilts by `roll`; angles in the HeadPose sign convention. */
function headRotation(yawDeg: number, pitchDeg: number, rollDeg: number): Mat {
  // pitch > 0 = chin down = the nose swings toward −y; a right-handed turn about +x by +a swings +z toward −y.
  // roll  > 0 = clockwise on screen = a right-handed turn about +z by −a.
  // yaw   > 0 = nose toward the image's right = a right-handed turn about +y by +a.
  return mul(mul(ry(yawDeg * RAD), rx(pitchDeg * RAD)), rz(-rollDeg * RAD))
}

/** Row-major 4×4 as FaceLandmarks.transform carries it, with a translation and an optional uniform scale. */
function matrix4(r: Mat, scale = 1, t: Vec = [0.4, 22, -65]): number[] {
  return [
    r[0][0] * scale, r[0][1] * scale, r[0][2] * scale, t[0],
    r[1][0] * scale, r[1][1] * scale, r[1][2] * scale, t[1],
    r[2][0] * scale, r[2][1] * scale, r[2][2] * scale, t[2],
    0, 0, 0, 1,
  ]
}

describe('what the angles mean (checked on the axes, not on the formulas)', () => {
  it('yaw > 0: the face\'s forward axis points to the image\'s right', () => {
    const f = apply(headRotation(20, 0, 0), [0, 0, 1])
    expect(f[0]).toBeGreaterThan(0.3)
    expect(Math.abs(f[1])).toBeLessThan(1e-12)
    expect(f[2]).toBeGreaterThan(0)
  })

  it('pitch > 0: chin down, the forward axis points toward the floor', () => {
    const f = apply(headRotation(0, 20, 0), [0, 0, 1])
    expect(f[1]).toBeLessThan(-0.3)
    expect(Math.abs(f[0])).toBeLessThan(1e-12)
  })

  it('roll > 0: clockwise on screen, the top of the head tips toward the image\'s right', () => {
    const up = apply(headRotation(0, 0, 20), [0, 1, 0])
    expect(up[0]).toBeGreaterThan(0.3)
    expect(up[1]).toBeGreaterThan(0)
  })
})

describe('headPoseFromTransform – transformation matrix', () => {
  it('reads a level, frontal head as zero', () => {
    const pose = headPoseFromTransform(matrix4(headRotation(0, 0, 0)))
    expect(pose.yaw).toBeCloseTo(0, 10)
    expect(pose.pitch).toBeCloseTo(0, 10)
    expect(pose.roll).toBeCloseTo(0, 10)
  })

  it('recovers each angle on its own, positive and negative', () => {
    for (const a of [-45, -20, -3, 3, 8, 20, 45]) {
      const yaw = headPoseFromTransform(matrix4(headRotation(a, 0, 0)))
      expect(yaw.yaw).toBeCloseTo(a, 9)
      expect(yaw.pitch).toBeCloseTo(0, 9)
      expect(yaw.roll).toBeCloseTo(0, 9)

      const pitch = headPoseFromTransform(matrix4(headRotation(0, a, 0)))
      expect(pitch.pitch).toBeCloseTo(a, 9)
      expect(pitch.yaw).toBeCloseTo(0, 9)
      expect(pitch.roll).toBeCloseTo(0, 9)

      const roll = headPoseFromTransform(matrix4(headRotation(0, 0, a)))
      expect(roll.roll).toBeCloseTo(a, 9)
      expect(roll.yaw).toBeCloseTo(0, 9)
      expect(roll.pitch).toBeCloseTo(0, 9)
    }
  })

  it('recovers combined rotations', () => {
    for (const [yaw, pitch, roll] of [
      [10, -5, 3],
      [-25, 12, -8],
      [35, 20, 15],
      [-2.5, 3.9, -0.9],
    ] as const) {
      const pose = headPoseFromTransform(matrix4(headRotation(yaw, pitch, roll)))
      expect(pose.yaw).toBeCloseTo(yaw, 8)
      expect(pose.pitch).toBeCloseTo(pitch, 8)
      expect(pose.roll).toBeCloseTo(roll, 8)
    }
  })

  it('ignores the translation and any uniform scale in the matrix', () => {
    const r = headRotation(12, -7, 4)
    const plain = headPoseFromTransform(matrix4(r))
    const scaled = headPoseFromTransform(matrix4(r, 17.5, [-300, 8000, -0.001]))
    expect(scaled.yaw).toBeCloseTo(plain.yaw, 9)
    expect(scaled.pitch).toBeCloseTo(plain.pitch, 9)
    expect(scaled.roll).toBeCloseTo(plain.roll, 9)
  })

  it('mirroring the head flips yaw and roll and leaves pitch', () => {
    const a = headPoseFromTransform(matrix4(headRotation(14, 6, -9)))
    const b = headPoseFromTransform(matrix4(headRotation(-14, 6, 9)))
    expect(b.yaw).toBeCloseTo(-a.yaw, 9)
    expect(b.roll).toBeCloseTo(-a.roll, 9)
    expect(b.pitch).toBeCloseTo(a.pitch, 9)
  })

  it('matches the matrix MediaPipe produced for the portrait fixture (near frontal, slightly down)', () => {
    // Row-major, as FaceLandmarks.transform carries it (captured from a real detection in Chromium).
    const m = [
      0.9993919134140015, -0.013295787386596203, 0.03225291147828102, -0.4123116135597229,
      0.01544753834605217, 0.9976064562797546, -0.06741082668304443, 22.463706970214844,
      -0.03127942234277725, 0.06786813586950302, 0.9972041845321655, -65.44642639160156,
      0, 0, 0, 1,
    ]
    const pose = headPoseFromTransform(m)
    expect(pose.yaw).toBeCloseTo(1.85, 2)
    expect(pose.pitch).toBeCloseTo(3.87, 2)
    expect(pose.roll).toBeCloseTo(-0.89, 2)
  })

  it('does not trust a matrix that is not a rotation: wrong size, NaN, degenerate or sheared', () => {
    const good = matrix4(headRotation(0, 0, 0))
    expect(headPoseFromTransform(good.slice(0, 15)).yaw).toBeNaN()
    expect(headPoseFromTransform([...good.slice(0, 5), Number.NaN, ...good.slice(6)]).yaw).toBeNaN()
    expect(headPoseFromTransform(new Array<number>(16).fill(0)).yaw).toBeNaN()
    const sheared = [...good]
    sheared[1] = 0.8 // first and second axes no longer perpendicular
    expect(headPoseFromTransform(sheared).yaw).toBeNaN()
  })
})

// ───────────────────────────── landmark fallback ─────────────────────────────

/**
 * A head built from the six landmarks the fallback reads, in mesh pixels: eye corners at ±48 px, forehead 100 px above
 * and chin 100 px below the eye line. At zero pose the forehead–chin axis leans back by the calibrated neutral lean,
 * which is exactly what the fallback removes.
 */
function neutralHead(): Record<number, Vec> {
  const lean = NEUTRAL_AXIS_LEAN_DEG * RAD
  const half = 100
  return {
    33: [-60, 0, 0], //   subject's right eye, outer corner
    133: [-36, 0, 0], //  inner
    362: [36, 0, 0], //   subject's left eye, inner corner
    263: [60, 0, 0], //   outer
    10: [0, half, half * Math.tan(lean)], // top of the mesh forehead
    152: [0, -half, -half * Math.tan(lean)], // chin
  }
}

/** Rotate the head, move it, and read it out as MediaPipe landmarks (y down, z away from the camera = negative toward it). */
function landmarksFor(yaw: number, pitch: number, roll: number, offset: Vec = [400, -300, 0], scale = 1): FaceLandmarks {
  const r = headRotation(yaw, pitch, roll)
  const points: Point3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }))
  for (const [id, v] of Object.entries(neutralHead())) {
    const w = apply(r, v)
    points[Number(id)] = { x: w[0] * scale + offset[0], y: -(w[1] * scale + offset[1]), z: -(w[2] * scale + offset[2]) }
  }
  return { points, width: 800, height: 1000, blendshapes: {}, transform: null }
}

describe('headPoseFromTransform – landmark fallback (no matrix)', () => {
  it('reads a neutral head as zero', () => {
    const pose = headPoseFromTransform(null, landmarksFor(0, 0, 0))
    expect(pose.yaw).toBeCloseTo(0, 9)
    expect(pose.pitch).toBeCloseTo(0, 9)
    expect(pose.roll).toBeCloseTo(0, 9)
  })

  it('recovers synthetic rotations of the head, with the same signs as the matrix path', () => {
    for (const [yaw, pitch, roll] of [
      [10, 0, 0],
      [-10, 0, 0],
      [0, 8, 0],
      [0, -8, 0],
      [0, 0, 6],
      [0, 0, -6],
      [15, -6, 4],
      [-30, 10, -12],
    ] as const) {
      const fromLandmarks = headPoseFromTransform(null, landmarksFor(yaw, pitch, roll))
      const fromMatrix = headPoseFromTransform(matrix4(headRotation(yaw, pitch, roll)))
      expect(fromLandmarks.yaw).toBeCloseTo(yaw, 8)
      expect(fromLandmarks.pitch).toBeCloseTo(pitch, 8)
      expect(fromLandmarks.roll).toBeCloseTo(roll, 8)
      expect(fromLandmarks.yaw).toBeCloseTo(fromMatrix.yaw, 8)
    }
  })

  it('does not depend on where the head is in the frame or how large it is', () => {
    const a = headPoseFromTransform(null, landmarksFor(9, -4, 3, [400, -300, 0], 1))
    const b = headPoseFromTransform(null, landmarksFor(9, -4, 3, [90, -70, 500], 3.5))
    expect(b.yaw).toBeCloseTo(a.yaw, 8)
    expect(b.pitch).toBeCloseTo(a.pitch, 8)
    expect(b.roll).toBeCloseTo(a.roll, 8)
  })

  it('uses the fallback only when the matrix is unusable', () => {
    const lm = landmarksFor(10, 0, 0)
    const bad = new Array<number>(16).fill(Number.NaN)
    expect(headPoseFromTransform(bad, lm).yaw).toBeCloseTo(10, 8)
    // A good matrix wins over the landmarks.
    expect(headPoseFromTransform(matrix4(headRotation(-5, 0, 0)), lm).yaw).toBeCloseTo(-5, 8)
  })

  it('with neither a matrix nor landmarks the pose is unknown (NaN), which fails every "≤ limit" check', () => {
    const none = headPoseFromTransform(null)
    expect(none.yaw).toBeNaN()
    expect(none.pitch).toBeNaN()
    expect(none.roll).toBeNaN()
    expect(Math.abs(none.yaw) <= 3).toBe(false)
  })

  it('a mesh missing the needed points, or with coincident eyes, gives NaN rather than a guess', () => {
    const short = landmarksFor(0, 0, 0)
    short.points.length = 100
    expect(headPoseFromTransform(null, short).yaw).toBeNaN()

    const collapsed = landmarksFor(0, 0, 0)
    for (const id of [33, 133, 263, 362]) collapsed.points[id] = { x: 5, y: 5, z: 5 }
    expect(headPoseFromTransform(null, collapsed).roll).toBeNaN()
  })
})
