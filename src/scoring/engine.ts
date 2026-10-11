/**
 * The scoring engine: Measurement → MetricScore (and a whole scan → scores + overall).
 *
 * Order of decisions for one measurement:
 *   1. Refused: the measurement carries a refusal, has no usable value, or its confidence is under 0.40.
 *      No score; the reason says why and what to re-capture. A refusal beats every other outcome.
 *   2. Unscored by design: MYTH evidence, rule kind `none`, or weight 0. No score, ever.
 *   3. By rule kind: range · one_sided · personal_baseline · checklist · percentile.
 *      A personal_baseline metric with neither a stored baseline nor a norm anchor is NOT scored: this
 *      measurement sets the baseline (only when confidence is HIGH or MEDIUM; a LOW value is not stored).
 *   4. Everything scored is truncated to an integer 0–100, carries its facts and a rendered reason.
 *
 * Checklist metrics read per-item results from `measurement.inputs[item.id]` (1 = passed, 0 = failed). Without
 * item results the overall share (`value`, in %) is used and any shortfall is capped (see checklistScoreFromShareRaw).
 * A percentile metric reads `inputs.percentile` (0–100), or `value` when the unit says percentile.
 */
import { getMetric } from '../catalog'
import type { Metric } from '../catalog/schema'
import type { Measurement, MetricScore, OverallScore, ScoreFacts } from '../domain/types'
import { confidenceBreakdown, type ConfidenceBreakdown } from './confidence'
import {
  RULESET_VERSION,
  anchorScoreRaw,
  bandFromPoints,
  baselineBand,
  baselineTau,
  checklistScoreFromShareRaw,
  checklistScoreRaw,
  combineBaselineAndAnchor,
  gapOutside,
  oneSidedScoreRaw,
  percentileScoreRaw,
  personalBaselineScoreRaw,
  rangeScoreRaw,
  scoreSpread,
  truncateScore,
  type Band,
} from './functions'
import { computeOverall } from './overall'
import { SHOT_LABELS, amount } from './phrasebank'
import {
  lowConfidenceRefusal,
  missingValueRefusal,
  renderReason,
  renderRefusal,
  type ChecklistDetail,
  type ReasonConfidence,
  type ReasonInput,
} from './reasons'

export interface ScoreContext {
  /** metricId → the user's personal baseline. */
  baselines: Record<string, number>
  uuid?: () => string
}

export interface BaselineToStore {
  metricId: string
  value: number
}

export interface Evaluation {
  metric: Metric
  score: MetricScore
  baselineToStore?: BaselineToStore
  /** Score movement within ± the measurement's uncertainty (feeds the overall ± band); null if unknowable. */
  spread: number | null
}

const defaultUuid = (): string => globalThis.crypto.randomUUID()
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6

/** Items a checklist result is judged on; the item id is the key in `Measurement.inputs`. */
function itemResults(m: Measurement, itemIds: readonly string[]): { known: boolean; results: Record<string, boolean | undefined> } {
  const inputs = m.inputs ?? {}
  const results: Record<string, boolean | undefined> = {}
  let known = false
  for (const id of itemIds) {
    const v = inputs[id]
    if (typeof v === 'number' && Number.isFinite(v)) {
      results[id] = v >= 0.5
      known = true
    }
  }
  return { known, results }
}

function percentileOf(m: Measurement): { value: number; fromUnit: boolean } | null {
  const p = m.inputs?.percentile
  if (typeof p === 'number' && Number.isFinite(p)) return { value: p, fromUnit: false }
  if (/percentile/i.test(m.unit) && m.value !== null && Number.isFinite(m.value)) return { value: m.value, fromUnit: true }
  return null
}

/**
 * Full evaluation of one measurement. Throws on a metric id the catalog does not know.
 * `scoreMetric` is the public wrapper; `scoreScan` uses the spread for the overall ± band.
 */
export function evaluateMeasurement(m: Measurement, ctx: ScoreContext): Evaluation {
  const metric = getMetric(m.metricId)
  if (!metric) throw new Error(`Unknown metric id "${m.metricId}": it is not in the catalog`)
  const uuid = ctx.uuid ?? defaultUuid

  const breakdown = confidenceBreakdown(m, metric)
  // The measurement does not record which of several allowed shots was used, so all of them are named.
  const shotLabel = metric.captureRequirements.map((shot) => SHOT_LABELS[shot]).join(' / ')
  const reasonConfidence = (b: ConfidenceBreakdown): ReasonConfidence => ({ band: b.band, value: b.value, parts: b })
  const common = {
    metricName: metric.name,
    method: m.method,
    nFrames: m.nFrames,
    confidence: reasonConfidence(breakdown),
  }

  const build = (
    score: number | null,
    facts: ScoreFacts | null,
    reason: string,
    confidence: { band: MetricScore['confidence']['band']; value: number } = { band: breakdown.band, value: breakdown.value },
  ): MetricScore => {
    const record: MetricScore = {
      id: uuid(),
      scanId: m.scanId,
      metricId: m.metricId,
      score,
      confidence,
      facts,
      reason,
      rulesetVersion: RULESET_VERSION,
    }
    assertScoreInvariant(record)
    return record
  }

  const refused = (reasons: string[], recapture: string[], confidenceValue: number): Evaluation => {
    const text = renderRefusal({
      metricName: metric.name,
      shotLabel,
      reasons: reasons.length > 0 ? reasons : missingValueRefusal().reasons,
      recapture: recapture.length > 0 ? recapture : [`repeat the ${shotLabel} capture under the capture protocol`],
    })
    return { metric, score: build(null, null, text, { band: 'REFUSED', value: confidenceValue }), spread: null }
  }

  // 1. Refusals.
  if (m.refusal) return refused(m.refusal.reasons, m.refusal.recapture, 0)
  if (m.value === null) return refused(missingValueRefusal().reasons, missingValueRefusal().recapture, 0)
  if (!Number.isFinite(m.value)) {
    return refused(['The measured value is not a finite number'], [`repeat the ${shotLabel} capture`], 0)
  }
  if (breakdown.band === 'REFUSED') {
    const r = lowConfidenceRefusal(common.confidence)
    return refused(r.reasons, r.recapture, breakdown.value)
  }

  const value = m.value
  const rule = metric.scoring
  const basis = {
    value,
    unit: m.unit,
    uncertainty: m.uncertainty,
    shotLabel,
    sourceIds: [...metric.sourceIds],
    weight: metric.weight,
    evidence: metric.evidence,
    changeability: metric.changeability,
  }

  // 2. Unscored by design.
  if (metric.evidence === 'MYTH' || rule.kind === 'none' || metric.weight === 0) {
    const cause = metric.evidence === 'MYTH' ? 'myth' : rule.kind === 'none' ? rule.reason : 'zero_weight'
    const reason = renderReason({ ...common, kind: 'unscored', basis, cause })
    return { metric, score: build(null, null, reason), spread: null }
  }

  // 3. By rule kind.
  let fn: (v: number) => number
  let band: Band
  let extra: Partial<Pick<Extract<ReasonInput, { kind: 'scored' }>, 'baseline' | 'checklist' | 'percentile'>> = {}
  let deterministic = false

  switch (rule.kind) {
    case 'range':
      fn = (v) => rangeScoreRaw(v, rule)
      band = { lo: rule.lo, hi: rule.hi }
      break

    case 'one_sided':
      fn = (v) => oneSidedScoreRaw(v, rule.points)
      band = bandFromPoints(rule.points)
      break

    case 'personal_baseline': {
      const stored = ctx.baselines[metric.id]
      const baseline = typeof stored === 'number' && Number.isFinite(stored) ? stored : undefined
      const anchor = rule.normAnchor
      if (baseline === undefined && !anchor) {
        const keep = breakdown.band === 'HIGH' || breakdown.band === 'MEDIUM'
        const reason = renderReason({ ...common, kind: 'baseline_set', basis, stored: keep })
        const evaluation: Evaluation = { metric, score: build(null, null, reason), spread: null }
        if (keep) evaluation.baselineToStore = { metricId: metric.id, value }
        return evaluation
      }
      // No B02 target exists yet, and the catalog supports no gaunt-face penalty: a leaner F01 is never penalised.
      const direction = metric.id === 'F01' && rule.direction === 'target_range' ? 'lower_better' : rule.direction
      const relative =
        baseline === undefined
          ? null
          : (() => {
              const tau = baselineTau({ scaleMin: metric.scale.min, scaleMax: metric.scale.max, baseline, uncertainty: m.uncertainty })
              return (v: number) => personalBaselineScoreRaw(v, baseline, direction, tau)
            })()
      const anchored = anchor ? (v: number) => anchorScoreRaw(v, anchor) : null
      fn = relative && anchored ? (v) => combineBaselineAndAnchor(relative(v), anchored(v)) : (relative ?? anchored)!
      band = anchor ? bandFromPoints(anchor) : baselineBand(baseline!, direction)
      if (baseline !== undefined) extra = { baseline: { value: baseline, direction, anchored: anchor !== undefined } }
      break
    }

    case 'checklist': {
      const itemIds = rule.items.map((i) => i.id)
      const { known, results } = itemResults(m, itemIds)
      let raw: number
      let detail: ChecklistDetail
      if (known) {
        const outcome = checklistScoreRaw(rule, results)
        raw = outcome.raw
        detail = {
          passed: outcome.passed,
          total: outcome.total,
          failed: outcome.failed.map((f) => ({ label: f.label, critical: f.critical })),
          cap: outcome.cap,
          share: outcome.share,
          itemsKnown: true,
        }
      } else {
        const fromShare = checklistScoreFromShareRaw(value, rule.criticalItemCap)
        raw = fromShare.raw
        detail = { passed: 0, total: rule.items.length, failed: [], cap: fromShare.cap, share: Math.min(100, Math.max(0, value)), itemsKnown: false }
      }
      fn = () => raw
      band = metric.ideal.male ? { lo: metric.ideal.male.lo, hi: metric.ideal.male.hi } : { lo: null, hi: null }
      extra = { checklist: detail }
      deterministic = true
      break
    }

    case 'percentile': {
      const p = percentileOf(m)
      if (!p) {
        return refused(
          [
            `The percentile rule needs your percentile in the reference population (${rule.referencePopulation}). Only ${amount(value, m.unit)} was supplied`,
          ],
          ['choose the reference population in setup so the value can be converted to a percentile'],
          0,
        )
      }
      fn = p.fromUnit ? (v) => percentileScoreRaw(v, rule.direction) : () => percentileScoreRaw(p.value, rule.direction)
      band = { lo: null, hi: null }
      extra = { percentile: { value: p.value, population: rule.referencePopulation, direction: rule.direction } }
      deterministic = !p.fromUnit
      break
    }
  }

  const raw = fn(value)
  const score = truncateScore(raw)
  const gap = gapOutside(value, band)
  const facts: ScoreFacts = {
    ...basis,
    idealSummary: metric.ideal.summary,
    idealLo: band.lo,
    idealHi: band.hi,
    gap: gap === null ? null : round6(gap),
    ruleKind: rule.kind,
    pointsLost: round6((metric.weight * (100 - score)) / 100),
  }
  const reason = renderReason({ ...common, kind: 'scored', facts, score, ...extra })
  const spread = deterministic ? 0 : m.uncertainty === null ? null : scoreSpread(fn, value, m.uncertainty)
  return { metric, score: build(score, facts, reason), spread }
}

/** The honesty invariant, checked on every record this module returns. */
export function assertScoreInvariant(s: MetricScore): void {
  if (s.reason.trim().length === 0) throw new Error(`Score for ${s.metricId} has an empty reason`)
  if (s.score !== null) {
    if (s.facts === null) throw new Error(`Score for ${s.metricId} has a number but no facts`)
    if (!Number.isInteger(s.score) || s.score < 0 || s.score > 100) throw new Error(`Score for ${s.metricId} is not an integer 0–100`)
    if (s.confidence.band === 'REFUSED') throw new Error(`Score for ${s.metricId} is refused but carries a number`)
  }
}

/** Score one measurement against the user's stored baselines. */
export function scoreMetric(m: Measurement, ctx: ScoreContext): { score: MetricScore; baselineToStore?: BaselineToStore } {
  const { score, baselineToStore } = evaluateMeasurement(m, ctx)
  return baselineToStore ? { score, baselineToStore } : { score }
}

/** Score a whole scan: one MetricScore per measurement, the overall score, and any baselines this scan sets. */
export function scoreScan(args: {
  scanId: string
  measurements: Measurement[]
  baselines: Record<string, number>
  uuid?: () => string
}): { scores: MetricScore[]; overall: OverallScore; baselinesToStore: BaselineToStore[] } {
  const seen = new Set<string>()
  const evaluations: Evaluation[] = []
  for (const m of args.measurements) {
    if (m.scanId !== args.scanId) throw new Error(`Measurement for ${m.metricId} belongs to scan "${m.scanId}", not "${args.scanId}"`)
    if (seen.has(m.metricId)) throw new Error(`Two measurements for ${m.metricId} in one scan`)
    seen.add(m.metricId)
    evaluations.push(evaluateMeasurement(m, { baselines: args.baselines, uuid: args.uuid }))
  }
  const overall = computeOverall({
    scanId: args.scanId,
    items: evaluations.map((e) => ({ metric: e.metric, score: e.score, spread: e.spread })),
  })
  const baselinesToStore = evaluations.flatMap((e) => (e.baselineToStore ? [e.baselineToStore] : []))
  return { scores: evaluations.map((e) => e.score), overall, baselinesToStore }
}
