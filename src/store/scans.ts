/**
 * Scan persistence: scans, their photos, measurements, scores, the overall score and personal baselines.
 *
 * The honesty rules are enforced HERE, at the data layer, so no screen or scoring bug can persist a
 * dishonest record:
 *  - Every score has a non-empty reason. A number (score != null) also carries the facts it cites.
 *  - A refused measurement (refusal set, or no value) is never scored; a refusal always says why and what to re-capture.
 *  - The overall score does not exist below 50 % coverage.
 *  - Photos are re-encoded JPEGs with no metadata (Exif / XMP / IPTC / comments / trailing data).
 *  - Only the fields the app is allowed to hold are accepted (no free text, names, file names, locations).
 *  - At most one quick scan per local calendar day.
 *
 * saveScan and deleteScan are each ONE read-write transaction over every table they touch, with ONE audit
 * row in it: either everything happens or nothing does. Baselines are write-once per metric and are never
 * removed by deleteScan. Backup and deleteAllData iterate database.tables, so these tables are covered.
 *
 * The JPEG check below is a local implementation (src/capture's hasMetadataMarkers did not exist when this
 * was written). It is stricter than "no APP1 / APP13": only JFIF, ICC profile and Adobe colour-transform
 * segments are allowed through, so an unknown segment cannot carry personal data past it.
 */
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
  /** Validates the whole bundle, then writes it in one transaction. Throws StoreError('invalid' | 'duplicate' | 'forbidden'). */
  saveScan(bundle: ScanBundle): Promise<void>
  /** Newest first. */
  listScans(): Promise<ScanRecord[]>
  /** Photos oldest first; measurements and scores by metric id. null when the scan does not exist. */
  getScanBundle(id: string): Promise<ScanBundle | null>
  /** The scan and everything hanging off it. Baselines stay. Throws StoreError('not_found'). */
  deleteScan(id: string): Promise<void>
  /** metricId → the user's own baseline value. */
  getBaselines(): Promise<Record<string, number>>
  /** At most one quick scan per local calendar day. `now` defaults to the store clock. */
  canQuickScan(now?: number): Promise<QuickScanStatus>
}

export type ScansDeps = StoreDeps

// ───────────────────────────── validation ─────────────────────────────

const SCAN_KINDS: Record<ScanKind, true> = { quick: true, weekly: true, calibration: true, monthly: true }
const CONFIDENCE_BANDS: Record<ConfidenceBand, true> = { HIGH: true, MEDIUM: true, LOW: true, REFUSED: true }
const OVERALL_STATUSES: Record<OverallStatus, true> = { FINAL: true, PROVISIONAL: true, NOT_AVAILABLE: true }
const POINT_GROUPS: Record<string, true> = { FIXED: true, SURGICAL_OR_PROFESSIONAL: true, CHANGEABLE: true }
const FACIAL_HAIR: readonly string[] = ['clean', 'stubble', 'beard']
const SETUPS: readonly string[] = ['phone_stand', 'handheld', 'laptop']

/** The overall score needs at least this share of the total weight to be scored (docs/PLAN.md). */
const MIN_OVERALL_COVERAGE = 0.5
/** Letters, digits, '_' and '-', starting with a letter: never '__proto__'. */
const METRIC_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
const AUDIT_DETAIL_MAX = 500

const invalid = (message: string) => new StoreError('invalid', message)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi

function record(value: unknown, label: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${label} must be an object`)
  if (allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw invalid(`${label} has a field the app does not store: "${key}"`)
    }
  }
  return value
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be a list`)
  return value
}

function requireIds(item: Record<string, unknown>, label: string, scanId: string): void {
  if (!isText(item.id)) throw invalid(`${label} needs an id`)
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
  if (!isText(scan.id)) throw invalid('Scan needs an id')
  if (!isNum(scan.takenAt) || scan.takenAt < 0) throw invalid('Scan needs a valid takenAt timestamp')
  if (typeof scan.kind !== 'string' || !Object.hasOwn(SCAN_KINDS, scan.kind)) throw invalid('Scan has an unknown kind')
  if (!isText(scan.algoVersion)) throw invalid('Scan needs an algoVersion')
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
  if (typeof m.metricId !== 'string' || !METRIC_ID.test(m.metricId)) throw invalid('Measurement has an invalid metric id')
  const label = `Measurement ${m.metricId}`
  requireIds(m, label, scanId)
  if (m.value !== null && !isNum(m.value)) throw invalid(`${label}: value must be a number or empty`)
  if (typeof m.unit !== 'string') throw invalid(`${label}: unit must be text`)
  if (m.uncertainty !== null && (!isNum(m.uncertainty) || m.uncertainty < 0)) throw invalid(`${label}: uncertainty must be 0 or more, or empty`)
  if (!isCount(m.nFrames)) throw invalid(`${label}: nFrames must be a whole number`)
  if (typeof m.method !== 'string' || !(METHODS as readonly string[]).includes(m.method)) throw invalid(`${label}: unknown method`)
  if (!inRange(m.qcFactor, 0, 1)) throw invalid(`${label}: qcFactor must be between 0 and 1`)
  if (!isText(m.algoVersion)) throw invalid(`${label}: needs an algoVersion`)
  if (m.inputs !== undefined) {
    const inputs = record(m.inputs, `${label}: inputs`)
    for (const [key, v] of Object.entries(inputs)) {
      if (!isNum(v)) throw invalid(`${label}: input "${key}" must be a number`)
    }
  }
  if (m.refusal !== undefined) {
    // A refusal means "no number": a value next to it would be a made-up measurement.
    if (m.value !== null) throw invalid(`${label}: has a refusal and a value. A refused metric has no value.`)
    const refusal = record(m.refusal, `${label}: refusal`, ['reasons', 'recapture'])
    const reasons = array(refusal.reasons, `${label}: refusal reasons`)
    const recapture = array(refusal.recapture, `${label}: refusal recapture`)
    if (reasons.length === 0 || !reasons.every(isText)) throw invalid(`${label}: a refusal must say why`)
    if (recapture.length === 0 || !recapture.every(isText)) throw invalid(`${label}: a refusal must say what to re-capture`)
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
  for (const key of ['unit', 'idealSummary', 'ruleKind', 'shotLabel', 'evidence', 'changeability'] as const) {
    if (typeof f[key] !== 'string') throw invalid(`${label}: facts.${key} must be text`)
  }
  if (!isText(f.idealSummary) || !isText(f.ruleKind)) throw invalid(`${label}: facts must describe the ideal and the rule used`)
  if (!Array.isArray(f.sourceIds) || !f.sourceIds.every((id) => typeof id === 'string')) throw invalid(`${label}: facts.sourceIds must be a list of ids`)
  return f as unknown as ScoreFacts
}

function validateScore(input: unknown, scanId: string): MetricScore {
  const s = record(input, 'Score', ['id', 'scanId', 'metricId', 'score', 'confidence', 'facts', 'reason', 'rulesetVersion'])
  if (typeof s.metricId !== 'string' || !METRIC_ID.test(s.metricId)) throw invalid('Score has an invalid metric id')
  const label = `Score ${s.metricId}`
  requireIds(s, label, scanId)
  // The honesty invariant. Reasons first: they apply to scored and unscored metrics alike.
  if (typeof s.reason !== 'string' || s.reason.trim().length === 0) {
    throw invalid(`${label}: has an empty reason. Every score needs a reason.`)
  }
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
  if (!isText(s.rulesetVersion)) throw invalid(`${label}: needs a rulesetVersion`)
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
  if (!isText(o.weightsVersion) || !isText(o.rulesetVersion)) throw invalid('Overall score needs its weights and ruleset versions')
  const lost = record(o.pointsLost, 'Overall score: pointsLost')
  for (const group of Object.keys(POINT_GROUPS)) {
    if (!isNum(lost[group])) throw invalid(`Overall score: pointsLost.${group} must be a number`)
  }
  for (const item of array(o.drag, 'Overall score: drag')) {
    const d = record(item, 'Overall score: drag item')
    if (typeof d.metricId !== 'string' || typeof d.name !== 'string' || typeof d.changeability !== 'string' || !isNum(d.pointsLost)) {
      throw invalid('Overall score: a drag item is malformed')
    }
    if (typeof d.group !== 'string' || !Object.hasOwn(POINT_GROUPS, d.group)) throw invalid('Overall score: a drag item has an unknown group')
  }
  // The headline number only exists when enough of the total weight was actually measured.
  if (o.coverage < MIN_OVERALL_COVERAGE && o.status !== 'NOT_AVAILABLE') {
    throw invalid(`Overall score: coverage is ${Math.trunc(o.coverage * 100)} %, below 50 %, so there is no overall score`)
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
  const baselines = array(input, 'baselinesToStore').map((item) => {
    const b = record(item, 'Baseline', ['metricId', 'value'])
    if (typeof b.metricId !== 'string' || !METRIC_ID.test(b.metricId)) throw invalid('Baseline has an invalid metric id')
    if (!isNum(b.value)) throw invalid(`Baseline ${b.metricId}: value must be a number`)
    return { metricId: b.metricId, value: b.value }
  })
  requireUnique(baselines.map((b) => b.metricId), 'Baseline')
  return baselines
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

async function assertCleanJpeg(photo: PhotoRecord): Promise<void> {
  const check = findJpegMetadata(new Uint8Array(await photo.blob.arrayBuffer()))
  const label = `Photo "${photo.shot}"`
  if (!check.wellFormed) throw invalid(`${label}: the file is not a complete JPEG`)
  if (check.findings.length > 0) {
    throw invalid(`${label}: the JPEG carries metadata (${check.findings.join(', ')}). Photos are stored re-encoded, with none.`)
  }
}

// ───────────────────────────── bundle ─────────────────────────────

/** Shape, honesty and cross-record checks. Pure apart from reading the photo bytes. */
async function validateBundle(input: unknown): Promise<ScanBundle> {
  const bundle = record(input, 'Scan bundle', ['scan', 'photos', 'measurements', 'scores', 'overall', 'baselinesToStore'])
  const scan = validateScan(bundle.scan)
  const photos = array(bundle.photos, 'photos').map((item) => validatePhoto(item, scan.id))
  const measurements = array(bundle.measurements, 'measurements').map((item) => validateMeasurement(item, scan.id))
  const scores = array(bundle.scores, 'scores').map((item) => validateScore(item, scan.id))
  const overall = validateOverall(bundle.overall, scan.id)
  const baselinesToStore = validateBaselines(bundle.baselinesToStore)

  requireUnique(photos.map((p) => p.id), 'Photo id')
  requireUnique(measurements.map((m) => m.id), 'Measurement id')
  requireUnique(scores.map((s) => s.id), 'Score id')
  requireUnique(measurements.map((m) => m.metricId), 'Measurement for metric')
  requireUnique(scores.map((s) => s.metricId), 'Score for metric')

  // A metric the app refused to measure must not appear scored.
  const unmeasurable = new Set(measurements.filter((m) => m.refusal !== undefined || m.value === null).map((m) => m.metricId))
  for (const s of scores) {
    if (s.score !== null && unmeasurable.has(s.metricId)) {
      throw invalid(`Score ${s.metricId}: the measurement was refused, so it cannot be scored`)
    }
  }
  for (const photo of photos) await assertCleanJpeg(photo)
  return { scan, photos, measurements, scores, overall, baselinesToStore }
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
      const { scan, photos, measurements, scores, overall, baselinesToStore } = await validateBundle(input)
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
        // Two rows sharing an id (a reused uuid) surface as a constraint error; say so plainly.
        if (e instanceof Error && (e.name === 'ConstraintError' || e.name === 'BulkError')) {
          throw new StoreError('duplicate', 'A photo, measurement or score in this scan has an id that is already saved')
        }
        throw e
      }
    },

    listScans() {
      return database.scans.orderBy('takenAt').reverse().toArray()
    },

    async getScanBundle(id) {
      if (!isText(id)) throw invalid('Missing scan id')
      const tables = [database.scans, database.photos, database.measurements, database.scores, database.overall, database.baselines]
      return database.transaction('r', tables, async () => {
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
