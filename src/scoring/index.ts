/**
 * Scoring engine – public surface. See docs/PLAN.md §2–4.
 *
 *   scoreMetric(measurement, ctx)  → one MetricScore (+ a baseline to store on a first scan)
 *   scoreScan({ … })               → every MetricScore, the OverallScore, and the baselines to store
 *   confidenceFor / renderReason / renderRefusal / lintTone are exported for the report UI and for tests.
 */
export { RULESET_VERSION } from './functions'
export { WEIGHTS_VERSION, computeOverall, dragGroup, statusForCoverage } from './overall'
export type { OverallArgs, OverallItem } from './overall'
export { scoreMetric, scoreScan, evaluateMeasurement, assertScoreInvariant } from './engine'
export type { BaselineToStore, Evaluation, ScoreContext } from './engine'
export { confidenceFor, confidenceBreakdown, bandForValue, countsTowardOverall, METHOD_BASE } from './confidence'
export type { ConfidenceBreakdown, ConfidenceParts } from './confidence'
export { renderReason, renderRefusal, renderOverallSummary, CAI_CEILING_NOTE } from './reasons'
export type { ChecklistDetail, ReasonBasis, ReasonConfidence, ReasonInput, RefusalInput } from './reasons'
export { lintTone } from './toneLint'
export {
  truncateScore,
  rangeScoreRaw,
  oneSidedScoreRaw,
  personalBaselineScoreRaw,
  checklistScoreRaw,
  percentileScoreRaw,
} from './functions'
