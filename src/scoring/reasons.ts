/**
 * Reason templates (docs/PLAN.md §4.3). A reason is assembled from fixed sentence frames and the measurement's own
 * facts; no part of it is generated. Three lines for a scored metric:
 *
 *   CERVICOMENTAL ANGLE · 131° ±3° · MEDIUM 0.72 (manual points, right profile, 2 placements)
 *   Ideal 105–120° [Ellenbogen & Karlin 1980 – source not verified]. 11° above range → score 38.
 *   CHANGEABLE · evidence MODERATE · weight 2.5 → costs 1.6 overall points.
 *
 * and for a refusal:
 *
 *   FWHR · NOT SCORED
 *   Head pitch +6.1° (limit ±4°). Pitch error exceeds any real change in this metric.
 *   Re-capture frontal neutral: ear canal level with lower eyelid; use the on-screen level line.
 *
 * Inputs are ScoreFacts (or the same fields for an unscored metric) plus the few measurement fields the header
 * needs (method, frame count, confidence parts). Source labels come from the catalog by id; a source that is not
 * verified says "source not verified".
 */
import type { Method } from '../catalog/schema'
import type { ConfidenceBand, OverallScore, ScoreFacts } from '../domain/types'
import type { BaselineDirection } from './functions'
import type { ConfidenceParts } from './confidence'
import {
  CHANGEABILITY_LABELS,
  EVIDENCE_GLOSS,
  GROUP_LABELS,
  METHOD_LABELS,
  UNSCORED_REASON_TEXT,
  amount,
  citeSources,
  fmt,
  fmtCost,
  fmtShare,
  quantity,
  rangeText,
  sentence,
  shortName,
} from './phrasebank'

export interface ReasonConfidence {
  band: ConfidenceBand
  value: number
  parts: ConfidenceParts
}

/** The measurement fields every reason cites. ScoreFacts satisfies this. */
export type ReasonBasis = Pick<ScoreFacts, 'value' | 'unit' | 'uncertainty' | 'shotLabel' | 'sourceIds' | 'weight' | 'evidence' | 'changeability'>

interface ReasonCommon {
  metricName: string
  method: Method
  nFrames: number
  confidence: ReasonConfidence
}

export interface ChecklistDetail {
  passed: number
  total: number
  /** Labels of failed items; critical ones flagged. */
  failed: { label: string; critical: boolean }[]
  cap: number | null
  /** Passed ÷ total × 100 (or the supplied share when only the share is known). */
  share: number
  /** False when only the overall share was supplied. */
  itemsKnown: boolean
}

export type ReasonInput =
  | (ReasonCommon & {
      kind: 'scored'
      facts: ScoreFacts
      score: number
      /** Set for personal_baseline: the baseline used, the direction, and whether a norm anchor also applied. */
      baseline?: { value: number; direction: BaselineDirection; anchored: boolean }
      checklist?: ChecklistDetail
      percentile?: { value: number; population: string; direction: 'higher_better' | 'lower_better' }
    })
  | (ReasonCommon & { kind: 'baseline_set'; basis: ReasonBasis; stored: boolean })
  | (ReasonCommon & { kind: 'unscored'; basis: ReasonBasis; cause: string })

export interface RefusalInput {
  metricName: string
  shotLabel: string
  reasons: readonly string[]
  recapture: readonly string[]
}

// ───────────────────────────── pieces ─────────────────────────────

const PHOTO_METHODS: ReadonlySet<Method> = new Set<Method>([
  'AUTO_FRONTAL_PHOTO',
  'AUTO_PROFILE_PHOTO',
  'POSE_MODEL_PHOTO',
  'SEGMENTATION_PHOTO',
  'COLOR_CALIBRATED_PHOTO',
  'VIDEO_ANALYSIS',
])
const SELF_METHODS: ReadonlySet<Method> = new Set<Method>(['SELF_GRADE_REFERENCE', 'CHECKLIST', 'MANUAL_INPUT', 'HABIT_LOG'])

function countText(method: Method, n: number): string | null {
  if (SELF_METHODS.has(method) || n < 1) return null
  const noun = PHOTO_METHODS.has(method) ? 'frame' : method === 'MANUAL_LANDMARKS' || method === 'TAP_COUNT_ON_PHOTO' ? 'placement' : 'reading'
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function header(c: ReasonCommon, basis: ReasonBasis): string {
  const how = [METHOD_LABELS[c.method], basis.shotLabel, countText(c.method, c.nFrames)].filter((p): p is string => p !== null && p !== '')
  const conf = `${c.confidence.band} ${c.confidence.value.toFixed(2)}`
  return `${shortName(c.metricName)} · ${quantity(basis.value, basis.uncertainty, basis.unit)} · ${conf} (${how.join(', ')})`
}

function evidenceText(evidence: string): string {
  const gloss = EVIDENCE_GLOSS[evidence]
  return gloss ? `evidence ${evidence} (${gloss})` : `evidence ${evidence}`
}

function changeText(changeability: string): string {
  return CHANGEABILITY_LABELS[changeability] ?? changeability.replace(/_/g, ' ')
}

function classification(basis: ReasonBasis, tail: string): string {
  return `${changeText(basis.changeability)} · ${evidenceText(basis.evidence)} · weight ${fmt(basis.weight)} → ${tail}`
}

function confidenceParts(c: ReasonConfidence): string {
  const p = c.parts
  const capNote = p.cappedAtMedium ? ', capped below HIGH for self-report' : ''
  return `method ${p.method.toFixed(2)} × photo ${p.photo.toFixed(2)} × repeatability ${p.repeatability.toFixed(2)} = ${c.value.toFixed(2)}${capNote}`
}

function stripParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function directionText(direction: BaselineDirection): string {
  if (direction === 'lower_better') return 'lower is better'
  if (direction === 'higher_better') return 'higher is better'
  return 'deviation either way counts'
}

/** "11° above range", "inside the ideal band". Direction is read from the value against the band ends. */
function gapText(facts: ScoreFacts): string {
  if (facts.gap === null) return `No ideal band applies, so the lookup table is read at ${amount(facts.value, facts.unit)}`
  if (facts.gap === 0) return 'Inside the ideal band'
  const below = facts.idealLo !== null && facts.value < facts.idealLo
  return `${amount(facts.gap, facts.unit)} ${below ? 'below' : 'above'} range`
}

function checklistText(detail: ChecklistDetail): string {
  if (!detail.itemsKnown) {
    if (detail.cap === null) return `All checks passed (share ${fmt(detail.share)}%)`
    return `${fmt(detail.share)}% of checks passed. Per-item results were not supplied and a critical failure cannot be ruled out, so the score is capped at ${fmt(detail.cap)}`
  }
  const base = `${detail.passed} of ${detail.total} checks passed`
  if (detail.failed.length === 0) return base
  const failed = detail.failed.map((f) => `${stripParenthetical(f.label)}${f.critical ? ' (critical)' : ''}`).join('; ')
  const cap = detail.cap === null ? '' : `; a critical check failed, so the score is capped at ${fmt(detail.cap)}`
  return `${base}; failed: ${failed}${cap}`
}

function scoredMiddle(input: Extract<ReasonInput, { kind: 'scored' }>): string {
  const { facts, score } = input
  const cite = citeSources(facts.sourceIds)
  if (input.checklist) {
    const ideal = facts.idealLo !== null || facts.idealHi !== null ? `Ideal ${rangeText(facts.idealLo, facts.idealHi, facts.unit)} ${cite}. ` : `${cite} `
    return `${ideal}${checklistText(input.checklist)} → score ${score}.`
  }
  if (input.percentile) {
    const p = input.percentile
    return `Rank: percentile ${fmt(p.value)} among ${p.population} ${cite}. ${p.direction === 'higher_better' ? 'Higher is better' : 'Lower is better'} → score ${score}.`
  }
  if (input.baseline) {
    const b = input.baseline
    const worse = facts.gap === null || facts.gap === 0
      ? 'No change for the worse'
      : `${amount(facts.gap, facts.unit)} ${b.direction === 'target_range' ? 'away from baseline' : 'worse than baseline'}`
    if (b.anchored) {
      return `Norm anchor: ideal ${rangeText(facts.idealLo, facts.idealHi, facts.unit)} ${cite}. Your own baseline is ${amount(b.value, facts.unit)} (${directionText(b.direction)}); the lower of the two scores applies. ${gapText(facts)} → score ${score}.`
    }
    return `Reference: your own baseline ${amount(b.value, facts.unit)} (${directionText(b.direction)}); no population norm exists for this index ${cite}. ${worse} → score ${score}.`
  }
  return `Ideal ${rangeText(facts.idealLo, facts.idealHi, facts.unit)} ${cite}. ${gapText(facts)} → score ${score}.`
}

// ───────────────────────────── public renderers ─────────────────────────────

export function renderReason(input: ReasonInput): string {
  if (input.kind === 'scored') {
    const { facts } = input
    const lines = [header(input, facts), scoredMiddle(input)]
    if (input.confidence.band === 'LOW') {
      lines.push(`WARNING · LOW confidence (${confidenceParts(input.confidence)}): shown for reference, left out of the overall score.`)
      lines.push(classification(facts, `would cost ${fmtCost(facts.pointsLost)} overall points if it counted.`))
    } else {
      lines.push(classification(facts, `costs ${fmtCost(facts.pointsLost)} overall points.`))
    }
    return lines.join('\n')
  }

  if (input.kind === 'baseline_set') {
    const { basis } = input
    const lines = [header(input, basis)]
    if (input.stored) {
      lines.push(
        `BASELINE SET · NOT SCORED. This first measurement becomes your personal baseline: ${amount(basis.value, basis.unit)}. No population norm exists for this index, so scoring starts on the next scan. ${citeSources(basis.sourceIds)}`,
      )
    } else {
      lines.push(
        `NOT SCORED · LOW confidence (${confidenceParts(input.confidence)}) is too weak to set a personal baseline. Nothing was stored; re-scan under the capture protocol.`,
      )
    }
    lines.push(classification(basis, 'not counted in the overall until it is scored.'))
    return lines.join('\n')
  }

  const { basis } = input
  const why = UNSCORED_REASON_TEXT[input.cause] ?? 'it has no scoring rule'
  const cost = basis.weight > 0 ? 'left out of the overall score.' : 'costs no overall points.'
  return [
    header(input, basis),
    `NOT SCORED · ${why}. ${citeSources(basis.sourceIds)}`,
    classification(basis, cost),
  ].join('\n')
}

export function renderRefusal(input: RefusalInput): string {
  const lines = [`${shortName(input.metricName)} · NOT SCORED`]
  for (const reason of input.reasons) lines.push(sentence(reason))
  if (input.recapture.length > 0) lines.push(sentence(`Re-capture ${input.shotLabel}: ${input.recapture.map((r) => r.trim().replace(/[.;]$/, '')).join('; ')}`))
  return lines.join('\n')
}

/** Refusal text for a metric whose confidence fell under 0.40 without an explicit refusal from the measurement. */
export function lowConfidenceRefusal(confidence: ReasonConfidence): { reasons: string[]; recapture: string[] } {
  return {
    reasons: [
      `Confidence ${confidence.value.toFixed(2)} is under the 0.40 floor (${confidenceParts(confidence)}). A number at this confidence would be noise`,
    ],
    recapture: ['follow the capture protocol: 1.5 m distance, window light, grey card in frame, head level, neutral face'],
  }
}

/** Refusal text for a measurement that has no value and no stated refusal. */
export function missingValueRefusal(): { reasons: string[]; recapture: string[] } {
  return {
    reasons: ['No value was measured for this metric'],
    recapture: ['repeat the capture; the app cannot score a metric without a measured value'],
  }
}

// ───────────────────────────── overall summary ─────────────────────────────

export const CAI_CEILING_NOTE = 'Ceilings are not personalised yet: every ceiling is taken as 100, so CAI is provisional.'

/** Plain lines for the report header. Built only from the OverallScore fields. */
export function renderOverallSummary(overall: OverallScore): string[] {
  const lines: string[] = []
  const coverage = `${fmtShare(overall.coverage)}%`
  if (overall.status === 'NOT_AVAILABLE' || overall.appearance === null) {
    lines.push('OVERALL · NOT AVAILABLE')
    lines.push(`Only ${coverage} of the total weight was scored this scan. At least 50% is needed for an overall number, so none is shown.`)
  } else {
    const band = overall.band === null ? '' : ` ±${fmt(overall.band)}`
    lines.push(`OVERALL · ${overall.appearance}${band} · ${overall.status}`)
    lines.push(
      overall.status === 'FINAL'
        ? `Coverage ${coverage} of the total weight (75% or more).`
        : `Coverage ${coverage} of the total weight. Below 75% the score is provisional.`,
    )
  }
  const lost = overall.pointsLost
  lines.push(
    `Points lost: ${GROUP_LABELS.CHANGEABLE} ${fmtCost(lost.CHANGEABLE)} · ${GROUP_LABELS.FIXED} ${fmtCost(lost.FIXED)} · ${GROUP_LABELS.SURGICAL_OR_PROFESSIONAL} ${fmtCost(lost.SURGICAL_OR_PROFESSIONAL)}.`,
  )
  for (const item of overall.drag.slice(0, 3)) {
    lines.push(`Drag: ${shortName(item.name)} costs ${fmtCost(item.pointsLost)} points (${GROUP_LABELS[item.group]}).`)
  }
  lines.push(
    overall.cai === null
      ? 'CAI not available: too little of the changeable weight was scored this scan (at least 50% is needed).'
      : `CAI ${overall.cai}%. ${CAI_CEILING_NOTE}`,
  )
  lines.push(`Weights ${overall.weightsVersion}, ruleset ${overall.rulesetVersion}. Weights are evidence-informed judgement, not a validated model.`)
  return lines
}
