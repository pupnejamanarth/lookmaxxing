import { describe, expect, it } from 'vitest'
import { getMetric } from '../../src/catalog'
import { METHODS, type Method } from '../../src/catalog/schema'
import type { Measurement } from '../../src/domain/types'
import {
  METHOD_BASE,
  SELF_REPORT_METHODS,
  bandForValue,
  confidenceBreakdown,
  confidenceFor,
  countsTowardOverall,
  repeatabilityFactor,
  scaleSpan,
  truncate2,
} from '../../src/scoring/confidence'

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

// F05 (symmetry): scale 0–15 → span 15.
const F05 = getMetric('F05')!
const meas = (o: Partial<Measurement> = {}): Measurement => ({
  id: 'm1',
  scanId: 's1',
  metricId: 'F05',
  value: 4,
  unit: '% of pupil distance',
  uncertainty: 0,
  nFrames: 5,
  method: 'AUTO_FRONTAL_PHOTO',
  qcFactor: 1,
  algoVersion: 'a1',
  ...o,
})

describe('method base', () => {
  it('follows PLAN §4.2', () => {
    expect(METHOD_BASE.AUTO_FRONTAL_PHOTO).toBe(1)
    expect(METHOD_BASE.AUTO_PROFILE_PHOTO).toBe(1)
    expect(METHOD_BASE.COLOR_CALIBRATED_PHOTO).toBe(0.9)
    expect(METHOD_BASE.MANUAL_LANDMARKS).toBe(0.85)
    expect(METHOD_BASE.TAPE_MEASURE).toBe(0.85)
    expect(METHOD_BASE.SELF_GRADE_REFERENCE).toBe(0.6)
    expect(METHOD_BASE.CHECKLIST).toBe(0.6)
  })

  it('has an entry for every method', () => {
    for (const method of METHODS) expect(METHOD_BASE[method]).toBeGreaterThan(0)
  })

  it('gives each method its base when nothing else degrades the measurement', () => {
    const cases: [Method, number][] = [
      ['AUTO_FRONTAL_PHOTO', 1],
      ['COLOR_CALIBRATED_PHOTO', 0.9],
      ['MANUAL_LANDMARKS', 0.85],
      ['TAPE_MEASURE', 0.85],
      ['SELF_GRADE_REFERENCE', 0.6],
    ]
    for (const [method, expected] of cases) {
      expect(confidenceFor(meas({ method }), F05).value).toBe(expected)
    }
  })
})

describe('bands', () => {
  it('reads HIGH ≥ 0.80, MEDIUM 0.60–0.79, LOW 0.40–0.59, REFUSED below 0.40', () => {
    expect(bandForValue(1)).toBe('HIGH')
    expect(bandForValue(0.8)).toBe('HIGH')
    expect(bandForValue(0.79)).toBe('MEDIUM')
    expect(bandForValue(0.6)).toBe('MEDIUM')
    expect(bandForValue(0.59)).toBe('LOW')
    expect(bandForValue(0.4)).toBe('LOW')
    expect(bandForValue(0.39)).toBe('REFUSED')
    expect(bandForValue(0)).toBe('REFUSED')
  })

  it('assigns each band through the full calculation (qc factor sets the value; AUTO base, no spread)', () => {
    const at = (qcFactor: number) => confidenceFor(meas({ qcFactor }), F05)
    expect(at(0.95)).toEqual({ band: 'HIGH', value: 0.95 })
    expect(at(0.8)).toEqual({ band: 'HIGH', value: 0.8 })
    expect(at(0.79)).toEqual({ band: 'MEDIUM', value: 0.79 })
    expect(at(0.6)).toEqual({ band: 'MEDIUM', value: 0.6 })
    expect(at(0.59)).toEqual({ band: 'LOW', value: 0.59 })
    expect(at(0.4)).toEqual({ band: 'LOW', value: 0.4 })
    expect(at(0.39)).toEqual({ band: 'REFUSED', value: 0.39 })
    expect(at(0.1)).toEqual({ band: 'REFUSED', value: 0.1 })
  })

  it('truncates to two decimals, so a displayed value never reaches a band it did not earn', () => {
    expect(truncate2(0.7999999)).toBe(0.79)
    expect(truncate2(0.8000000000000002)).toBe(0.8)
    expect(confidenceFor(meas({ qcFactor: 0.7999 }), F05)).toEqual({ band: 'MEDIUM', value: 0.79 })
    expect(confidenceFor(meas({ qcFactor: 0.5999 }), F05)).toEqual({ band: 'LOW', value: 0.59 })
  })

  it('only HIGH and MEDIUM count toward the overall', () => {
    expect(countsTowardOverall('HIGH')).toBe(true)
    expect(countsTowardOverall('MEDIUM')).toBe(true)
    expect(countsTowardOverall('LOW')).toBe(false)
    expect(countsTowardOverall('REFUSED')).toBe(false)
  })
})

describe('repeatability from uncertainty relative to the scale', () => {
  it('is clamp(1 − 1.5·uncertainty/span, 0, 1), hand-computed on a 0–15 scale', () => {
    const r = (uncertainty: number) => repeatabilityFactor(meas({ uncertainty }), F05)
    expect(r(0)).toBe(1)
    expect(r(0.75)).toBeCloseTo(0.925, 12) // 5 % of span
    expect(r(1.5)).toBeCloseTo(0.85, 12) // 10 %
    expect(r(3)).toBeCloseTo(0.7, 12) // 20 %
    expect(r(10)).toBe(0) // clamped
  })

  it('combines into the confidence product: 1.0 × 0.95 × 0.925 = 0.87875 → 0.87 HIGH', () => {
    const c = confidenceBreakdown(meas({ qcFactor: 0.95, uncertainty: 0.75 }), F05)
    expect(c.product).toBeCloseTo(0.87875, 12)
    expect(c.value).toBe(0.87)
    expect(c.band).toBe('HIGH')
    expect(c.method).toBe(1)
    expect(c.photo).toBe(0.95)
  })

  it('gives MEDIUM, LOW and REFUSED from spread and photo quality together', () => {
    expect(confidenceFor(meas({ qcFactor: 0.9, uncertainty: 1.5 }), F05)).toEqual({ band: 'MEDIUM', value: 0.76 }) // 0.9 × 0.85
    expect(confidenceFor(meas({ qcFactor: 0.7, uncertainty: 3 }), F05)).toEqual({ band: 'LOW', value: 0.49 }) // 0.7 × 0.7
    expect(confidenceFor(meas({ qcFactor: 0.5, uncertainty: 3 }), F05)).toEqual({ band: 'REFUSED', value: 0.35 }) // 0.5 × 0.7
  })

  it('treats an unknown uncertainty as 0.75: it cannot earn HIGH', () => {
    expect(repeatabilityFactor(meas({ uncertainty: null }), F05)).toBe(0.75)
    expect(confidenceFor(meas({ uncertainty: null }), F05)).toEqual({ band: 'MEDIUM', value: 0.75 })
  })

  it('caps repeatability at 0.85 under three frames, readings or placements', () => {
    expect(repeatabilityFactor(meas({ nFrames: 1 }), F05)).toBe(0.85)
    expect(repeatabilityFactor(meas({ nFrames: 2 }), F05)).toBe(0.85)
    expect(repeatabilityFactor(meas({ nFrames: 3 }), F05)).toBe(1)
    // Two manual placements land at MEDIUM, as in the PLAN §4.3 example: 0.85 × 1 × 0.85 = 0.7225.
    expect(confidenceFor(meas({ method: 'MANUAL_LANDMARKS', nFrames: 2 }), F05)).toEqual({ band: 'MEDIUM', value: 0.72 })
  })

  it('reads the span from the scoring rule when the scale is unbounded', () => {
    const e06 = getMetric('E06')! // scale unbounded, one_sided points 0…8
    expect(scaleSpan(e06, 3)).toBe(8)
    const s04 = getMetric('S04')! // scale 0…null, personal baseline: falls back to the value's size
    expect(scaleSpan(s04, 4)).toBe(4)
    expect(scaleSpan(s04, 0)).toBeNull()
    expect(scaleSpan(F05, 4)).toBe(15)
    expect(scaleSpan(getMetric('F02')!, 120)).toBe(100)
  })
})

describe('self-report is never HIGH', () => {
  it('sits at the MEDIUM floor with perfect factors and drops to LOW with any photo-quality loss', () => {
    const f13 = getMetric('F13')!
    const perfect = meas({ metricId: 'F13', method: 'SELF_GRADE_REFERENCE', uncertainty: null, nFrames: 1 })
    expect(confidenceFor(perfect, f13)).toEqual({ band: 'MEDIUM', value: 0.6 })
    expect(confidenceFor({ ...perfect, qcFactor: 0.9 }, f13)).toEqual({ band: 'LOW', value: 0.54 })
  })

  it('has no repeatability to lose: uncertainty and frame count do not move it', () => {
    const f13 = getMetric('F13')!
    for (const method of SELF_REPORT_METHODS) {
      for (const [uncertainty, nFrames] of [[null, 0], [5, 1], [0, 9]] as const) {
        expect(repeatabilityFactor({ method, uncertainty, nFrames, value: 1 }, f13)).toBe(1)
        expect(confidenceFor(meas({ metricId: 'F13', method, uncertainty, nFrames }), f13)).toEqual({ band: 'MEDIUM', value: 0.6 })
      }
    }
  })

  it('property: no self-report method reaches HIGH for any quality, spread or frame count', () => {
    const r = rng(7)
    for (let i = 0; i < 2000; i++) {
      const methods = [...SELF_REPORT_METHODS]
      const method = methods[Math.floor(r() * methods.length)]!
      const m = meas({
        method,
        qcFactor: r() * 1.2,
        uncertainty: r() < 0.2 ? null : r() * 6,
        nFrames: Math.floor(r() * 8),
      })
      const c = confidenceBreakdown(m, F05)
      expect(c.band).not.toBe('HIGH')
      expect(c.value).toBeLessThanOrEqual(0.79)
    }
  })

  it('applies the cap if a base ever exceeded it', () => {
    // The table cannot produce this today (0.6 base); the breakdown still reports the cap flag honestly.
    const c = confidenceBreakdown(meas({ method: 'SELF_GRADE_REFERENCE' }), F05)
    expect(c.cappedAtMedium).toBe(false)
  })
})

describe('refusal', () => {
  it('any refusal is REFUSED at 0 whatever the factors say', () => {
    const refused = meas({ value: null, qcFactor: 1, refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['level the camera'] } })
    expect(confidenceFor(refused, F05)).toEqual({ band: 'REFUSED', value: 0 })
  })

  it('a missing value is REFUSED even without a stated refusal', () => {
    expect(confidenceFor(meas({ value: null }), F05)).toEqual({ band: 'REFUSED', value: 0 })
  })
})

describe('properties', () => {
  it('the value never rises when photo quality falls or the spread grows', () => {
    const r = rng(11)
    for (let i = 0; i < 1500; i++) {
      const method = METHODS[Math.floor(r() * METHODS.length)]!
      const qc = r()
      const u = r() * 5
      const nFrames = Math.floor(r() * 7)
      const base = confidenceBreakdown(meas({ method, qcFactor: qc, uncertainty: u, nFrames }), F05).value
      const worseQc = confidenceBreakdown(meas({ method, qcFactor: qc * r(), uncertainty: u, nFrames }), F05).value
      const worseSpread = confidenceBreakdown(meas({ method, qcFactor: qc, uncertainty: u + r() * 5, nFrames }), F05).value
      expect(worseQc).toBeLessThanOrEqual(base + 1e-12)
      expect(worseSpread).toBeLessThanOrEqual(base + 1e-12)
      expect(base).toBeGreaterThanOrEqual(0)
      expect(base).toBeLessThanOrEqual(1)
    }
  })
})
