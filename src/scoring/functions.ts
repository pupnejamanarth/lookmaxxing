/**
 * Pure score functions, one per ScoringRule kind (docs/PLAN.md §4.1). No catalog lookups, no I/O.
 *
 * Every `*Raw` function returns an unrounded 0–100 number so monotonicity and continuity can be tested
 * and so uncertainty can be propagated through it. The ONLY place a score becomes a reported integer is
 * `truncateScore`: floor, never round up.
 */
/**
 * Version of the scoring rules: the functions in this file, the confidence formula, the reason templates and the
 * overall rules. Stored on every score so old scans can be recomputed; bump it whenever any of them changes.
 */
export const RULESET_VERSION = 'rules-1.0.0'

export interface ScorePoint {
  x: number
  y: number
}

export type BaselineDirection = 'lower_better' | 'higher_better' | 'target_range'

/** A closed interval; a null end is open (extends to infinity). */
export interface Band {
  lo: number | null
  hi: number | null
}

/** Absorbs float noise such as 69.99999999999999 for a true 70, so a hand-computed 70 is reported as 70. */
const TRUNCATE_EPSILON = 1e-9

/** Share of the scale span at which a personal-baseline deterioration scores about 61 (1 tau). App assumption. */
export const BASELINE_TAU_SHARE = 0.15

export function clampScore(raw: number): number {
  if (Number.isNaN(raw)) throw new RangeError('A score cannot be NaN')
  return Math.min(100, Math.max(0, raw))
}

/** The reported score: clamped to 0–100 and truncated. 38.9 is 38, never 39. */
export function truncateScore(raw: number): number {
  return Math.min(100, Math.floor(clampScore(raw) + TRUNCATE_EPSILON))
}

// ───────────────────────────── bands and gaps ─────────────────────────────

/** Distance outside the band (0 inside); null when the band has no ends at all. */
export function gapOutside(value: number, band: Band): number | null {
  if (band.lo === null && band.hi === null) return null
  if (band.lo !== null && value < band.lo) return band.lo - value
  if (band.hi !== null && value > band.hi) return value - band.hi
  return 0
}

// ───────────────────────────── range ─────────────────────────────

/** 100 inside [lo, hi]; outside 100·exp(−½(d/tau)²), d = distance to the nearest edge. Lo or hi may be infinite. */
export function rangeScoreRaw(value: number, rule: { lo: number; hi: number; tau: number }): number {
  if (!(rule.tau > 0)) throw new RangeError('range tau must be positive')
  const d = value < rule.lo ? rule.lo - value : value > rule.hi ? value - rule.hi : 0
  return 100 * Math.exp(-0.5 * (d / rule.tau) ** 2)
}

// ───────────────────────────── one_sided ─────────────────────────────

/** Piecewise-linear lookup. Outside the first or last point the score is clamped to that point's y. */
export function oneSidedScoreRaw(value: number, points: readonly ScorePoint[]): number {
  if (points.length === 0) throw new RangeError('one_sided needs at least one point')
  const pts = [...points].sort((a, b) => a.x - b.x)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (value <= first.x) return first.y
  if (value >= last.x) return last.y
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    if (value <= b.x) {
      if (b.x === a.x) return Math.min(a.y, b.y)
      return a.y + ((b.y - a.y) * (value - a.x)) / (b.x - a.x)
    }
  }
  return last.y
}

/**
 * Where a piecewise-linear score is 100: the hull of the points with y = 100. An end that carries y = 100
 * at the outermost point extends to infinity (clamped), so it is reported open (null).
 */
export function bandFromPoints(points: readonly ScorePoint[]): Band {
  const pts = [...points].sort((a, b) => a.x - b.x)
  const top = pts.filter((p) => p.y >= 100 - 1e-9)
  if (top.length === 0) return { lo: null, hi: null }
  const lo = top[0]!.x
  const hi = top[top.length - 1]!.x
  return {
    lo: lo === pts[0]!.x ? null : lo,
    hi: hi === pts[pts.length - 1]!.x ? null : hi,
  }
}

// ───────────────────────────── personal_baseline ─────────────────────────────

/**
 * Tolerance scale for personal-baseline scoring: BASELINE_TAU_SHARE of the scale span; an unbounded scale uses
 * the same share of the baseline's size; with a baseline of ~0, three times the measurement uncertainty; else 1.
 * An app assumption (the catalog gives no tau for these metrics) – replace with the personal MDC after calibration.
 */
export function baselineTau(args: { scaleMin: number | null; scaleMax: number | null; baseline: number; uncertainty: number | null }): number {
  const { scaleMin, scaleMax, baseline, uncertainty } = args
  if (scaleMin !== null && scaleMax !== null && scaleMax > scaleMin) return BASELINE_TAU_SHARE * (scaleMax - scaleMin)
  const fromBaseline = BASELINE_TAU_SHARE * Math.abs(baseline)
  if (fromBaseline > 1e-9) return fromBaseline
  if (uncertainty !== null && uncertainty > 0) return 3 * uncertainty
  return 1
}

/** The band a personal baseline implies: lower_better ≤ baseline, higher_better ≥ baseline, target_range = baseline. */
export function baselineBand(baseline: number, direction: BaselineDirection): Band {
  if (direction === 'lower_better') return { lo: null, hi: baseline }
  if (direction === 'higher_better') return { lo: baseline, hi: null }
  return { lo: baseline, hi: baseline }
}

/**
 * Score against the user's own baseline: 100 at the baseline (or better for lower/higher_better), then
 * 100·exp(−½(d/tau)²) with d = how far the value sits on the wrong side. A target_range baseline is a stand-in
 * target, so deviation in either direction counts.
 */
export function personalBaselineScoreRaw(value: number, baseline: number, direction: BaselineDirection, tau: number): number {
  const band = baselineBand(baseline, direction)
  return rangeScoreRaw(value, { lo: band.lo ?? -Infinity, hi: band.hi ?? Infinity, tau })
}

/** A norm anchor is a piecewise-linear value → score table (same shape as one_sided). */
export function anchorScoreRaw(value: number, anchor: readonly ScorePoint[]): number {
  return oneSidedScoreRaw(value, anchor)
}

/** With both a baseline and a norm anchor the score is the lower of the two: neither can flatter the other. */
export function combineBaselineAndAnchor(relativeRaw: number, anchorRaw: number): number {
  return Math.min(relativeRaw, anchorRaw)
}

// ───────────────────────────── checklist ─────────────────────────────

export interface ChecklistItemDef {
  id: string
  label: string
  critical: boolean
}

export interface ChecklistOutcome {
  /** Items passed, of `total`. */
  passed: number
  total: number
  /** Passed ÷ total × 100, before any cap. */
  share: number
  failed: ChecklistItemDef[]
  failedCritical: ChecklistItemDef[]
  /** The cap applied (criticalItemCap) or null when no critical item failed. */
  cap: number | null
  raw: number
}

/**
 * Share of items passed; failing any critical item caps the score at criticalItemCap.
 * `results[id]` true = passed. An item with no result counts as failed: an unchecked item earns nothing.
 */
export function checklistScoreRaw(
  rule: { criticalItemCap: number; items: readonly ChecklistItemDef[] },
  results: Readonly<Record<string, boolean | undefined>>,
): ChecklistOutcome {
  const total = rule.items.length
  if (total === 0) throw new RangeError('a checklist needs at least one item')
  const failed = rule.items.filter((item) => results[item.id] !== true)
  const failedCritical = failed.filter((item) => item.critical)
  const passed = total - failed.length
  const share = (passed / total) * 100
  const cap = failedCritical.length > 0 ? rule.criticalItemCap : null
  return { passed, total, share, failed, failedCritical, cap, raw: cap === null ? share : Math.min(share, cap) }
}

/**
 * Checklist score when only the overall share is known (no per-item results). A critical failure cannot be ruled
 * out below 100 %, so any shortfall is capped: the unknown is never credited.
 */
export function checklistScoreFromShareRaw(share: number, criticalItemCap: number): { raw: number; cap: number | null } {
  const s = clampScore(share)
  if (s >= 100 - 1e-9) return { raw: 100, cap: null }
  return { raw: Math.min(s, criticalItemCap), cap: criticalItemCap }
}

// ───────────────────────────── percentile ─────────────────────────────

/** `percentile` is the user's position (0–100) in the stated reference population. */
export function percentileScoreRaw(percentile: number, direction: 'higher_better' | 'lower_better'): number {
  const p = clampScore(percentile)
  return direction === 'higher_better' ? p : 100 - p
}

// ───────────────────────────── uncertainty ─────────────────────────────

/** Largest movement of `fn` within ±uncertainty of `value` – how far the score can shift on measurement noise. */
export function scoreSpread(fn: (v: number) => number, value: number, uncertainty: number): number {
  const centre = fn(value)
  return Math.max(Math.abs(fn(value + uncertainty) - centre), Math.abs(fn(value - uncertainty) - centre))
}
