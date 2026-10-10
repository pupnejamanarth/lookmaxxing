/**
 * Fixed vocabulary for score reasons. Everything a reason can say lives here or in reasons.ts as a template with
 * slots; nothing is generated. tests/unit/scoring-tone.test.ts lints every entry below.
 *
 * Rules the wording follows (docs/PLAN.md §2): state the measurement, the band, the gap and the cost; no
 * compliments, no softeners, no hype; attack the metric, not the person.
 */
import { getSource } from '../catalog'
import type { ShotType, Method, Source } from '../catalog/schema'
import type { ConfidenceBand } from '../domain/types'

// ───────────────────────────── labels ─────────────────────────────

export const METHOD_LABELS: Readonly<Record<Method, string>> = {
  AUTO_FRONTAL_PHOTO: 'auto frontal photo',
  AUTO_PROFILE_PHOTO: 'auto profile photo',
  MANUAL_LANDMARKS: 'manual points',
  COLOR_CALIBRATED_PHOTO: 'grey-card calibrated photo',
  TAP_COUNT_ON_PHOTO: 'tap count on photo',
  POSE_MODEL_PHOTO: 'pose model',
  SEGMENTATION_PHOTO: 'segmentation',
  TAPE_MEASURE: 'tape',
  SCALE: 'scale',
  SELF_GRADE_REFERENCE: 'self-grade',
  CHECKLIST: 'checklist',
  COMPUTED_FROM_OTHER_METRICS: 'computed from other metrics',
  AUDIO_ANALYSIS: 'audio analysis',
  VIDEO_ANALYSIS: 'video analysis',
  MANUAL_INPUT: 'manual entry',
  HABIT_LOG: 'habit log',
}

export const SHOT_LABELS: Readonly<Record<ShotType, string>> = {
  frontal_neutral: 'frontal neutral',
  frontal_smile: 'frontal smile',
  three_quarter_left: 'left three-quarter',
  three_quarter_right: 'right three-quarter',
  profile_left: 'left profile',
  profile_right: 'right profile',
  hairline_front: 'hairline',
  crown_top: 'crown from above',
  hair_natural: 'natural hair',
  skin_zones: 'skin zones',
  skin_sidelight: 'side-lit skin',
  eye_closeup: 'eye close-up',
  teeth_closeup: 'teeth close-up',
  body_front: 'body front',
  body_side: 'body side',
  body_back: 'body back',
  outfit: 'outfit',
  tape_entry: 'tape entry',
  scale_entry: 'scale entry',
  self_report: 'self-report',
  audio_clip: 'audio clip',
  video_clip: 'video clip',
  habit_log: 'habit log',
}

export const CHANGEABILITY_LABELS: Readonly<Record<string, string>> = {
  FIXED: 'FIXED',
  CHANGEABLE: 'CHANGEABLE',
  SURGICAL_ONLY: 'SURGICAL ONLY',
  PROFESSIONAL_ONLY: 'PROFESSIONAL ONLY',
  FIXED_BUT_VISIBILITY_CHANGEABLE: 'FIXED, VISIBILITY CHANGEABLE',
}

/** The evidence grade is always printed; the gloss says in plain words what the grade means. */
export const EVIDENCE_GLOSS: Readonly<Record<string, string>> = {
  STRONG: '',
  MODERATE: '',
  WEAK: 'few or low-quality studies',
  CONVENTION: 'a classical canon or custom, not a measured norm',
  PSEUDOSCIENCE: 'a community claim without research support',
  MYTH: 'contradicted by research',
}

/** Why a metric is never scored, by catalog `scoring.reason`, plus the two engine-side causes. */
export const UNSCORED_REASON_TEXT: Readonly<Record<string, string>> = {
  myth: 'the claim is a myth and is never scored',
  process_measure: 'it is a process measure, not an appearance trait',
  habit: 'it is a habit, tracked as adherence and not as appearance',
  deferred: 'its scoring is deferred to a later release',
  context_only: 'no evidence-based ideal exists, so it is shown for context only',
  zero_weight: 'its weight is 0, so it cannot change the overall score',
}

export const BAND_NAMES: Readonly<Record<ConfidenceBand, string>> = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  REFUSED: 'REFUSED',
}

export const GROUP_LABELS = {
  FIXED: 'fixed',
  SURGICAL_OR_PROFESSIONAL: 'surgical or professional',
  CHANGEABLE: 'changeable',
} as const

// ───────────────────────────── numbers ─────────────────────────────

/** Display precision by magnitude: 131, 11.5, 1.92, 0.043. Trailing zeros dropped; never "-0". */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return 'n/a'
  const a = Math.abs(n)
  const dp = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3
  const rounded = Number(n.toFixed(dp))
  if (rounded === 0 && n !== 0) return n.toPrecision(1)
  return String(rounded)
}

/** Points lost are shown rounded UP to 0.1: a cost is never understated. */
export function fmtCost(points: number): string {
  if (!(points > 1e-9)) return '0'
  return String(Math.ceil(points * 10 - 1e-9) / 10)
}

/** Whole-number percentage of a 0–1 share, truncated. */
export function fmtShare(share: number): string {
  return String(Math.floor(share * 100 + 1e-9))
}

function hasUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase()
  return u !== '' && u !== 'n/a'
}

/** A number with its unit: "11°", "1.1% of pupil distance", "0.21 ratio". */
export function amount(n: number, unit: string): string {
  if (!hasUnit(unit)) return fmt(n)
  if (unit.startsWith('°')) return `${fmt(n)}°`
  if (unit.startsWith('%')) return `${fmt(n)}%${unit.slice(1)}`
  return `${fmt(n)} ${unit}`
}

/** "131° ±3°", "4.1% ±0.6% of pupil distance", "1.92 ±0.04 ratio". Unknown uncertainty is said, not hidden. */
export function quantity(value: number, uncertainty: number | null, unit: string): string {
  const u = uncertainty === null ? null : Math.abs(uncertainty)
  if (!hasUnit(unit)) return u === null ? `${fmt(value)} ±unknown` : `${fmt(value)} ±${fmt(u)}`
  if (unit.startsWith('°')) return u === null ? `${fmt(value)}° ±unknown` : `${fmt(value)}° ±${fmt(u)}°`
  if (unit.startsWith('%')) {
    const rest = unit.slice(1)
    return u === null ? `${fmt(value)}% ±unknown${rest}` : `${fmt(value)}% ±${fmt(u)}%${rest}`
  }
  return u === null ? `${fmt(value)} ±unknown ${unit}` : `${fmt(value)} ±${fmt(u)} ${unit}`
}

/** A band as words: "105–120°", "at most 0.5 ratio", "at least 1.5 ratio", "exactly 52 index". */
export function rangeText(lo: number | null, hi: number | null, unit: string): string {
  if (lo !== null && hi !== null) {
    if (lo === hi) return `exactly ${amount(lo, unit)}`
    if (hasUnit(unit) && unit.startsWith('°')) return `${fmt(lo)}–${fmt(hi)}°`
    if (hasUnit(unit) && unit.startsWith('%')) return `${fmt(lo)}–${fmt(hi)}%${unit.slice(1)}`
    return hasUnit(unit) ? `${fmt(lo)}–${fmt(hi)} ${unit}` : `${fmt(lo)}–${fmt(hi)}`
  }
  if (lo !== null) return `at least ${amount(lo, unit)}`
  if (hi !== null) return `at most ${amount(hi, unit)}`
  return 'none defined'
}

// ───────────────────────────── names and sources ─────────────────────────────

/**
 * Label used in the reason header: the catalog name without a trailing parenthetical, upper-case; a short
 * all-caps acronym in that parenthetical (FWHR) is used instead because that is what people call the metric.
 */
export function shortName(name: string): string {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(name)
  if (!m) return name.toUpperCase()
  const base = m[1]!.trim()
  const inner = m[2]!.trim()
  if (/^[A-Z][A-Z0-9]{1,5}$/.test(inner)) return inner
  return (base === '' ? name : base).toUpperCase()
}

const INITIALS = /^(?:[A-Z]\.\s?-?)+$/

/** "Ellenbogen & Karlin 1980", "Coetzee et al. 2010", or a truncated first sentence when the citation has no authors. */
export function sourceLabel(source: Pick<Source, 'citation'>): string {
  const citation = source.citation.trim()
  const m = /^(.+?)\s*\((\d{4})[a-z]?\)/.exec(citation)
  if (m) {
    const tokens = m[1]!
      .split(/,|&/)
      .map((t) => t.trim())
      .filter((t) => t !== '')
    const etAl = tokens.some((t) => /^et al\.?$/i.test(t))
    const surnames: string[] = []
    // A surname is followed by an initials token; a title never is.
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      if (/^et al\.?$/i.test(t) || INITIALS.test(t)) continue
      if (/^\p{Lu}[\p{L}'’-]*(?: \p{Lu}[\p{L}'’-]*)?$/u.test(t) && (INITIALS.test(tokens[i + 1] ?? '') || /^et al\.?$/i.test(tokens[i + 1] ?? ''))) {
        surnames.push(t)
      } else {
        surnames.length = 0
        break
      }
    }
    if (surnames.length > 0) {
      const year = m[2]!
      if (surnames.length === 1) return etAl ? `${surnames[0]} et al. ${year}` : `${surnames[0]} ${year}`
      if (surnames.length === 2 && !etAl) return `${surnames[0]} & ${surnames[1]} ${year}`
      return `${surnames[0]} et al. ${year}`
    }
  }
  const firstSentence = citation.split(/\.\s/)[0]!.replace(/\.$/, '')
  return firstSentence.length > 48 ? `${firstSentence.slice(0, 47).trimEnd()}…` : firstSentence
}

export const SOURCE_NOT_VERIFIED = 'source not verified'

/**
 * "[Rhodes 2006 – source not verified]". Cites exactly the ids given (the metric's own list). When only some are
 * unverified each carries its own tag. An id the catalog does not know is cited by id and treated as unverified.
 */
export function citeSources(sourceIds: readonly string[]): string {
  if (sourceIds.length === 0) return '[no source cited]'
  const entries = sourceIds.map((id) => {
    const source = getSource(id)
    return { label: source ? sourceLabel(source) : id, verified: source?.verified === true }
  })
  const unverified = entries.filter((e) => !e.verified).length
  if (unverified === 0) return `[${entries.map((e) => e.label).join('; ')}]`
  if (unverified === entries.length) return `[${entries.map((e) => e.label).join('; ')} – ${SOURCE_NOT_VERIFIED}]`
  return `[${entries.map((e) => (e.verified ? e.label : `${e.label} (${SOURCE_NOT_VERIFIED})`)).join('; ')}]`
}

/** Ends a sentence fragment with a full stop unless it already carries terminal punctuation. */
export function sentence(text: string): string {
  const t = text.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}
