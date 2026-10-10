import { describe, expect, it } from 'vitest'
import {
  anchorScoreRaw,
  bandFromPoints,
  baselineBand,
  baselineTau,
  checklistScoreFromShareRaw,
  checklistScoreRaw,
  clampScore,
  combineBaselineAndAnchor,
  gapOutside,
  oneSidedScoreRaw,
  percentileScoreRaw,
  personalBaselineScoreRaw,
  rangeScoreRaw,
  scoreSpread,
  truncateScore,
  type ScorePoint,
} from '../../src/scoring/functions'

/** Small seeded PRNG so the property loops are deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (r: () => number, lo: number, hi: number): number => lo + (hi - lo) * r()

describe('truncateScore', () => {
  it('truncates, never rounds up', () => {
    expect(truncateScore(38.9)).toBe(38)
    expect(truncateScore(99.999)).toBe(99)
    expect(truncateScore(0.99)).toBe(0)
    expect(truncateScore(60)).toBe(60)
  })

  it('clamps to 0–100', () => {
    expect(truncateScore(-5)).toBe(0)
    expect(truncateScore(100)).toBe(100)
    expect(truncateScore(140)).toBe(100)
    expect(clampScore(-1)).toBe(0)
  })

  it('absorbs float noise on a true integer but not a real shortfall', () => {
    expect(truncateScore(70.00000000000001)).toBe(70)
    expect(truncateScore(69.99999999999999)).toBe(70)
    expect(truncateScore(69.9999999)).toBe(69)
  })

  it('refuses NaN instead of inventing a score', () => {
    expect(() => truncateScore(Number.NaN)).toThrow(RangeError)
  })
})

describe('range rule', () => {
  const rule = { lo: 105, hi: 120, tau: 8 }

  it('is 100 inside the band, edges included', () => {
    for (const v of [105, 112.5, 120]) expect(rangeScoreRaw(v, rule)).toBe(100)
  })

  it('matches 100·exp(−½(d/tau)²) outside, hand-computed', () => {
    // d = 11 above: exp(−½·(11/8)²) = exp(−0.9453125) = 0.38847…
    expect(rangeScoreRaw(131, rule)).toBeCloseTo(100 * Math.exp(-0.9453125), 9)
    expect(truncateScore(rangeScoreRaw(131, rule))).toBe(38)
    // d = tau → exp(−½) = 0.60653…
    expect(rangeScoreRaw(128, rule)).toBeCloseTo(60.6530659712633, 9)
    expect(truncateScore(rangeScoreRaw(128, rule))).toBe(60)
    // d = 2·tau → exp(−2) = 0.13533…
    expect(rangeScoreRaw(136, rule)).toBeCloseTo(13.5335283236613, 9)
    expect(truncateScore(rangeScoreRaw(136, rule))).toBe(13)
  })

  it('is symmetric about the band', () => {
    expect(rangeScoreRaw(105 - 7, rule)).toBeCloseTo(rangeScoreRaw(120 + 7, rule), 12)
  })

  it('rejects a non-positive tau', () => {
    expect(() => rangeScoreRaw(1, { lo: 0, hi: 1, tau: 0 })).toThrow(RangeError)
  })

  it('property: non-increasing away from the band, continuous, within 0–100, truncation never exceeds raw', () => {
    const r = rng(1)
    for (let i = 0; i < 2000; i++) {
      const lo = between(r, -50, 50)
      const hi = lo + between(r, 0, 40)
      const tau = between(r, 0.1, 20)
      const rule2 = { lo, hi, tau }
      const d1 = between(r, 0, 4 * tau)
      const d2 = d1 + between(r, 0, 2 * tau)
      // Both sides: further out never scores higher.
      expect(rangeScoreRaw(hi + d2, rule2)).toBeLessThanOrEqual(rangeScoreRaw(hi + d1, rule2) + 1e-12)
      expect(rangeScoreRaw(lo - d2, rule2)).toBeLessThanOrEqual(rangeScoreRaw(lo - d1, rule2) + 1e-12)
      // Continuity: the steepest slope of 100·exp(−x²/2τ²) is 100/(τ·√e).
      const x = between(r, lo - 5 * tau, hi + 5 * tau)
      const eps = tau * 1e-4
      const lipschitz = (100 / (tau * Math.sqrt(Math.E))) * eps * 1.0001
      expect(Math.abs(rangeScoreRaw(x + eps, rule2) - rangeScoreRaw(x, rule2))).toBeLessThanOrEqual(lipschitz + 1e-12)
      // Bounds and truncation.
      const raw = rangeScoreRaw(x, rule2)
      expect(raw).toBeGreaterThanOrEqual(0)
      expect(raw).toBeLessThanOrEqual(100)
      expect(truncateScore(raw)).toBeLessThanOrEqual(raw + 1e-8)
      expect(truncateScore(raw)).toBeGreaterThan(raw - 1 - 1e-8)
    }
  })
})

describe('one_sided rule', () => {
  const iga: ScorePoint[] = [
    { x: 0, y: 100 },
    { x: 1, y: 85 },
    { x: 2, y: 55 },
    { x: 3, y: 25 },
    { x: 4, y: 5 },
  ]

  it('hits the table points exactly', () => {
    for (const p of iga) expect(oneSidedScoreRaw(p.x, iga)).toBe(p.y)
  })

  it('interpolates linearly, hand-computed', () => {
    expect(oneSidedScoreRaw(0.5, iga)).toBeCloseTo(92.5, 12)
    expect(truncateScore(oneSidedScoreRaw(0.5, iga))).toBe(92)
    expect(oneSidedScoreRaw(1.5, iga)).toBeCloseTo(70, 12)
    expect(oneSidedScoreRaw(2.5, iga)).toBeCloseTo(40, 12)
    expect(oneSidedScoreRaw(3.25, iga)).toBeCloseTo(20, 12)
  })

  it('clamps outside the table', () => {
    expect(oneSidedScoreRaw(-3, iga)).toBe(100)
    expect(oneSidedScoreRaw(9, iga)).toBe(5)
  })

  it('works for a target-style table with a plateau', () => {
    const bodyFat: ScorePoint[] = [
      { x: 6, y: 20 },
      { x: 8, y: 70 },
      { x: 10, y: 100 },
      { x: 15, y: 100 },
      { x: 18, y: 80 },
    ]
    expect(oneSidedScoreRaw(12, bodyFat)).toBe(100)
    expect(oneSidedScoreRaw(7, bodyFat)).toBeCloseTo(45, 12)
    expect(oneSidedScoreRaw(16.5, bodyFat)).toBeCloseTo(90, 12)
    expect(oneSidedScoreRaw(3, bodyFat)).toBe(20)
  })

  it('does not depend on the order the points are given in', () => {
    expect(oneSidedScoreRaw(1.5, [...iga].reverse())).toBeCloseTo(70, 12)
  })

  it('needs at least one point', () => {
    expect(() => oneSidedScoreRaw(1, [])).toThrow(RangeError)
  })

  it('property: continuous, bounded by the table, monotone when the table is', () => {
    const r = rng(2)
    for (let i = 0; i < 1500; i++) {
      const n = 2 + Math.floor(r() * 6)
      const xs: number[] = []
      let x = between(r, -20, 20)
      for (let k = 0; k < n; k++) {
        xs.push(x)
        x += between(r, 0.2, 10)
      }
      const ys = xs.map(() => between(r, 0, 100))
      const pts = xs.map((px, k) => ({ x: px, y: ys[k]! }))
      const maxSlope = Math.max(...pts.slice(1).map((p, k) => Math.abs(p.y - pts[k]!.y) / (p.x - pts[k]!.x)))
      const probe = between(r, xs[0]! - 5, xs[n - 1]! + 5)
      const eps = 1e-4
      expect(Math.abs(oneSidedScoreRaw(probe + eps, pts) - oneSidedScoreRaw(probe, pts))).toBeLessThanOrEqual(maxSlope * eps + 1e-9)
      expect(oneSidedScoreRaw(probe, pts)).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9)
      expect(oneSidedScoreRaw(probe, pts)).toBeLessThanOrEqual(Math.max(...ys) + 1e-9)

      // A non-increasing table gives a non-increasing score.
      const sorted = [...ys].sort((a, b) => b - a)
      const mono = xs.map((px, k) => ({ x: px, y: sorted[k]! }))
      const a = between(r, xs[0]! - 3, xs[n - 1]! + 3)
      const b = a + between(r, 0, 8)
      expect(oneSidedScoreRaw(b, mono)).toBeLessThanOrEqual(oneSidedScoreRaw(a, mono) + 1e-9)
    }
  })
})

describe('bands and gaps', () => {
  it('reads the 100-score region of a table', () => {
    expect(bandFromPoints([{ x: 0, y: 100 }, { x: 1, y: 85 }, { x: 4, y: 5 }])).toEqual({ lo: null, hi: 0 })
    expect(bandFromPoints([{ x: 6, y: 20 }, { x: 10, y: 100 }, { x: 15, y: 100 }, { x: 45, y: 0 }])).toEqual({ lo: 10, hi: 15 })
    expect(bandFromPoints([{ x: 1.1, y: 10 }, { x: 1.5, y: 100 }, { x: 1.9, y: 100 }])).toEqual({ lo: 1.5, hi: null })
    expect(bandFromPoints([{ x: 0, y: 50 }, { x: 1, y: 100 }, { x: 2, y: 100 }, { x: 3, y: 50 }])).toEqual({ lo: 1, hi: 2 })
    expect(bandFromPoints([{ x: 0, y: 50 }, { x: 3, y: 60 }])).toEqual({ lo: null, hi: null })
  })

  it('measures distance outside a band', () => {
    expect(gapOutside(131, { lo: 105, hi: 120 })).toBe(11)
    expect(gapOutside(100, { lo: 105, hi: 120 })).toBe(5)
    expect(gapOutside(110, { lo: 105, hi: 120 })).toBe(0)
    expect(gapOutside(7, { lo: null, hi: 2 })).toBe(5)
    expect(gapOutside(-7, { lo: null, hi: 2 })).toBe(0)
    expect(gapOutside(1, { lo: null, hi: null })).toBeNull()
  })
})

describe('personal_baseline rule', () => {
  it('sets the tolerance from the scale span, else from the baseline, else from the uncertainty', () => {
    expect(baselineTau({ scaleMin: 0, scaleMax: 100, baseline: 52, uncertainty: 2 })).toBeCloseTo(15, 12)
    expect(baselineTau({ scaleMin: 0, scaleMax: 4, baseline: 2, uncertainty: 0 })).toBeCloseTo(0.6, 12)
    expect(baselineTau({ scaleMin: 0, scaleMax: null, baseline: 40, uncertainty: 1 })).toBeCloseTo(6, 12)
    expect(baselineTau({ scaleMin: null, scaleMax: null, baseline: -40, uncertainty: 1 })).toBeCloseTo(6, 12)
    expect(baselineTau({ scaleMin: null, scaleMax: null, baseline: 0, uncertainty: 2 })).toBe(6)
    expect(baselineTau({ scaleMin: null, scaleMax: null, baseline: 0, uncertainty: null })).toBe(1)
  })

  it('implies the right band per direction', () => {
    expect(baselineBand(50, 'lower_better')).toEqual({ lo: null, hi: 50 })
    expect(baselineBand(50, 'higher_better')).toEqual({ lo: 50, hi: null })
    expect(baselineBand(50, 'target_range')).toEqual({ lo: 50, hi: 50 })
  })

  it('lower_better: 100 at or below the baseline, then decays one tau → 60.65', () => {
    expect(personalBaselineScoreRaw(50, 50, 'lower_better', 15)).toBe(100)
    expect(personalBaselineScoreRaw(30, 50, 'lower_better', 15)).toBe(100)
    expect(personalBaselineScoreRaw(65, 50, 'lower_better', 15)).toBeCloseTo(60.6530659712633, 9)
    expect(personalBaselineScoreRaw(80, 50, 'lower_better', 15)).toBeCloseTo(13.5335283236613, 9)
  })

  it('higher_better mirrors it', () => {
    expect(personalBaselineScoreRaw(70, 50, 'higher_better', 15)).toBe(100)
    expect(personalBaselineScoreRaw(35, 50, 'higher_better', 15)).toBeCloseTo(60.6530659712633, 9)
  })

  it('target_range penalises deviation either way', () => {
    expect(personalBaselineScoreRaw(50, 50, 'target_range', 15)).toBe(100)
    expect(personalBaselineScoreRaw(65, 50, 'target_range', 15)).toBeCloseTo(60.6530659712633, 9)
    expect(personalBaselineScoreRaw(35, 50, 'target_range', 15)).toBeCloseTo(60.6530659712633, 9)
  })

  it('combines with a norm anchor by taking the lower score', () => {
    const anchor: ScorePoint[] = [{ x: 0, y: 100 }, { x: 10, y: 0 }]
    expect(anchorScoreRaw(4, anchor)).toBeCloseTo(60, 12)
    expect(combineBaselineAndAnchor(100, anchorScoreRaw(4, anchor))).toBeCloseTo(60, 12)
    expect(combineBaselineAndAnchor(30, anchorScoreRaw(4, anchor))).toBe(30)
  })

  it('property: lower_better is non-increasing as the value rises; higher_better non-decreasing', () => {
    const r = rng(3)
    for (let i = 0; i < 1000; i++) {
      const baseline = between(r, -30, 80)
      const tau = between(r, 0.2, 25)
      const a = baseline + between(r, -50, 50)
      const b = a + between(r, 0, 30)
      expect(personalBaselineScoreRaw(b, baseline, 'lower_better', tau)).toBeLessThanOrEqual(personalBaselineScoreRaw(a, baseline, 'lower_better', tau) + 1e-12)
      expect(personalBaselineScoreRaw(b, baseline, 'higher_better', tau)).toBeGreaterThanOrEqual(personalBaselineScoreRaw(a, baseline, 'higher_better', tau) - 1e-12)
    }
  })
})

describe('checklist rule', () => {
  const rule = {
    criticalItemCap: 60,
    items: [
      { id: 'distance', label: 'Distance', critical: true },
      { id: 'sharp', label: 'Sharp', critical: true },
      { id: 'light', label: 'Light', critical: false },
      { id: 'height', label: 'Height', critical: false },
      { id: 'pose', label: 'Pose', critical: false },
      { id: 'expression', label: 'Expression', critical: false },
    ],
  }
  const all = { distance: true, sharp: true, light: true, height: true, pose: true, expression: true }

  it('is the share of items passed', () => {
    expect(checklistScoreRaw(rule, all).raw).toBe(100)
    const one = checklistScoreRaw(rule, { ...all, light: false })
    expect(one.raw).toBeCloseTo(83.3333333333, 9)
    expect(truncateScore(one.raw)).toBe(83)
    expect(one.cap).toBeNull()
    expect(one.failed.map((f) => f.id)).toEqual(['light'])
    expect(checklistScoreRaw(rule, { ...all, light: false, height: false, pose: false }).raw).toBe(50)
  })

  it('caps the score when a critical item fails', () => {
    const o = checklistScoreRaw(rule, { ...all, distance: false })
    expect(o.share).toBeCloseTo(83.3333333333, 9)
    expect(o.cap).toBe(60)
    expect(o.raw).toBe(60)
    expect(o.failedCritical.map((f) => f.id)).toEqual(['distance'])
  })

  it('keeps the lower value when the share is already under the cap', () => {
    const o = checklistScoreRaw(rule, { distance: false, sharp: false, light: false, height: true, pose: true, expression: true })
    expect(o.share).toBe(50)
    expect(o.raw).toBe(50)
  })

  it('counts an item without a result as failed', () => {
    const o = checklistScoreRaw(rule, { distance: true, sharp: true, light: true, height: true, pose: true })
    expect(o.passed).toBe(5)
    expect(o.failed.map((f) => f.id)).toEqual(['expression'])
  })

  it('needs at least one item', () => {
    expect(() => checklistScoreRaw({ criticalItemCap: 60, items: [] }, {})).toThrow(RangeError)
  })

  it('share-only fallback caps any shortfall because a critical failure cannot be ruled out', () => {
    expect(checklistScoreFromShareRaw(100, 60)).toEqual({ raw: 100, cap: null })
    expect(checklistScoreFromShareRaw(90, 60)).toEqual({ raw: 60, cap: 60 })
    expect(checklistScoreFromShareRaw(50, 60)).toEqual({ raw: 50, cap: 60 })
    expect(checklistScoreFromShareRaw(140, 60)).toEqual({ raw: 100, cap: null })
  })
})

describe('percentile rule', () => {
  it('maps the percentile straight to a score', () => {
    expect(percentileScoreRaw(80, 'higher_better')).toBe(80)
    expect(percentileScoreRaw(80, 'lower_better')).toBe(20)
    expect(percentileScoreRaw(-5, 'higher_better')).toBe(0)
    expect(percentileScoreRaw(130, 'higher_better')).toBe(100)
  })
})

describe('scoreSpread', () => {
  it('is the largest score movement within ± the uncertainty', () => {
    const rule = { lo: 105, hi: 120, tau: 8 }
    const fn = (v: number) => rangeScoreRaw(v, rule)
    // Inside the band, ±3 reaches 123: exp(−½(3/8)²) = 0.9322…, a movement of 6.78.
    expect(scoreSpread(fn, 120, 3)).toBeCloseTo(100 - 100 * Math.exp(-0.5 * (3 / 8) ** 2), 9)
    expect(scoreSpread(fn, 112, 3)).toBe(0)
    expect(scoreSpread(fn, 131, 0)).toBe(0)
  })
})
