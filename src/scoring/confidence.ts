/**
 * Confidence per docs/PLAN.md §4.2:
 *
 *   confidence = method base × photo-quality factor × repeatability
 *
 *  - method base: how much the way the number was obtained can be trusted (table below).
 *  - photo-quality factor: `Measurement.qcFactor`, 0–1, the product of the capture checks.
 *  - repeatability: from the measurement's uncertainty (burst spread + method error) relative to the metric's scale:
 *        rel = uncertainty ÷ span                       span = scale max − min, else the scoring rule's own width
 *        repeatability = clamp(1 − 1.5·rel, 0, 1)       5 % of the scale → 0.93, 10 % → 0.85, 20 % → 0.70
 *    Unknown uncertainty → 0.75 (an unmeasured spread cannot earn HIGH). Fewer than 3 frames, readings or
 *    placements → at most 0.85 (two placements show little repeatability). Self-report methods have nothing to
 *    repeat: repeatability is 1 for them whatever the uncertainty or frame count; their 0.6 base prices that in.
 *    Only photo-quality loss can pull a self-report from the MEDIUM floor (exactly 0.60) down to LOW.
 *
 * Bands: HIGH ≥ 0.80 · MEDIUM 0.60–0.79 · LOW 0.40–0.59 (scored with a warning, left out of the overall) ·
 * REFUSED < 0.40 or any refusal. Self-report methods are capped at 0.79, so they are never HIGH (with a 0.6 base
 * the product cannot pass 0.60 anyway; the cap is a guard against a future base change).
 * The value is truncated to two decimals and the band is read from that truncated value, so a displayed 0.80
 * is always HIGH and a displayed 0.79 is never HIGH.
 */
import type { Metric, Method } from '../catalog/schema'
import type { ConfidenceBand, Measurement } from '../domain/types'

export const BAND_THRESHOLDS = { HIGH: 0.8, MEDIUM: 0.6, LOW: 0.4 } as const
/** Highest value a self-reported measurement can reach. */
export const SELF_REPORT_CAP = 0.79
/** Repeatability when the uncertainty is unknown. */
export const UNKNOWN_REPEATABILITY = 0.75
/** Repeatability ceiling when fewer than this many frames were combined. */
export const MIN_FRAMES_FOR_FULL_REPEATABILITY = 3
export const FEW_FRAMES_REPEATABILITY_CAP = 0.85
/** Slope of the repeatability penalty per unit of uncertainty ÷ span. */
export const REPEATABILITY_SLOPE = 1.5

export const METHOD_BASE: Readonly<Record<Method, number>> = {
  AUTO_FRONTAL_PHOTO: 1.0,
  AUTO_PROFILE_PHOTO: 1.0,
  // Automatic, but the models are less constrained than a face landmarker on a controlled frontal photo.
  POSE_MODEL_PHOTO: 0.9,
  SEGMENTATION_PHOTO: 0.9,
  COLOR_CALIBRATED_PHOTO: 0.9,
  MANUAL_LANDMARKS: 0.85,
  TAP_COUNT_ON_PHOTO: 0.85,
  TAPE_MEASURE: 0.85,
  SCALE: 0.85,
  // Derived from other measurements: carries their error, so it is not given the top base.
  COMPUTED_FROM_OTHER_METRICS: 0.85,
  AUDIO_ANALYSIS: 0.85,
  VIDEO_ANALYSIS: 0.85,
  // Self-report.
  SELF_GRADE_REFERENCE: 0.6,
  CHECKLIST: 0.6,
  MANUAL_INPUT: 0.6,
  HABIT_LOG: 0.6,
}

export const SELF_REPORT_METHODS: ReadonlySet<Method> = new Set<Method>([
  'SELF_GRADE_REFERENCE',
  'CHECKLIST',
  'MANUAL_INPUT',
  'HABIT_LOG',
])

export interface ConfidenceParts {
  method: number
  photo: number
  repeatability: number
  /** method × photo × repeatability, before the self-report cap. */
  product: number
  /** True when the self-report cap lowered the value. */
  cappedAtMedium: boolean
}

export interface ConfidenceBreakdown extends ConfidenceParts {
  band: ConfidenceBand
  value: number
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** Truncated to two decimals; the epsilon absorbs float noise such as 0.7999999999999999 for a true 0.80. */
export function truncate2(x: number): number {
  return Math.floor(x * 100 + 1e-9) / 100
}

export function bandForValue(value: number): ConfidenceBand {
  if (value >= BAND_THRESHOLDS.HIGH) return 'HIGH'
  if (value >= BAND_THRESHOLDS.MEDIUM) return 'MEDIUM'
  if (value >= BAND_THRESHOLDS.LOW) return 'LOW'
  return 'REFUSED'
}

/** The width of the metric's scale in its own unit, used to judge how large an uncertainty is. */
export function scaleSpan(metric: Metric, value: number | null): number | null {
  const { min, max } = metric.scale
  if (min !== null && max !== null && max > min) return max - min
  const rule = metric.scoring
  if (rule.kind === 'range') return 6 * rule.tau
  if (rule.kind === 'one_sided' || (rule.kind === 'personal_baseline' && rule.normAnchor)) {
    const pts = rule.kind === 'one_sided' ? rule.points : rule.normAnchor!
    const xs = pts.map((p) => p.x)
    const width = Math.max(...xs) - Math.min(...xs)
    if (width > 0) return width
  }
  if (value !== null && Math.abs(value) > 1e-9) return Math.abs(value)
  return null
}

export function repeatabilityFactor(m: Pick<Measurement, 'uncertainty' | 'nFrames' | 'value' | 'method'>, metric: Metric): number {
  // A self-report has no burst or placements to repeat; its 0.6 base already prices in the subjectivity.
  if (SELF_REPORT_METHODS.has(m.method)) return 1
  let r: number
  if (m.uncertainty === null || !Number.isFinite(m.uncertainty)) {
    r = UNKNOWN_REPEATABILITY
  } else {
    const span = scaleSpan(metric, m.value)
    if (span === null) r = m.uncertainty === 0 ? 1 : UNKNOWN_REPEATABILITY
    else r = clamp01(1 - REPEATABILITY_SLOPE * (Math.abs(m.uncertainty) / span))
  }
  if (m.nFrames < MIN_FRAMES_FOR_FULL_REPEATABILITY) r = Math.min(r, FEW_FRAMES_REPEATABILITY_CAP)
  return r
}

/**
 * Full confidence calculation with its parts, so a reason can show which factor pulled it down.
 * A measurement with a refusal (or no value) is REFUSED at 0 whatever its factors say.
 */
export function confidenceBreakdown(m: Measurement, metric: Metric): ConfidenceBreakdown {
  const method = METHOD_BASE[m.method]
  const photo = clamp01(m.qcFactor)
  const repeatability = repeatabilityFactor(m, metric)
  const product = method * photo * repeatability
  if (m.refusal || m.value === null) {
    return { method, photo, repeatability, product, cappedAtMedium: false, band: 'REFUSED', value: 0 }
  }
  const capped = SELF_REPORT_METHODS.has(m.method) && product > SELF_REPORT_CAP
  const value = truncate2(capped ? SELF_REPORT_CAP : product)
  return { method, photo, repeatability, product, cappedAtMedium: capped, band: bandForValue(value), value }
}

/** `{ band, value }` as stored on a MetricScore. */
export function confidenceFor(m: Measurement, metric: Metric): { band: ConfidenceBand; value: number } {
  const { band, value } = confidenceBreakdown(m, metric)
  return { band, value }
}

/** HIGH and MEDIUM count toward the overall score; LOW is shown with a warning but left out. */
export function countsTowardOverall(band: ConfidenceBand): boolean {
  return band === 'HIGH' || band === 'MEDIUM'
}
