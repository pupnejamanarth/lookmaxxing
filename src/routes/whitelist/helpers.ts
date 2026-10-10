import { PATCH_TEST_DAYS, StoreError } from '../../store'
import type { PatchTestResult, ProductCategory, WhitelistItem } from '../../types'

const DAY_MS = 86_400_000

export { PATCH_TEST_DAYS }

/** Plain-language labels. Deliberately generic: no product, brand or ingredient names. */
export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  cleanser: 'Face cleanser',
  moisturizer: 'Moisturizer',
  sunscreen: 'Sunscreen',
  topical_active: 'Active skin treatment',
  shampoo: 'Shampoo',
  conditioner: 'Conditioner',
  hair_styling: 'Hair styling product',
  toothpaste: 'Toothpaste',
  mouthwash: 'Mouthwash',
  oral_care_other: 'Other oral care',
  deodorant: 'Deodorant',
  fragrance: 'Fragrance',
  shaving: 'Shaving product',
  natural_topical: 'Natural or homemade topical',
  supplement: 'Supplement',
  medication: 'Medication',
  other: 'Other',
}

export const CATEGORY_ORDER: readonly ProductCategory[] = [
  'cleanser',
  'moisturizer',
  'sunscreen',
  'topical_active',
  'shaving',
  'deodorant',
  'fragrance',
  'natural_topical',
  'shampoo',
  'conditioner',
  'hair_styling',
  'toothpaste',
  'mouthwash',
  'oral_care_other',
  'supplement',
  'medication',
  'other',
]

export const CATEGORY_OPTIONS = CATEGORY_ORDER.map((value) => ({ value, label: CATEGORY_LABEL[value] }))

/** Mirrors the store rule: products applied to skin, scalp or hair get a patch test when new. */
const NO_PATCH_TEST: ReadonlySet<ProductCategory> = new Set([
  'toothpaste',
  'mouthwash',
  'oral_care_other',
  'supplement',
  'medication',
  'other',
])
export const needsPatchTest = (category: ProductCategory): boolean => !NO_PATCH_TEST.has(category)

const SCALP: ReadonlySet<ProductCategory> = new Set(['shampoo', 'conditioner', 'hair_styling'])
export const patchSite = (category: ProductCategory): string => (SCALP.has(category) ? 'behind the ear' : 'inner forearm')

export const RESULT_LABEL: Record<PatchTestResult, string> = {
  no_reaction: 'No reaction',
  mild_irritation: 'Mild irritation',
  reaction: 'Reaction',
}

/** Whole days still needed before the test can pass. 0 when done or not started. */
export function patchDaysRemaining(item: Pick<WhitelistItem, 'patchTest'>, now: number): number {
  const { startedAt } = item.patchTest
  if (startedAt === null) return PATCH_TEST_DAYS
  const remaining = PATCH_TEST_DAYS * DAY_MS - Math.max(0, now - startedAt)
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS)
}

export const hasReaction = (item: Pick<WhitelistItem, 'patchTest'>): boolean =>
  item.patchTest.status === 'failed' || item.patchTest.entries.some((e) => e.result === 'reaction')

/** The newest logged result is mild irritation. The app holds the pass until a clean result follows. */
export const hasIrritationHold = (item: Pick<WhitelistItem, 'patchTest'>): boolean => {
  const { entries } = item.patchTest
  return entries.length > 0 && entries[entries.length - 1].result === 'mild_irritation'
}

export function canMarkPassed(item: Pick<WhitelistItem, 'patchTest'>, now: number): boolean {
  return (
    item.patchTest.status === 'in_progress' && !hasReaction(item) && !hasIrritationHold(item) && patchDaysRemaining(item, now) === 0
  )
}

/** The active switch only works when the store would accept it. */
export function canToggleActive(item: Pick<WhitelistItem, 'patchTest'>): boolean {
  const { status } = item.patchTest
  return status !== 'failed' && status !== 'not_started' && status !== 'in_progress'
}

export type PatchBadge = { label: string; tone: 'green' | 'amber' | 'red' | 'grey' } | null

export function patchBadge(item: Pick<WhitelistItem, 'patchTest'>, now: number): PatchBadge {
  switch (item.patchTest.status) {
    case 'failed':
      return { label: 'Excluded for good', tone: 'red' }
    case 'passed':
      return { label: 'Patch test passed', tone: 'green' }
    case 'not_started':
      return { label: 'Patch test not started', tone: 'amber' }
    case 'in_progress': {
      const left = patchDaysRemaining(item, now)
      return { label: left === 0 ? 'Patch test ready to pass' : `Patch test: ${left} ${left === 1 ? 'day' : 'days'} left`, tone: 'amber' }
    }
    default:
      return null
  }
}

/** Plain message for a failed store call. Never echoes raw internals for unknown errors. */
export function describeError(e: unknown): string {
  if (e instanceof StoreError) {
    switch (e.code) {
      case 'duplicate':
        return 'You already have a product with this name in this category. Change the name or the category.'
      case 'invalid':
        return `This was not saved. ${e.message}.`
      case 'forbidden':
        return `Not allowed. ${e.message}`
      case 'not_found':
        return 'This product no longer exists. It may have been removed. Reload the list.'
    }
  }
  return 'Something went wrong while saving on this device. Nothing was sent anywhere. Try again.'
}
