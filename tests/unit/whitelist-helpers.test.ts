import { describe, expect, it } from 'vitest'
import { PRODUCT_CATEGORIES } from '../../src/catalog/schema'
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  canMarkPassed,
  canToggleActive,
  describeError,
  needsPatchTest,
  patchBadge,
  patchDaysRemaining,
  patchSite,
} from '../../src/routes/whitelist/helpers'
import { StoreError } from '../../src/store'
import type { PatchTestStatus, WhitelistItem } from '../../src/types'

const DAY = 86_400_000
const T0 = 1_700_000_000_000

function item(status: PatchTestStatus, startedAt: number | null, reaction = false): Pick<WhitelistItem, 'patchTest'> {
  return {
    patchTest: { status, startedAt, entries: reaction ? [{ ts: T0, result: 'reaction', note: '' }] : [] },
  }
}

describe('whitelist helpers', () => {
  it('labels and orders every category exactly once', () => {
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...PRODUCT_CATEGORIES].sort())
    expect([...CATEGORY_ORDER].sort()).toEqual([...PRODUCT_CATEGORIES].sort())
  })

  it('computes days remaining', () => {
    expect(patchDaysRemaining(item('in_progress', T0), T0)).toBe(7)
    expect(patchDaysRemaining(item('in_progress', T0), T0 + 3 * DAY + 1)).toBe(4)
    expect(patchDaysRemaining(item('in_progress', T0), T0 + 7 * DAY)).toBe(0)
    expect(patchDaysRemaining(item('not_started', null), T0)).toBe(7)
    expect(patchDaysRemaining(item('in_progress', T0), T0 - 5000)).toBe(7)
  })

  it('allows passing only after 7 days without a reaction', () => {
    expect(canMarkPassed(item('in_progress', T0), T0 + 6 * DAY)).toBe(false)
    expect(canMarkPassed(item('in_progress', T0), T0 + 7 * DAY)).toBe(true)
    expect(canMarkPassed(item('in_progress', T0, true), T0 + 9 * DAY)).toBe(false)
    expect(canMarkPassed(item('not_started', null), T0 + 9 * DAY)).toBe(false)
  })

  it('only lets the switch move when the store would accept it', () => {
    expect(canToggleActive(item('not_needed', null))).toBe(true)
    expect(canToggleActive(item('passed', T0))).toBe(true)
    expect(canToggleActive(item('in_progress', T0))).toBe(false)
    expect(canToggleActive(item('failed', T0, true))).toBe(false)
  })

  it('picks the patch site', () => {
    expect(patchSite('shampoo')).toBe('behind the ear')
    expect(patchSite('cleanser')).toBe('inner forearm')
    expect(needsPatchTest('supplement')).toBe(false)
    expect(needsPatchTest('fragrance')).toBe(true)
  })

  it('badges the patch test state', () => {
    expect(patchBadge(item('failed', T0, true), T0)?.label).toBe('Excluded for good')
    expect(patchBadge(item('not_needed', null), T0)).toBeNull()
    expect(patchBadge(item('in_progress', T0), T0 + DAY)?.label).toBe('Patch test: 6 days left')
  })

  it('maps every store error code to a specific message', () => {
    const msgs = (['duplicate', 'invalid', 'forbidden', 'not_found'] as const).map((c) => describeError(new StoreError(c, 'Name cannot be empty')))
    expect(new Set(msgs).size).toBe(4)
    expect(describeError(new Error('boom'))).not.toContain('boom')
  })
})
