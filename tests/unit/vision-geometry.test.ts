import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HFOV_DEG,
  IRIS,
  IRIS_DIAMETER_MM,
  angleDeg,
  dist,
  estimateDistanceM,
  irisDiameterPx,
  lineAngleDeg,
  midpoint,
} from '../../src/vision/geometry'
import type { FaceLandmarks, Point3 } from '../../src/vision/types'

const RAD = Math.PI / 180

describe('dist / midpoint', () => {
  it('measures a 3-4-5 triangle in either direction', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(dist({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(5)
    expect(dist({ x: -1, y: -1 }, { x: 2, y: 3 })).toBe(5)
  })

  it('is 0 for the same point and ignores z', () => {
    expect(dist({ x: 7, y: 7 }, { x: 7, y: 7 })).toBe(0)
    const a: Point3 = { x: 0, y: 0, z: 0 }
    const b: Point3 = { x: 3, y: 4, z: 99 }
    expect(dist(a, b)).toBe(5)
  })

  it('stays exact at pixel scale', () => {
    expect(dist({ x: 0, y: 0 }, { x: 4000, y: 3000 })).toBe(5000)
  })

  it('midpoint is the mean, including negative coordinates', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 })
    expect(midpoint({ x: -4, y: 6 }, { x: 4, y: -2 })).toEqual({ x: 0, y: 2 })
    expect(midpoint({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 })
  })
})

describe('angleDeg (unsigned angle at the vertex)', () => {
  const o = { x: 0, y: 0 }

  it('reads right angles, straight lines and zero', () => {
    expect(angleDeg({ x: 1, y: 0 }, o, { x: 0, y: 1 })).toBeCloseTo(90, 10)
    expect(angleDeg({ x: 1, y: 0 }, o, { x: -1, y: 0 })).toBeCloseTo(180, 10)
    expect(angleDeg({ x: 1, y: 0 }, o, { x: 5, y: 0 })).toBe(0)
  })

  it('reads 45° and 60° exactly', () => {
    expect(angleDeg({ x: 1, y: 0 }, o, { x: 1, y: 1 })).toBeCloseTo(45, 10)
    expect(angleDeg({ x: 1, y: 0 }, o, { x: Math.cos(60 * RAD), y: Math.sin(60 * RAD) })).toBeCloseTo(60, 10)
  })

  it('does not depend on the order of the rays, the lengths, or where the vertex is', () => {
    const a = { x: 5, y: 2 }
    const b = { x: 1, y: 9 }
    const v = { x: 2, y: 3 }
    const base = angleDeg(a, v, b)
    expect(angleDeg(b, v, a)).toBeCloseTo(base, 10)
    expect(angleDeg({ x: 2 + (5 - 2) * 10, y: 3 + (2 - 3) * 10 }, v, b)).toBeCloseTo(base, 10)
    expect(angleDeg({ x: a.x + 100, y: a.y - 50 }, { x: v.x + 100, y: v.y - 50 }, { x: b.x + 100, y: b.y - 50 })).toBeCloseTo(base, 10)
  })

  it('stays accurate next to 0° and 180°, where acos of a rounded cosine is not', () => {
    const tiny = 1e-7
    expect(angleDeg({ x: 1, y: 0 }, o, { x: 1, y: tiny })).toBeCloseTo(tiny / RAD, 12)
    expect(angleDeg({ x: 1, y: 0 }, o, { x: -1, y: tiny })).toBeCloseTo(180 - tiny / RAD, 9)
  })

  it('is NaN when a ray has no length (never a made-up angle)', () => {
    expect(angleDeg(o, o, { x: 1, y: 0 })).toBeNaN()
    expect(angleDeg({ x: 1, y: 0 }, o, o)).toBeNaN()
    expect(angleDeg({ x: Number.NaN, y: 0 }, o, { x: 1, y: 0 })).toBeNaN()
  })
})

describe('lineAngleDeg (direction in image coordinates, clockwise positive)', () => {
  const o = { x: 0, y: 0 }

  it('0° points right, 90° points down the screen, −90° up, ±180° left', () => {
    expect(lineAngleDeg(o, { x: 1, y: 0 })).toBe(0)
    expect(lineAngleDeg(o, { x: 0, y: 1 })).toBe(90)
    expect(lineAngleDeg(o, { x: 0, y: -1 })).toBe(-90)
    expect(lineAngleDeg(o, { x: -1, y: 0 })).toBe(180)
  })

  it('a line sloping down to the right is positive (the sign of a clockwise head roll)', () => {
    expect(lineAngleDeg({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(45, 10)
    expect(lineAngleDeg({ x: 0, y: 0 }, { x: 10, y: -10 })).toBeCloseTo(-45, 10)
  })

  it('reverses by 180° when the endpoints swap', () => {
    const a = { x: 3, y: 1 }
    const b = { x: 9, y: 4 }
    expect(Math.abs(lineAngleDeg(a, b) - lineAngleDeg(b, a))).toBeCloseTo(180, 10)
  })

  it('reads a 3° tilt of a 100 px eye line', () => {
    const tilt = 3 * RAD
    expect(lineAngleDeg({ x: 0, y: 0 }, { x: 100 * Math.cos(tilt), y: 100 * Math.sin(tilt) })).toBeCloseTo(3, 10)
  })

  it('is NaN for a zero-length line', () => {
    expect(lineAngleDeg(o, o)).toBeNaN()
    expect(lineAngleDeg({ x: Number.NaN, y: 0 }, o)).toBeNaN()
  })
})

// ───────────────────────────── iris ─────────────────────────────

/** A 478-point mesh that is all zeros except the iris rings: horizontal diameters in px, vertical ones deliberately different. */
function irisMesh(rightHorizontal: number, leftHorizontal: number): FaceLandmarks {
  const points: Point3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }))
  const ring = (center: number, edges: readonly number[], cx: number, horizontal: number, vertical: number) => {
    points[center] = { x: cx, y: 100, z: 0 }
    // edges = [left edge, right edge] of the horizontal pair; the vertical pair are the two ids after the centre's ring start
    points[edges[0] as number] = { x: cx - horizontal / 2, y: 100, z: 0 }
    points[edges[1] as number] = { x: cx + horizontal / 2, y: 100, z: 0 }
    const [top, bottom] = center === IRIS.centerR ? [470, 472] : [475, 477]
    points[top] = { x: cx, y: 100 - vertical / 2, z: 0 }
    points[bottom] = { x: cx, y: 100 + vertical / 2, z: 0 }
  }
  ring(IRIS.centerR, IRIS.horizontalR, 300, rightHorizontal, rightHorizontal * 0.8)
  ring(IRIS.centerL, IRIS.horizontalL, 500, leftHorizontal, leftHorizontal * 0.8)
  return { points, width: 800, height: 600, blendshapes: {}, transform: null }
}

describe('irisDiameterPx', () => {
  it('is the mean horizontal diameter of the two eyes', () => {
    expect(irisDiameterPx(irisMesh(20, 20))).toBeCloseTo(20, 10)
    expect(irisDiameterPx(irisMesh(18, 22))).toBeCloseTo(20, 10)
  })

  it('ignores the vertical pair (eyelids cover it, so it is both biased and noisy)', () => {
    const lm = irisMesh(20, 20)
    // Collapse the vertical pairs completely: the answer must not change.
    for (const id of [470, 472, 475, 477]) lm.points[id] = { x: 0, y: 0, z: 0 }
    expect(irisDiameterPx(lm)).toBeCloseTo(20, 10)
  })

  it('scales linearly with the image', () => {
    const small = irisDiameterPx(irisMesh(10, 10))
    const big = irisDiameterPx(irisMesh(30, 30))
    expect(big / small).toBeCloseTo(3, 10)
  })

  it('uses the one eye that has an iris when the other has collapsed, and 0 when neither does', () => {
    expect(irisDiameterPx(irisMesh(24, 0))).toBeCloseTo(24, 10)
    expect(irisDiameterPx(irisMesh(0, 0))).toBe(0)
  })

  it('is 0 for a mesh without iris points (the plain 468-point mesh)', () => {
    const lm = irisMesh(20, 20)
    lm.points.length = 468
    expect(irisDiameterPx(lm)).toBe(0)
    expect(irisDiameterPx({ ...lm, points: [] })).toBe(0)
  })

  it('does not count non-finite points', () => {
    const lm = irisMesh(20, 20)
    lm.points[469] = { x: Number.NaN, y: 100, z: 0 }
    expect(irisDiameterPx(lm)).toBeCloseTo(20, 10)
  })
})

// ───────────────────────────── distance ─────────────────────────────

describe('estimateDistanceM', () => {
  it('matches the pinhole formula exactly: 90° hfov on a 1000 px frame is f = 500 px', () => {
    // d = f · iris_mm / irisPx = 500 · 0.0117 / 5.85 = 1 m
    expect(estimateDistanceM(5.85, 1000, 90)).toBeCloseTo(1, 12)
    expect(IRIS_DIAMETER_MM).toBe(11.7)
  })

  it('doubling the iris size halves the distance, and it grows with the frame width', () => {
    const base = estimateDistanceM(10, 1000, 90)
    expect(estimateDistanceM(20, 1000, 90)).toBeCloseTo(base / 2, 12)
    expect(estimateDistanceM(10, 2000, 90)).toBeCloseTo(base * 2, 12)
  })

  it('a narrower field of view (a longer lens) puts the same iris size farther away', () => {
    expect(estimateDistanceM(10, 1000, 40)).toBeGreaterThan(estimateDistanceM(10, 1000, 65))
    expect(estimateDistanceM(10, 1000, 65)).toBeGreaterThan(estimateDistanceM(10, 1000, 90))
  })

  it('defaults to a 65° field of view', () => {
    expect(DEFAULT_HFOV_DEG).toBe(65)
    expect(estimateDistanceM(12, 1080)).toBe(estimateDistanceM(12, 1080, 65))
  })

  it('round-trips: the iris size a face at 1.5 m would have gives back 1.5 m', () => {
    const width = 1080
    const f = width / 2 / Math.tan((65 / 2) * RAD)
    const irisAt1p5m = (f * 0.0117) / 1.5
    expect(irisAt1p5m).toBeGreaterThan(5)
    expect(irisAt1p5m).toBeLessThan(10)
    expect(estimateDistanceM(irisAt1p5m, width)).toBeCloseTo(1.5, 10)
  })

  it('a selfie-sized iris reads as close, a far-away one as far', () => {
    expect(estimateDistanceM(40, 1080)).toBeLessThan(0.4)
    expect(estimateDistanceM(4, 1080)).toBeGreaterThan(2)
  })

  it('no iris (0 or negative px) is infinitely far, so a "too close" test cannot pass by accident', () => {
    expect(estimateDistanceM(0, 1000)).toBe(Number.POSITIVE_INFINITY)
    expect(estimateDistanceM(-3, 1000)).toBe(Number.POSITIVE_INFINITY)
  })

  it('unusable inputs are NaN, not a number', () => {
    expect(estimateDistanceM(Number.NaN, 1000)).toBeNaN()
    expect(estimateDistanceM(10, 0)).toBeNaN()
    expect(estimateDistanceM(10, -5)).toBeNaN()
    expect(estimateDistanceM(10, Number.NaN)).toBeNaN()
    expect(estimateDistanceM(10, 1000, 0)).toBeNaN()
    expect(estimateDistanceM(10, 1000, 180)).toBeNaN()
    expect(estimateDistanceM(10, 1000, -20)).toBeNaN()
    expect(estimateDistanceM(10, 1000, Number.NaN)).toBeNaN()
    expect(estimateDistanceM(Number.POSITIVE_INFINITY, 1000)).toBeNaN()
  })
})
