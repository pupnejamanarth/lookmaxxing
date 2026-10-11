/**
 * Small numeric helpers for the metrics module. Pure functions. An input that is not a finite number gives NaN
 * rather than a quiet default, so a bad value cannot turn into a plausible-looking measurement; callers test
 * Number.isFinite before they trust a result.
 */

const allFinite = (xs: readonly number[]): boolean => xs.every(Number.isFinite)

/** Middle value; for an even count the mean of the two middle values. NaN for an empty list or a non-finite entry. */
export function median(values: readonly number[]): number {
  if (values.length === 0 || !allFinite(values)) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

export function mean(values: readonly number[]): number {
  if (values.length === 0 || !allFinite(values)) return Number.NaN
  return values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * Sample standard deviation (divides by n − 1), the right estimator for a handful of burst frames.
 * NaN for fewer than two values: one frame has no spread to report, and 0 would claim a perfect repeat.
 */
export function sampleStd(values: readonly number[]): number {
  if (values.length < 2 || !allFinite(values)) return Number.NaN
  const m = mean(values)
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1))
}

/** Root of the sum of squares: independent error terms combine this way. */
export function quadrature(terms: readonly number[]): number {
  if (!allFinite(terms)) return Number.NaN
  return Math.sqrt(terms.reduce((s, t) => s + t * t, 0))
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
export const clamp01 = (x: number): number => clamp(x, 0, 1)

/** Rounds to a fixed number of decimals so stored values are not 0.30000000000000004. */
export function round(x: number, decimals = 6): number {
  const f = 10 ** decimals
  return Math.round(x * f) / f
}

/**
 * Maps a size of error to a 0–1 quality factor: 1 while the error is within `clean`, falling in a straight line to
 * `atLimit` at `limit`, and held at `atLimit` beyond it (the gate that owns the limit refuses first, so the held value
 * is only reached on a boundary). NaN in, NaN out: an unmeasured error is not a good one.
 */
export function softLimitFactor(value: number, clean: number, limit: number, atLimit: number): number {
  if (!Number.isFinite(value)) return Number.NaN
  if (value <= clean) return 1
  if (value >= limit) return atLimit
  return 1 - ((1 - atLimit) * (value - clean)) / (limit - clean)
}

/** Product of factors, clamped to 0–1. */
export function product(factors: readonly number[]): number {
  return clamp01(factors.reduce((p, f) => p * f, 1))
}
