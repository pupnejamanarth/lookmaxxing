/**
 * Scan persistence: scans, their photos, measurements, scores, the overall score and personal baselines.
 *
 * The honesty rules are enforced HERE, at the data layer, so no screen or scoring bug can persist a
 * dishonest record:
 *  - Every score has a real reason. A number (score != null) also carries the facts it cites, and those facts,
 *    unit and uncertainty are the ones of the measurement in the same scan: a score cannot cite fiction.
 *  - Every measurement has exactly one score row, so a refused metric cannot vanish from the report.
 *  - A refused measurement (refusal set, or no value) is never scored; a refusal always says why and what to re-capture.
 *  - The overall score follows docs/PLAN.md section 4.4: FINAL from 75 % coverage, PROVISIONAL from 50 %, nothing below.
 *    Coverage must match the scored weight (HIGH and MEDIUM scores) of the same scan.
 *  - A baseline is the measured value of a metric this scan measured and left unscored, nothing else.
 *  - Photos are re-encoded JPEGs with no metadata (Exif / XMP / IPTC / comments / trailing data), one per shot.
 *    What is stored is a fresh Blob built from the bytes that were checked, so no file name or date comes along.
 *  - Only the fields the app is allowed to hold are accepted (no free text, names, file names, locations),
 *    and every text field has a length limit.
 *  - At most one quick scan per local calendar day.
 *
 * saveScan and deleteScan are each ONE read-write transaction over every table they touch, with ONE audit
 * row in it: either everything happens or nothing does. Baselines are write-once per metric and are never
 * removed by deleteScan. Backup and deleteAllData iterate database.tables, so these tables are covered.
 *
 * Restore writes rows without going through saveScan, so getScanBundle re-runs the same rules on what it reads
 * and refuses a damaged scan instead of rendering it. verifyScanRows exposes the same rules for the restore path.
 *
 * The JPEG check below is a local implementation (src/capture's hasMetadataMarkers did not exist when this
 * was written). It is stricter than "no APP1 / APP13": only JFIF, ICC profile and Adobe colour-transform
 * segments are allowed through, so an unknown segment cannot carry personal data past it.
 */
import { totalWeight } from '../catalog'
import { METHODS, SHOT_TYPES } from '../catalog/schema'
import type {
  ConfidenceBand,
  Measurement,
  MetricScore,
  OverallScore,
  OverallStatus,
  PhotoRecord,
  ScanKind,
  ScanRecord,
  ScoreFacts,
} from '../domain/types'
import { WEIGHTS_VERSION, countsTowardOverall, statusForCoverage } from '../scoring'
import { db, type BaselineRow, type LookmaxxingDB } from './db'
import { StoreError, type StoreDeps } from './store'

export interface BaselineToStore {
  metricId: string
  value: number
}

/** Everything one scan produced, saved and loaded as a unit. */
export interface ScanBundle {
  scan: ScanRecord
  photos: PhotoRecord[]
  measurements: Measurement[]
  scores: MetricScore[]
  overall: OverallScore
  /** On save: baselines to set if absent. On load: the baselines this scan established. */
  baselinesToStore: BaselineToStore[]
}

export interface QuickScanStatus {
  allowed: boolean
  /** Start of the next local calendar day when a quick scan was already taken today; null when allowed. */
  nextAllowedAt: number | null
}

export interface ScansStore {
  /**
   * Validates the whole bundle, then writes it in one transaction.
   * Throws StoreError('invalid' | 'duplicate' | 'forbidden') or StorageFullError.
   */
  saveScan(bundle: ScanBundle): Promise<void>
  /** Newest first. */
  listScans(): Promise<ScanRecord[]>
  /**
   * Photos oldest first; measurements and scores by metric id. null when the scan does not exist.
   * Rejects with StoreError('invalid') when the saved data breaks a save-time rule (a damaged scan).
   */
  getScanBundle(id: string): Promise<ScanBundle | null>
  /** The scan and everything hanging off it. Baselines stay. Throws StoreError('not_found'). */
  deleteScan(id: string): Promise<void>
  /** metricId → the user's own baseline value. */
  getBaselines(): Promise<Record<string, number>>
  /** At most one quick scan per local calendar day. `now` defaults to the store clock. */
  canQuickScan(now?: number): Promise<QuickScanStatus>
}

export type ScansDeps = StoreDeps

/**
 * The device is out of storage. A StoreError with code 'forbidden' (StoreErrorCode has no storage code and
 * store.ts is not part of this module), so callers that only look at `code` keep working; check
 * `instanceof StorageFullError` to show the dedicated advice.
 */
export class StorageFullError extends StoreError {
  constructor(cause?: unknown) {
    super('forbidden', 'Not enough storage on this device. Free up space, or back up and delete old scans, then try again.')
    this.name = 'StorageFullError'
    if (cause !== undefined) this.cause = cause
  }
}

// ───────────────────────────── validation ─────────────────────────────

const SCAN_KINDS: Record<ScanKind, true> = { quick: true, weekly: true, calibration: true, monthly: true }
const CONFIDENCE_BANDS: Record<ConfidenceBand, true> = { HIGH: true, MEDIUM: true, LOW: true, REFUSED: true }
const OVERALL_STATUSES: Record<OverallStatus, true> = { FINAL: true, PROVISIONAL: true, NOT_AVAILABLE: true }
const POINT_GROUPS: Record<string, true> = { FIXED: true, SURGICAL_OR_PROFESSIONAL: true, CHANGEABLE: true }
const FACIAL_HAIR: readonly string[] = ['clean', 'stubble', 'beard']
const SETUPS: readonly string[] = ['phone_stand', 'handheld', 'laptop']

/** Letters, digits, '_' and '-', starting with a letter: never '__proto__'. */
const METRIC_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
const AUDIT_DETAIL_MAX = 500

// Text limits. Generous for anything the app writes, far below anything that could hold a document.
const MAX_ID = 128
const MAX_VERSION = 64
/** The longest catalog unit is 53 characters (a colour-difference description). */
const MAX_UNIT = 120
const MAX_LABEL = 500
const MAX_REASON = 4000
/** A reason is a sentence; anything shorter is a placeholder. */
const MIN_REASON = 12
const MAX_LIST = 64
/** Coverage is stored rounded to 6 places, so the sum of the scored weights may differ by this much. */
const COVERAGE_TOLERANCE = 1e-6

const invalid = (message: string) => new StoreError('invalid', message)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isId = (v: unknown): v is string => isText(v) && v.length <= MAX_ID
const isVersion = (v: unknown): v is string => isText(v) && v.length <= MAX_VERSION
const isLabel = (v: unknown): v is string => isText(v) && v.length <= MAX_LABEL
const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi
const isMetricId = (v: unknown): v is string => typeof v === 'string' && METRIC_ID.test(v)
const percent = (share: number) => `${Math.trunc(share * 100)} %`

function record(value: unknown, label: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${label} must be an object`)
  if (allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw invalid(`${label} has a field the app does not store: "${key}"`)
    }
  }
  return value
}

function array(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be a list`)
  if (value.length > max) throw invalid(`${label} has too many entries (${max} at most)`)
  return value
}

/** Plain text of at most `max` characters; blank is fine. */
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw invalid(`${label} must be text`)
  if (value.length > max) throw invalid(`${label} is too long (${max} characters at most)`)
  return value
}

function requireIds(item: Record<string, unknown>, label: string, scanId: string): void {
  if (!isId(item.id)) throw invalid(`${label} needs an id of 1 to ${MAX_ID} characters`)
  if (item.scanId !== scanId) throw invalid(`${label} belongs to a different scan (expected "${scanId}")`)
}

function requireUnique(values: string[], what: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw invalid(`${what} "${value}" appears more than once`)
    seen.add(value)
  }
}

function validateScan(input: unknown): ScanRecord {
  const scan = record(input, 'Scan', ['id', 'takenAt', 'kind', 'conditions', 'algoVersion'])
  if (!isId(scan.id)) throw invalid(`Scan needs an id of 1 to ${MAX_ID} characters`)
  if (!isNum(scan.takenAt) || scan.takenAt < 0) throw invalid('Scan needs a valid takenAt timestamp')
  if (typeof scan.kind !== 'string' || !Object.hasOwn(SCAN_KINDS, scan.kind)) throw invalid('Scan has an unknown kind')
  if (!isVersion(scan.algoVersion)) throw invalid(`Scan needs an algoVersion of up to ${MAX_VERSION} characters`)
  // Coarse, free-text-free conditions only: an unknown key would be a way to smuggle in text.
  const conditions = record(scan.conditions, 'Scan conditions', ['hoursSlept', 'alcoholLastNight', 'illness', 'facialHair', 'setup'])
  const { hoursSlept, alcoholLastNight, illness, facialHair, setup } = conditions
  if (hoursSlept !== undefined && !inRange(hoursSlept, 0, 24)) throw invalid('Scan conditions: hoursSlept must be 0 to 24')
  if (alcoholLastNight !== undefined && typeof alcoholLastNight !== 'boolean') throw invalid('Scan conditions: alcoholLastNight must be true or false')
  if (illness !== undefined && typeof illness !== 'boolean') throw invalid('Scan conditions: illness must be true or false')
  if (facialHair !== undefined && (typeof facialHair !== 'string' || !FACIAL_HAIR.includes(facialHair))) {
    throw invalid('Scan conditions: facialHair must be clean, stubble or beard')
  }
  if (setup !== undefined && (typeof setup !== 'string' || !SETUPS.includes(setup))) {
    throw invalid('Scan conditions: setup must be phone_stand, handheld or laptop')
  }
  return scan as unknown as ScanRecord
}

function validatePhoto(input: unknown, scanId: string): PhotoRecord {
  const photo = record(input, 'Photo', ['id', 'scanId', 'shot', 'blob', 'width', 'height', 'qc', 'createdAt'])
  const label = `Photo "${String(photo.shot)}"`
  requireIds(photo, label, scanId)
  if (typeof photo.shot !== 'string' || !(SHOT_TYPES as readonly string[]).includes(photo.shot)) throw invalid('Photo has an unknown shot type')
  if (!(photo.blob instanceof Blob)) throw invalid(`${label}: the image must be a Blob`)
  if (photo.blob.type !== 'image/jpeg') throw invalid(`${label}: only re-encoded JPEG photos are stored (got "${photo.blob.type || 'no type'}")`)
  if (photo.blob.size === 0) throw invalid(`${label}: the image is empty`)
  if (!isCount(photo.width) || photo.width < 1 || !isCount(photo.height) || photo.height < 1) {
    throw invalid(`${label}: width and height must be positive whole numbers`)
  }
  if (!isNum(photo.createdAt)) throw invalid(`${label}: createdAt must be a timestamp`)
  const qc = record(photo.qc, `${label}: qc`)
  if (qc.shot !== photo.shot) throw invalid(`${label}: its quality record is for a different shot`)
  if (!isCount(qc.framesTried) || !isCount(qc.framesKept)) throw invalid(`${label}: qc frame counts must be whole numbers`)
  if (!Array.isArray(qc.checks)) throw invalid(`${label}: qc needs its checks`)
  for (const item of array(qc.checks, `${label}: qc checks`, MAX_LIST)) {
    const check = record(item, `${label}: a qc check`)
    for (const key of ['limit', 'hint'] as const) {
      if (typeof check[key] === 'string') text(check[key], `${label}: a qc check ${key}`, MAX_LABEL)
    }
  }
  if (typeof qc.greyCard !== 'boolean') throw invalid(`${label}: qc.greyCard must be true or false`)
  for (const key of ['burstSpread', 'estimatedDistanceM', 'irisPx'] as const) {
    if (qc[key] !== null && !isNum(qc[key])) throw invalid(`${label}: qc.${key} must be a number or empty`)
  }
  return photo as unknown as PhotoRecord
}

function validateMeasurement(input: unknown, scanId: string): Measurement {
  const m = record(input, 'Measurement', [
    'id', 'scanId', 'metricId', 'value', 'unit', 'uncertainty', 'nFrames', 'method', 'qcFactor', 'algoVersion', 'inputs', 'refusal',
  ])
  if (!isMetricId(m.metricId)) throw invalid('Measurement has an invalid metric id')
  const label = `Measurement ${m.metricId}`
  requireIds(m, label, scanId)
  if (m.value !== null && !isNum(m.value)) throw invalid(`${label}: value must be a number or empty`)
  text(m.unit, `${label}: unit`, MAX_UNIT)
  if (m.uncertainty !== null && (!isNum(m.uncertainty) || m.uncertainty < 0)) throw invalid(`${label}: uncertainty must be 0 or more, or empty`)
  if (!isCount(m.nFrames)) throw invalid(`${label}: nFrames must be a whole number`)
  if (typeof m.method !== 'string' || !(METHODS as readonly string[]).includes(m.method)) throw invalid(`${label}: unknown method`)
  if (!inRange(m.qcFactor, 0, 1)) throw invalid(`${label}: qcFactor must be between 0 and 1`)
  if (!isVersion(m.algoVersion)) throw invalid(`${label}: needs an algoVersion of up to ${MAX_VERSION} characters`)
  if (m.inputs !== undefined) {
    const inputs = record(m.inputs, `${label}: inputs`)
    const entries = Object.entries(inputs)
    if (entries.length > MAX_LIST * 4) throw invalid(`${label}: too many inputs`)
    for (const [key, v] of entries) {
      text(key, `${label}: an input name`, MAX_VERSION)
      if (!isNum(v)) throw invalid(`${label}: input "${key}" must be a number`)
    }
  }
  if (m.refusal !== undefined) {
    // A refusal means "no number": a value next to it would be a made-up measurement.
    if (m.value !== null) throw invalid(`${label}: has a refusal and a value. A refused metric has no value.`)
    const refusal = record(m.refusal, `${label}: refusal`, ['reasons', 'recapture'])
    const reasons = array(refusal.reasons, `${label}: refusal reasons`, MAX_LIST)
    const recapture = array(refusal.recapture, `${label}: refusal recapture`, MAX_LIST)
    if (reasons.length === 0 || !reasons.every(isText)) throw invalid(`${label}: a refusal must say why`)
    if (recapture.length === 0 || !recapture.every(isText)) throw invalid(`${label}: a refusal must say what to re-capture`)
    if (![...reasons, ...recapture].every(isLabel)) throw invalid(`${label}: a refusal line is too long (${MAX_LABEL} characters at most)`)
  } else if (m.value === null) {
    throw invalid(`${label}: has no value and no refusal. A missing number needs a stated reason.`)
  }
  return m as unknown as Measurement
}

function validateFacts(facts: unknown, label: string): ScoreFacts {
  const f = record(facts, `${label}: facts`)
  const nullableNumbers = ['uncertainty', 'idealLo', 'idealHi', 'gap'] as const
  for (const key of nullableNumbers) {
    if (f[key] !== null && !isNum(f[key])) throw invalid(`${label}: facts.${key} must be a number or empty`)
  }
  if (!isNum(f.value) || !isNum(f.weight) || f.weight < 0 || !isNum(f.pointsLost)) {
    throw invalid(`${label}: facts need numeric value, weight and pointsLost`)
  }
  text(f.unit, `${label}: facts.unit`, MAX_UNIT)
  text(f.idealSummary, `${label}: facts.idealSummary`, MAX_LABEL)
  text(f.shotLabel, `${label}: facts.shotLabel`, MAX_LABEL)
  for (const key of ['ruleKind', 'evidence', 'changeability'] as const) text(f[key], `${label}: facts.${key}`, MAX_VERSION)
  if (!isText(f.idealSummary) || !isText(f.ruleKind)) throw invalid(`${label}: facts must describe the ideal and the rule used`)
  if (!Array.isArray(f.sourceIds) || !f.sourceIds.every((id) => typeof id === 'string' && id.length <= MAX_VERSION)) {
    throw invalid(`${label}: facts.sourceIds must be a list of ids`)
  }
  if (f.sourceIds.length > MAX_LIST) throw invalid(`${label}: facts.sourceIds has too many entries`)
  return f as unknown as ScoreFacts
}

function validateReason(reason: unknown, label: string, scored: boolean): void {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw invalid(`${label}: has an empty reason. Every score needs a reason.`)
  }
  if (reason.length > MAX_REASON) throw invalid(`${label}: the reason is too long (${MAX_REASON} characters at most)`)
  if (reason.trim().length < MIN_REASON || !/\p{L}/u.test(reason)) {
    throw invalid(`${label}: the reason says nothing. Every score needs a reason that names what was measured.`)
  }
  if (scored && !/\d/.test(reason)) throw invalid(`${label}: the reason cites no number. A score must cite its measurement.`)
}

function validateScore(input: unknown, scanId: string): MetricScore {
  const s = record(input, 'Score', ['id', 'scanId', 'metricId', 'score', 'confidence', 'facts', 'reason', 'rulesetVersion'])
  if (!isMetricId(s.metricId)) throw invalid('Score has an invalid metric id')
  const label = `Score ${s.metricId}`
  requireIds(s, label, scanId)
  // The honesty invariant. Reasons first: they apply to scored and unscored metrics alike.
  validateReason(s.reason, label, s.score !== null)
  if (s.score !== null && !inRange(s.score, 0, 100)) throw invalid(`${label}: score must be between 0 and 100, or empty`)
  const confidence = record(s.confidence, `${label}: confidence`)
  if (typeof confidence.band !== 'string' || !Object.hasOwn(CONFIDENCE_BANDS, confidence.band)) throw invalid(`${label}: unknown confidence band`)
  if (!inRange(confidence.value, 0, 1)) throw invalid(`${label}: confidence value must be between 0 and 1`)
  if (s.score !== null) {
    if (s.facts === null || s.facts === undefined) throw invalid(`${label}: has a score but no facts. A score must cite its measurement.`)
    validateFacts(s.facts, label)
    if (confidence.band === 'REFUSED') throw invalid(`${label}: a refused metric cannot have a score`)
  } else if (s.facts !== null && s.facts !== undefined) {
    validateFacts(s.facts, label)
  }
  if (!isVersion(s.rulesetVersion)) throw invalid(`${label}: needs a rulesetVersion of up to ${MAX_VERSION} characters`)
  return s as unknown as MetricScore
}

function validateOverall(input: unknown, scanId: string): OverallScore {
  const o = record(input, 'Overall score', [
    'scanId', 'appearance', 'band', 'coverage', 'status', 'pointsLost', 'drag', 'cai', 'weightsVersion', 'rulesetVersion',
  ])
  if (o.scanId !== scanId) throw invalid(`Overall score belongs to a different scan (expected "${scanId}")`)
  if (typeof o.status !== 'string' || !Object.hasOwn(OVERALL_STATUSES, o.status)) throw invalid('Overall score has an unknown status')
  if (!inRange(o.coverage, 0, 1)) throw invalid('Overall score: coverage must be between 0 and 1')
  if (o.appearance !== null && !inRange(o.appearance, 0, 100)) throw invalid('Overall score: appearance must be between 0 and 100, or empty')
  if (o.band !== null && (!isNum(o.band) || o.band < 0)) throw invalid('Overall score: band must be 0 or more, or empty')
  if (o.cai !== null && !inRange(o.cai, 0, 100)) throw invalid('Overall score: cai must be between 0 and 100, or empty')
  if (!isVersion(o.weightsVersion) || !isVersion(o.rulesetVersion)) throw invalid('Overall score needs its weights and ruleset versions')
  const lost = record(o.pointsLost, 'Overall score: pointsLost')
  for (const group of Object.keys(POINT_GROUPS)) {
    if (!isNum(lost[group])) throw invalid(`Overall score: pointsLost.${group} must be a number`)
  }
  for (const item of array(o.drag, 'Overall score: drag', 512)) {
    const d = record(item, 'Overall score: drag item')
    if (!isMetricId(d.metricId) || typeof d.name !== 'string' || typeof d.changeability !== 'string' || !isNum(d.pointsLost)) {
      throw invalid('Overall score: a drag item is malformed')
    }
    text(d.name, 'Overall score: a drag item name', MAX_LABEL)
    text(d.changeability, 'Overall score: a drag item changeability', MAX_VERSION)
    if (typeof d.group !== 'string' || !Object.hasOwn(POINT_GROUPS, d.group)) throw invalid('Overall score: a drag item has an unknown group')
  }
  // docs/PLAN.md 4.4: the status is a function of coverage. A looser status would persist a FINAL score for a
  // provisional scan, or hide a result that exists.
  const expected = statusForCoverage(o.coverage)
  if (o.status !== expected) {
    if (expected === 'NOT_AVAILABLE') {
      throw invalid(`Overall score: coverage is ${percent(o.coverage)}, below 50 %, so there is no overall score`)
    }
    throw invalid(
      `Overall score: coverage of ${percent(o.coverage)} is ${expected}, not ${o.status}. ` +
        'FINAL needs 75 % or more, PROVISIONAL 50 % up to 75 %, and below 50 % there is no overall score.',
    )
  }
  if (o.status === 'NOT_AVAILABLE' && (o.appearance !== null || o.band !== null)) {
    throw invalid('Overall score: NOT_AVAILABLE cannot carry an appearance score or band')
  }
  if (o.status !== 'NOT_AVAILABLE' && o.appearance === null) {
    throw invalid(`Overall score: ${o.status} needs an appearance score`)
  }
  return o as unknown as OverallScore
}

function validateBaselines(input: unknown): BaselineToStore[] {
  const baselines = array(input, 'baselinesToStore', MAX_LIST * 4).map((item) => {
    const b = record(item, 'Baseline', ['metricId', 'value'])
    if (!isMetricId(b.metricId)) throw invalid('Baseline has an invalid metric id')
    if (!isNum(b.value)) throw invalid(`Baseline ${b.metricId}: value must be a number`)
    return { metricId: b.metricId, value: b.value }
  })
  requireUnique(baselines.map((b) => b.metricId), 'Baseline')
  return baselines
}

// ───────────────────────────── cross-record rules ─────────────────────────────

const unmeasurable = (m: Measurement): boolean => m.refusal !== undefined || m.value === null

/** Scores and measurements are one-to-one, and what a score cites is what was measured. */
function checkScoresAgainstMeasurements(measurements: Measurement[], scores: MetricScore[]): void {
  const byMetric = new Map(measurements.map((m) => [m.metricId, m]))
  for (const s of scores) {
    if (!byMetric.has(s.metricId)) {
      throw invalid(`Score ${s.metricId}: this scan has no measurement for it. A score must cite its measurement.`)
    }
  }
  const scoredMetrics = new Set(scores.map((s) => s.metricId))
  for (const m of measurements) {
    if (!scoredMetrics.has(m.metricId)) {
      throw invalid(`Measurement ${m.metricId}: has no score row. Every measurement, refused or not, needs its reason in the report.`)
    }
  }
  for (const s of scores) {
    const m = byMetric.get(s.metricId)!
    // A metric the app refused to measure must not appear scored.
    if (s.score !== null && unmeasurable(m)) {
      throw invalid(`Score ${s.metricId}: the measurement was refused, so it cannot be scored`)
    }
    const f = s.facts
    if (f === null || f === undefined) continue
    if (f.value !== m.value) throw invalid(`Score ${s.metricId}: its facts cite ${f.value} but the measurement is ${m.value ?? 'empty'}`)
    if (f.unit !== m.unit) throw invalid(`Score ${s.metricId}: its facts use the unit "${f.unit}" but the measurement uses "${m.unit}"`)
    if (f.uncertainty !== m.uncertainty) {
      throw invalid(`Score ${s.metricId}: its facts cite an uncertainty of ${f.uncertainty ?? 'none'} but the measurement has ${m.uncertainty ?? 'none'}`)
    }
  }
}

/** A baseline is the measured value of a metric this scan measured and left unscored with enough confidence. */
function checkBaselines(baselines: BaselineToStore[], measurements: Measurement[], scores: MetricScore[]): void {
  for (const b of baselines) {
    const m = measurements.find((x) => x.metricId === b.metricId)
    const s = scores.find((x) => x.metricId === b.metricId)
    if (!m || !s) throw invalid(`Baseline ${b.metricId}: this scan did not measure it`)
    if (unmeasurable(m)) throw invalid(`Baseline ${b.metricId}: its measurement was refused, so it cannot become your reference value`)
    if (b.value !== m.value) throw invalid(`Baseline ${b.metricId}: the stored value ${b.value} is not the measured value ${m.value}`)
    if (s.score !== null || (s.confidence.band !== 'HIGH' && s.confidence.band !== 'MEDIUM')) {
      throw invalid(`Baseline ${b.metricId}: only a first measurement that was left unscored, with HIGH or MEDIUM confidence, can set a baseline`)
    }
  }
}

/** Coverage is the scored (HIGH and MEDIUM) weight over the catalog's total weight, as docs/PLAN.md 4.4 says. */
function checkCoverage(overall: OverallScore, scores: MetricScore[]): void {
  // Weights change between releases; an older scan is judged by the weights it was scored with, which are not here.
  if (overall.weightsVersion !== WEIGHTS_VERSION) return
  let scoredWeight = 0
  for (const s of scores) {
    if (s.score !== null && countsTowardOverall(s.confidence.band) && s.facts) scoredWeight += s.facts.weight
  }
  const expected = scoredWeight / totalWeight()
  if (Math.abs(expected - overall.coverage) > COVERAGE_TOLERANCE) {
    throw invalid(
      `Overall score: coverage says ${(overall.coverage * 100).toFixed(1)} % but the scores carry ${(expected * 100).toFixed(1)} % of the total weight`,
    )
  }
}

/** Shape, honesty and cross-record checks on plain data. Photo bytes are checked separately (they need async reads). */
function checkBundle(input: unknown): ScanBundle {
  const bundle = record(input, 'Scan bundle', ['scan', 'photos', 'measurements', 'scores', 'overall', 'baselinesToStore'])
  const scan = validateScan(bundle.scan)
  const photos = array(bundle.photos, 'photos', MAX_LIST).map((item) => validatePhoto(item, scan.id))
  const measurements = array(bundle.measurements, 'measurements', 512).map((item) => validateMeasurement(item, scan.id))
  const scores = array(bundle.scores, 'scores', 512).map((item) => validateScore(item, scan.id))
  const overall = validateOverall(bundle.overall, scan.id)
  const baselinesToStore = validateBaselines(bundle.baselinesToStore)

  requireUnique(photos.map((p) => p.id), 'Photo id')
  requireUnique(photos.map((p) => p.shot), 'Photo for shot')
  requireUnique(measurements.map((m) => m.id), 'Measurement id')
  requireUnique(scores.map((s) => s.id), 'Score id')
  requireUnique(measurements.map((m) => m.metricId), 'Measurement for metric')
  requireUnique(scores.map((s) => s.metricId), 'Score for metric')

  checkScoresAgainstMeasurements(measurements, scores)
  checkBaselines(baselinesToStore, measurements, scores)
  checkCoverage(overall, scores)
  return { scan, photos, measurements, scores, overall, baselinesToStore }
}

// ───────────────────────────── JPEG metadata check ─────────────────────────────

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))
const startsWith = (bytes: Uint8Array, prefix: string): boolean => {
  const want = ascii(prefix)
  return bytes.length >= want.length && want.every((b, i) => bytes[i] === b)
}

/** What a segment is, or null when it is allowed to stay in a stored photo. */
function describeSegment(marker: number, payload: Uint8Array): string | null {
  const app = marker - 0xe0
  switch (marker) {
    case 0xe0:
      return startsWith(payload, 'JFIF\0') ? null : startsWith(payload, 'JFXX\0') ? 'APP0 JFXX thumbnail' : 'APP0 unknown data'
    case 0xe1:
      // Anything else in APP1 is an XMP packet or a vendor block; none of it may stay.
      return startsWith(payload, 'Exif\0') ? 'APP1 Exif (camera, time, GPS)' : 'APP1 XMP or other metadata'
    case 0xe2:
      return startsWith(payload, 'ICC_PROFILE\0') ? null : startsWith(payload, 'MPF\0') ? 'APP2 multi-picture data' : 'APP2 unknown data'
    case 0xed:
      return startsWith(payload, 'Photoshop 3.0') ? 'APP13 IPTC / Photoshop' : 'APP13 metadata'
    case 0xee:
      return startsWith(payload, 'Adobe') ? null : 'APP14 unknown data'
    case 0xfe:
      return 'COM comment'
    default:
      if (marker > 0xe0 && marker <= 0xef) return `APP${app} metadata`
      // JPG0-JPG13: reserved extension segments, never produced by a browser encoder.
      return marker >= 0xf0 && marker <= 0xfd ? 'reserved extension segment' : null
  }
}

export interface JpegCheck {
  /** Starts with SOI, has well-formed segments, a scan and an end-of-image marker. */
  wellFormed: boolean
  /** Metadata or other non-image payload found. Empty for a clean photo. */
  findings: string[]
}

/**
 * Walks the JPEG segment structure (it does not decode pixels). Segments are parsed rather than searched for
 * byte patterns, so compressed image data can never look like metadata.
 */
export function findJpegMetadata(bytes: Uint8Array): JpegCheck {
  const n = bytes.length
  const findings: string[] = []
  const malformed: JpegCheck = { wellFormed: false, findings }
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return malformed
  let i = 2
  let sawScan = false
  while (i < n) {
    if (bytes[i] !== 0xff) return malformed
    while (i < n && bytes[i] === 0xff) i++ // fill bytes
    if (i >= n) return malformed
    const marker = bytes[i++]!
    if (marker === 0xd9) {
      if (i < n) findings.push('data after the end of the image')
      return { wellFormed: sawScan, findings }
    }
    if (marker === 0x00 || marker === 0xd8) return malformed
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // standalone markers carry no length
    if (i + 2 > n) return malformed
    const length = (bytes[i]! << 8) | bytes[i + 1]!
    if (length < 2 || i + length > n) return malformed
    const finding = describeSegment(marker, bytes.subarray(i + 2, i + length))
    if (finding !== null && !findings.includes(finding)) findings.push(finding)
    i += length
    if (marker === 0xda) {
      sawScan = true
      // Entropy-coded data: skip to the next real marker (not a stuffed 0xFF00, restart marker or fill byte).
      while (i < n) {
        const j = bytes.indexOf(0xff, i)
        if (j === -1 || j + 1 >= n) {
          i = n
          break
        }
        const next = bytes[j + 1]!
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) i = j + 2
        else if (next === 0xff) i = j + 1
        else {
          i = j
          break
        }
      }
    }
  }
  return malformed // ran out of bytes before the end-of-image marker
}

/** Reads the photo once and throws unless it is a complete JPEG with no metadata. Returns the bytes that were checked. */
async function readCleanJpeg(photo: PhotoRecord): Promise<ArrayBuffer> {
  const buffer = await photo.blob.arrayBuffer()
  const check = findJpegMetadata(new Uint8Array(buffer))
  const label = `Photo "${photo.shot}"`
  if (!check.wellFormed) throw invalid(`${label}: the file is not a complete JPEG`)
  if (check.findings.length > 0) {
    throw invalid(`${label}: the JPEG carries metadata (${check.findings.join(', ')}). Photos are stored re-encoded, with none.`)
  }
  return buffer
}

/**
 * The photos as they are stored: the checked bytes in a brand-new Blob. Whatever the caller passed in (a File with a
 * name and a date, a Blob that is edited later) cannot reach the database, and the bytes written are the bytes checked.
 */
async function storablePhotos(photos: PhotoRecord[]): Promise<PhotoRecord[]> {
  return Promise.all(photos.map(async (photo) => ({ ...photo, blob: new Blob([await readCleanJpeg(photo)], { type: 'image/jpeg' }) })))
}

// ───────────────────────────── stored data ─────────────────────────────

/** A private copy, taken before anything is validated, so the data checked is the data written. */
function detach<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    throw invalid('The scan holds data that cannot be stored')
  }
}

/** Save-time rules over what was read back. Anything that fails is a damaged scan, never a normal report. */
async function verifyStored(bundle: ScanBundle): Promise<void> {
  try {
    const checked = checkBundle(bundle)
    for (const photo of checked.photos) {
      // saveScan never stores a File; one here came from outside and still carries a name and a date.
      if (typeof File !== 'undefined' && photo.blob instanceof File) {
        throw invalid(`Photo "${photo.shot}": the image is a named file, not a plain re-encoded JPEG`)
      }
      await readCleanJpeg(photo)
    }
  } catch (e) {
    if (e instanceof StoreError && e.code === 'invalid') {
      throw invalid(`Scan "${bundle.scan.id}" is damaged and cannot be shown (${e.message.replace(/\.$/, '')}). Delete it from the history.`)
    }
    throw e
  }
}

export type ScanTableName = 'scans' | 'photos' | 'measurements' | 'scores' | 'overall' | 'baselines'

/**
 * Runs every save-time rule over raw rows of the six scan tables, for the restore path (restore writes rows without
 * going through saveScan). Rows are grouped by scan. A row that belongs to no scan is rejected, except baselines:
 * they outlive the scan that set them. Throws StoreError('invalid') naming the first offence.
 */
export async function verifyScanRows(rows: Partial<Record<ScanTableName, readonly unknown[]>>): Promise<void> {
  const list = (name: ScanTableName): unknown[] => [...(rows[name] ?? [])]
  const scanRows = list('scans').map((row) => validateScan(row))
  requireUnique(scanRows.map((s) => s.id), 'Scan')
  const known = new Set(scanRows.map((s) => s.id))

  const group = (name: ScanTableName): Map<string, unknown[]> => {
    const byScan = new Map<string, unknown[]>()
    for (const row of list(name)) {
      const scanId = isRecord(row) ? row.scanId : undefined
      if (typeof scanId !== 'string' || !known.has(scanId)) {
        if (name === 'baselines') continue
        throw invalid(`A ${name} row belongs to a scan that is not there`)
      }
      byScan.set(scanId, [...(byScan.get(scanId) ?? []), row])
    }
    return byScan
  }
  const photos = group('photos')
  const measurements = group('measurements')
  const scores = group('scores')
  const overall = group('overall')
  const baselines = group('baselines')

  for (const row of list('baselines')) {
    const b = record(row, 'Baseline', ['metricId', 'value', 'setAt', 'scanId'])
    if (!isMetricId(b.metricId) || !isNum(b.value) || !isNum(b.setAt) || typeof b.scanId !== 'string') {
      throw invalid('A baseline row is malformed')
    }
  }
  for (const scan of scanRows) {
    const overallRows = overall.get(scan.id) ?? []
    if (overallRows.length === 0) throw invalid(`Scan "${scan.id}" has no overall score row`)
    if (overallRows.length > 1) throw invalid(`Scan "${scan.id}" has more than one overall score row`)
    await verifyStored({
      scan,
      photos: (photos.get(scan.id) ?? []) as PhotoRecord[],
      measurements: (measurements.get(scan.id) ?? []) as Measurement[],
      scores: (scores.get(scan.id) ?? []) as MetricScore[],
      overall: overallRows[0] as OverallScore,
      baselinesToStore: (baselines.get(scan.id) ?? []).map((row) => {
        const { metricId, value } = row as BaselineRow
        return { metricId, value }
      }),
    })
  }
}

// ───────────────────────────── write failures ─────────────────────────────

const QUOTA_ERRORS = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'])

/** Quota errors arrive bare, wrapped in a Dexie BulkError's failures, or as the inner error of an aborted transaction. */
function isQuotaError(e: unknown, depth = 0): boolean {
  if (depth > 4 || typeof e !== 'object' || e === null) return false
  const err = e as { name?: unknown; failures?: unknown; inner?: unknown; cause?: unknown }
  if (typeof err.name === 'string' && QUOTA_ERRORS.has(err.name)) return true
  if (Array.isArray(err.failures) && err.failures.some((f) => isQuotaError(f, depth + 1))) return true
  return isQuotaError(err.inner, depth + 1) || isQuotaError(err.cause, depth + 1)
}

/** Two rows sharing an id (a reused uuid): a constraint error, alone or as every failure of a BulkError. */
function isDuplicateKeyError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e.name === 'ConstraintError') return true
  if (e.name !== 'BulkError') return false
  const failures = (e as { failures?: unknown }).failures
  return Array.isArray(failures) && failures.length > 0 && failures.every((f) => f instanceof Error && f.name === 'ConstraintError')
}

/** The plain-language error for a failed write, or null to rethrow the original unchanged. */
function explainWriteFailure(e: unknown): StoreError | null {
  if (e instanceof StoreError) return e
  if (isQuotaError(e)) return new StorageFullError(e)
  if (isDuplicateKeyError(e)) return new StoreError('duplicate', 'A photo, measurement or score in this scan has an id that is already saved')
  return null
}

// ───────────────────────────── dates ─────────────────────────────

/** [start, next start) of the local calendar day containing `ts`; the local-time constructor keeps DST days correct. */
function localDay(ts: number): { start: number; end: number } {
  const d = new Date(ts)
  return {
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
  }
}

const clip = (text: string) => (text.length > AUDIT_DETAIL_MAX ? `${text.slice(0, AUDIT_DETAIL_MAX - 1)}…` : text)
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

// ───────────────────────────── store ─────────────────────────────

export function createScansStore(database: LookmaxxingDB, deps: ScansDeps = {}): ScansStore {
  const now = deps.now ?? Date.now

  /** Call inside a transaction that includes `scans`. */
  async function quickScanOn(ts: number): Promise<boolean> {
    const { start, end } = localDay(ts)
    const sameDay = await database.scans.where('takenAt').between(start, end, true, false).toArray()
    return sameDay.some((scan) => scan.kind === 'quick')
  }

  const writeTables = [
    database.scans,
    database.photos,
    database.measurements,
    database.scores,
    database.overall,
    database.baselines,
    database.audit,
  ]

  return {
    async saveScan(input) {
      // Copy first (synchronously), validate the copy, write the copy.
      const bundle = checkBundle(detach(input))
      const photos = await storablePhotos(bundle.photos)
      const { scan, measurements, scores, overall, baselinesToStore } = bundle
      try {
        await database.transaction('rw', writeTables, async () => {
          if (await database.scans.get(scan.id)) throw new StoreError('duplicate', `Scan "${scan.id}" is already saved`)
          if (scan.kind === 'quick' && (await quickScanOn(scan.takenAt))) {
            throw new StoreError('forbidden', 'Only one quick scan per day. The next one is available after midnight.')
          }
          await database.scans.add(scan)
          if (photos.length > 0) await database.photos.bulkAdd(photos)
          if (measurements.length > 0) await database.measurements.bulkAdd(measurements)
          if (scores.length > 0) await database.scores.bulkAdd(scores)
          await database.overall.add(overall)
          // Write-once: a metric that already has a baseline keeps it.
          let newBaselines = 0
          for (const { metricId, value } of baselinesToStore) {
            if (await database.baselines.get(metricId)) continue
            await database.baselines.add({ metricId, value, setAt: scan.takenAt, scanId: scan.id })
            newBaselines++
          }
          const detail =
            `Saved ${scan.kind} scan ${scan.id}: ${plural(photos.length, 'photo')}, ${plural(measurements.length, 'measurement')}, ` +
            `${plural(scores.length, 'score')}, ${plural(newBaselines, 'new baseline')}`
          await database.audit.add({ ts: now(), event: 'scan_saved', detail: clip(detail) })
        })
      } catch (e) {
        throw explainWriteFailure(e) ?? e
      }
    },

    listScans() {
      return database.scans.orderBy('takenAt').reverse().toArray()
    },

    async getScanBundle(id) {
      if (!isText(id)) throw invalid('Missing scan id')
      const tables = [database.scans, database.photos, database.measurements, database.scores, database.overall, database.baselines]
      const bundle = await database.transaction('r', tables, async () => {
        const scan = await database.scans.get(id)
        if (!scan) return null
        const [photos, measurements, scores, overall, baselines] = await Promise.all([
          database.photos.where('scanId').equals(id).toArray(),
          database.measurements.where('scanId').equals(id).toArray(),
          database.scores.where('scanId').equals(id).toArray(),
          database.overall.get(id),
          database.baselines.toArray(),
        ])
        // An overall row is always written with its scan; its absence means the data is damaged, not "no result".
        if (!overall) throw new StoreError('invalid', `Scan "${id}" has no overall score row`)
        const byMetric = (a: { metricId: string }, b: { metricId: string }) => (a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0)
        return {
          scan,
          photos: photos.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)),
          measurements: measurements.sort(byMetric),
          scores: scores.sort(byMetric),
          overall,
          baselinesToStore: baselines
            .filter((row) => row.scanId === id)
            .sort(byMetric)
            .map(({ metricId, value }) => ({ metricId, value })),
        }
      })
      // Outside the transaction: reading photo bytes is not an IndexedDB request.
      if (bundle) await verifyStored(bundle)
      return bundle
    },

    async deleteScan(id) {
      if (!isText(id)) throw invalid('Missing scan id')
      const tables = [database.scans, database.photos, database.measurements, database.scores, database.overall, database.audit]
      await database.transaction('rw', tables, async () => {
        const scan = await database.scans.get(id)
        if (!scan) throw new StoreError('not_found', 'Scan not found')
        const photos = await database.photos.where('scanId').equals(id).delete()
        const measurements = await database.measurements.where('scanId').equals(id).delete()
        const scores = await database.scores.where('scanId').equals(id).delete()
        await database.overall.delete(id)
        await database.scans.delete(id)
        const detail = `Deleted ${scan.kind} scan ${id}: ${plural(photos, 'photo')}, ${plural(measurements, 'measurement')}, ${plural(scores, 'score')}`
        await database.audit.add({ ts: now(), event: 'scan_deleted', detail: clip(detail) })
      })
    },

    async getBaselines() {
      const rows: BaselineRow[] = await database.baselines.toArray()
      return Object.fromEntries(rows.map((row) => [row.metricId, row.value]))
    },

    async canQuickScan(at) {
      const ts = at ?? now()
      if (!isNum(ts)) throw invalid('canQuickScan needs a timestamp')
      if (!(await quickScanOn(ts))) return { allowed: true, nextAllowedAt: null }
      return { allowed: false, nextAllowedAt: localDay(ts).end }
    },
  }
}

export const scans: ScansStore = createScansStore(db)
