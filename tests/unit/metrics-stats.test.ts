import { describe, expect, it } from 'vitest'
import { clamp, clamp01, mean, median, product, quadrature, round, sampleStd, softLimitFactor } from '../../src/metrics/stats'

describe('median', () => {
  it('takes the middle value of an odd count', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([9])).toBe(9)
  })

  it('takes the mean of the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([10, 20])).toBe(15)
  })

  it('ignores a wild outlier, which is why a burst is combined by the median', () => {
    expect(median([1.0, 1.01, 0.99, 1.02, 40])).toBe(1.01)
  })

  it('does not reorder its input', () => {
    const xs = [3, 1, 2]
    median(xs)
    expect(xs).toEqual([3, 1, 2])
  })

  it('gives NaN, never a default, for nothing or for a non-finite entry', () => {
    expect(median([])).toBeNaN()
    expect(median([1, Number.NaN, 3])).toBeNaN()
    expect(median([1, Number.POSITIVE_INFINITY])).toBeNaN()
  })
})

describe('mean and sampleStd', () => {
  it('mean', () => {
    expect(mean([1, 2, 3, 6])).toBe(3)
    expect(mean([])).toBeNaN()
  })

  it('divides by n − 1: the standard deviation of 2, 4, 4, 4, 5, 5, 7, 9 is sqrt(32/7)', () => {
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12)
  })

  it('is 0 for identical values and NaN for fewer than two values (one frame has no spread)', () => {
    expect(sampleStd([3, 3, 3])).toBe(0)
    expect(sampleStd([3])).toBeNaN()
    expect(sampleStd([])).toBeNaN()
    expect(sampleStd([1, Number.NaN])).toBeNaN()
  })
})

describe('small helpers', () => {
  it('quadrature adds independent errors', () => {
    expect(quadrature([3, 4])).toBe(5)
    expect(quadrature([])).toBe(0)
    expect(quadrature([1, Number.NaN])).toBeNaN()
  })

  it('clamp, clamp01, round, product', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp01(1.7)).toBe(1)
    expect(clamp01(0.4)).toBe(0.4)
    expect(round(0.30000000000000004)).toBe(0.3)
    expect(round(1.23456789, 3)).toBe(1.235)
    expect(product([0.9, 0.9, 0.5])).toBeCloseTo(0.405, 12)
    expect(product([])).toBe(1)
    expect(product([2, 2])).toBe(1)
  })
})

describe('softLimitFactor', () => {
  // clean 1, limit 3, 0.85 at the limit
  const f = (v: number) => softLimitFactor(v, 1, 3, 0.85)

  it('is 1 inside the clean zone, 0.85 at the limit, and linear between', () => {
    expect(f(0)).toBe(1)
    expect(f(1)).toBe(1)
    expect(f(2)).toBeCloseTo(0.925, 12)
    expect(f(3)).toBeCloseTo(0.85, 12)
  })

  it('holds the limit value beyond the limit (the gate refuses before the factor matters)', () => {
    expect(f(10)).toBe(0.85)
  })

  it('is monotone non-increasing', () => {
    let last = Number.POSITIVE_INFINITY
    for (let v = 0; v <= 5; v += 0.25) {
      const x = f(v)
      expect(x).toBeLessThanOrEqual(last)
      last = x
    }
  })

  it('NaN in, NaN out: an unmeasured error is not a good one', () => {
    expect(f(Number.NaN)).toBeNaN()
  })
})
