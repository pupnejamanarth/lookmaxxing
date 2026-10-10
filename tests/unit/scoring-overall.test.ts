import { describe, expect, it } from 'vitest'
import { getMetric } from '../../src/catalog'
import type { Metric } from '../../src/catalog/schema'
import type { ConfidenceBand, MetricScore } from '../../src/domain/types'
import { RULESET_VERSION } from '../../src/scoring/functions'
import {
  CAI_MIN_CHANGEABLE_COVERAGE,
  COVERAGE_FINAL,
  COVERAGE_PROVISIONAL,
  WEIGHTS_VERSION,
  computeOverall,
  dragGroup,
  statusForCoverage,
  type OverallItem,
} from '../../src/scoring/overall'

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

/** A small invented catalog whose weights sum to 100, so every expectation below is a hand sum. */
const proto = getMetric('F05')!
const fake = (id: string, weight: number, changeability: Metric['changeability']): Metric => ({ ...proto, id, name: `Metric ${id}`, weight, changeability })
const T1 = fake('T01', 40, 'FIXED')
const T2 = fake('T02', 20, 'CHANGEABLE')
const T3 = fake('T03', 15, 'SURGICAL_ONLY')
const T4 = fake('T04', 15, 'FIXED_BUT_VISIBILITY_CHANGEABLE')
const T5 = fake('T05', 10, 'PROFESSIONAL_ONLY')
const CATALOG = [T1, T2, T3, T4, T5]

function item(metric: Metric, score: number | null, spread: number | null = 0, band: ConfidenceBand = 'HIGH'): OverallItem {
  const s: MetricScore = {
    id: `id-${metric.id}`,
    scanId: 's1',
    metricId: metric.id,
    score,
    confidence: { band, value: band === 'HIGH' ? 0.9 : band === 'MEDIUM' ? 0.7 : band === 'LOW' ? 0.5 : 0 },
    facts: null,
    reason: 'x',
    rulesetVersion: RULESET_VERSION,
  }
  return { metric, score: s, spread }
}
const overall = (items: OverallItem[], ceilings?: Record<string, number>) => computeOverall({ scanId: 's1', items, catalog: CATALOG, ceilings })

describe('groups', () => {
  it('maps changeability to the three drag groups', () => {
    expect(dragGroup('FIXED')).toBe('FIXED')
    expect(dragGroup('CHANGEABLE')).toBe('CHANGEABLE')
    expect(dragGroup('SURGICAL_ONLY')).toBe('SURGICAL_OR_PROFESSIONAL')
    expect(dragGroup('PROFESSIONAL_ONLY')).toBe('SURGICAL_OR_PROFESSIONAL')
  })

  it('counts FIXED_BUT_VISIBILITY_CHANGEABLE as CHANGEABLE because the catalog plans around it', () => {
    expect(dragGroup('FIXED_BUT_VISIBILITY_CHANGEABLE')).toBe('CHANGEABLE')
  })
})

describe('coverage and status thresholds', () => {
  it('FINAL ≥ 75%, PROVISIONAL 50–75%, NOT_AVAILABLE below 50%', () => {
    expect(COVERAGE_FINAL).toBe(0.75)
    expect(COVERAGE_PROVISIONAL).toBe(0.5)
    expect(statusForCoverage(0)).toBe('NOT_AVAILABLE')
    expect(statusForCoverage(0.4999)).toBe('NOT_AVAILABLE')
    expect(statusForCoverage(0.5)).toBe('PROVISIONAL')
    expect(statusForCoverage(0.7499)).toBe('PROVISIONAL')
    expect(statusForCoverage(0.75)).toBe('FINAL')
    expect(statusForCoverage(1)).toBe('FINAL')
  })

  it('40 of 100 weight scored: coverage 0.4, no overall number at all', () => {
    const o = overall([item(T1, 80)])
    expect(o.coverage).toBe(0.4)
    expect(o.status).toBe('NOT_AVAILABLE')
    expect(o.appearance).toBeNull()
    expect(o.band).toBeNull()
  })

  it('exactly 50 is PROVISIONAL and exactly 75 is FINAL', () => {
    const half = overall([item(T1, 80), item(T5, 80)])
    expect(half.coverage).toBe(0.5)
    expect(half.status).toBe('PROVISIONAL')
    expect(half.appearance).toBe(80)
    const threeQuarters = overall([item(T1, 80), item(T2, 80), item(T3, 80)])
    expect(threeQuarters.coverage).toBe(0.75)
    expect(threeQuarters.status).toBe('FINAL')
  })

  it('60 of 100 is PROVISIONAL', () => {
    expect(overall([item(T1, 80), item(T2, 80)]).status).toBe('PROVISIONAL')
  })

  it('nothing scored is NOT_AVAILABLE with an empty drag list', () => {
    const o = overall([])
    expect(o).toMatchObject({ coverage: 0, status: 'NOT_AVAILABLE', appearance: null, band: null, cai: null, drag: [] })
    expect(o.pointsLost).toEqual({ FIXED: 0, SURGICAL_OR_PROFESSIONAL: 0, CHANGEABLE: 0 })
  })

  it('records the weights and ruleset versions', () => {
    const o = overall([item(T1, 80)])
    expect(o.weightsVersion).toBe(WEIGHTS_VERSION)
    expect(o.rulesetVersion).toBe(RULESET_VERSION)
    expect(o.scanId).toBe('s1')
  })
})

describe('appearance', () => {
  it('is Σwᵢsᵢ ÷ Σwᵢ truncated: (40·80 + 20·55 + 15·91) ÷ 75 = 75.53 → 75, not 76', () => {
    const o = overall([item(T1, 80), item(T2, 55), item(T3, 91)])
    expect(o.coverage).toBe(0.75)
    expect(o.appearance).toBe(75)
  })

  it('counts HIGH and MEDIUM only; LOW, REFUSED and unscored metrics are left out of score and coverage', () => {
    const base = [item(T1, 80), item(T2, 55), item(T3, 91, 0, 'MEDIUM')]
    const withExtras = [...base, item(T4, 0, 0, 'LOW'), item(T5, null, null, 'REFUSED')]
    const a = overall(base)
    const b = overall(withExtras)
    expect(b.appearance).toBe(a.appearance)
    expect(b.coverage).toBe(a.coverage)
    expect(b.pointsLost).toEqual(a.pointsLost)
    expect(b.drag).toEqual(a.drag)
  })

  it('an unscored metric (score null) never counts even at HIGH confidence', () => {
    const o = overall([item(T1, 80), item(T2, null)])
    expect(o.coverage).toBe(0.4)
  })

  it('a perfect scan is 100 and loses nothing', () => {
    const o = overall(CATALOG.map((m) => item(m, 100)))
    expect(o).toMatchObject({ coverage: 1, status: 'FINAL', appearance: 100, band: 0, cai: 100, drag: [] })
  })
})

describe('± band', () => {
  it('is Σwᵢδᵢ ÷ Σwᵢ: (40·4 + 20·10 + 15·0) ÷ 75 = 4.8', () => {
    const o = overall([item(T1, 80, 4), item(T2, 55, 10), item(T3, 91, 0)])
    expect(o.band).toBe(4.8)
  })

  it('is rounded UP to 0.1: 4.85 shows as 4.9', () => {
    // (40·4.1 + 20·9.8 + 15·4.4) ÷ 75 = (164 + 196 + 66) ÷ 75 = 5.68 → 5.7
    expect(overall([item(T1, 80, 4.1), item(T2, 55, 9.8), item(T3, 91, 4.4)]).band).toBe(5.7)
  })

  it('is null when an included metric has no stated uncertainty', () => {
    expect(overall([item(T1, 80, 4), item(T2, 55, null), item(T3, 91, 0)]).band).toBeNull()
  })

  it('ignores the spread of a metric that is left out', () => {
    expect(overall([item(T1, 80, 4), item(T2, 55, 10), item(T3, 91, 0), item(T4, 10, null, 'LOW')]).band).toBe(4.8)
  })
})

describe('points lost and the drag list', () => {
  const items = [item(T1, 80), item(T2, 55), item(T3, 91), item(T4, 70), item(T5, 50)]

  it('is wᵢ(100 − sᵢ)/100 grouped by changeability', () => {
    const o = overall(items)
    // FIXED: T1 40·0.20 = 8. SURGICAL/PRO: T3 15·0.09 = 1.35 + T5 10·0.5 = 5 → 6.35.
    // CHANGEABLE: T2 20·0.45 = 9 + T4 15·0.30 = 4.5 → 13.5.
    expect(o.pointsLost).toEqual({ FIXED: 8, SURGICAL_OR_PROFESSIONAL: 6.35, CHANGEABLE: 13.5 })
  })

  it('lists drag items largest first, with their group and raw changeability', () => {
    const o = overall(items)
    expect(o.drag.map((d) => [d.metricId, d.pointsLost, d.group, d.changeability])).toEqual([
      ['T02', 9, 'CHANGEABLE', 'CHANGEABLE'],
      ['T01', 8, 'FIXED', 'FIXED'],
      ['T05', 5, 'SURGICAL_OR_PROFESSIONAL', 'PROFESSIONAL_ONLY'],
      ['T04', 4.5, 'CHANGEABLE', 'FIXED_BUT_VISIBILITY_CHANGEABLE'],
      ['T03', 1.35, 'SURGICAL_OR_PROFESSIONAL', 'SURGICAL_ONLY'],
    ])
    expect(o.drag[0]!.name).toBe('Metric T02')
  })

  it('leaves a metric that lost nothing off the list, and breaks ties by id', () => {
    const o = overall([item(T1, 100), item(T2, 50), item(T3, 33.3333333)])
    expect(o.drag.map((d) => d.metricId)).not.toContain('T01')
    const tie = overall([item(fake('T08', 10, 'FIXED'), 50), item(fake('T07', 10, 'FIXED'), 50)])
    expect(tie.drag.map((d) => d.metricId)).toEqual(['T07', 'T08'])
  })
})

describe('Ceiling Attainment Index', () => {
  it('is 100·Σwᵢsᵢ ÷ Σwᵢcᵢ over scored changeable metrics, ceilings defaulting to 100', () => {
    // Changeable: T02 (w 20, s 55) and T04 (w 15, s 70, visibility-changeable): 100·2150 ÷ 3500 = 61.43 → 61.
    const o = overall([item(T1, 80), item(T2, 55), item(T3, 91), item(T4, 70), item(T5, 50)])
    expect(o.cai).toBe(61)
  })

  it('uses personalised ceilings when given: T02 ceiling 80 → 100·2150 ÷ 3100 = 69.35 → 69', () => {
    const o = overall([item(T2, 55), item(T4, 70)], { T02: 80 })
    expect(o.cai).toBe(69)
  })

  it('never exceeds 100 when a score is above its ceiling, and ignores a nonsense ceiling', () => {
    expect(overall([item(T2, 90), item(T4, 90)], { T02: 50, T04: 50 }).cai).toBe(100)
    expect(overall([item(T2, 55), item(T4, 70)], { T02: 0, T04: Number.NaN }).cai).toBe(61)
  })

  it('is only given when the scored changeable metrics cover at least half of the changeable weight', () => {
    expect(CAI_MIN_CHANGEABLE_COVERAGE).toBe(0.5)
    // T02 alone is 20 of 35 changeable weight (57 %): given.
    expect(overall([item(T2, 55)]).cai).toBe(55)
    // T04 alone is 15 of 35 (43 %): withheld rather than faked.
    expect(overall([item(T4, 70)]).cai).toBeNull()
  })

  it('is null when no changeable metric is scored, and LOW changeable metrics do not count', () => {
    expect(overall([item(T1, 80)]).cai).toBeNull()
    expect(overall([item(T2, 55, 0, 'LOW'), item(T4, 70, 0, 'LOW')]).cai).toBeNull()
  })
})

describe('properties', () => {
  it('appearance is a truncated weighted mean within the score range; status and coverage agree', () => {
    const r = rng(21)
    for (let i = 0; i < 1500; i++) {
      const n = 1 + Math.floor(r() * 7)
      const catalog = Array.from({ length: n }, (_, k) => fake(`P0${k}`, 0.25 * (1 + Math.floor(r() * 80)), (['FIXED', 'CHANGEABLE', 'SURGICAL_ONLY', 'PROFESSIONAL_ONLY', 'FIXED_BUT_VISIBILITY_CHANGEABLE'] as const)[Math.floor(r() * 5)]!))
      const items = catalog.map((m) => item(m, r() < 0.15 ? null : Math.floor(r() * 101), r() * 12, (['HIGH', 'MEDIUM', 'LOW', 'REFUSED'] as const)[Math.floor(r() * 4)]!))
      const o = computeOverall({ scanId: 's1', items, catalog })
      const included = items.filter((it) => it.score.score !== null && (it.score.confidence.band === 'HIGH' || it.score.confidence.band === 'MEDIUM'))
      const w = included.reduce((s, it) => s + it.metric.weight, 0)
      const total = catalog.reduce((s, m) => s + m.weight, 0)
      expect(o.coverage).toBeCloseTo(w / total, 5)
      expect(o.status).toBe(statusForCoverage(w / total))
      if (o.status === 'NOT_AVAILABLE') {
        expect(o.appearance).toBeNull()
        expect(o.band).toBeNull()
      } else {
        const exact = included.reduce((s, it) => s + it.metric.weight * it.score.score!, 0) / w
        expect(o.appearance).toBe(Math.floor(exact + 1e-9))
        expect(o.appearance!).toBeLessThanOrEqual(exact + 1e-9)
        expect(o.appearance!).toBeGreaterThanOrEqual(Math.min(...included.map((it) => it.score.score!)) - 1)
        expect(o.band!).toBeGreaterThanOrEqual(0)
      }
      const lost = o.pointsLost.FIXED + o.pointsLost.SURGICAL_OR_PROFESSIONAL + o.pointsLost.CHANGEABLE
      expect(lost).toBeCloseTo(included.reduce((s, it) => s + (it.metric.weight * (100 - it.score.score!)) / 100, 0), 5)
      expect(o.drag.reduce((s, d) => s + d.pointsLost, 0)).toBeCloseTo(lost, 5)
      for (let k = 1; k < o.drag.length; k++) expect(o.drag[k - 1]!.pointsLost).toBeGreaterThanOrEqual(o.drag[k]!.pointsLost)
      if (o.cai !== null) {
        expect(o.cai).toBeGreaterThanOrEqual(0)
        expect(o.cai).toBeLessThanOrEqual(100)
      }
    }
  })
})
