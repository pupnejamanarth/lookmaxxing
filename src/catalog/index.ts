/**
 * Catalog aggregate. Each data file under ./data exports its own arrays; this module merges them.
 * Validation lives in tests/unit/catalog.test.ts (so the production bundle carries no zod parsing cost).
 */
import type { CategoryId, Metric, Source, NaturalMethod, BannedItem, ReferralFlag } from './schema'
import { CATEGORY_IDS } from './schema'
import * as face from './data/face'
import * as skin from './data/skin'
import * as hair from './data/hair'
import * as eyesSmile from './data/eyesSmile'
import * as body from './data/body'
import * as postureGrooming from './data/postureGrooming'
import * as presenceHabits from './data/presenceHabits'
import * as safety from './data/safety'

export const METRICS: readonly Metric[] = [
  ...face.metrics,
  ...skin.metrics,
  ...hair.metrics,
  ...eyesSmile.metrics,
  ...body.metrics,
  ...postureGrooming.metrics,
  ...presenceHabits.metrics,
]

export const SOURCES: readonly Source[] = [
  ...face.sources,
  ...skin.sources,
  ...hair.sources,
  ...eyesSmile.sources,
  ...body.sources,
  ...postureGrooming.sources,
  ...presenceHabits.sources,
  ...safety.sources,
]

export const NATURAL_METHODS: readonly NaturalMethod[] = safety.naturalMethods
export const BANNED: readonly BannedItem[] = safety.banned
export const REFERRAL_FLAGS: readonly ReferralFlag[] = safety.referralFlags

const metricById = new Map(METRICS.map((m) => [m.id, m]))
const sourceById = new Map(SOURCES.map((s) => [s.id, s]))

export function getMetric(id: string): Metric | undefined {
  return metricById.get(id)
}
export function getSource(id: string): Source | undefined {
  return sourceById.get(id)
}
export function metricsByCategory(category: CategoryId): Metric[] {
  return METRICS.filter((m) => m.category === category)
}
export function totalWeight(metrics: readonly Metric[] = METRICS): number {
  return Math.round(metrics.reduce((s, m) => s + m.weight, 0) * 1e6) / 1e6
}
/** Metrics that can appear in the action plan (fixed / surgical / professional-only are excluded). */
export function isPlannable(m: Metric): boolean {
  return m.changeability === 'CHANGEABLE' || m.changeability === 'FIXED_BUT_VISIBILITY_CHANGEABLE'
}
export { CATEGORY_IDS }
