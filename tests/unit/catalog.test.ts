import { describe, expect, it } from 'vitest'
import {
  BANNED,
  METRICS,
  NATURAL_METHODS,
  REFERRAL_FLAGS,
  SOURCES,
  getMetric,
  isPlannable,
  totalWeight,
} from '../../src/catalog'
import {
  BannedItem,
  CATEGORY_IDS,
  CATEGORY_WEIGHT_TOTALS,
  Metric,
  NaturalMethod,
  ReferralFlag,
  Source,
} from '../../src/catalog/schema'

/** Every id that the approved plan promises. Removing one silently is not allowed. */
const REQUIRED_IDS = [
  ...Array.from({ length: 20 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 13 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 9 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 7 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 15 }, (_, i) => `X${String(i + 1).padStart(2, '0')}`),
]

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

describe('catalog – metrics', () => {
  it('contains every promised metric id', () => {
    const have = new Set(METRICS.map((m) => m.id))
    expect(REQUIRED_IDS.filter((id) => !have.has(id))).toEqual([])
  })

  it('has unique ids', () => {
    const seen = new Set<string>()
    const dups = METRICS.map((m) => m.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
    expect(dups).toEqual([])
  })

  it.each(METRICS.map((m) => [m.id, m] as const))('%s satisfies the metric schema', (_id, m) => {
    expect(issues(Metric.safeParse(m))).toEqual([])
  })

  it('category weights add up exactly and the total is 100', () => {
    for (const c of CATEGORY_IDS) {
      const sum = totalWeight(METRICS.filter((m) => m.category === c))
      expect(sum, `category ${c}`).toBeCloseTo(CATEGORY_WEIGHT_TOTALS[c], 6)
    }
    expect(totalWeight()).toBeCloseTo(100, 6)
  })

  it('applies the pseudoscience / weak-evidence weight caps', () => {
    for (const m of METRICS) {
      if (m.evidence === 'PSEUDOSCIENCE') expect(m.weight, m.id).toBeLessThanOrEqual(0.25)
      if (m.evidence === 'WEAK') expect(m.weight, m.id).toBeLessThanOrEqual(1)
      if (m.evidence === 'MYTH') expect(m.weight, m.id).toBe(0)
    }
  })

  it('flags the known community pseudoscience metrics plainly', () => {
    for (const id of ['F10', 'F11']) {
      const m = getMetric(id)!
      expect(m.evidence, id).toBe('PSEUDOSCIENCE')
      expect(m.communityClaim, id).toBeTruthy()
    }
    expect(METRICS.some((m) => m.evidence === 'MYTH')).toBe(true)
  })

  it('keeps fixed, surgical and professional-only metrics out of the action plan', () => {
    for (const m of METRICS) {
      if (!isPlannable(m)) expect(m.drivers, m.id).toEqual([])
    }
    for (const id of ['B01', 'F04', 'F14', 'S02', 'E04']) {
      expect(isPlannable(getMetric(id)!), id).toBe(false)
    }
  })

  it('treats body fat, facial adiposity and posture as plannable', () => {
    for (const id of ['B02', 'F01', 'P01']) expect(isPlannable(getMetric(id)!), id).toBe(true)
  })

  it('never lets habits carry appearance weight', () => {
    for (const m of METRICS.filter((m) => m.category === 'habits')) expect(m.weight).toBe(0)
  })
})

describe('catalog – sources', () => {
  it('is schema-valid with unique ids', () => {
    const ids = SOURCES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SOURCES) expect(issues(Source.safeParse(s)), s.id).toEqual([])
  })

  it('only marks a source verified when it has a URL', () => {
    for (const s of SOURCES) if (s.verified) expect(s.url, s.id).toBeTruthy()
  })

  it('resolves every cited source id and leaves no orphan sources', () => {
    const known = new Set(SOURCES.map((s) => s.id))
    const cited = new Set<string>()
    for (const m of METRICS) for (const id of m.sourceIds) cited.add(id)
    for (const n of NATURAL_METHODS) for (const id of n.sourceIds) cited.add(id)
    for (const b of BANNED) for (const id of b.sourceIds) cited.add(id)
    expect([...cited].filter((id) => !known.has(id))).toEqual([])
    expect([...known].filter((id) => !cited.has(id))).toEqual([])
  })
})

describe('catalog – natural methods, bans, referral flags', () => {
  it('has schema-valid, uniquely identified entries', () => {
    for (const n of NATURAL_METHODS) expect(issues(NaturalMethod.safeParse(n)), n.id).toEqual([])
    for (const b of BANNED) expect(issues(BannedItem.safeParse(b)), b.id).toEqual([])
    for (const r of REFERRAL_FLAGS) expect(issues(ReferralFlag.safeParse(r)), r.id).toEqual([])
    for (const list of [NATURAL_METHODS, BANNED, REFERRAL_FLAGS]) {
      const ids = list.map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('only targets metrics that exist', () => {
    for (const n of NATURAL_METHODS) for (const id of n.targetsMetricIds) expect(getMetric(id), `${n.id}→${id}`).toBeTruthy()
    for (const r of REFERRAL_FLAGS) for (const id of r.metricIds) expect(getMetric(id), `${r.id}→${id}`).toBeTruthy()
  })

  it('never recommends anything that matches a banned pattern', () => {
    const live = NATURAL_METHODS.filter((n) => n.status === 'RECOMMENDED' || n.status === 'OPTIONAL_LOW_PRIORITY')
    for (const n of live) {
      const text = `${n.name} ${n.whatItDoes}`.toLowerCase()
      for (const b of BANNED) for (const p of b.patterns) expect(text.includes(p), `${n.id} contains banned "${p}" (${b.id})`).toBe(false)
    }
  })

  it('requires patch tests for anything applied to the body and keeps myths out of the plan', () => {
    for (const n of NATURAL_METHODS) {
      if (n.appliedToBody) expect(n.patchTest.required, n.id).toBe(true)
      if (n.evidence === 'MYTH') expect(['EXCLUDED_MYTH', 'EXCLUDED_NO_LASTING_EFFECT', 'BANNED_HARMFUL']).toContain(n.status)
    }
  })

  it('includes the hard bans from the brief', () => {
    const text = BANNED.map((b) => `${b.name} ${b.patterns.join(' ')}`.toLowerCase()).join(' | ')
    for (const needle of ['bone smash', 'crash diet', 'dehydrat', 'lemon', 'baking soda', 'toothpaste', 'charcoal', 'essential oil', 'dermaroll']) {
      expect(text.includes(needle), `missing ban: ${needle}`).toBe(true)
    }
  })
})
