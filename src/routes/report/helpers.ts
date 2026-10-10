/**
 * Pure view-model for the scan history (#/scans) and the scan report (#/scans/:id). No React, no I/O.
 *
 * Nothing here scores or measures anything. Every number comes from the stored bundle (scores, facts, measurements,
 * overall); the catalog only supplies names, links and the fixed labels around them. Text that the scoring engine
 * stored (reasons, refusals) is passed through unchanged.
 */
import { METRICS, getMetric, totalWeight } from '../../catalog'
import { CATEGORY_IDS } from '../../catalog/schema'
import type { CategoryId, Changeability, Evidence, ShotType } from '../../catalog/schema'
import type {
  ConfidenceBand,
  DragItem,
  Measurement,
  MetricScore,
  OverallScore,
  OverallStatus,
  PhotoRecord,
  QcCheck,
  ScanKind,
  ScanRecord,
} from '../../domain/types'
import { formatDateTime, plural } from '../../ui/format'
import { CATEGORY_LABEL } from '../catalog/helpers'
import { COPY } from './copy'

/** The overall score needs this share of the total weight (docs/PLAN.md section 4.4). */
export const MIN_OVERALL_COVERAGE = 0.5
/** From this share up the overall score is FINAL; below it, PROVISIONAL. */
export const FINAL_COVERAGE = 0.75

const EPS = 1e-9

// ───────────────────────────── number formatting ─────────────────────────────

/** Display precision by magnitude (131, 11.5, 1.92, 0.043), trailing zeros dropped. Same convention as stored reasons. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return 'n/a'
  const a = Math.abs(n)
  const dp = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3
  const rounded = Number(n.toFixed(dp))
  if (rounded === 0 && n !== 0) return n.toPrecision(1)
  return String(rounded)
}

const hasUnit = (unit: string): boolean => {
  const u = unit.trim().toLowerCase()
  return u !== '' && u !== 'n/a'
}

/** "11°", "1.1% of pupil distance", "0.21 ratio". */
export function formatAmount(n: number, unit: string): string {
  if (!hasUnit(unit)) return fmt(n)
  if (unit.startsWith('°')) return `${fmt(n)}°`
  if (unit.startsWith('%')) return `${fmt(n)}%${unit.slice(1)}`
  return `${fmt(n)} ${unit}`
}

/** "131° ± 3°", "4.1% ± 0.6% of pupil distance", "1.92 ± 0.04 ratio". An unknown uncertainty is said, not hidden. */
export function formatQuantity(value: number, uncertainty: number | null, unit: string): string {
  const u = uncertainty === null ? null : Math.abs(uncertainty)
  if (u === null) return `${formatAmount(value, unit)} (uncertainty unknown)`
  if (!hasUnit(unit)) return `${fmt(value)} ± ${fmt(u)}`
  if (unit.startsWith('°')) return `${fmt(value)}° ± ${fmt(u)}°`
  if (unit.startsWith('%')) return `${fmt(value)}% ± ${fmt(u)}%${unit.slice(1)}`
  return `${fmt(value)} ± ${fmt(u)} ${unit}`
}

/** A score is truncated, never rounded up. */
export function formatScore(score: number): string {
  return String(Math.min(100, Math.max(0, Math.trunc(score + EPS))))
}

/** Whole-number percentage of a 0 to 1 share, truncated: 0.178 reads "17%". */
export function formatShare(share: number): string {
  return `${Math.floor(Math.max(0, share) * 100 + EPS)}%`
}

/** Points lost are rounded UP to 0.1, so a cost is never understated. */
export function formatPoints(points: number): string {
  if (!(points > EPS)) return '0'
  return String(Math.ceil(points * 10 - EPS) / 10)
}

export const formatWeight = fmt

// ───────────────────────────── labels ─────────────────────────────

export const KIND_LABEL: Record<ScanKind, string> = {
  quick: 'Quick scan',
  weekly: 'Weekly scan',
  calibration: 'Calibration scan',
  monthly: 'Monthly scan',
}

export const SHOT_LABEL: Partial<Record<ShotType, string>> = {
  frontal_neutral: 'Frontal neutral',
  frontal_smile: 'Frontal smile',
  three_quarter_left: 'Left three-quarter',
  three_quarter_right: 'Right three-quarter',
  profile_left: 'Left profile',
  profile_right: 'Right profile',
  hairline_front: 'Hairline',
  crown_top: 'Crown from above',
  hair_natural: 'Natural hair',
  skin_zones: 'Skin zones',
  skin_sidelight: 'Side-lit skin',
  eye_closeup: 'Eye close-up',
  teeth_closeup: 'Teeth close-up',
  body_front: 'Body front',
  body_side: 'Body side',
  body_back: 'Body back',
  outfit: 'Outfit',
}

export function shotLabel(shot: string): string {
  return SHOT_LABEL[shot as ShotType] ?? shot.replace(/_/g, ' ')
}

const GROUP_LABEL: Record<DragItem['group'], string> = {
  FIXED: 'Fixed',
  SURGICAL_OR_PROFESSIONAL: 'Surgical or professional',
  CHANGEABLE: 'Changeable',
}

const CHANGEABILITY_TEXT: Record<string, string> = {
  FIXED: 'Fixed',
  CHANGEABLE: 'Changeable',
  SURGICAL_ONLY: 'Surgical only',
  PROFESSIONAL_ONLY: 'Professional only',
  FIXED_BUT_VISIBILITY_CHANGEABLE: 'Fixed, visibility changeable',
}

export function changeabilityText(changeability: string): string {
  return CHANGEABILITY_TEXT[changeability] ?? changeability.replace(/_/g, ' ').toLowerCase()
}

/** Fixed, surgical-only and professional-only traits are rated honestly and never planned around. */
const NOT_IN_PLAN: Partial<Record<string, string>> = {
  FIXED: 'Fixed – not in the action plan',
  SURGICAL_ONLY: 'Surgical only – not in the action plan',
  PROFESSIONAL_ONLY: 'Professional only – not in the action plan',
}

export function planNote(changeability: string | null): string | null {
  return changeability === null ? null : (NOT_IN_PLAN[changeability] ?? null)
}

/** The catalog name without its trailing explanatory parenthetical: "Facial symmetry (left-right mismatch)" becomes "Facial symmetry". */
export function plainName(name: string): string {
  const stripped = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return stripped === '' ? name : stripped
}

const sentenceCase = (text: string): string => {
  const t = text.trim().replace(/[.;]+$/, '')
  return t === '' ? '' : `${t[0]!.toUpperCase()}${t.slice(1)}.`
}

// ───────────────────────────── metric cards ─────────────────────────────

export type CardKind = 'scored' | 'refused' | 'baseline_set' | 'unscored'

export interface MetricCard {
  metricId: string
  name: string
  inCatalog: boolean
  category: CategoryId | null
  /** Shot the metric is read from, e.g. "Frontal neutral". */
  shotText: string | null
  kind: CardKind
  /** Weight 0, pseudoscience and myth metrics: shown, but visually secondary. */
  secondary: boolean
  /** The plain flag that goes with a secondary card. */
  flag: string | null
  /** One or two words for the collapsed summary: "Pseudoscience", "Myth", "Weight 0". */
  flagShort: string | null
  /** "score 46", "refused", "baseline set", "not scored". */
  statusShort: string
  score: number | null
  scoreText: string | null
  /** "131° ± 3°" – the measured value with its uncertainty and unit. */
  valueText: string | null
  band: ConfidenceBand | null
  confidenceValueText: string | null
  /** HIGH or MEDIUM and scored: counted in the overall score. */
  countsInOverall: boolean
  lowConfidence: boolean
  /** Exactly as stored. */
  reason: string
  refusalReasons: string[]
  recapture: string[]
  weight: number | null
  weightText: string | null
  pointsLost: number | null
  pointsLostText: string | null
  evidence: Evidence | null
  changeability: Changeability | null
  /** "Fixed – not in the action plan" for fixed, surgical-only and professional-only metrics. */
  planNote: string | null
  baselineNote: string | null
  /** Set when a stored record breaks the "no score without a reason" rule; the number is then hidden. */
  integrityNote: string | null
  /** Route of the metric's catalog page; null when this build's catalog does not know the id. */
  linkTo: string | null
}

export interface CardInput {
  measurements: readonly Measurement[]
  scores: readonly MetricScore[]
  /** The baselines this scan established. */
  baselinesToStore: readonly { metricId: string }[]
}

/** The stored refusal text when the measurement itself carries no structured refusal (a low-confidence refusal). */
export function parseRefusalText(reason: string): { reasons: string[]; recapture: string[] } {
  const reasons: string[] = []
  const recapture: string[] = []
  const lines = reason
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  lines.forEach((line, i) => {
    if (i === 0 && /NOT SCORED/i.test(line)) return
    if (/^re-capture\b/i.test(line)) {
      const colon = line.indexOf(':')
      const body = colon >= 0 ? line.slice(colon + 1) : line.replace(/^re-capture\s*/i, '')
      for (const step of body.split(';')) {
        const text = sentenceCase(step)
        if (text !== '') recapture.push(text)
      }
      return
    }
    reasons.push(sentenceCase(line))
  })
  return { reasons, recapture }
}

function flagShortFor(evidence: Evidence | null, weight: number | null): string | null {
  if (evidence === 'MYTH') return 'Myth'
  if (evidence === 'PSEUDOSCIENCE') return 'Pseudoscience'
  return weight === 0 ? 'Weight 0' : null
}

const STATUS_SHORT: Record<CardKind, string> = { scored: 'score', refused: 'refused', baseline_set: 'baseline set', unscored: 'not scored' }

function flagFor(evidence: Evidence | null, weight: number | null): string | null {
  if (evidence === 'MYTH') return 'Myth: contradicted by research. It never counts toward any score.'
  if (evidence === 'PSEUDOSCIENCE') {
    return weight === null || weight === 0
      ? 'Pseudoscience: a popular claim with no research support. Weight 0, so it cannot change the overall score.'
      : `Pseudoscience: a popular claim with no research support. Weight ${formatWeight(weight)} of 100.`
  }
  if (weight === 0) return 'Weight 0: shown for information. It cannot change the overall score.'
  return null
}

function cardFor(metricId: string, measurement: Measurement | undefined, score: MetricScore | undefined, baselineSet: boolean): MetricCard {
  const metric = getMetric(metricId)
  const facts = score?.facts ?? null
  const reason = score?.reason ?? ''
  const hasNumber = score !== undefined && score.score !== null
  // The store rejects this; a hand-edited or damaged record must still not surface a bare number.
  const sound = hasNumber && facts !== null && reason.trim() !== ''
  const integrityNote = hasNumber && !sound ? COPY.integrityNote : null

  const measurementRefused = measurement !== undefined && (measurement.refusal !== undefined || measurement.value === null)
  const refused = !hasNumber && (score?.confidence.band === 'REFUSED' || measurementRefused)

  let kind: CardKind
  if (sound) kind = 'scored'
  else if (refused) kind = 'refused'
  else if (baselineSet) kind = 'baseline_set'
  else kind = 'unscored'

  const evidence = ((facts?.evidence ?? metric?.evidence) as Evidence | undefined) ?? null
  const changeability = ((facts?.changeability ?? metric?.changeability) as Changeability | undefined) ?? null
  const weight = facts?.weight ?? metric?.weight ?? null
  const flag = flagFor(evidence, weight)

  const band = score?.confidence.band ?? null
  const scoredNumber = sound ? Math.trunc(score!.score! + EPS) : null

  // A refused metric shows no number at all: its value is below the confidence floor or a hard QC check failed.
  let valueText: string | null = null
  if (sound) valueText = formatQuantity(facts!.value, facts!.uncertainty, facts!.unit)
  else if (kind !== 'refused' && measurement && measurement.value !== null && measurement.refusal === undefined) {
    valueText = formatQuantity(measurement.value, measurement.uncertainty, measurement.unit)
  }

  let refusalReasons: string[] = []
  let recapture: string[] = []
  if (kind === 'refused') {
    const parsed = parseRefusalText(reason)
    refusalReasons = (measurement?.refusal?.reasons ?? parsed.reasons).map(sentenceCase).filter((s) => s !== '')
    recapture = (measurement?.refusal?.recapture ?? parsed.recapture).map(sentenceCase).filter((s) => s !== '')
  }

  const lowConfidence = sound && band === 'LOW'
  const countsInOverall = sound && (band === 'HIGH' || band === 'MEDIUM')
  const category = metric?.category ?? null

  return {
    metricId,
    name: metric?.name ?? metricId,
    inCatalog: metric !== undefined,
    category,
    shotText: metric ? shotLabel(metric.captureRequirements[0] ?? 'frontal_neutral') : null,
    kind,
    secondary: flag !== null,
    flag,
    flagShort: flagShortFor(evidence, weight),
    statusShort: kind === 'scored' ? `score ${formatScore(scoredNumber!)}` : STATUS_SHORT[kind],
    score: scoredNumber,
    scoreText: scoredNumber === null ? null : formatScore(scoredNumber),
    valueText,
    band,
    confidenceValueText: score ? score.confidence.value.toFixed(2) : null,
    countsInOverall,
    lowConfidence,
    reason: !score ? COPY.noScoreRecord : reason.trim() === '' ? 'No reason was stored with this record.' : reason,
    refusalReasons,
    recapture,
    weight,
    weightText: weight === null ? null : formatWeight(weight),
    pointsLost: sound ? facts!.pointsLost : null,
    pointsLostText: sound ? formatPoints(facts!.pointsLost) : null,
    evidence,
    changeability,
    planNote: planNote(changeability),
    baselineNote: kind === 'baseline_set' ? COPY.baselineNote : null,
    integrityNote,
    linkTo: metric ? `/metrics/${metric.id}` : null,
  }
}

const categoryRank = (card: MetricCard): number => (card.category === null ? CATEGORY_IDS.length : CATEGORY_IDS.indexOf(card.category))

function compareCards(a: MetricCard, b: MetricCard): number {
  return (
    categoryRank(a) - categoryRank(b) ||
    Number(a.secondary) - Number(b.secondary) ||
    (a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0)
  )
}

/** One card per metric id found in the measurements or the scores, in report order. */
export function buildCards(input: CardInput): MetricCard[] {
  const measurements = new Map(input.measurements.map((m) => [m.metricId, m]))
  const scores = new Map(input.scores.map((s) => [s.metricId, s]))
  const baselines = new Set(input.baselinesToStore.map((b) => b.metricId))
  const ids = new Set([...measurements.keys(), ...scores.keys()])
  return [...ids].map((id) => cardFor(id, measurements.get(id), scores.get(id), baselines.has(id))).sort(compareCards)
}

export interface CardGroup {
  category: CategoryId | null
  label: string
  cards: MetricCard[]
}

export function groupCards(cards: readonly MetricCard[]): CardGroup[] {
  const groups: CardGroup[] = []
  for (const card of cards) {
    const last = groups[groups.length - 1]
    if (last && last.category === card.category) last.cards.push(card)
    else groups.push({ category: card.category, label: card.category ? CATEGORY_LABEL[card.category] : 'Not in this catalog', cards: [card] })
  }
  return groups
}

export interface Tally {
  total: number
  scored: number
  counted: number
  low: number
  refused: number
  baselineSet: number
  unscored: number
}

export function tallyCards(cards: readonly MetricCard[]): Tally {
  const count = (pred: (c: MetricCard) => boolean) => cards.filter(pred).length
  return {
    total: cards.length,
    scored: count((c) => c.kind === 'scored'),
    counted: count((c) => c.countsInOverall),
    low: count((c) => c.lowConfidence),
    refused: count((c) => c.kind === 'refused'),
    baselineSet: count((c) => c.kind === 'baseline_set'),
    unscored: count((c) => c.kind === 'unscored'),
  }
}

export function tallyText(t: Tally): string {
  if (t.total === 0) return COPY.metricsNone
  const parts = [`${t.scored} scored`]
  if (t.scored > 0) parts[0] += ` (${t.counted} counted in the overall${t.low > 0 ? `, ${t.low} LOW confidence and left out` : ''})`
  if (t.refused > 0) parts.push(`${t.refused} refused`)
  if (t.baselineSet > 0) parts.push(`${t.baselineSet} ${plural(t.baselineSet, 'baseline')} set`)
  if (t.unscored > 0) parts.push(`${t.unscored} not scored`)
  return `${t.total} ${plural(t.total, 'metric')} in this scan: ${parts.join(', ')}.`
}

// ───────────────────────────── re-capture summary ─────────────────────────────

export interface RecaptureStep {
  text: string
  metricIds: string[]
  metricNames: string[]
}

export interface RecaptureGroup {
  key: string
  label: string
  steps: RecaptureStep[]
}

/** Refused metrics worth a re-capture: the ones that carry weight. */
export function actionableRefusals(cards: readonly MetricCard[]): MetricCard[] {
  return cards.filter((c) => c.kind === 'refused' && !c.secondary)
}

/** Refused metrics that carry no weight (pseudoscience, myth, weight 0). A re-capture only for these changes nothing. */
export function ignorableRefusals(cards: readonly MetricCard[]): MetricCard[] {
  return cards.filter((c) => c.kind === 'refused' && c.secondary)
}

const stepKey = (text: string): string => text.toLowerCase().replace(/[.;\s]+$/g, '').replace(/\s+/g, ' ').trim()

/**
 * Refused metrics that carry weight, grouped by the shot they are read from. Identical instructions are listed once with the metrics
 * they unblock, so ten refusals that all say "hold the head level" read as one line.
 */
export function buildRecapture(cards: readonly MetricCard[]): RecaptureGroup[] {
  const groups = new Map<string, RecaptureGroup & { seen: Map<string, RecaptureStep> }>()
  for (const card of actionableRefusals(cards)) {
    const steps = card.recapture.length > 0 ? card.recapture : ['Repeat the capture under the capture protocol.']
    const label = card.shotText ?? 'Photo'
    let group = groups.get(label)
    if (!group) {
      group = { key: label, label, steps: [], seen: new Map() }
      groups.set(label, group)
    }
    for (const text of steps) {
      const key = stepKey(text)
      let step = group.seen.get(key)
      if (!step) {
        step = { text, metricIds: [], metricNames: [] }
        group.seen.set(key, step)
        group.steps.push(step)
      }
      if (!step.metricIds.includes(card.metricId)) {
        step.metricIds.push(card.metricId)
        step.metricNames.push(plainName(card.name))
      }
    }
  }
  return [...groups.values()].map(({ key, label, steps }) => ({ key, label, steps }))
}

// ───────────────────────────── overall block ─────────────────────────────

export interface OverallView {
  status: OverallStatus
  /** True only when the bundle holds a number and its status allows showing it. */
  available: boolean
  headline: string
  /** "62" – null unless available. */
  numberText: string | null
  /** "± 3.1" – null unless the bundle carries a band. */
  bandText: string | null
  tag: 'PROVISIONAL' | 'FINAL' | null
  coveragePct: number
  coverageText: string
  /** Plain paragraphs: why the score is (not) available. */
  explanation: string[]
  caiText: string
  weightsText: string
}

/**
 * Share of the total weight that belongs to the metrics this scan tried to measure (scored, refused or unscored).
 * It is the most the overall coverage could have reached with this build.
 */
export function attemptedShare(measurements: readonly Pick<Measurement, 'metricId'>[]): number {
  const ids = new Set(measurements.map((m) => m.metricId))
  const weight = METRICS.filter((m) => ids.has(m.id)).reduce((s, m) => s + m.weight, 0)
  const total = totalWeight()
  return total > 0 ? weight / total : 0
}

export interface OverallContext {
  /** Share of the total weight this scan tried to measure (see attemptedShare). */
  attempted?: number | null
  /** Card counts of the same scan: says what was left out of the coverage. */
  tally?: Tally
}

/** What did not count toward this scan's coverage, in words. Empty when everything measured was scored. */
export function leftOutText(tally: Tally): string | null {
  const parts: string[] = []
  if (tally.refused > 0) parts.push(`${tally.refused} refused`)
  if (tally.low > 0) parts.push(`${tally.low} LOW confidence`)
  if (tally.baselineSet > 0) parts.push(`${tally.baselineSet} ${plural(tally.baselineSet, 'baseline')} set (scored from the next scan)`)
  return parts.length === 0 ? null : `Left out of the coverage: ${parts.join(', ')}.`
}

export function buildOverallView(overall: OverallScore, context: OverallContext = {}): OverallView {
  const attempted = context.attempted ?? null
  const available = overall.status !== 'NOT_AVAILABLE' && overall.appearance !== null
  const coverage = formatShare(overall.coverage)
  const need = formatShare(MIN_OVERALL_COVERAGE)
  const explanation: string[] = []

  if (!available) {
    explanation.push(COPY.overallNotAvailableWhy)
    if (attempted !== null && attempted < MIN_OVERALL_COVERAGE - EPS) {
      explanation.push(
        `${COPY.overallBuildScope} The metrics this build measures carry ${formatShare(attempted)} of the total weight at most, below the ${need} needed.`,
      )
    } else {
      explanation.push(
        'Too little of the measured weight could be scored: refused metrics and LOW confidence metrics are left out. Fix what the re-capture list says and scan again.',
      )
    }
  } else if (overall.status === 'PROVISIONAL') {
    explanation.push(COPY.overallProvisionalNote)
  }
  const leftOut = context.tally ? leftOutText(context.tally) : null
  if (leftOut) explanation.push(leftOut)
  explanation.push(COPY.overallWeightsNote)

  return {
    status: overall.status,
    available,
    headline: available ? `Overall score: ${formatScore(overall.appearance!)}` : COPY.overallNotAvailable,
    numberText: available ? formatScore(overall.appearance!) : null,
    bandText: available && overall.band !== null ? `± ${fmt(overall.band)}` : null,
    tag: available ? (overall.status === 'PROVISIONAL' ? 'PROVISIONAL' : 'FINAL') : null,
    coveragePct: Math.floor(Math.max(0, Math.min(1, overall.coverage)) * 100 + EPS),
    coverageText: `${coverage} of the score is measurable from this scan, ${need} is needed.`,
    explanation,
    caiText: overall.cai === null ? `CAI: ${COPY.caiUnavailable}.` : `CAI: ${Math.trunc(overall.cai)}% – ${COPY.caiProvisional}.`,
    weightsText: `Weights ${overall.weightsVersion}, ruleset ${overall.rulesetVersion}.`,
  }
}

// ───────────────────────────── drag chart ─────────────────────────────

export interface DragBar {
  group: DragItem['group']
  label: string
  points: number
  pointsText: string
  /** 0 to 100, relative to the largest group. */
  widthPct: number
}

export interface DragRow {
  metricId: string
  name: string
  pointsText: string
  groupLabel: string
  changeabilityLabel: string
  /** The card exists on this report, so a jump button makes sense. */
  hasCard: boolean
}

export interface DragModel {
  /** False when nothing was scored with HIGH or MEDIUM confidence: there is nothing to chart. */
  show: boolean
  bars: DragBar[]
  top: DragRow[]
  totalText: string
  /** The text alternative for the chart. */
  description: string
}

const DRAG_GROUPS: readonly DragItem['group'][] = ['FIXED', 'SURGICAL_OR_PROFESSIONAL', 'CHANGEABLE']
const TOP_DRAGS = 5

export function buildDragModel(overall: OverallScore, cards: readonly MetricCard[]): DragModel {
  const show = cards.some((c) => c.countsInOverall)
  const lost = overall.pointsLost
  const max = Math.max(...DRAG_GROUPS.map((g) => lost[g]), 0)
  const bars: DragBar[] = DRAG_GROUPS.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    points: lost[group],
    pointsText: formatPoints(lost[group]),
    widthPct: max > EPS && lost[group] > EPS ? Math.max(2, (lost[group] / max) * 100) : 0,
  }))
  const cardIds = new Set(cards.map((c) => c.metricId))
  const top: DragRow[] = overall.drag.slice(0, TOP_DRAGS).map((d) => ({
    metricId: d.metricId,
    name: plainName(d.name),
    pointsText: formatPoints(d.pointsLost),
    groupLabel: GROUP_LABEL[d.group],
    changeabilityLabel: changeabilityText(d.changeability),
    hasCard: cardIds.has(d.metricId),
  }))
  const total = DRAG_GROUPS.reduce((s, g) => s + lost[g], 0)
  const description =
    `Points lost out of 100. ${bars.map((b) => `${b.label}: ${b.pointsText}`).join('. ')}.` +
    (top.length > 0 ? ` Biggest drags: ${top.map((t) => `${t.name}, ${t.pointsText} points, ${t.groupLabel.toLowerCase()}`).join('; ')}.` : '')
  return { show, bars, top, totalText: `${formatPoints(total)} points lost in total`, description }
}

// ───────────────────────────── photos ─────────────────────────────

const CHECK_LABEL: Record<QcCheck['id'], string> = {
  face: 'Face found',
  yaw: 'Head turn',
  roll: 'Head tilt',
  pitch: 'Head pitch',
  distance: 'Distance',
  centered: 'Face position',
  sharpness: 'Sharpness',
  exposure: 'Exposure',
  expression: 'Expression',
  lighting: 'Even light',
  steady: 'Steadiness',
}

export interface PhotoCheckView {
  id: string
  label: string
  ok: boolean
  limit: string
  hint: string
}

export interface PhotoView {
  id: string
  shot: string
  shotLabel: string
  sizeText: string
  verdict: 'pass' | 'issues' | 'fail'
  verdictText: string
  /** Failed checks only, each with the instruction that fixes it. */
  issues: PhotoCheckView[]
  checks: PhotoCheckView[]
  facts: string[]
  alt: string
}

export function describePhoto(photo: Pick<PhotoRecord, 'id' | 'shot' | 'width' | 'height' | 'qc'>): PhotoView {
  const { qc } = photo
  const checks: PhotoCheckView[] = qc.checks.map((c) => ({
    id: c.id,
    label: CHECK_LABEL[c.id] ?? c.id,
    ok: c.ok,
    limit: c.limit,
    hint: c.hint,
  }))
  const issues = checks.filter((c) => !c.ok)
  const kept = `${qc.framesKept} of ${qc.framesTried} ${plural(qc.framesTried, 'frame')} kept`

  let verdict: PhotoView['verdict']
  let verdictText: string
  if (qc.framesKept === 0) {
    verdict = 'fail'
    verdictText = `QC failed: no frame passed the quality checks (${kept}).`
  } else if (issues.length > 0) {
    verdict = 'issues'
    verdictText = `QC found ${issues.length} ${plural(issues.length, 'problem')} (${kept}): ${issues.map((i) => i.label.toLowerCase()).join(', ')}.`
  } else {
    verdict = 'pass'
    verdictText = `QC passed (${kept}).`
  }

  const facts: string[] = []
  if (qc.estimatedDistanceM !== null) facts.push(`Camera about ${qc.estimatedDistanceM.toFixed(1)} m away (estimate from iris size, about ±15%)`)
  if (qc.burstSpread !== null) facts.push(`Burst spread ${(qc.burstSpread * 100).toFixed(1)}% of pupil distance`)
  facts.push(qc.greyCard ? 'Grey card in frame' : 'No grey card in frame')

  const label = shotLabel(photo.shot)
  return {
    id: photo.id,
    shot: photo.shot,
    shotLabel: label,
    sizeText: `${photo.width} × ${photo.height} px`,
    verdict,
    verdictText,
    issues,
    checks,
    facts,
    alt: `${label} photo of this scan`,
  }
}

// ───────────────────────────── conditions ─────────────────────────────

const FACIAL_HAIR_TEXT: Record<string, string> = { clean: 'clean-shaven', stubble: 'stubble', beard: 'beard' }
const SETUP_TEXT: Record<string, string> = { phone_stand: 'phone on a stand', handheld: 'handheld', laptop: 'laptop camera' }

/** The coarse conditions the user declared, as short phrases. Empty when none were logged. */
export function describeConditions(conditions: ScanRecord['conditions']): string[] {
  const out: string[] = []
  if (conditions.hoursSlept !== undefined) out.push(`${fmt(conditions.hoursSlept)} h of sleep`)
  if (conditions.alcoholLastNight !== undefined) out.push(conditions.alcoholLastNight ? 'alcohol the night before' : 'no alcohol the night before')
  if (conditions.illness !== undefined) out.push(conditions.illness ? 'ill' : 'not ill')
  if (conditions.facialHair !== undefined) out.push(FACIAL_HAIR_TEXT[conditions.facialHair] ?? conditions.facialHair)
  if (conditions.setup !== undefined) out.push(SETUP_TEXT[conditions.setup] ?? conditions.setup)
  return out
}

export function scanSubtitle(scan: Pick<ScanRecord, 'kind' | 'takenAt'>): string {
  return `${KIND_LABEL[scan.kind] ?? scan.kind} · ${formatDateTime(scan.takenAt)}`
}

// ───────────────────────────── history ─────────────────────────────

export interface HistoryRow {
  id: string
  takenAt: number
  dateText: string
  kindLabel: string
  status: OverallStatus | null
  statusText: string
  coverageText: string
  countsText: string
  scored: number
  refused: number
}

export function summariseScan(scan: ScanRecord, overall: OverallScore | undefined, scores: readonly Pick<MetricScore, 'score' | 'confidence'>[]): HistoryRow {
  const scored = scores.filter((s) => s.score !== null).length
  const refused = scores.filter((s) => s.confidence.band === 'REFUSED').length

  let statusText: string
  if (!overall) statusText = 'Overall record missing'
  else if (overall.status === 'NOT_AVAILABLE' || overall.appearance === null) statusText = 'Overall not available'
  else statusText = `Overall ${formatScore(overall.appearance)}${overall.status === 'PROVISIONAL' ? ', provisional' : ''}`

  return {
    id: scan.id,
    takenAt: scan.takenAt,
    dateText: formatDateTime(scan.takenAt),
    kindLabel: KIND_LABEL[scan.kind] ?? scan.kind,
    status: overall?.status ?? null,
    statusText,
    coverageText: overall ? `${formatShare(overall.coverage)} of the score measured` : 'Coverage unknown',
    countsText: `${scored} scored, ${refused} refused`,
    scored,
    refused,
  }
}
