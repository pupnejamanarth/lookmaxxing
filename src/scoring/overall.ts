/**
 * Overall scores per docs/PLAN.md §4.4.
 *
 *  - Appearance = Σ wᵢsᵢ ÷ Σ wᵢ over HIGH + MEDIUM scored metrics only (LOW is shown but left out), truncated.
 *  - Coverage = scored weight ÷ TOTAL catalog weight. FINAL ≥ 75 %, PROVISIONAL 50–75 %, below 50 % there is no
 *    overall number at all (status NOT_AVAILABLE, appearance and band null) – the report says so instead.
 *  - ± band: each metric's score is evaluated at value ± uncertainty; the largest movement is that metric's δᵢ, and
 *    band = Σ wᵢδᵢ ÷ Σ wᵢ. Summing (not root-sum-of-squares) assumes fully correlated errors, which is the honest
 *    case when most metrics come from one photo's landmarks; it can overstate the band, never understate it. The
 *    band is rounded UP to 0.1 for the same reason. If an included metric has no uncertainty the band is null.
 *  - Points lost = wᵢ(100 − sᵢ)/100 per metric, grouped FIXED / SURGICAL_OR_PROFESSIONAL / CHANGEABLE.
 *    FIXED_BUT_VISIBILITY_CHANGEABLE counts as CHANGEABLE, because the catalog itself treats it as plannable
 *    (isPlannable) and requires it to name lever drivers (haircut, grooming…): the user can act on the visible part.
 *    The drag item keeps the raw changeability string so the UI can show the nuance.
 *  - CAI = 100 · Σ wᵢsᵢ ÷ Σ wᵢcᵢ over scored changeable metrics. Ceilings cᵢ default to 100: they are NOT
 *    personalised yet, and the report must say so (CAI_CEILING_NOTE in reasons.ts). CAI is only given when the
 *    scored changeable metrics cover at least half of the catalog's changeable weight; a CAI built from one or two
 *    metrics would be a made-up number.
 *
 * Appearance and CAI are truncated, never rounded up.
 */
import { METRICS, isPlannable, totalWeight } from '../catalog'
import type { Metric } from '../catalog/schema'
import type { DragItem, MetricScore, OverallScore, OverallStatus } from '../domain/types'
import { countsTowardOverall } from './confidence'
import { RULESET_VERSION } from './functions'

/** Bump when any metric weight in the catalog changes: stored scores cite it so old scans can be recomputed. */
export const WEIGHTS_VERSION = 'weights-1.0.0'

export const COVERAGE_FINAL = 0.75
export const COVERAGE_PROVISIONAL = 0.5
export const CAI_MIN_CHANGEABLE_COVERAGE = 0.5

export type DragGroup = DragItem['group']

export function dragGroup(changeability: string): DragGroup {
  if (changeability === 'CHANGEABLE' || changeability === 'FIXED_BUT_VISIBILITY_CHANGEABLE') return 'CHANGEABLE'
  if (changeability === 'SURGICAL_ONLY' || changeability === 'PROFESSIONAL_ONLY') return 'SURGICAL_OR_PROFESSIONAL'
  return 'FIXED'
}

export interface OverallItem {
  metric: Metric
  score: MetricScore
  /** Largest score movement within ± the measurement's uncertainty; null when the uncertainty is unknown. */
  spread: number | null
}

export interface OverallArgs {
  scanId: string
  items: readonly OverallItem[]
  /** metricId → realistic ceiling 0–100 for CAI. Absent ids default to 100 (not personalised yet). */
  ceilings?: Readonly<Record<string, number>>
  /** The catalog to measure coverage against (default: the whole catalog). */
  catalog?: readonly Metric[]
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6
const EPS = 1e-9

export function statusForCoverage(coverage: number): OverallStatus {
  if (coverage >= COVERAGE_FINAL - EPS) return 'FINAL'
  if (coverage >= COVERAGE_PROVISIONAL - EPS) return 'PROVISIONAL'
  return 'NOT_AVAILABLE'
}

export function computeOverall(args: OverallArgs): OverallScore {
  const catalog = args.catalog ?? METRICS
  const included = args.items.filter(
    (it): it is OverallItem & { score: MetricScore & { score: number } } =>
      it.score.score !== null && countsTowardOverall(it.score.confidence.band),
  )

  const scoredWeight = included.reduce((s, it) => s + it.metric.weight, 0)
  const coverage = round6(scoredWeight / totalWeight(catalog))
  const status = statusForCoverage(scoredWeight / totalWeight(catalog))
  const available = status !== 'NOT_AVAILABLE' && scoredWeight > 0

  const weighted = included.reduce((s, it) => s + it.metric.weight * it.score.score, 0)
  const appearance = available ? Math.min(100, Math.floor(weighted / scoredWeight + EPS)) : null

  let band: number | null = null
  if (available && included.every((it) => it.spread !== null)) {
    const moved = included.reduce((s, it) => s + it.metric.weight * it.spread!, 0)
    // Math.max also turns the -0 that ceil returns for a tiny negative into 0.
    band = Math.max(0, Math.ceil((moved / scoredWeight) * 10 - EPS) / 10)
  }

  const pointsLost = { FIXED: 0, SURGICAL_OR_PROFESSIONAL: 0, CHANGEABLE: 0 }
  const drag: DragItem[] = []
  for (const it of included) {
    const lost = (it.metric.weight * (100 - it.score.score)) / 100
    const group = dragGroup(it.metric.changeability)
    pointsLost[group] += lost
    if (lost > EPS) {
      drag.push({ metricId: it.metric.id, name: it.metric.name, pointsLost: round6(lost), changeability: it.metric.changeability, group })
    }
  }
  drag.sort((a, b) => b.pointsLost - a.pointsLost || a.metricId.localeCompare(b.metricId))

  return {
    scanId: args.scanId,
    appearance,
    band,
    coverage,
    status: available ? status : 'NOT_AVAILABLE',
    pointsLost: {
      FIXED: round6(pointsLost.FIXED),
      SURGICAL_OR_PROFESSIONAL: round6(pointsLost.SURGICAL_OR_PROFESSIONAL),
      CHANGEABLE: round6(pointsLost.CHANGEABLE),
    },
    drag,
    cai: computeCai(included, args.ceilings ?? {}, catalog),
    weightsVersion: WEIGHTS_VERSION,
    rulesetVersion: RULESET_VERSION,
  }
}

function computeCai(
  included: readonly (OverallItem & { score: MetricScore & { score: number } })[],
  ceilings: Readonly<Record<string, number>>,
  catalog: readonly Metric[],
): number | null {
  const changeable = included.filter((it) => dragGroup(it.metric.changeability) === 'CHANGEABLE')
  if (changeable.length === 0) return null
  const scoredWeight = changeable.reduce((s, it) => s + it.metric.weight, 0)
  const catalogWeight = totalWeight(catalog.filter(isPlannable))
  if (catalogWeight <= 0 || scoredWeight / catalogWeight < CAI_MIN_CHANGEABLE_COVERAGE - EPS) return null
  let numerator = 0
  let denominator = 0
  for (const it of changeable) {
    const c = ceilings[it.metric.id]
    const ceiling = c !== undefined && Number.isFinite(c) && c > 0 ? Math.min(100, c) : 100
    numerator += it.metric.weight * it.score.score
    denominator += it.metric.weight * ceiling
  }
  return Math.min(100, Math.floor((100 * numerator) / denominator + EPS))
}
