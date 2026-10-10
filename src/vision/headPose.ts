/**
 * Head pose (yaw, pitch, roll in degrees) from MediaPipe's facial transformation matrix, with a
 * landmark-geometry fallback for when the matrix is missing.
 *
 * Sign conventions are those of HeadPose in types.ts, seen on a NON-mirrored image:
 *   yaw   > 0  face turned toward the image's right (the nose points to the right edge of the picture)
 *   pitch > 0  chin down (the nose points toward the floor)
 *   roll  > 0  clockwise on screen (the top of the head tips toward the image's right)
 *
 * Both paths build a rotation matrix R whose columns are the face's own right / up / forward axes expressed in a
 * right-handed camera frame (x to the image's right, y up, z toward the viewer), then read the angles out of R
 * as R = Ry(yaw)·Rx(pitch)·Rz(roll): a head turns, then nods, then tilts. Each factor is a rotation in the sense of the
 * sign convention above (a positive roll is the clockwise one on screen).
 *
 * Checked against the real model: MediaPipe's matrix has this frame (the portrait fixture's translation is +y up,
 * −z in front of the camera; its forward axis agrees with the normal of the landmark cloud to 1°), and a picture
 * rotated by a known angle in tests/e2e/vision.spec.ts moves roll by that angle with the right sign.
 */
import type { FaceLandmarks, HeadPose, Point3 } from './types'

const RAD = 180 / Math.PI

type Vec3 = readonly [number, number, number]
/** Row-major 3×3. */
type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

const NAN_POSE: HeadPose = { yaw: Number.NaN, pitch: Number.NaN, roll: Number.NaN }

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])

function unit(a: Vec3): Vec3 | null {
  const n = norm(a)
  return n > 0 && Number.isFinite(n) ? [a[0] / n, a[1] / n, a[2] / n] : null
}

/** Angles in degrees from a rotation matrix, R = Ry(yaw)·Rx(pitch)·Rz(roll). */
function eulerFromRotation(r: Mat3): HeadPose {
  // Third column = the face's forward axis; second column's x/y give the tilt of its up axis.
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r[5])))
  const yaw = Math.atan2(r[2], r[8])
  const roll = Math.atan2(-r[3], r[4])
  return { yaw: yaw * RAD, pitch: pitch * RAD, roll: roll * RAD }
}

/** R · Rx(angle): rotate the face about its OWN right axis. */
function nodAboutOwnX(r: Mat3, angleRad: number): Mat3 {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  // Columns 1 and 2 (up, forward) rotate into each other; column 0 (right) is unchanged.
  return [
    r[0], r[1] * c + r[2] * s, -r[1] * s + r[2] * c,
    r[3], r[4] * c + r[5] * s, -r[4] * s + r[5] * c,
    r[6], r[7] * c + r[8] * s, -r[7] * s + r[8] * c,
  ]
}

// ───────────────────────────── from the transformation matrix ─────────────────────────────

/** Rotation part of a row-major 4×4, with any uniform scale removed. Null if it is not a usable rotation. */
function rotationOf(matrix: readonly number[]): Mat3 | null {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return null
  const m = matrix
  const cols: Vec3[] = [
    [m[0]!, m[4]!, m[8]!],
    [m[1]!, m[5]!, m[9]!],
    [m[2]!, m[6]!, m[10]!],
  ]
  const u = cols.map(unit)
  if (u.some((c) => c === null)) return null
  const [a, b, c] = u as [Vec3, Vec3, Vec3]
  // A real face transform is a similarity; columns that are not mutually perpendicular mean it is not.
  if (Math.abs(dot(a, b)) > 0.05 || Math.abs(dot(a, c)) > 0.05 || Math.abs(dot(b, c)) > 0.05) return null
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]]
}

// ───────────────────────────── landmark fallback ─────────────────────────────

/**
 * How far the mesh's own forehead-to-chin axis leans back from the head's true vertical when the head is level
 * (Frankfort-horizontal), in degrees: the chin sits behind the forehead, so the raw axis reads as a nod. Measured on
 * the mesh as MediaPipe produces it (a real detection of tests/fixtures/portrait.jpg, whose matrix pitch is known),
 * not taken from anthropometric tables, because the mesh depth axis is a model output with its own scale. Single-face
 * calibration: this is the main reason the fallback pitch is only approximate.
 */
export const NEUTRAL_AXIS_LEAN_DEG = -3

const ids = {
  eyeOuterR: 33,
  eyeInnerR: 133,
  eyeOuterL: 263,
  eyeInnerL: 362,
  forehead: 10,
  chin: 152,
} as const

/** Landmarks → camera frame (x right, y up, z toward the viewer). MediaPipe: image y grows downward, smaller z is nearer. */
function toFrame(p: Point3): Vec3 {
  return [p.x, -p.y, -p.z]
}

function rotationFromLandmarks(lm: FaceLandmarks): Mat3 | null {
  const pts = lm.points
  const need = Object.values(ids)
  if (need.some((i) => pts[i] === undefined)) return null
  const p = (i: number): Vec3 => toFrame(pts[i] as Point3)
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

  // Right axis: from the subject's right eye to the left one, using both corners of each eye.
  const eyeR = mid(p(ids.eyeOuterR), p(ids.eyeInnerR))
  const eyeL = mid(p(ids.eyeOuterL), p(ids.eyeInnerL))
  const right = unit([eyeL[0] - eyeR[0], eyeL[1] - eyeR[1], eyeL[2] - eyeR[2]])
  if (!right) return null

  // Up axis: chin → top of the mesh forehead, made perpendicular to the right axis.
  const f = p(ids.forehead)
  const c = p(ids.chin)
  const rawUp: Vec3 = [f[0] - c[0], f[1] - c[1], f[2] - c[2]]
  const along = dot(rawUp, right)
  const up = unit([rawUp[0] - right[0] * along, rawUp[1] - right[1] * along, rawUp[2] - right[2] * along])
  if (!up) return null

  const forward = cross(right, up)
  const r: Mat3 = [right[0], up[0], forward[0], right[1], up[1], forward[1], right[2], up[2], forward[2]]
  return nodAboutOwnX(r, -NEUTRAL_AXIS_LEAN_DEG / RAD)
}

/**
 * Head pose in degrees.
 *
 * `matrix` is the row-major 4×4 facial transformation matrix (FaceLandmarks.transform). When it is missing or not a
 * rotation, `lm` is used instead: roll and yaw come from the eye line (in 3D for yaw), pitch from the forehead–chin
 * axis. The fallback is a geometric approximation: expect a few degrees of error in yaw and roll and more in pitch,
 * because the mesh depth is itself a model estimate. With neither input the pose is unknown and every angle is NaN,
 * which fails any "angle ≤ limit" check instead of passing it.
 */
export function headPoseFromTransform(matrix: number[] | null, lm?: FaceLandmarks): HeadPose {
  const fromMatrix = matrix ? rotationOf(matrix) : null
  if (fromMatrix) return eulerFromRotation(fromMatrix)
  const fromLandmarks = lm ? rotationFromLandmarks(lm) : null
  if (fromLandmarks) return eulerFromRotation(fromLandmarks)
  return { ...NAN_POSE }
}
