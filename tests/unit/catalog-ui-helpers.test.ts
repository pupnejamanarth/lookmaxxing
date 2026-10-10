import { describe, expect, it } from 'vitest'
import { METRICS } from '../../src/catalog'
import type { Metric, ScoringRule } from '../../src/catalog/schema'
import {
  EMPTY_FILTERS,
  bucketOf,
  catalogStats,
  describeRule,
  filterMetrics,
  groupByCategory,
  hasActiveFilters,
  isStruckOff,
  neighbours,
  parseTab,
  sampleCurve,
  segmentsByCategory,
  segmentsByChangeability,
  sortFlags,
  sortMethods,
  toggleIn,
} from '../../src/routes/catalog/helpers'

function metric(over: Partial<Metric>): Metric {
  return {
    id: 'F01',
    category: 'face',
    name: 'Test metric',
    weight: 2,
    evidence: 'MODERATE',
    changeability: 'CHANGEABLE',
    ...over,
  } as Metric
}

const SAMPLE: Metric[] = [
  metric({ id: 'F01', weight: 6, changeability: 'CHANGEABLE' }),
  metric({ id: 'F02', weight: 2, changeability: 'FIXED', evidence: 'WEAK' }),
  metric({ id: 'S01', category: 'skin', name: 'Skin clarity', weight: 2, changeability: 'FIXED_BUT_VISIBILITY_CHANGEABLE' }),
  metric({ id: 'X01', category: 'habits', name: 'Sleep log', weight: 0, changeability: 'CHANGEABLE' }),
  metric({ id: 'F03', weight: 0.2, changeability: 'SURGICAL_ONLY', evidence: 'PSEUDOSCIENCE' }),
]

describe('filtering', () => {
  it('returns everything with empty filters', () => {
    expect(filterMetrics(SAMPLE, EMPTY_FILTERS)).toHaveLength(5)
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })
  it('combines filters with AND across groups and OR inside a group', () => {
    const r = filterMetrics(SAMPLE, { ...EMPTY_FILTERS, categories: ['face', 'skin'], changeability: ['FIXED', 'CHANGEABLE'] })
    expect(r.map((m) => m.id)).toEqual(['F01', 'F02'])
  })
  it('hides zero weight and searches id, name and text', () => {
    expect(filterMetrics(SAMPLE, { ...EMPTY_FILTERS, hideZeroWeight: true }).map((m) => m.id)).not.toContain('X01')
    expect(filterMetrics(SAMPLE, { ...EMPTY_FILTERS, query: ' clarity ' }).map((m) => m.id)).toEqual(['S01'])
    expect(filterMetrics(SAMPLE, { ...EMPTY_FILTERS, query: 'x01' }).map((m) => m.id)).toEqual(['X01'])
  })
  it('toggles a value without mutating', () => {
    const a = ['face'] as const
    expect(toggleIn(a, 'skin')).toEqual(['face', 'skin'])
    expect(toggleIn(a, 'face')).toEqual([])
    expect(a).toEqual(['face'])
  })
})

describe('grouping and weight shares', () => {
  it('groups in category order, drops empty groups, sums weight', () => {
    const g = groupByCategory(SAMPLE)
    expect(g.map((x) => x.category)).toEqual(['face', 'skin', 'habits'])
    expect(g[0]!.weight).toBeCloseTo(8.2, 5)
    expect(g[0]!.metrics.map((m) => m.id)).toEqual(['F01', 'F02', 'F03'])
  })
  it('buckets changeability', () => {
    expect(bucketOf('PROFESSIONAL_ONLY')).toBe('surgical_professional')
    expect(bucketOf('FIXED_BUT_VISIBILITY_CHANGEABLE')).toBe('visibility')
  })
  it('segments sum to 100 percent and skip empty ones', () => {
    for (const segs of [segmentsByCategory(SAMPLE), segmentsByChangeability(SAMPLE)]) {
      expect(segs.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 5)
      expect(segs.every((x) => x.weight > 0)).toBe(true)
    }
    expect(segmentsByCategory(SAMPLE).map((s) => s.key)).toEqual(['face', 'skin'])
  })
  it('computes header stats', () => {
    const s = catalogStats(SAMPLE)
    expect(s.count).toBe(5)
    expect(s.scoredCount).toBe(4)
    expect(s.totalWeight).toBeCloseTo(10.2, 5)
    expect(s.changeablePct + s.fixedPct + s.surgicalProfessionalPct).toBeCloseTo(100, 5)
    expect(s.pseudoscienceCount).toBe(1)
    expect(s.weakCount).toBe(1)
  })
  it('handles an empty list', () => {
    const s = catalogStats([])
    expect(s.totalWeight).toBe(0)
    expect(s.changeablePct).toBe(0)
    expect(segmentsByCategory([])).toEqual([])
  })
  it('finds neighbours', () => {
    expect(neighbours(SAMPLE, 'F01')).toEqual({ prev: null, next: SAMPLE[1] })
    expect(neighbours(SAMPLE, 'F03').next).toBeNull()
    expect(neighbours(SAMPLE, 'nope')).toEqual({ prev: null, next: null })
  })
  it('real catalog totals stay consistent', () => {
    const s = catalogStats(METRICS)
    expect(s.changeablePct + s.fixedPct + s.surgicalProfessionalPct).toBeCloseTo(s.totalWeight > 0 ? 100 : 0, 5)
  })
})

describe('scoring curves', () => {
  it('range curve is 100 inside the band and falls outside', () => {
    const rule: ScoringRule = { kind: 'range', lo: 10, hi: 20, tau: 5, tauRationale: 'app chosen' }
    const c = sampleCurve(rule)!
    expect(c.band).toEqual({ lo: 10, hi: 20 })
    expect(c.xMin).toBe(-5)
    expect(c.xMax).toBe(35)
    const inside = c.points.filter((p) => p.x >= 10 && p.x <= 20)
    expect(inside.every((p) => p.y === 100)).toBe(true)
    expect(c.points[0]!.y).toBeLessThan(2)
    const at = c.points.find((p) => p.x > 25 - 0.5 && p.x < 25 + 0.5)
    expect(at!.y).toBeGreaterThan(50)
  })
  it('one-sided curve passes through its points and flat-extends', () => {
    const rule: ScoringRule = { kind: 'one_sided', points: [{ x: 0, y: 100 }, { x: 10, y: 0 }] }
    const c = sampleCurve(rule)!
    expect(c.points).toHaveLength(4)
    expect(c.points[0]!.y).toBe(100)
    expect(c.points[3]!.y).toBe(0)
    expect(c.xMin).toBeLessThan(0)
  })
  it('personal baseline uses its anchor only when present', () => {
    const base = { kind: 'personal_baseline', direction: 'lower_better', note: 'your own value' } as const
    expect(sampleCurve(base)).toBeNull()
    expect(sampleCurve({ ...base, normAnchor: [{ x: 1, y: 100 }, { x: 3, y: 20 }] })).not.toBeNull()
  })
  it('non-numeric rules have no curve', () => {
    expect(sampleCurve({ kind: 'none', reason: 'habit' })).toBeNull()
    expect(sampleCurve({ kind: 'percentile', direction: 'higher_better', referencePopulation: 'adult men' })).toBeNull()
  })
  it('describes every rule kind in words', () => {
    expect(describeRule({ kind: 'none', reason: 'myth' }, 'x')).toMatch(/^Not scored/)
    expect(describeRule({ kind: 'range', lo: 1, hi: 2, tau: 1, tauRationale: 'Because.' }, 'cm')).toContain('1 to 2 cm')
    expect(
      describeRule({ kind: 'checklist', criticalItemCap: 40, items: [{ id: 'a', label: 'Item a', critical: true }, { id: 'b', label: 'Item b', critical: false }] }, ''),
    ).toContain('caps the score at 40')
  })
})

describe('methods helpers', () => {
  it('parses the tab and defaults to natural', () => {
    expect(parseTab(undefined)).toBe('natural')
    expect(parseTab('banned')).toBe('banned')
    expect(parseTab('doctor')).toBe('doctor')
    expect(parseTab('x')).toBe('natural')
  })
  it('strikes off myths, exclusions and bans', () => {
    expect(isStruckOff({ status: 'RECOMMENDED', evidence: 'STRONG' })).toBe(false)
    expect(isStruckOff({ status: 'OPTIONAL_LOW_PRIORITY', evidence: 'MYTH' })).toBe(true)
    expect(isStruckOff({ status: 'EXCLUDED_NO_LASTING_EFFECT', evidence: 'WEAK' })).toBe(true)
  })
  it('sorts usable methods before excluded ones', () => {
    const list = [
      { id: 'NM02', status: 'EXCLUDED_MYTH' },
      { id: 'NM03', status: 'RECOMMENDED' },
      { id: 'NM01', status: 'RECOMMENDED' },
    ] as never[]
    expect(sortMethods(list).map((m: { id: string }) => m.id)).toEqual(['NM01', 'NM03', 'NM02'])
  })
  it('sorts referral flags by urgency', () => {
    const flags = [
      { id: 'REF01', urgency: 'routine' },
      { id: 'REF02', urgency: 'urgent' },
    ] as never[]
    expect(sortFlags(flags).map((f: { id: string }) => f.id)).toEqual(['REF02', 'REF01'])
  })
})
