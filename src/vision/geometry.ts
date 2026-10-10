/**
 * Plane geometry helpers plus the two scale proxies that come from the iris: its pixel diameter and
 * the camera distance estimated from it.
 *
 * Degenerate input (a zero-length ray, a non-finite coordinate) returns NaN, never a made-up number:
 * NaN poisons any arithmetic it enters and zod rejects it, so a bad point cannot be scored by accident.
 * Callers must test Number.isFinite before using a result.
 */
import type { FaceLandmarks, Point2 } from './types'

const RAD = 180 / Math.PI

export function dist(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Unsigned angle at `vertex` between the rays vertex→a and vertex→b, in degrees, 0…180. NaN if a ray has no length. */
export function angleDeg(a: Point2, vertex: Point2, b: Point2): number {
  const ax = a.x - vertex.x
  const ay = a.y - vertex.y
  const bx = b.x - vertex.x
  const by = b.y - vertex.y
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  if (!(la > 0) || !(lb > 0)) return Number.NaN
  // atan2 of (cross, dot) is accurate near 0° and 180°, where acos of a rounded cosine is not.
  return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) * RAD
}

/**
 * Direction of the line a→b in image coordinates (x right, y down), degrees in (−180, 180].
 * Positive = clockwise on screen, the same sign as HeadPose.roll. 0° = a→b points right. NaN if a = b.
 */
export function lineAngleDeg(a: Point2, b: Point2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (!(Math.hypot(dx, dy) > 0)) return Number.NaN
  return Math.atan2(dy, dx) * RAD
}

// ───────────────────────────── iris scale ─────────────────────────────

/** Mean horizontal visible iris diameter of an adult, 11.7 mm (the figure MediaPipe's own iris-depth solution is built on). */
export const IRIS_DIAMETER_MM = 11.7

/**
 * Landmark ids of the two irises, each the left and right edge point of the ring (the horizontal diameter).
 * Subject's right iris = viewer's left on a non-mirrored image. On the portrait fixture the pair 469–471 / 474–476
 * measures 17 px and the other pair of ring points 15 px, which is why the horizontal pair is the one used.
 */
export const IRIS = {
  centerR: 468,
  centerL: 473,
  horizontalR: [469, 471],
  horizontalL: [474, 476],
} as const

function irisHorizontalPx(points: readonly Point2[], pair: readonly number[]): number {
  const a = points[pair[0] as number]
  const b = points[pair[1] as number]
  return a && b ? dist(a, b) : Number.NaN
}

/**
 * Mean horizontal iris diameter of both eyes in image pixels (the scale / distance proxy); 0 when the mesh has no
 * iris points or they collapse. The horizontal diameter is the one the 11.7 mm constant describes and the one an
 * eyelid never covers, so it also repeats better from frame to frame than the vertical one.
 */
export function irisDiameterPx(lm: FaceLandmarks): number {
  const usable = [irisHorizontalPx(lm.points, IRIS.horizontalR), irisHorizontalPx(lm.points, IRIS.horizontalL)].filter(
    (d) => Number.isFinite(d) && d > 0,
  )
  if (usable.length === 0) return 0
  return usable.reduce((s, d) => s + d, 0) / usable.length
}

/** Default horizontal field of view across the image WIDTH, degrees (a typical phone camera held in portrait). */
export const DEFAULT_HFOV_DEG = 65

/**
 * Camera-to-face distance in metres from the iris size (pinhole model).
 *
 *   focal length in px  f = (W / 2) / tan(hfov / 2)         (W = width of the image the iris was measured in)
 *   distance            d = f · 11.7 mm / irisPx
 *
 * This is an ESTIMATE, good to about ±15%: real iris diameters span roughly 11–12.5 mm between adults (±6%), the
 * true field of view of the lens/crop in use is only assumed, and the iris landmarks themselves carry about a pixel
 * of error. It is accurate enough to refuse a selfie-distance shot (< 1.2 m), not to measure anything with.
 *
 * Returns Infinity when no iris is visible (irisPx ≤ 0: the limit of an infinitely small iris), so a range check
 * fails on "too far" rather than passing; NaN when an input is not a usable number.
 */
export function estimateDistanceM(irisPx: number, imageWidthPx: number, hfovDeg: number = DEFAULT_HFOV_DEG): number {
  if (!Number.isFinite(irisPx) || !Number.isFinite(imageWidthPx) || !Number.isFinite(hfovDeg)) return Number.NaN
  if (!(imageWidthPx > 0) || !(hfovDeg > 0) || !(hfovDeg < 180)) return Number.NaN
  if (irisPx <= 0) return Number.POSITIVE_INFINITY
  const focalPx = imageWidthPx / 2 / Math.tan((hfovDeg / 2) / RAD)
  return (focalPx * (IRIS_DIAMETER_MM / 1000)) / irisPx
}
