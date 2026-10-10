/** Pure helpers for the metric browser and the methods library. No React, no I/O. */
import type {
  BannedItem,
  CategoryId,
  Changeability,
  Evidence,
  Metric,
  NaturalMethod,
  Phase,
  ReferralFlag,
  ScoringRule,
} from '../../catalog/schema'
import { CATEGORY_IDS } from '../../catalog/schema'

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  face: 'Face',
  skin: 'Skin',
  hair: 'Hair',
  eyes_smile: 'Eyes and smile',
  body: 'Body',
  posture: 'Posture',
  grooming: 'Grooming',
  presence: 'Presence',
  habits: 'Habits',
}

export const PHASE_LABEL: Record<Phase, string> = {
  M1: 'Measured from build M1',
  M2: 'Measured from build M2',
  M3: 'Measured from build M3',
  V2: 'Planned for version 2',
  V3: 'Planned for version 3',
}

export function phaseLabel(phase: Phase): string {
  return PHASE_LABEL[phase]
}

export function phaseShort(phase: Phase): string {
  return phase === 'V2' || phase === 'V3' ? `Later: ${phase}` : `From ${phase}`
}

// ───────────────────────────── filtering ─────────────────────────────

export interface MetricFilters {
  categories: readonly CategoryId[]
  changeability: readonly Changeability[]
  evidence: readonly Evidence[]
  hideZeroWeight: boolean
  query: string
}

export const EMPTY_FILTERS: MetricFilters = {
  categories: [],
  changeability: [],
  evidence: [],
  hideZeroWeight: false,
  query: '',
}

export function hasActiveFilters(f: MetricFilters): boolean {
  return (
    f.categories.length > 0 ||
    f.changeability.length > 0 ||
    f.evidence.length > 0 ||
    f.hideZeroWeight ||
    f.query.trim() !== ''
  )
}

/** Adds the value if absent, removes it if present. Never mutates. */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function filterMetrics(metrics: readonly Metric[], f: MetricFilters): Metric[] {
  const q = f.query.trim().toLowerCase()
  return metrics.filter((m) => {
    if (f.categories.length > 0 && !f.categories.includes(m.category)) return false
    if (f.changeability.length > 0 && !f.changeability.includes(m.changeability)) return false
    if (f.evidence.length > 0 && !f.evidence.includes(m.evidence)) return false
    if (f.hideZeroWeight && m.weight <= 0) return false
    if (q) {
      const hay = `${m.id} ${m.name} ${m.measures}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export interface MetricGroup {
  category: CategoryId
  label: string
  metrics: Metric[]
  /** Sum of weights of the metrics in this group (after filtering). */
  weight: number
}

const round = (n: number, places = 2): number => {
  const k = 10 ** places
  return Math.round(n * k) / k
}

export function sumWeight(metrics: readonly Metric[]): number {
  return round(metrics.reduce((s, m) => s + m.weight, 0), 4)
}

/** Groups in catalog category order; empty groups are dropped. Metrics sorted by id. */
export function groupByCategory(metrics: readonly Metric[]): MetricGroup[] {
  const out: MetricGroup[] = []
  for (const category of CATEGORY_IDS) {
    const list = metrics.filter((m) => m.category === category).sort((a, b) => a.id.localeCompare(b.id))
    if (list.length === 0) continue
    out.push({ category, label: CATEGORY_LABEL[category], metrics: list, weight: sumWeight(list) })
  }
  return out
}

// ───────────────────────────── weight shares ─────────────────────────────

export type ChangeBucket = 'changeable' | 'visibility' | 'fixed' | 'surgical_professional'

export const BUCKET_LABEL: Record<ChangeBucket, string> = {
  changeable: 'Changeable',
  visibility: 'Fixed, visibility changeable',
  fixed: 'Fixed',
  surgical_professional: 'Surgical or professional only',
}

export function bucketOf(c: Changeability): ChangeBucket {
  switch (c) {
    case 'CHANGEABLE':
      return 'changeable'
    case 'FIXED_BUT_VISIBILITY_CHANGEABLE':
      return 'visibility'
    case 'FIXED':
      return 'fixed'
    default:
      return 'surgical_professional'
  }
}

export interface Segment {
  key: string
  label: string
  weight: number
  /** Share of the segment total, 0 to 100. */
  pct: number
}

function toSegments(entries: { key: string; label: string; weight: number }[]): Segment[] {
  const total = entries.reduce((s, e) => s + e.weight, 0)
  return entries
    .filter((e) => e.weight > 0)
    .map((e) => ({ ...e, weight: round(e.weight), pct: total > 0 ? (e.weight / total) * 100 : 0 }))
}

export function segmentsByCategory(metrics: readonly Metric[]): Segment[] {
  return toSegments(
    CATEGORY_IDS.map((c) => ({
      key: c,
      label: CATEGORY_LABEL[c],
      weight: metrics.filter((m) => m.category === c).reduce((s, m) => s + m.weight, 0),
    })),
  )
}

export const BUCKET_ORDER: readonly ChangeBucket[] = ['changeable', 'visibility', 'fixed', 'surgical_professional']

export function segmentsByChangeability(metrics: readonly Metric[]): Segment[] {
  return toSegments(
    BUCKET_ORDER.map((b) => ({
      key: b,
      label: BUCKET_LABEL[b],
      weight: metrics.filter((m) => bucketOf(m.changeability) === b).reduce((s, m) => s + m.weight, 0),
    })),
  )
}

export interface CatalogStats {
  count: number
  scoredCount: number
  totalWeight: number
  /** Percent of total weight. Changeable includes "visibility changeable". */
  changeablePct: number
  fixedPct: number
  surgicalProfessionalPct: number
  pseudoscienceCount: number
  weakCount: number
}

export function catalogStats(metrics: readonly Metric[]): CatalogStats {
  const total = sumWeight(metrics)
  const share = (pred: (m: Metric) => boolean): number =>
    total > 0 ? (metrics.filter(pred).reduce((s, m) => s + m.weight, 0) / total) * 100 : 0
  return {
    count: metrics.length,
    scoredCount: metrics.filter((m) => m.weight > 0).length,
    totalWeight: total,
    changeablePct: share((m) => bucketOf(m.changeability) === 'changeable' || bucketOf(m.changeability) === 'visibility'),
    fixedPct: share((m) => m.changeability === 'FIXED'),
    surgicalProfessionalPct: share((m) => bucketOf(m.changeability) === 'surgical_professional'),
    pseudoscienceCount: metrics.filter((m) => m.evidence === 'PSEUDOSCIENCE').length,
    weakCount: metrics.filter((m) => m.evidence === 'WEAK').length,
  }
}

export function formatWeight(w: number): string {
  if (w === 0) return '0'
  const s = w.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return s
}

export function formatPct(p: number): string {
  return `${Math.round(p)}%`
}

// ───────────────────────────── prev / next ─────────────────────────────

export function neighbours(metrics: readonly Metric[], id: string): { prev: Metric | null; next: Metric | null } {
  const i = metrics.findIndex((m) => m.id === id)
  if (i < 0) return { prev: null, next: null }
  return { prev: metrics[i - 1] ?? null, next: metrics[i + 1] ?? null }
}

// ───────────────────────────── scoring rule text and curve ─────────────────────────────

export function ruleKindLabel(rule: ScoringRule): string {
  switch (rule.kind) {
    case 'range':
      return 'Target range'
    case 'one_sided':
      return 'One-sided'
    case 'personal_baseline':
      return 'Personal baseline'
    case 'checklist':
      return 'Checklist'
    case 'percentile':
      return 'Percentile'
    case 'none':
      return 'Not scored'
  }
}

const NONE_REASON: Record<Extract<ScoringRule, { kind: 'none' }>['reason'], string> = {
  myth: 'It rests on a claim the evidence does not support.',
  process_measure: 'It tracks a process, not how you look.',
  habit: 'It is a habit. Habits carry no appearance weight.',
  deferred: 'Scoring is deferred to a later version.',
  context_only: 'It is recorded for context only.',
}

export function describeRule(rule: ScoringRule, unit: string): string {
  switch (rule.kind) {
    case 'range':
      return `Full score (100) from ${rule.lo} to ${rule.hi} ${unit}. Outside that band the score falls smoothly with distance from the nearest edge. The fall-off width is ${rule.tau} ${unit}. ${rule.tauRationale}`
    case 'one_sided': {
      const first = rule.points[0]
      const last = rule.points[rule.points.length - 1]
      const rising = first !== undefined && last !== undefined && last.y > first.y
      return `The score is read from a lookup of ${rule.points.length} points, joined by straight lines. ${rising ? 'Higher values score higher.' : 'Lower values score higher.'} There is no penalty for going past the best point.`
    }
    case 'personal_baseline': {
      const dir =
        rule.direction === 'lower_better'
          ? 'Lower is better.'
          : rule.direction === 'higher_better'
            ? 'Higher is better.'
            : 'The best value is a target you choose.'
      return `Scored against your own baseline, not a population ideal. ${dir} ${rule.note}`
    }
    case 'checklist': {
      const critical = rule.items.filter((i) => i.critical).length
      return `Score is the share of ${rule.items.length} checklist items you pass. ${critical} of them ${critical === 1 ? 'is' : 'are'} critical. Failing a critical item caps the score at ${rule.criticalItemCap}.`
    }
    case 'percentile':
      return `Scored by where you fall in this reference group: ${rule.referencePopulation}. ${rule.direction === 'higher_better' ? 'A higher percentile scores higher.' : 'A lower percentile scores higher.'}`
    case 'none':
      return `Not scored. ${NONE_REASON[rule.reason]}`
  }
}

export interface CurvePoint {
  x: number
  y: number
}

export interface Curve {
  points: CurvePoint[]
  xMin: number
  xMax: number
  /** Optional shaded band (the full-score or ideal zone). */
  band: { lo: number; hi: number } | null
}

/** Score as a function of value for numeric rules. Returns null for rules without a numeric curve. */
export function sampleCurve(rule: ScoringRule, samples = 60): Curve | null {
  if (rule.kind === 'range') {
    const lo = Math.min(rule.lo, rule.hi)
    const hi = Math.max(rule.lo, rule.hi)
    const xMin = lo - 3 * rule.tau
    const xMax = hi + 3 * rule.tau
    const points: CurvePoint[] = []
    for (let i = 0; i <= samples; i++) {
      const x = xMin + ((xMax - xMin) * i) / samples
      const d = x < lo ? lo - x : x > hi ? x - hi : 0
      points.push({ x, y: 100 * Math.exp(-0.5 * (d / rule.tau) ** 2) })
    }
    return { points, xMin, xMax, band: { lo, hi } }
  }
  const anchors = rule.kind === 'one_sided' ? rule.points : rule.kind === 'personal_baseline' ? rule.normAnchor : undefined
  if (anchors && anchors.length >= 2) {
    const pts = [...anchors].sort((a, b) => a.x - b.x)
    const first = pts[0]!
    const last = pts[pts.length - 1]!
    const pad = (last.x - first.x) * 0.1
    const points: CurvePoint[] = [
      { x: first.x - pad, y: first.y },
      ...pts.map((p) => ({ x: p.x, y: p.y })),
      { x: last.x + pad, y: last.y },
    ]
    return { points, xMin: first.x - pad, xMax: last.x + pad, band: null }
  }
  return null
}

// ───────────────────────────── methods ─────────────────────────────


export type MethodsTab = 'natural' | 'banned' | 'doctor'
export const METHODS_TABS: readonly MethodsTab[] = ['natural', 'banned', 'doctor']

export function parseTab(raw: string | undefined): MethodsTab {
  return raw === 'banned' || raw === 'doctor' ? raw : 'natural'
}

export type NaturalStatus = NaturalMethod['status']

export const STATUS_LABEL: Record<NaturalStatus, string> = {
  RECOMMENDED: 'RECOMMENDED',
  OPTIONAL_LOW_PRIORITY: 'OPTIONAL',
  EXCLUDED_MYTH: 'EXCLUDED',
  EXCLUDED_NO_LASTING_EFFECT: 'EXCLUDED',
  BANNED_HARMFUL: 'BANNED',
  WHITELIST_REQUIRED: 'NEEDS WHITELIST',
}

export function isStruckOff(m: Pick<NaturalMethod, 'status' | 'evidence'>): boolean {
  return m.evidence === 'MYTH' || m.status === 'EXCLUDED_MYTH' || m.status === 'EXCLUDED_NO_LASTING_EFFECT' || m.status === 'BANNED_HARMFUL'
}

const STATUS_ORDER: Record<NaturalStatus, number> = {
  RECOMMENDED: 0,
  OPTIONAL_LOW_PRIORITY: 1,
  WHITELIST_REQUIRED: 2,
  EXCLUDED_NO_LASTING_EFFECT: 3,
  EXCLUDED_MYTH: 4,
  BANNED_HARMFUL: 5,
}

/** Usable methods first, struck-off ones last. Stable by id inside a status. */
export function sortMethods(list: readonly NaturalMethod[]): NaturalMethod[] {
  return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id.localeCompare(b.id))
}

export const BAN_GROUP_LABEL: Record<BannedItem['group'], string> = {
  injury_risk: 'Injury risk',
  extreme_restriction: 'Extreme restriction',
  skin_damage: 'Skin damage',
  teeth_damage: 'Teeth damage',
  eye_risk: 'Eye risk',
  diy_procedure: 'Do-it-yourself procedure',
  pseudoscience_harm: 'Pseudoscience that causes harm',
  voice_harm: 'Voice harm',
  sun_damage: 'Sun damage',
}

export function groupBanned(list: readonly BannedItem[]): { group: BannedItem['group']; label: string; items: BannedItem[] }[] {
  const order = Object.keys(BAN_GROUP_LABEL) as BannedItem['group'][]
  return order
    .map((group) => ({ group, label: BAN_GROUP_LABEL[group], items: list.filter((b) => b.group === group) }))
    .filter((g) => g.items.length > 0)
}

export const URGENCY_ORDER: Record<ReferralFlag['urgency'], number> = { urgent: 0, soon: 1, routine: 2 }
export const URGENCY_LABEL: Record<ReferralFlag['urgency'], string> = {
  urgent: 'See a doctor promptly',
  soon: 'See a doctor soon',
  routine: 'Mention it at a routine visit',
}

export function sortFlags(list: readonly ReferralFlag[]): ReferralFlag[] {
  return [...list].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.id.localeCompare(b.id))
}
