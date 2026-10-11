import { describe, expect, it } from 'vitest'
import { METRICS, getMetric, totalWeight } from '../../src/catalog'
import type { Measurement, MetricScore } from '../../src/domain/types'
import {
  RULESET_VERSION,
  WEIGHTS_VERSION,
  assertScoreInvariant,
  lintTone,
  scoreMetric,
  scoreScan,
} from '../../src/scoring'
import { bandFromPoints } from '../../src/scoring/functions'

let counter = 0
const uuid = () => `id-${++counter}`

const meas = (o: Partial<Measurement> & { metricId: string }): Measurement => ({
  id: `m-${++counter}`,
  scanId: 's1',
  value: 0,
  unit: '',
  uncertainty: 0,
  nFrames: 5,
  method: 'AUTO_FRONTAL_PHOTO',
  qcFactor: 1,
  algoVersion: 'a1',
  ...o,
})
const lines = (s: MetricScore) => s.reason.split('\n')

describe('scoreMetric', () => {
  it('throws on a metric id the catalog does not know', () => {
    expect(() => scoreMetric(meas({ metricId: 'Z99', value: 1 }), { baselines: {} })).toThrow(/Unknown metric id "Z99"/)
  })

  it('returns only the score when no baseline is set', () => {
    const r = scoreMetric(meas({ metricId: 'F05', value: 2, unit: '% of pupil distance' }), { baselines: {}, uuid })
    expect(Object.keys(r)).toEqual(['score'])
  })

  it('uses the injected uuid and stamps the ruleset version, scan and metric', () => {
    const r = scoreMetric(meas({ metricId: 'F05', value: 2, unit: '% of pupil distance' }), { baselines: {}, uuid: () => 'fixed-id' })
    expect(r.score).toMatchObject({ id: 'fixed-id', scanId: 's1', metricId: 'F05', rulesetVersion: RULESET_VERSION })
  })

  it('falls back to a generated id when none is injected', () => {
    const a = scoreMetric(meas({ metricId: 'F05', value: 2 }), { baselines: {} }).score.id
    const b = scoreMetric(meas({ metricId: 'F05', value: 2 }), { baselines: {} }).score.id
    expect(a).toMatch(/[0-9a-f-]{36}/)
    expect(a).not.toBe(b)
  })
})

describe('range rule (F05 symmetry: ideal 0–3 % of pupil distance, tau 2.5)', () => {
  const unit = '% of pupil distance'

  it('scores 100 inside the band', () => {
    const { score } = scoreMetric(meas({ metricId: 'F05', value: 2, unit, uncertainty: 0.3 }), { baselines: {}, uuid })
    expect(score.score).toBe(100)
    expect(score.facts!.gap).toBe(0)
    expect(lines(score)[1]).toContain('Inside the ideal band → score 100.')
    expect(score.facts!.pointsLost).toBe(0)
  })

  it('scores 5.4 → d = 2.4 → 100·exp(−½·0.96²) = 63.07 → truncated 63, with every fact cited', () => {
    const { score } = scoreMetric(meas({ metricId: 'F05', value: 5.4, unit, uncertainty: 0.6 }), { baselines: {}, uuid })
    expect(score.score).toBe(63)
    expect(score.confidence.band).toBe('HIGH')
    expect(score.facts).toEqual({
      value: 5.4,
      unit,
      uncertainty: 0.6,
      idealSummary: getMetric('F05')!.ideal.summary,
      idealLo: 0,
      idealHi: 3,
      gap: 2.4,
      ruleKind: 'range',
      shotLabel: 'frontal neutral',
      sourceIds: ['face:rhodes2006'],
      weight: 5.75,
      evidence: 'MODERATE',
      changeability: 'FIXED',
      pointsLost: 2.1275,
    })
    expect(lines(score)[0]).toMatch(/^FACIAL SYMMETRY · 5\.4% ±0\.6% of pupil distance · HIGH 0\.\d\d \(auto frontal photo, frontal neutral, 5 frames\)$/)
    expect(lines(score)[1]).toContain('2.4% of pupil distance above range → score 63.')
    expect(lines(score)[2]).toBe('FIXED · evidence MODERATE · weight 5.75 → costs 2.2 overall points.')
  })

  it('never rounds up: a raw 38.87 is 38', () => {
    // F02 is the PLAN example: 131° against 105–120° with tau 8 → 38.87.
    const { score } = scoreMetric(
      meas({ metricId: 'F02', value: 131, unit: '°', uncertainty: 3, nFrames: 2, method: 'MANUAL_LANDMARKS', qcFactor: 1 }),
      { baselines: {}, uuid },
    )
    expect(score.score).toBe(38)
    expect(score.confidence).toEqual({ band: 'MEDIUM', value: 0.72 })
    expect(lines(score)[0]).toBe('CERVICOMENTAL ANGLE · 131° ±3° · MEDIUM 0.72 (manual points, left profile / right profile, 2 placements)')
    expect(lines(score)[1]).toMatch(/^Ideal 105–120° \[Ellenbogen & Karlin 1980( – source not verified)?\]\. 11° above range → score 38\.$/)
  })

  it('scores below the band symmetrically', () => {
    const { score } = scoreMetric(meas({ metricId: 'F07', value: 0.55, unit: 'ratio', uncertainty: 0.05 }), { baselines: {}, uuid })
    // F07 ideal 0.9–1.3, tau 0.2: d = 0.35 → exp(−½·1.75²) = exp(−1.53125) = 0.2162 → 21.
    expect(score.score).toBe(21)
    expect(lines(score)[1]).toContain('0.35 ratio below range → score 21.')
  })

  it('says CONVENTION evidence in plain words', () => {
    const { score } = scoreMetric(meas({ metricId: 'F07', value: 1.45, unit: 'ratio' }), { baselines: {}, uuid })
    expect(score.score).toBe(75)
    expect(lines(score)[2]).toContain('evidence CONVENTION (a classical canon or custom, not a measured norm)')
  })

  it('a source that is not verified says so', () => {
    const { score } = scoreMetric(meas({ metricId: 'F05', value: 5.4, unit: '% of pupil distance' }), { baselines: {}, uuid })
    expect(score.reason).toContain('source not verified')
  })
})

describe('one_sided rule', () => {
  it('interpolates a body-fat style table (B02: 17 % → between (15,100) and (18,80) = 86.67 → 86)', () => {
    const { score } = scoreMetric(
      meas({ metricId: 'B02', value: 17, unit: '% body fat', uncertainty: 0.5, nFrames: 3, method: 'TAPE_MEASURE' }),
      { baselines: {}, uuid },
    )
    expect(score.score).toBe(86)
    expect(score.facts).toMatchObject({ idealLo: 10, idealHi: 15, gap: 2, ruleKind: 'one_sided', weight: 7 })
    expect(score.confidence.band).toBe('HIGH')
  })

  it('clamps below and above the table', () => {
    expect(scoreMetric(meas({ metricId: 'B02', value: 3, unit: '% body fat', method: 'TAPE_MEASURE', nFrames: 3 }), { baselines: {} }).score.score).toBe(20)
    expect(scoreMetric(meas({ metricId: 'B02', value: 50, unit: '% body fat', method: 'TAPE_MEASURE', nFrames: 3 }), { baselines: {} }).score.score).toBe(0)
  })

  it('reads an open band from a table that starts at 100 (F13: grade ≤ 1 is the ideal)', () => {
    const { score } = scoreMetric(meas({ metricId: 'F13', value: 2.5, unit: 'grade' }), { baselines: {}, uuid })
    // between (2, 90) and (3, 70) → 80.
    expect(score.score).toBe(80)
    expect(score.facts).toMatchObject({ idealLo: null, idealHi: 1, gap: 1.5 })
    expect(lines(score)[1]).toContain('Ideal at most 1 grade')
  })

  it('every one_sided and range metric is 100 on its own plateau', () => {
    for (const m of METRICS) {
      const rule = m.scoring
      let value: number | null = null
      if (rule.kind === 'range') value = (rule.lo + rule.hi) / 2
      if (rule.kind === 'one_sided') {
        const band = bandFromPoints(rule.points)
        value = band.lo !== null && band.hi !== null ? (band.lo + band.hi) / 2 : (band.lo ?? band.hi)
      }
      if (value === null || m.weight === 0) continue
      const { score } = scoreMetric(meas({ metricId: m.id, value, unit: m.scale.unit, method: m.methods[0]! }), { baselines: {} })
      expect(score.score, m.id).toBe(100)
    }
  })
})

describe('personal_baseline rule (F01: no norm anchor)', () => {
  const f01 = (value: number, o: Partial<Measurement> = {}) => meas({ metricId: 'F01', value, unit: 'index', uncertainty: 2, ...o })

  it('the first scan sets the baseline and is NOT scored', () => {
    const r = scoreMetric(f01(52), { baselines: {}, uuid })
    expect(r.score.score).toBeNull()
    expect(r.score.facts).toBeNull()
    expect(r.baselineToStore).toEqual({ metricId: 'F01', value: 52 })
    expect(r.score.confidence.band).toBe('HIGH')
    expect(lines(r.score)[1]).toContain('BASELINE SET · NOT SCORED.')
    expect(lines(r.score)[1]).toContain('personal baseline: 52 index')
    expect(lines(r.score)[2]).toContain('not counted in the overall until it is scored')
  })

  it('later scans score against the stored baseline, and store nothing', () => {
    const same = scoreMetric(f01(52), { baselines: { F01: 52 }, uuid })
    expect(same.score.score).toBe(100)
    expect(same.baselineToStore).toBeUndefined()
    // Scale 0–100 → tau 15. 15 above the baseline: exp(−½) = 60.65 → 60. Either direction (target_range).
    expect(scoreMetric(f01(67), { baselines: { F01: 52 } }).score.score).toBe(60)
    // A leaner face is never penalised (no B02 target, no gaunt-face source).
    expect(scoreMetric(f01(37), { baselines: { F01: 52 } }).score.score).toBe(100)
    expect(scoreMetric(f01(0), { baselines: { F01: 52 } }).score.score).toBe(100)
    // 30 away: exp(−2) = 13.53 → 13.
    expect(scoreMetric(f01(82), { baselines: { F01: 52 } }).score.score).toBe(13)
  })

  it('cites the baseline, the change and the lack of a norm in the reason', () => {
    const { score } = scoreMetric(f01(67), { baselines: { F01: 52 }, uuid })
    expect(score.facts).toMatchObject({ idealLo: null, idealHi: 52, gap: 15, ruleKind: 'personal_baseline', pointsLost: 3.2 })
    expect(lines(score)[1]).toContain('Reference: your own baseline 52 index')
    expect(lines(score)[1]).toContain('no population norm exists for this index')
    expect(lines(score)[1]).toContain('15 index worse than baseline → score 60.')
  })

  it('does not store a LOW-confidence value as the baseline', () => {
    const low = f01(52, { qcFactor: 0.5 }) // 1.0 × 0.5 × (1 − 1.5·0.02) = 0.485
    const r = scoreMetric(low, { baselines: {}, uuid })
    expect(r.score.confidence.band).toBe('LOW')
    expect(r.score.score).toBeNull()
    expect(r.baselineToStore).toBeUndefined()
    expect(lines(r.score)[1]).toContain('too weak to set a personal baseline')
  })

  it('stores a MEDIUM-confidence baseline', () => {
    const r = scoreMetric(f01(52, { qcFactor: 0.7 }), { baselines: {}, uuid })
    expect(r.score.confidence.band).toBe('MEDIUM')
    expect(r.baselineToStore).toEqual({ metricId: 'F01', value: 52 })
  })

  it('a refused first measurement stores nothing', () => {
    const r = scoreMetric(
      meas({ metricId: 'F01', value: null, unit: 'index', refusal: { reasons: ['Jaw edge hidden by beard'], recapture: ['shave or tie hair back'] } }),
      { baselines: {} },
    )
    expect(r.baselineToStore).toBeUndefined()
    expect(r.score.score).toBeNull()
  })

  it('a LOW-confidence later scan is scored with a warning and flagged as left out', () => {
    const { score } = scoreMetric(f01(67, { qcFactor: 0.5 }), { baselines: { F01: 52 }, uuid })
    expect(score.confidence.band).toBe('LOW')
    expect(score.score).toBe(60)
    expect(lines(score)[2]).toContain('WARNING · LOW confidence')
    expect(lines(score)[2]).toContain('left out of the overall score')
  })
})

describe('checklist rule (V06)', () => {
  const items = { distance: 1, sharp: 1, light: 1, height: 1, pose: 1, expression: 1 }
  const v06 = (inputs: Record<string, number> | undefined, value: number) =>
    meas({ metricId: 'V06', value, unit: '% of checks passed', uncertainty: 0, ...(inputs ? { inputs } : {}) })

  it('all items passed is 100', () => {
    const { score } = scoreMetric(v06(items, 100), { baselines: {}, uuid })
    expect(score.score).toBe(100)
    expect(lines(score)[1]).toContain('6 of 6 checks passed')
  })

  it('a failed non-critical item costs its share: 5 of 6 = 83.33 → 83', () => {
    const { score } = scoreMetric(v06({ ...items, light: 0 }, 83.3), { baselines: {}, uuid })
    expect(score.score).toBe(83)
    expect(lines(score)[1]).toContain('5 of 6 checks passed; failed: Even light with no hard shadow across the face')
    expect(lines(score)[1]).not.toContain('capped')
  })

  it('a failed critical item caps the score at 60, and the reason says which', () => {
    const { score } = scoreMetric(v06({ ...items, distance: 0 }, 83.3), { baselines: {}, uuid })
    expect(score.score).toBe(60)
    expect(lines(score)[1]).toContain('Camera at least 1.5 m from the face (critical)')
    expect(lines(score)[1]).toContain('capped at 60 → score 60.')
    expect(score.facts!.pointsLost).toBe(1.2)
  })

  it('below the cap the lower share wins: 3 of 6 with a critical failure is 50', () => {
    const { score } = scoreMetric(v06({ ...items, distance: 0, light: 0, pose: 0 }, 50), { baselines: {} })
    expect(score.score).toBe(50)
  })

  it('without item results, the share is used and any shortfall is capped', () => {
    expect(scoreMetric(v06(undefined, 100), { baselines: {} }).score.score).toBe(100)
    const capped = scoreMetric(v06(undefined, 90), { baselines: {} }).score
    expect(capped.score).toBe(60)
    expect(capped.reason).toContain('Per-item results were not supplied')
    expect(scoreMetric(v06(undefined, 40), { baselines: {} }).score.score).toBe(40)
  })

  it('an item with no result counts as failed', () => {
    const { score } = scoreMetric(v06({ distance: 1, sharp: 1, light: 1, height: 1, pose: 1 }, 100), { baselines: {} })
    expect(score.score).toBe(83)
  })
})

describe('percentile rule (B01 height)', () => {
  const b01 = (o: Partial<Measurement>) => meas({ metricId: 'B01', value: 180, unit: 'cm', uncertainty: 0.5, method: 'MANUAL_INPUT', nFrames: 1, ...o })

  it('scores the supplied percentile: higher is better', () => {
    const { score } = scoreMetric(b01({ inputs: { percentile: 82.4 } }), { baselines: {}, uuid })
    expect(score.score).toBe(82)
    expect(score.confidence.band).toBe('MEDIUM')
    expect(score.facts).toMatchObject({ value: 180, unit: 'cm', ruleKind: 'percentile', idealLo: null, idealHi: null, gap: null })
    expect(lines(score)[1]).toContain('Rank: percentile 82.4 among Adult men of the population the user selects at setup')
  })

  it('reads the value as the percentile when the unit says so', () => {
    expect(scoreMetric(b01({ value: 40, unit: 'percentile' }), { baselines: {} }).score.score).toBe(40)
  })

  it('refuses when no percentile is available: a raw height cannot be scored without a reference population', () => {
    const { score } = scoreMetric(b01({}), { baselines: {}, uuid })
    expect(score.score).toBeNull()
    expect(score.confidence).toEqual({ band: 'REFUSED', value: 0 })
    expect(score.reason).toContain('needs your percentile in the reference population')
    expect(score.reason).toContain('Re-capture self-report: choose the reference population in setup')
  })
})

describe('unscored by design', () => {
  it('rule kind none (FWHR, pseudoscience): measured, shown, never scored', () => {
    const { score, baselineToStore } = scoreMetric(meas({ metricId: 'F10', value: 1.92, unit: 'ratio', uncertainty: 0.04 }), { baselines: {}, uuid })
    expect(score.score).toBeNull()
    expect(score.facts).toBeNull()
    expect(score.confidence.band).toBe('HIGH')
    expect(baselineToStore).toBeUndefined()
    expect(lines(score)[0]).toMatch(/^FWHR · 1\.92 ±0\.04 ratio · HIGH/)
    expect(lines(score)[1]).toContain('NOT SCORED · no evidence-based ideal exists, so it is shown for context only.')
    expect(lines(score)[2]).toContain('evidence PSEUDOSCIENCE (a community claim without research support)')
    expect(lines(score)[2]).toContain('weight 0 → costs no overall points.')
  })

  it('MYTH is never scored', () => {
    const { score } = scoreMetric(meas({ metricId: 'F21', value: 0.97, unit: 'n/a' }), { baselines: {} })
    expect(score.score).toBeNull()
    expect(lines(score)[1]).toContain('the claim is a myth and is never scored')
  })

  it('no metric with evidence MYTH, rule none or weight 0 ever gets a score, whatever the value', () => {
    for (const m of METRICS) {
      if (m.evidence !== 'MYTH' && m.scoring.kind !== 'none' && m.weight !== 0) continue
      for (const value of [-100, 0, 0.5, 1, 1.5, 50, 100, 1e6]) {
        const { score, baselineToStore } = scoreMetric(meas({ metricId: m.id, value, unit: m.scale.unit, method: m.methods[0]! }), { baselines: { [m.id]: 1 } })
        expect(score.score, `${m.id} @ ${value}`).toBeNull()
        expect(baselineToStore).toBeUndefined()
        expect(score.reason.length).toBeGreaterThan(0)
      }
    }
  })

  it('the unscored-by-design count matches the catalog (every metric is scoreable or says why not)', () => {
    const none = METRICS.filter((m) => m.scoring.kind === 'none')
    expect(none.length).toBeGreaterThan(40)
    for (const m of none) expect(m.weight).toBe(0)
  })
})

describe('refusals pass straight through', () => {
  const refusal = {
    reasons: ['Head pitch +6.1° (limit ±4°)', 'Pitch error exceeds any real change in this metric.'],
    recapture: ['ear canal level with lower eyelid', 'use the on-screen level line'],
  }

  it('a measurement refusal becomes a REFUSED score with no number and the stated reasons', () => {
    const { score, baselineToStore } = scoreMetric(meas({ metricId: 'F14', value: null, refusal }), { baselines: {}, uuid })
    expect(score.score).toBeNull()
    expect(score.facts).toBeNull()
    expect(score.confidence).toEqual({ band: 'REFUSED', value: 0 })
    expect(baselineToStore).toBeUndefined()
    expect(score.reason).toBe(
      [
        'NOSE WIDTH VS EYE SPACING · NOT SCORED',
        'Head pitch +6.1° (limit ±4°).',
        'Pitch error exceeds any real change in this metric.',
        'Re-capture frontal neutral: ear canal level with lower eyelid; use the on-screen level line.',
      ].join('\n'),
    )
  })

  it('a refusal beats the unscored-by-design message (the user still needs to know what to re-capture)', () => {
    const { score } = scoreMetric(meas({ metricId: 'F10', value: null, refusal }), { baselines: {} })
    expect(lines(score)[0]).toBe('FWHR · NOT SCORED')
    expect(score.reason).not.toContain('context only')
  })

  it('a measurement with no value and no refusal is refused with a generic reason', () => {
    const { score } = scoreMetric(meas({ metricId: 'F05', value: null }), { baselines: {} })
    expect(score.score).toBeNull()
    expect(score.confidence.band).toBe('REFUSED')
    expect(score.reason).toContain('No value was measured for this metric.')
  })

  it('a non-finite value is refused', () => {
    const { score } = scoreMetric(meas({ metricId: 'F05', value: Number.POSITIVE_INFINITY }), { baselines: {} })
    expect(score.score).toBeNull()
    expect(score.reason).toContain('not a finite number')
  })

  it('an empty refusal still yields a non-empty, actionable reason', () => {
    const { score } = scoreMetric(meas({ metricId: 'F05', value: null, refusal: { reasons: [], recapture: [] } }), { baselines: {} })
    expect(score.reason).toContain('NOT SCORED')
    expect(score.reason).toContain('Re-capture frontal neutral: repeat the frontal neutral capture')
  })

  it('confidence under 0.40 refuses without a stated refusal and reports the confidence it computed', () => {
    const { score } = scoreMetric(meas({ metricId: 'F05', value: 4, unit: '% of pupil distance', qcFactor: 0.35 }), { baselines: {}, uuid })
    expect(score.score).toBeNull()
    expect(score.confidence).toEqual({ band: 'REFUSED', value: 0.35 })
    expect(score.reason).toContain('Confidence 0.35 is under the 0.40 floor')
    expect(score.reason).toContain('Re-capture frontal neutral')
  })
})

describe('confidence bands through the engine', () => {
  const f05 = (qcFactor: number) => scoreMetric(meas({ metricId: 'F05', value: 5.4, unit: '% of pupil distance', qcFactor }), { baselines: {} }).score

  it('HIGH and MEDIUM score normally; LOW scores with a warning; REFUSED does not score', () => {
    expect(f05(0.95).confidence.band).toBe('HIGH')
    expect(f05(0.7).confidence.band).toBe('MEDIUM')
    const low = f05(0.5)
    expect(low.confidence.band).toBe('LOW')
    expect(low.score).toBe(63)
    expect(lines(low)).toHaveLength(4)
    expect(f05(0.3).score).toBeNull()
    expect(f05(0.3).confidence.band).toBe('REFUSED')
  })
})

describe('the honesty invariant', () => {
  it('assertScoreInvariant rejects a number with no facts, an empty reason, and a refused number', () => {
    const ok: MetricScore = {
      id: 'x', scanId: 's', metricId: 'F05', score: 63, confidence: { band: 'HIGH', value: 0.9 }, rulesetVersion: RULESET_VERSION, reason: 'because',
      facts: { value: 1, unit: 'u', uncertainty: null, idealSummary: 's', idealLo: null, idealHi: null, gap: null, ruleKind: 'range', shotLabel: 'l', sourceIds: [], weight: 1, evidence: 'MODERATE', changeability: 'FIXED', pointsLost: 0 },
    }
    expect(() => assertScoreInvariant(ok)).not.toThrow()
    expect(() => assertScoreInvariant({ ...ok, facts: null })).toThrow(/no facts/)
    expect(() => assertScoreInvariant({ ...ok, reason: '  ' })).toThrow(/empty reason/)
    expect(() => assertScoreInvariant({ ...ok, score: null, reason: '' })).toThrow(/empty reason/)
    expect(() => assertScoreInvariant({ ...ok, score: 63.5 })).toThrow(/integer/)
    expect(() => assertScoreInvariant({ ...ok, confidence: { band: 'REFUSED', value: 0 } })).toThrow(/refused/)
    expect(() => assertScoreInvariant({ ...ok, score: null })).not.toThrow()
  })

  it('across every catalog metric × value × quality × baseline: no score without facts and a reason; integers 0–100; tone clean', () => {
    let scored = 0
    let unscored = 0
    for (const m of METRICS) {
      const rule = m.scoring
      const values = [-5, 0, 0.3, 1, 2.5, 7, 40, 100]
      for (const value of values)
        for (const qcFactor of [1, 0.65, 0.5, 0.2])
          for (const baselines of [{}, { [m.id]: 3 }]) {
            const inputs: Record<string, number> | undefined =
              rule.kind === 'checklist' ? Object.fromEntries(rule.items.map((it, i) => [it.id, (i + value) % 2 === 0 ? 1 : 0])) : rule.kind === 'percentile' ? { percentile: 55 } : undefined
            const { score } = scoreMetric(
              meas({ metricId: m.id, value, unit: m.scale.unit, uncertainty: 0.2, qcFactor, method: m.methods[0]!, ...(inputs ? { inputs } : {}) }),
              { baselines, uuid },
            )
            expect(score.reason.trim().length, m.id).toBeGreaterThan(0)
            expect(lintTone(score.reason), `${m.id}\n${score.reason}`).toEqual([])
            if (score.score !== null) {
              scored++
              expect(score.facts, m.id).not.toBeNull()
              expect(Number.isInteger(score.score)).toBe(true)
              expect(score.score).toBeGreaterThanOrEqual(0)
              expect(score.score).toBeLessThanOrEqual(100)
              expect(score.confidence.band).not.toBe('REFUSED')
            } else {
              unscored++
            }
          }
    }
    expect(scored).toBeGreaterThan(1000)
    expect(unscored).toBeGreaterThan(1000)
  })
})

describe('scoreScan', () => {
  /** What an M1 frontal scan produces: the measurable metrics, with plausible values. */
  const m1Scan = (o: { f01?: number } = {}): Measurement[] => [
    meas({ metricId: 'F01', value: o.f01 ?? 52, unit: 'index', uncertainty: 2.1 }),
    meas({ metricId: 'F05', value: 5.4, unit: '% of pupil distance', uncertainty: 0.6 }),
    meas({ metricId: 'F07', value: 1.45, unit: 'ratio', uncertainty: 0.05 }),
    meas({ metricId: 'F08', value: 46.1, unit: '% of face width', uncertainty: 0.8 }),
    meas({ metricId: 'F10', value: 1.92, unit: 'ratio', uncertainty: 0.04 }),
    meas({ metricId: 'F11', value: 1.01, unit: 'ratio', uncertainty: 0.03 }),
    meas({ metricId: 'F12', value: 4.2, unit: '°', uncertainty: 0.8 }),
    meas({ metricId: 'F14', value: 1.1, unit: 'ratio', uncertainty: 0.05 }),
    meas({ metricId: 'F15', value: 1.9, unit: 'ratio', uncertainty: 0.1 }),
    meas({ metricId: 'F16', value: 2.9, unit: 'ratio', uncertainty: 0.1 }),
    meas({ metricId: 'F17', value: 1.3, unit: 'ratio', uncertainty: 0.05 }),
    meas({ metricId: 'F21', value: 0.5, unit: 'n/a' }),
    meas({ metricId: 'F22', value: 22, unit: '% of pupil distance', uncertainty: 1 }),
    meas({ metricId: 'F23', value: 63, unit: 'mm', uncertainty: 4 }),
    meas({ metricId: 'V06', value: 83.3, unit: '% of checks passed', uncertainty: 0, inputs: { distance: 1, sharp: 1, light: 0, height: 1, pose: 1, expression: 1 } }),
  ]

  it('M1 covers about 18 % of the weight, so there is NO overall score and the report says so', () => {
    const first = scoreScan({ scanId: 's1', measurements: m1Scan(), baselines: {}, uuid })
    // First scan: F01 sets the baseline and is unscored. Scored weight: F05 5.75 + F07 .25 + F08 .25 + F14 .25 + F15 .25 + F16 .5 + V06 3 = 10.25.
    expect(first.overall.coverage).toBe(0.1025)
    expect(first.overall.status).toBe('NOT_AVAILABLE')
    expect(first.overall.appearance).toBeNull()
    expect(first.overall.band).toBeNull()
    expect(first.overall.cai).toBeNull()
    expect(first.baselinesToStore).toEqual([{ metricId: 'F01', value: 52 }])

    const second = scoreScan({ scanId: 's2', measurements: m1Scan({ f01: 60 }).map((m) => ({ ...m, scanId: 's2' })), baselines: { F01: 52 }, uuid })
    // F01 (8) is now scored too: 18.25.
    expect(second.overall.coverage).toBe(0.1825)
    expect(second.overall.status).toBe('NOT_AVAILABLE')
    expect(second.overall.appearance).toBeNull()
    expect(second.baselinesToStore).toEqual([])
  })

  it('returns one score per measurement, in order, all stamped with the ruleset and weights versions', () => {
    const ms = m1Scan()
    const r = scoreScan({ scanId: 's1', measurements: ms, baselines: {}, uuid })
    expect(r.scores.map((s) => s.metricId)).toEqual(ms.map((m) => m.metricId))
    for (const s of r.scores) expect(s.rulesetVersion).toBe(RULESET_VERSION)
    expect(r.overall.weightsVersion).toBe(WEIGHTS_VERSION)
    expect(r.overall.rulesetVersion).toBe(RULESET_VERSION)
  })

  it('lists the drag by points lost with F05 first', () => {
    const r = scoreScan({ scanId: 's1', measurements: m1Scan(), baselines: {}, uuid })
    expect(r.overall.drag[0]).toMatchObject({ metricId: 'F05', group: 'FIXED' })
    expect(r.overall.pointsLost.CHANGEABLE).toBeCloseTo(0.51, 6) // V06: 5 of 6 passed, no critical failure → 83: 3 × 17 ÷ 100
  })

  it('leaves a LOW-confidence metric out of the overall while still reporting its score', () => {
    const ms = [
      meas({ metricId: 'F05', value: 5.4, unit: '% of pupil distance', qcFactor: 0.5 }),
      meas({ metricId: 'F16', value: 2.9, unit: 'ratio' }),
    ]
    const r = scoreScan({ scanId: 's1', measurements: ms, baselines: {}, uuid })
    expect(r.scores[0]!.score).toBe(63)
    expect(r.scores[0]!.confidence.band).toBe('LOW')
    expect(r.overall.coverage).toBe(0.005)
    expect(r.overall.drag.map((d) => d.metricId)).toEqual(['F16'])
  })

  it('FINAL on the real catalog: every scoreable metric on its plateau gives 100, full coverage, nothing lost', () => {
    const measurements: Measurement[] = []
    const baselines: Record<string, number> = {}
    for (const m of METRICS) {
      const rule = m.scoring
      if (rule.kind === 'none' || m.weight === 0) continue
      let value = 10
      let inputs: Record<string, number> | undefined
      if (rule.kind === 'range') value = (rule.lo + rule.hi) / 2
      if (rule.kind === 'one_sided') {
        const band = bandFromPoints(rule.points)
        value = band.lo !== null && band.hi !== null ? (band.lo + band.hi) / 2 : (band.lo ?? band.hi ?? 0)
      }
      if (rule.kind === 'personal_baseline') baselines[m.id] = value
      if (rule.kind === 'checklist') inputs = Object.fromEntries(rule.items.map((it) => [it.id, 1]))
      if (rule.kind === 'percentile') inputs = { percentile: 100 }
      measurements.push(meas({ metricId: m.id, value, unit: m.scale.unit, method: m.methods[0]!, uncertainty: 0, ...(inputs ? { inputs } : {}) }))
    }
    const r = scoreScan({ scanId: 's1', measurements, baselines, uuid })
    expect(r.overall.coverage).toBe(1)
    expect(r.overall.status).toBe('FINAL')
    expect(r.overall.appearance).toBe(100)
    expect(r.overall.band).toBe(0)
    expect(r.overall.cai).toBe(100)
    expect(r.overall.drag).toEqual([])
    expect(r.scores.every((s) => s.score === 100)).toBe(true)
    expect(totalWeight()).toBe(100)
  })

  it('PROVISIONAL on the real catalog, with a hand-computed truncated appearance', () => {
    // Scored: F01 (8, baseline 52, value 67 → 60), F05 (5.75, 63), B02 (7, tape, 17 % → 86), S01..: keep to what is hand-checkable.
    const ms = [
      meas({ metricId: 'F01', value: 67, unit: 'index', uncertainty: 2 }),
      meas({ metricId: 'F05', value: 5.4, unit: '% of pupil distance', uncertainty: 0.6 }),
      meas({ metricId: 'B02', value: 17, unit: '% body fat', uncertainty: 0.5, nFrames: 3, method: 'TAPE_MEASURE' }),
    ]
    const r = scoreScan({ scanId: 's1', measurements: ms, baselines: { F01: 52 }, uuid })
    expect(r.scores.map((s) => s.score)).toEqual([60, 63, 86])
    // (8·60 + 5.75·63 + 7·86) ÷ 20.75 = (480 + 362.25 + 602) ÷ 20.75 = 69.6 → but coverage is only 20.75 %.
    expect(r.overall.coverage).toBe(0.2075)
    expect(r.overall.appearance).toBeNull()
  })

  it('rejects two measurements for one metric and a measurement from another scan', () => {
    expect(() =>
      scoreScan({ scanId: 's1', measurements: [meas({ metricId: 'F05', value: 2 }), meas({ metricId: 'F05', value: 3 })], baselines: {} }),
    ).toThrow(/Two measurements for F05/)
    expect(() => scoreScan({ scanId: 's1', measurements: [meas({ metricId: 'F05', value: 2, scanId: 'other' })], baselines: {} })).toThrow(/belongs to scan "other"/)
  })

  it('throws on an unknown metric id rather than skipping it', () => {
    expect(() => scoreScan({ scanId: 's1', measurements: [meas({ metricId: 'Q01', value: 2 })], baselines: {} })).toThrow(/Unknown metric id/)
  })

  it('an empty scan yields an empty, unavailable overall', () => {
    const r = scoreScan({ scanId: 's1', measurements: [], baselines: {} })
    expect(r.scores).toEqual([])
    expect(r.baselinesToStore).toEqual([])
    expect(r.overall).toMatchObject({ status: 'NOT_AVAILABLE', coverage: 0, appearance: null })
  })
})

describe('weights fingerprint', () => {
  it('fails when a catalog weight changes without a WEIGHTS_VERSION bump', () => {
    // If this fails: the weights changed. Bump WEIGHTS_VERSION in src/scoring/overall.ts, then update this value.
    const fingerprint = METRICS.map((m) => `${m.id}:${m.weight}`).join('|')
    let h = 5381
    for (let i = 0; i < fingerprint.length; i++) h = ((h * 33) ^ fingerprint.charCodeAt(i)) >>> 0
    expect({ version: WEIGHTS_VERSION, hash: h.toString(16) }).toEqual({ version: 'weights-1.0.0', hash: '9195c970' })
  })
})
