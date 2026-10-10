/**
 * Engine paths no real catalog metric exercises yet: a personal_baseline metric WITH a norm anchor, and a
 * scored-looking metric whose weight is 0. The catalog is replaced for two invented ids; everything else is real.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Metric } from '../../src/catalog/schema'
import type { Measurement } from '../../src/domain/types'

vi.mock('../../src/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/catalog')>()
  const proto = actual.getMetric('S04')!
  const anchored: Metric = {
    ...proto,
    id: 'S99',
    weight: 2,
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      normAnchor: [
        { x: 0, y: 100 },
        { x: 10, y: 0 },
      ],
      note: 'invented anchor for the engine test',
    },
  }
  const zero: Metric = {
    ...actual.getMetric('F05')!,
    id: 'F98',
    weight: 0,
    scoring: { kind: 'range', lo: 0, hi: 3, tau: 2.5, tauRationale: 'invented for the engine test' },
  }
  return { ...actual, getMetric: (id: string) => (id === 'S99' ? anchored : id === 'F98' ? zero : actual.getMetric(id)) }
})

const { scoreMetric } = await import('../../src/scoring')

const meas = (o: Partial<Measurement> & { metricId: string }): Measurement => ({
  id: 'm',
  scanId: 's1',
  value: 0,
  unit: 'ΔE spread (CIELAB)',
  uncertainty: 0,
  nFrames: 5,
  method: 'COLOR_CALIBRATED_PHOTO',
  qcFactor: 1,
  algoVersion: 'a1',
  ...o,
})

describe('personal_baseline with a norm anchor', () => {
  it('an anchor alone scores without a baseline and stores none: value 4 → 100 − 40 = 60', () => {
    const r = scoreMetric(meas({ metricId: 'S99', value: 4 }), { baselines: {}, uuid: () => 'id' })
    expect(r.score.score).toBe(60)
    expect(r.baselineToStore).toBeUndefined()
    expect(r.score.facts).toMatchObject({ idealLo: null, idealHi: 0, gap: 4, ruleKind: 'personal_baseline' })
    expect(r.score.reason).toContain('Ideal at most 0 ΔE spread (CIELAB)')
  })

  it('with a baseline too, the LOWER of the baseline score and the anchor score applies', () => {
    // Baseline 5 (lower is better), tau = 15 % of |5| = 0.75. Value 4 is better than the baseline: relative 100; anchor 60 → 60.
    const better = scoreMetric(meas({ metricId: 'S99', value: 4 }), { baselines: { S99: 5 }, uuid: () => 'id' })
    expect(better.score.score).toBe(60)
    expect(better.score.reason).toContain('Your own baseline is 5 ΔE spread (CIELAB) (lower is better); the lower of the two scores applies.')
    // Value 5.75 is 0.75 (one tau) worse than the baseline: relative 60.65; anchor 42.5 → 42.
    expect(scoreMetric(meas({ metricId: 'S99', value: 5.75 }), { baselines: { S99: 5 } }).score.score).toBe(42)
    // Value 8 is 3 worse (four tau): relative 0.03; anchor 20 → 0.
    expect(scoreMetric(meas({ metricId: 'S99', value: 8 }), { baselines: { S99: 5 } }).score.score).toBe(0)
    // A bad anchor score cannot be rescued by a flattering baseline: baseline 9, value 9 → relative 100, anchor 10 → 10.
    expect(scoreMetric(meas({ metricId: 'S99', value: 9 }), { baselines: { S99: 9 } }).score.score).toBe(10)
  })

  it('a first scan with an anchor is scored, not "baseline set"', () => {
    const { score } = scoreMetric(meas({ metricId: 'S99', value: 2 }), { baselines: {} })
    expect(score.score).toBe(80)
    expect(score.reason).not.toContain('BASELINE SET')
  })
})

describe('a metric whose weight is 0 is never scored', () => {
  it('even with a valid range rule and a value on the plateau', () => {
    const { score } = scoreMetric(meas({ metricId: 'F98', value: 1, unit: '% of pupil distance' }), { baselines: {}, uuid: () => 'id' })
    expect(score.score).toBeNull()
    expect(score.facts).toBeNull()
    expect(score.reason).toContain('NOT SCORED · its weight is 0, so it cannot change the overall score.')
  })
})
