import type { Table } from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_CATEGORIES } from '../../src/catalog/schema'
import * as storeModule from '../../src/store'
import { LookmaxxingDB, StoreError, createStore, watch } from '../../src/store'
import type { AuditEvent, ProductCategory, WhitelistItem } from '../../src/types'

const DAY = 86_400_000
const START = 1_700_000_000_000

/** Applied to skin, scalp or hair: a NEW product in these categories must be patch tested first. */
const SKIN_SCALP_HAIR: ProductCategory[] = [
  'cleanser',
  'moisturizer',
  'sunscreen',
  'topical_active',
  'shampoo',
  'conditioner',
  'hair_styling',
  'shaving',
  'natural_topical',
  'deodorant',
  'fragrance',
]
const OTHER_CATEGORIES: ProductCategory[] = ['toothpaste', 'mouthwash', 'oral_care_other', 'supplement', 'medication', 'other']

let seq = 0
const opened: LookmaxxingDB[] = []

function setup() {
  const database = new LookmaxxingDB(`lmx-store-test-${++seq}`)
  opened.push(database)
  const clock = { t: START }
  let n = 0
  const store = createStore(database, { now: () => clock.t, uuid: () => `id-${++n}` })
  const advance = (ms: number) => {
    clock.t += ms
  }
  return { database, store, clock, advance }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    if (e instanceof StoreError) return e.code
    throw e
  }
  return 'resolved'
}

async function auditEvents(database: LookmaxxingDB): Promise<AuditEvent[]> {
  return (await database.audit.orderBy('id').toArray()).map((row) => row.event)
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(opened.splice(0).map((database) => database.delete()))
})

describe('public surface', () => {
  it('exports exactly what the UI is written against', () => {
    for (const name of ['db', 'LookmaxxingDB', 'store', 'createStore', 'StoreError', 'watch']) {
      expect(storeModule).toHaveProperty(name)
    }
    expect(Object.keys(storeModule.store).sort()).toEqual(
      [
        'getProfile',
        'updateProfile',
        'completeOnboarding',
        'listWhitelist',
        'getActiveWhitelist',
        'addWhitelistItem',
        'updateWhitelistItem',
        'setWhitelistActive',
        'removeWhitelistItem',
        'startPatchTest',
        'logPatchTest',
        'passPatchTest',
        'listAudit',
        'appendAudit',
        'requestPersistentStorage',
        'getStorageEstimate',
        'deleteAllData',
      ].sort(),
    )
  })

  it('declares the v1 schema', () => {
    const { database } = setup()
    const schema = Object.fromEntries(database.tables.map((t) => [t.name, t.schema.primKey.keyPath]))
    expect(schema).toEqual({ profile: 'id', whitelist: 'id', audit: 'id', kv: 'key' })
    expect(database.table('whitelist').schema.indexes.map((i) => i.name).sort()).toEqual(['active', 'addedAt', 'category'])
    expect(database.table('audit').schema.primKey.auto).toBe(true)
    expect(database.table('audit').schema.indexes.map((i) => i.name).sort()).toEqual(['event', 'ts'])
  })

  it('works with the real clock and uuid when no deps are injected', async () => {
    const database = new LookmaxxingDB(`lmx-store-test-${++seq}`)
    opened.push(database)
    const store = createStore(database)
    const before = Date.now()
    const item = await store.addWhitelistItem({ name: 'Synthetic cleanser', category: 'cleanser' })
    expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(item.addedAt).toBeGreaterThanOrEqual(before)
    expect(item.addedAt).toBeLessThanOrEqual(Date.now())
  })

  it('falls back to getRandomValues when randomUUID is unavailable (insecure context)', async () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    const database = new LookmaxxingDB(`lmx-store-test-${++seq}`)
    opened.push(database)
    const item = await createStore(database).addWhitelistItem({ name: 'Synthetic cleanser', category: 'cleanser' })
    expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('profile', () => {
  it('creates the default row on first call and keeps it afterwards', async () => {
    const { store, database, advance } = setup()
    expect(await database.profile.count()).toBe(0)
    const first = await store.getProfile()
    expect(first).toEqual({
      id: 'me',
      sexProfile: 'male',
      heightCm: null,
      units: 'metric',
      dailyMinutes: 30,
      trainingDaysPerWeek: 3,
      scanWeekday: 0,
      installedToHomeScreen: null,
      storagePersisted: null,
      privacyChecklist: {},
      equipmentChecklist: {},
      onboardedAt: null,
      createdAt: START,
      updatedAt: START,
    })
    advance(5000)
    expect(await store.getProfile()).toEqual(first)
    expect(await database.profile.count()).toBe(1)
  })

  it('creates exactly one row when called concurrently', async () => {
    const { store, database } = setup()
    const rows = await Promise.all([store.getProfile(), store.getProfile(), store.getProfile()])
    expect(new Set(rows.map((r) => r.createdAt)).size).toBe(1)
    expect(await database.profile.count()).toBe(1)
  })

  it('stores no name, email, date of birth or location field', async () => {
    const { store } = setup()
    const keys = Object.keys(await store.getProfile()).sort()
    expect(keys).toEqual(
      [
        'id',
        'sexProfile',
        'heightCm',
        'units',
        'dailyMinutes',
        'trainingDaysPerWeek',
        'scanWeekday',
        'installedToHomeScreen',
        'storagePersisted',
        'privacyChecklist',
        'equipmentChecklist',
        'onboardedAt',
        'createdAt',
        'updatedAt',
      ].sort(),
    )
  })

  it('applies a valid patch, bumps updatedAt, keeps createdAt and audits field names only', async () => {
    const { store, database, advance } = setup()
    await store.getProfile()
    advance(1000)
    const next = await store.updateProfile({
      heightCm: 181.5,
      units: 'imperial',
      dailyMinutes: 60,
      trainingDaysPerWeek: 5,
      scanWeekday: 6,
      installedToHomeScreen: true,
      privacyChecklist: { disk_encryption_on: true },
      equipmentChecklist: { bathroom_scale: false },
    })
    expect(next).toMatchObject({
      heightCm: 181.5,
      units: 'imperial',
      dailyMinutes: 60,
      trainingDaysPerWeek: 5,
      scanWeekday: 6,
      installedToHomeScreen: true,
      privacyChecklist: { disk_encryption_on: true },
      equipmentChecklist: { bathroom_scale: false },
      createdAt: START,
      updatedAt: START + 1000,
    })
    expect(await store.getProfile()).toEqual(next)
    const audit = await database.audit.toArray()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ event: 'settings_changed', ts: START + 1000 })
    expect(audit[0]?.detail).toContain('heightCm')
    expect(audit[0]?.detail).not.toContain('181')
  })

  it('creates the profile when updating before any read', async () => {
    const { store } = setup()
    const next = await store.updateProfile({ units: 'imperial' })
    expect(next.units).toBe('imperial')
    expect(next.dailyMinutes).toBe(30)
  })

  it('treats a patch that changes nothing as a no-op (no write, no audit row)', async () => {
    const { store, database, advance } = setup()
    const before = await store.getProfile()
    advance(1000)
    expect(await store.updateProfile({})).toEqual(before)
    expect(await store.updateProfile({ units: 'metric', dailyMinutes: 30, privacyChecklist: {}, heightCm: undefined })).toEqual(before)
    expect(await database.audit.count()).toBe(0)
  })

  it.each([
    ['heightCm below range', { heightCm: 119.9 }],
    ['heightCm above range', { heightCm: 230.1 }],
    ['heightCm NaN', { heightCm: Number.NaN }],
    ['heightCm Infinity', { heightCm: Number.POSITIVE_INFINITY }],
    ['heightCm as string', { heightCm: '180' }],
    ['units unknown', { units: 'furlongs' }],
    ['dailyMinutes 10', { dailyMinutes: 10 }],
    ['dailyMinutes 45', { dailyMinutes: 45 }],
    ['dailyMinutes as string', { dailyMinutes: '30' }],
    ['trainingDaysPerWeek -1', { trainingDaysPerWeek: -1 }],
    ['trainingDaysPerWeek 8', { trainingDaysPerWeek: 8 }],
    ['trainingDaysPerWeek fractional', { trainingDaysPerWeek: 2.5 }],
    ['scanWeekday -1', { scanWeekday: -1 }],
    ['scanWeekday 7', { scanWeekday: 7 }],
    ['scanWeekday fractional', { scanWeekday: 1.5 }],
    ['installedToHomeScreen as string', { installedToHomeScreen: 'yes' }],
    ['checklist value not boolean', { privacyChecklist: { a: 'yes' } }],
    ['checklist is an array', { equipmentChecklist: [true] }],
    ['checklist is null', { privacyChecklist: null }],
    ['checklist key empty', { privacyChecklist: { '': true } }],
  ])('rejects %s', async (_label, patch) => {
    const { store, database } = setup()
    const before = await store.getProfile()
    expect(await codeOf(store.updateProfile(patch as never))).toBe('invalid')
    expect(await store.getProfile()).toEqual(before)
    expect(await database.audit.count()).toBe(0)
  })

  it.each([
    ['heightCm', 120],
    ['heightCm', 230],
    ['heightCm', null],
    ['dailyMinutes', 15],
    ['dailyMinutes', 60],
    ['trainingDaysPerWeek', 0],
    ['trainingDaysPerWeek', 7],
    ['scanWeekday', 0],
    ['scanWeekday', 6],
    ['installedToHomeScreen', false],
  ])('accepts boundary value %s = %s', async (key, value) => {
    const { store } = setup()
    const next = await store.updateProfile({ [key]: value })
    expect(next).toHaveProperty(key, value)
  })

  it.each([
    ['onboardedAt', 5],
    ['onboardedAt', null],
    ['storagePersisted', true],
    ['storagePersisted', null],
  ])('forbids setting %s = %s directly', async (key, value) => {
    const { store, database } = setup()
    const before = await store.getProfile()
    expect(await codeOf(store.updateProfile({ [key]: value } as never))).toBe('forbidden')
    expect(await store.getProfile()).toEqual(before)
    expect(await database.audit.count()).toBe(0)
  })

  it('refuses to clear the height once onboarded', async () => {
    const { store } = setup()
    await store.updateProfile({ heightCm: 180 })
    await store.completeOnboarding()
    expect(await codeOf(store.updateProfile({ heightCm: null }))).toBe('invalid')
    expect((await store.getProfile()).heightCm).toBe(180)
    expect((await store.updateProfile({ heightCm: 181 })).heightCm).toBe(181)
  })

  it.each(['id', 'createdAt', 'updatedAt', 'sexProfile', 'name', 'email', 'dateOfBirth', 'location'])(
    'rejects the unknown or immutable field "%s"',
    async (key) => {
      const { store, database } = setup()
      const before = await store.getProfile()
      expect(await codeOf(store.updateProfile({ [key]: 'x' } as never))).toBe('invalid')
      expect(await store.getProfile()).toEqual(before)
      expect(await database.audit.count()).toBe(0)
    },
  )

  it('applies nothing when one field of a patch is invalid', async () => {
    const { store } = setup()
    const before = await store.getProfile()
    expect(await codeOf(store.updateProfile({ units: 'imperial', dailyMinutes: 99 as never }))).toBe('invalid')
    expect(await store.getProfile()).toEqual(before)
  })

  it('does not alias the caller\'s checklist object', async () => {
    const { store } = setup()
    const checklist = { disk_encryption_on: true }
    await store.updateProfile({ privacyChecklist: checklist })
    checklist.disk_encryption_on = false
    expect((await store.getProfile()).privacyChecklist).toEqual({ disk_encryption_on: true })
  })

  describe('onboarding gate', () => {
    it('refuses to complete without a height and leaves no trace', async () => {
      const { store, database } = setup()
      expect(await codeOf(store.completeOnboarding())).toBe('invalid')
      expect((await store.getProfile()).onboardedAt).toBeNull()
      expect(await database.audit.count()).toBe(0)
    })

    it('refuses again after the height is cleared back to null', async () => {
      const { store } = setup()
      await store.updateProfile({ heightCm: 180 })
      await store.updateProfile({ heightCm: null })
      expect(await codeOf(store.completeOnboarding())).toBe('invalid')
    })

    it('sets onboardedAt once and audits once', async () => {
      const { store, database, advance } = setup()
      await store.updateProfile({ heightCm: 180 })
      advance(2000)
      const done = await store.completeOnboarding()
      expect(done.onboardedAt).toBe(START + 2000)
      expect(done.updatedAt).toBe(START + 2000)
      advance(9000)
      const again = await store.completeOnboarding()
      expect(again.onboardedAt).toBe(START + 2000)
      expect(await auditEvents(database)).toEqual(['settings_changed', 'onboarding_completed'])
    })
  })
})

describe('whitelist: empty by default', () => {
  it('a fresh database has an empty list and an empty active list', async () => {
    const { store } = setup()
    expect(await store.listWhitelist()).toEqual([])
    expect(await store.getActiveWhitelist()).toEqual([])
  })

  it('stays empty through profile setup and onboarding', async () => {
    const { store } = setup()
    await store.updateProfile({ heightCm: 180, privacyChecklist: { disk_encryption_on: true } })
    await store.completeOnboarding()
    await store.requestPersistentStorage()
    expect(await store.listWhitelist()).toEqual([])
    expect(await store.getActiveWhitelist()).toEqual([])
  })

  it('is empty again after deleting everything', async () => {
    const { store } = setup()
    await store.addWhitelistItem({ name: 'Synthetic cleanser', category: 'cleanser' })
    await store.deleteAllData()
    expect(await store.getActiveWhitelist()).toEqual([])
  })
})

describe('whitelist: add, validate, update', () => {
  it('adds an item with a trimmed name, defaults and an audit row', async () => {
    const { store, database } = setup()
    const item = await store.addWhitelistItem({ name: '  Synthetic cleanser A  ', category: 'cleanser' })
    expect(item).toEqual({
      id: 'id-1',
      name: 'Synthetic cleanser A',
      category: 'cleanser',
      notes: '',
      active: true,
      addedAt: START,
      updatedAt: START,
      patchTest: { status: 'not_needed', startedAt: null, entries: [] },
    })
    expect(await store.listWhitelist()).toEqual([item])
    const audit = await database.audit.toArray()
    expect(audit).toEqual([
      { id: 1, ts: START, event: 'whitelist_added', detail: 'Added "Synthetic cleanser A" (cleanser)' },
    ])
  })

  it('keeps trimmed notes', async () => {
    const { store } = setup()
    const item = await store.addWhitelistItem({ name: 'Synthetic balm', category: 'moisturizer', notes: '  twice daily  ' })
    expect(item.notes).toBe('twice daily')
  })

  it('lists by addedAt ascending', async () => {
    const { store, advance } = setup()
    await store.addWhitelistItem({ name: 'First', category: 'cleanser' })
    advance(10)
    await store.addWhitelistItem({ name: 'Second', category: 'toothpaste' })
    advance(10)
    await store.addWhitelistItem({ name: 'Third', category: 'shampoo' })
    expect((await store.listWhitelist()).map((i) => i.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('accepts names and notes at the length limits', async () => {
    const { store } = setup()
    const item = await store.addWhitelistItem({ name: 'n'.repeat(80), category: 'other', notes: 'x'.repeat(500) })
    expect(item.name).toHaveLength(80)
    expect(item.notes).toHaveLength(500)
  })

  it.each([
    ['empty name', { name: '', category: 'cleanser' }],
    ['whitespace-only name', { name: '   \n ', category: 'cleanser' }],
    ['81-character name', { name: 'n'.repeat(81), category: 'cleanser' }],
    ['non-string name', { name: 42, category: 'cleanser' }],
    ['missing name', { category: 'cleanser' }],
    ['501-character notes', { name: 'ok', category: 'cleanser', notes: 'x'.repeat(501) }],
    ['non-string notes', { name: 'ok', category: 'cleanser', notes: 5 }],
    ['unknown category', { name: 'ok', category: 'perfume' }],
    ['missing category', { name: 'ok' }],
    ['non-boolean alreadyUsing', { name: 'ok', category: 'cleanser', alreadyUsing: 'yes' }],
    ['extra field', { name: 'ok', category: 'cleanser', active: true }],
    ['null input', null],
  ])('rejects %s', async (_label, input) => {
    const { store, database } = setup()
    expect(await codeOf(store.addWhitelistItem(input as never))).toBe('invalid')
    expect(await database.whitelist.count()).toBe(0)
    expect(await database.audit.count()).toBe(0)
  })

  describe('duplicates', () => {
    it('rejects a case-insensitive duplicate name in the same category', async () => {
      const { store, database } = setup()
      await store.addWhitelistItem({ name: 'Synthetic Cleanser', category: 'cleanser' })
      expect(await codeOf(store.addWhitelistItem({ name: 'synthetic cleanser', category: 'cleanser' }))).toBe('duplicate')
      expect(await codeOf(store.addWhitelistItem({ name: '  SYNTHETIC   CLEANSER ', category: 'cleanser' }))).toBe('duplicate')
      expect(await database.whitelist.count()).toBe(1)
      expect(await database.audit.count()).toBe(1)
    })

    it('allows the same name in another category', async () => {
      const { store } = setup()
      await store.addWhitelistItem({ name: 'Synthetic', category: 'cleanser' })
      const other = await store.addWhitelistItem({ name: 'synthetic', category: 'shampoo' })
      expect(other.category).toBe('shampoo')
    })

    it('rejects a trial duplicate of a current-stack item', async () => {
      const { store } = setup()
      await store.addWhitelistItem({ name: 'Synthetic', category: 'cleanser' })
      expect(await codeOf(store.addWhitelistItem({ name: 'Synthetic', category: 'cleanser', alreadyUsing: false }))).toBe('duplicate')
    })

    it('rejects renaming onto another item in the same category but allows a case-only rename of itself', async () => {
      const { store } = setup()
      await store.addWhitelistItem({ name: 'Alpha', category: 'cleanser' })
      const beta = await store.addWhitelistItem({ name: 'Beta', category: 'cleanser' })
      expect(await codeOf(store.updateWhitelistItem(beta.id, { name: 'ALPHA' }))).toBe('duplicate')
      expect((await store.updateWhitelistItem(beta.id, { name: 'BETA' })).name).toBe('BETA')
    })

    it('rejects moving an item into a category where its name already exists', async () => {
      const { store } = setup()
      await store.addWhitelistItem({ name: 'Same', category: 'shampoo' })
      const cleanser = await store.addWhitelistItem({ name: 'same', category: 'cleanser' })
      expect(await codeOf(store.updateWhitelistItem(cleanser.id, { category: 'shampoo' }))).toBe('duplicate')
      expect((await store.listWhitelist()).find((i) => i.id === cleanser.id)?.category).toBe('cleanser')
    })
  })

  describe('update', () => {
    it('changes name, category and notes, bumps updatedAt and audits', async () => {
      const { store, database, advance } = setup()
      const item = await store.addWhitelistItem({ name: 'Old', category: 'cleanser' })
      advance(500)
      const next = await store.updateWhitelistItem(item.id, { name: ' New ', category: 'moisturizer', notes: 'note' })
      expect(next).toEqual({ ...item, name: 'New', category: 'moisturizer', notes: 'note', updatedAt: START + 500 })
      expect(await store.listWhitelist()).toEqual([next])
      const last = (await database.audit.toArray()).at(-1)
      expect(last).toMatchObject({ event: 'whitelist_updated', ts: START + 500 })
      expect(last?.detail).toBe('Updated "New" (moisturizer): changed name, category, notes')
    })

    it('can clear notes', async () => {
      const { store } = setup()
      const item = await store.addWhitelistItem({ name: 'A', category: 'cleanser', notes: 'x' })
      expect((await store.updateWhitelistItem(item.id, { notes: '' })).notes).toBe('')
    })

    it('treats an empty or identical patch as a no-op without an audit row', async () => {
      const { store, database, advance } = setup()
      const item = await store.addWhitelistItem({ name: 'A', category: 'cleanser' })
      advance(500)
      expect(await store.updateWhitelistItem(item.id, {})).toEqual(item)
      expect(await store.updateWhitelistItem(item.id, { name: 'A', category: 'cleanser', notes: '' })).toEqual(item)
      expect(await database.audit.count()).toBe(1)
    })

    it('throws not_found for an unknown id', async () => {
      const { store } = setup()
      expect(await codeOf(store.updateWhitelistItem('nope', { name: 'x' }))).toBe('not_found')
    })

    it('validates the patch', async () => {
      const { store } = setup()
      const item = await store.addWhitelistItem({ name: 'A', category: 'cleanser' })
      expect(await codeOf(store.updateWhitelistItem(item.id, { name: '' }))).toBe('invalid')
      expect(await codeOf(store.updateWhitelistItem(item.id, { name: 'n'.repeat(81) }))).toBe('invalid')
      expect(await codeOf(store.updateWhitelistItem(item.id, { notes: 'x'.repeat(501) }))).toBe('invalid')
      expect(await codeOf(store.updateWhitelistItem(item.id, { category: 'perfume' as never }))).toBe('invalid')
      expect(await codeOf(store.updateWhitelistItem('', { name: 'x' }))).toBe('invalid')
    })

    it('cannot be used to bypass the activation or patch-test rules', async () => {
      const { store } = setup()
      const trial = await store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
      expect(await codeOf(store.updateWhitelistItem(trial.id, { active: true } as never))).toBe('invalid')
      expect(await codeOf(store.updateWhitelistItem(trial.id, { patchTest: { status: 'passed' } } as never))).toBe('invalid')
      expect(await codeOf(store.updateWhitelistItem(trial.id, { id: 'other' } as never))).toBe('invalid')
      expect((await store.getActiveWhitelist())).toEqual([])
    })

    it('leaves the patch-test record alone when the category change keeps the same rule', async () => {
      const { store } = setup()
      const item = await store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
      const moved = await store.updateWhitelistItem(item.id, { category: 'moisturizer' })
      expect(moved.patchTest).toEqual(item.patchTest)
      expect(moved.active).toBe(false)
    })

    it('refuses a category change that crosses the patch-test rule, in both directions', async () => {
      const { store } = setup()
      const a = await store.addWhitelistItem({ name: 'X', category: 'other', alreadyUsing: false })
      expect(await codeOf(store.updateWhitelistItem(a.id, { category: 'cleanser' }))).toBe('forbidden')
      const b = await store.addWhitelistItem({ name: 'Y', category: 'cleanser', alreadyUsing: false })
      expect(await codeOf(store.updateWhitelistItem(b.id, { category: 'toothpaste' }))).toBe('forbidden')
      expect((await store.listWhitelist()).map((i) => i.category)).toEqual(['other', 'cleanser'])
    })
  })

  describe('remove', () => {
    it('deletes the item and audits it', async () => {
      const { store, database } = setup()
      const item = await store.addWhitelistItem({ name: 'Synthetic', category: 'toothpaste' })
      await store.removeWhitelistItem(item.id)
      expect(await store.listWhitelist()).toEqual([])
      expect((await database.audit.toArray()).at(-1)).toMatchObject({
        event: 'whitelist_removed',
        detail: 'Removed "Synthetic" (toothpaste)',
      })
    })

    it('throws not_found for an unknown or already removed id', async () => {
      const { store } = setup()
      const item = await store.addWhitelistItem({ name: 'Synthetic', category: 'toothpaste' })
      await store.removeWhitelistItem(item.id)
      expect(await codeOf(store.removeWhitelistItem(item.id))).toBe('not_found')
      expect(await codeOf(store.removeWhitelistItem('nope'))).toBe('not_found')
    })

    it('allows the same name to be added again afterwards', async () => {
      const { store } = setup()
      const item = await store.addWhitelistItem({ name: 'Synthetic', category: 'toothpaste' })
      await store.removeWhitelistItem(item.id)
      expect((await store.addWhitelistItem({ name: 'Synthetic', category: 'toothpaste' })).name).toBe('Synthetic')
    })
  })
})

describe('whitelist: alreadyUsing vs trial', () => {
  it('the test matrix covers every product category exactly once', () => {
    expect([...SKIN_SCALP_HAIR, ...OTHER_CATEGORIES].sort()).toEqual([...PRODUCT_CATEGORIES].sort())
  })

  it.each(PRODUCT_CATEGORIES)('%s: alreadyUsing (explicit or default) is active with no patch test', async (category) => {
    const { store } = setup()
    const byDefault = await store.addWhitelistItem({ name: 'Default', category })
    const explicit = await store.addWhitelistItem({ name: 'Explicit', category, alreadyUsing: true })
    for (const item of [byDefault, explicit]) {
      expect(item.active).toBe(true)
      expect(item.patchTest).toEqual({ status: 'not_needed', startedAt: null, entries: [] })
    }
  })

  it.each(SKIN_SCALP_HAIR)('%s: a new trial product starts inactive with its patch test not started', async (category) => {
    const { store } = setup()
    const item = await store.addWhitelistItem({ name: 'Trial', category, alreadyUsing: false })
    expect(item.active).toBe(false)
    expect(item.patchTest).toEqual({ status: 'not_started', startedAt: null, entries: [] })
    expect(await store.getActiveWhitelist()).toEqual([])
  })

  it.each(OTHER_CATEGORIES)('%s: a new product that is not applied to skin or hair needs no patch test', async (category) => {
    const { store } = setup()
    const item = await store.addWhitelistItem({ name: 'New', category, alreadyUsing: false })
    expect(item.active).toBe(true)
    expect(item.patchTest.status).toBe('not_needed')
    expect(await store.getActiveWhitelist()).toEqual([item])
  })

  it('audits a trial add as such', async () => {
    const { store, database } = setup()
    await store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
    const row = (await database.audit.toArray())[0]
    expect(row?.event).toBe('whitelist_added')
    expect(row?.detail).toContain('Added "Trial" (cleanser)')
  })
})

describe('whitelist: active list and toggling', () => {
  it('getActiveWhitelist returns only active items that have not failed, by addedAt', async () => {
    const { store, database, advance } = setup()
    const a = await store.addWhitelistItem({ name: 'A', category: 'cleanser' })
    advance(10)
    const b = await store.addWhitelistItem({ name: 'B', category: 'cleanser' })
    advance(10)
    await store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
    advance(10)
    const failed = await store.addWhitelistItem({ name: 'Failed', category: 'cleanser' })
    await store.setWhitelistActive(b.id, false)
    // Corrupt-state defence: even a failed item that somehow reads active:true is never returned.
    await database.whitelist.update(failed.id, { active: true, patchTest: { status: 'failed', startedAt: null, entries: [] } })
    expect((await store.getActiveWhitelist()).map((i) => i.id)).toEqual([a.id])
    expect((await store.listWhitelist()).map((i) => i.name)).toEqual(['A', 'B', 'Trial', 'Failed'])
  })

  it('toggles a current-stack item off and on with audit rows, and ignores no-op toggles', async () => {
    const { store, database } = setup()
    const item = await store.addWhitelistItem({ name: 'A', category: 'cleanser' })
    const off = await store.setWhitelistActive(item.id, false)
    expect(off.active).toBe(false)
    expect(await store.getActiveWhitelist()).toEqual([])
    await store.setWhitelistActive(item.id, false)
    const on = await store.setWhitelistActive(item.id, true)
    expect(on.active).toBe(true)
    expect(await store.getActiveWhitelist()).toHaveLength(1)
    await store.setWhitelistActive(item.id, true)
    expect(await auditEvents(database)).toEqual(['whitelist_added', 'whitelist_toggled', 'whitelist_toggled'])
    const details = (await database.audit.toArray()).slice(1).map((r) => r.detail)
    expect(details).toEqual(['Deactivated "A" (cleanser)', 'Activated "A" (cleanser)'])
  })

  it('refuses to activate a trial item whose patch test has not passed', async () => {
    const { store } = setup()
    const item = await store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
    expect(await codeOf(store.setWhitelistActive(item.id, true))).toBe('forbidden')
    await store.startPatchTest(item.id)
    expect(await codeOf(store.setWhitelistActive(item.id, true))).toBe('forbidden')
    expect(await store.getActiveWhitelist()).toEqual([])
  })

  it('allows deactivating a trial item (a no-op) and rejects bad input', async () => {
    const { store } = setup()
    const item = await store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
    expect((await store.setWhitelistActive(item.id, false)).active).toBe(false)
    expect(await codeOf(store.setWhitelistActive(item.id, 'yes' as never))).toBe('invalid')
    expect(await codeOf(store.setWhitelistActive('nope', true))).toBe('not_found')
  })
})

describe('patch-test lifecycle', () => {
  async function trial() {
    const env = setup()
    const item = await env.store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
    return { ...env, item }
  }

  it('startPatchTest moves not_started to in_progress and stamps startedAt', async () => {
    const { store, database, item, advance } = await trial()
    advance(1234)
    const started = await store.startPatchTest(item.id)
    expect(started.patchTest).toEqual({ status: 'in_progress', startedAt: START + 1234, entries: [] })
    expect(started.active).toBe(false)
    expect(started.updatedAt).toBe(START + 1234)
    const last = (await database.audit.toArray()).at(-1)
    expect(last).toMatchObject({ event: 'patch_test_started', detail: 'Started patch test for "Trial" (cleanser)' })
  })

  it('startPatchTest refuses products that need no test or already passed', async () => {
    const { store, advance } = await trial()
    const current = await store.addWhitelistItem({ name: 'Current', category: 'cleanser' })
    expect(await codeOf(store.startPatchTest(current.id))).toBe('forbidden')
    const other = await store.addWhitelistItem({ name: 'Paste', category: 'toothpaste', alreadyUsing: false })
    expect(await codeOf(store.startPatchTest(other.id))).toBe('forbidden')
    const t = await store.addWhitelistItem({ name: 'T2', category: 'shampoo', alreadyUsing: false })
    await store.startPatchTest(t.id)
    advance(7 * DAY)
    await store.passPatchTest(t.id)
    expect(await codeOf(store.startPatchTest(t.id))).toBe('forbidden')
    expect(await codeOf(store.startPatchTest('nope'))).toBe('not_found')
  })

  it('restarting a running test resets the clock but keeps the log', async () => {
    const { store, item, advance } = await trial()
    await store.startPatchTest(item.id)
    await store.logPatchTest(item.id, 'mild_irritation', 'slight redness')
    advance(5 * DAY)
    const restarted = await store.startPatchTest(item.id)
    expect(restarted.patchTest.startedAt).toBe(START + 5 * DAY)
    expect(restarted.patchTest.entries).toHaveLength(1)
    advance(5 * DAY)
    expect(await codeOf(store.passPatchTest(item.id))).toBe('forbidden')
    advance(2 * DAY)
    expect((await store.passPatchTest(item.id)).patchTest.status).toBe('passed')
  })

  it('logs no_reaction and mild_irritation entries while the test keeps running', async () => {
    const { store, database, item, advance } = await trial()
    await store.startPatchTest(item.id)
    advance(DAY)
    await store.logPatchTest(item.id, 'no_reaction')
    advance(DAY)
    const mild = await store.logPatchTest(item.id, 'mild_irritation', '  tingling  ')
    expect(mild.patchTest.status).toBe('in_progress')
    expect(mild.active).toBe(false)
    expect(mild.patchTest.entries).toEqual([
      { ts: START + DAY, result: 'no_reaction', note: '' },
      { ts: START + 2 * DAY, result: 'mild_irritation', note: 'tingling' },
    ])
    const rows = (await database.audit.toArray()).filter((r) => r.event === 'patch_test_logged')
    expect(rows.map((r) => r.detail)).toEqual([
      'Patch test for "Trial" (cleanser): no_reaction',
      'Patch test for "Trial" (cleanser): mild_irritation',
    ])
    expect(rows.every((r) => !r.detail.includes('tingling'))).toBe(true)
  })

  it('refuses no_reaction / mild_irritation before the test was started', async () => {
    const { store, item } = await trial()
    expect(await codeOf(store.logPatchTest(item.id, 'no_reaction'))).toBe('forbidden')
    expect(await codeOf(store.logPatchTest(item.id, 'mild_irritation'))).toBe('forbidden')
    const current = await store.addWhitelistItem({ name: 'Current', category: 'cleanser' })
    expect(await codeOf(store.logPatchTest(current.id, 'no_reaction'))).toBe('forbidden')
  })

  it('validates the result and the note', async () => {
    const { store, item } = await trial()
    await store.startPatchTest(item.id)
    expect(await codeOf(store.logPatchTest(item.id, 'fine' as never))).toBe('invalid')
    expect(await codeOf(store.logPatchTest(item.id, 'no_reaction', 'x'.repeat(501)))).toBe('invalid')
    expect(await codeOf(store.logPatchTest('nope', 'no_reaction'))).toBe('not_found')
  })

  describe('a reaction is permanent', () => {
    async function failedTrial() {
      const env = await trial()
      await env.store.startPatchTest(env.item.id)
      env.advance(DAY)
      const failed = await env.store.logPatchTest(env.item.id, 'reaction', 'rash')
      return { ...env, failed }
    }

    it('marks the product failed, inactive and out of the active list', async () => {
      const { store, failed, database } = await failedTrial()
      expect(failed.active).toBe(false)
      expect(failed.patchTest.status).toBe('failed')
      expect(failed.patchTest.entries.at(-1)).toMatchObject({ result: 'reaction', note: 'rash' })
      expect(await store.getActiveWhitelist()).toEqual([])
      expect((await database.audit.toArray()).at(-1)?.detail).toContain('reaction')
    })

    it('cannot be re-activated, re-tested, passed or logged against again', async () => {
      const { store, item, advance } = await failedTrial()
      advance(30 * DAY)
      expect(await codeOf(store.setWhitelistActive(item.id, true))).toBe('forbidden')
      expect(await codeOf(store.startPatchTest(item.id))).toBe('forbidden')
      expect(await codeOf(store.passPatchTest(item.id))).toBe('forbidden')
      expect(await codeOf(store.logPatchTest(item.id, 'no_reaction'))).toBe('forbidden')
      expect(await codeOf(store.logPatchTest(item.id, 'reaction'))).toBe('forbidden')
      expect(await store.getActiveWhitelist()).toEqual([])
      const stored = (await store.listWhitelist())[0]
      expect(stored?.patchTest.status).toBe('failed')
      expect(stored?.active).toBe(false)
    })

    it('survives renaming, recategorising and deactivating', async () => {
      const { store, item } = await failedTrial()
      expect(await codeOf(store.updateWhitelistItem(item.id, { name: 'Renamed' }))).toBe('forbidden')
      expect(await codeOf(store.updateWhitelistItem(item.id, { category: 'moisturizer' }))).toBe('forbidden')
      await store.updateWhitelistItem(item.id, { notes: 'still editable' })
      await store.setWhitelistActive(item.id, false)
      expect(await codeOf(store.setWhitelistActive(item.id, true))).toBe('forbidden')
      expect((await store.listWhitelist())[0]?.patchTest.status).toBe('failed')
    })

    it('keeps excluding the product after remove + re-add, rename + re-add and recategorise + re-add', async () => {
      const { store, database } = setup()
      const mk = async (name: string, category: ProductCategory = 'cleanser') =>
        store.addWhitelistItem({ name, category })
      const a = await mk('Bad One')
      await store.logPatchTest(a.id, 'reaction')
      await store.removeWhitelistItem(a.id)
      expect(await codeOf(mk('  bad ONE '))).toBe('forbidden')
      expect(await store.getActiveWhitelist()).toEqual([])
      // a different item cannot be renamed into the excluded product either
      const other = await mk('Other')
      expect(await codeOf(store.updateWhitelistItem(other.id, { name: 'Bad One' }))).toBe('forbidden')
      // the same name in another category is a different product
      expect((await mk('Bad One', 'moisturizer')).active).toBe(true)
      const before = await database.audit.count()
      expect(await codeOf(mk('Bad One'))).toBe('forbidden')
      expect(await database.audit.count()).toBe(before)
      // a failed item that is renamed or recategorised is refused, so no one can launder it
      const b = await mk('Bad Two', 'shampoo')
      await store.logPatchTest(b.id, 'reaction')
      expect(await codeOf(store.updateWhitelistItem(b.id, { name: 'Fresh' }))).toBe('forbidden')
      expect(await codeOf(store.updateWhitelistItem(b.id, { category: 'conditioner' }))).toBe('forbidden')
      expect(await codeOf(mk('Bad Two', 'shampoo'))).toBe('forbidden')
    })

    it('can be reported for a product already in use, which then leaves the active list', async () => {
      const { store } = setup()
      const current = await store.addWhitelistItem({ name: 'Current', category: 'cleanser' })
      expect(await store.getActiveWhitelist()).toHaveLength(1)
      const failed = await store.logPatchTest(current.id, 'reaction')
      expect(failed.patchTest.status).toBe('failed')
      expect(failed.active).toBe(false)
      expect(await store.getActiveWhitelist()).toEqual([])
      expect(await codeOf(store.setWhitelistActive(current.id, true))).toBe('forbidden')
    })

    it('can be reported for a trial product whose test has not started', async () => {
      const { store, item } = await trial()
      expect((await store.logPatchTest(item.id, 'reaction')).patchTest.status).toBe('failed')
    })

    it('wins over a previously passed test', async () => {
      const { store, item, advance } = await trial()
      await store.startPatchTest(item.id)
      advance(7 * DAY)
      await store.passPatchTest(item.id)
      expect(await store.getActiveWhitelist()).toHaveLength(1)
      const failed = await store.logPatchTest(item.id, 'reaction')
      expect(failed.patchTest.status).toBe('failed')
      expect(await store.getActiveWhitelist()).toEqual([])
    })
  })

  describe('passPatchTest: the 7-day rule', () => {
    it('refuses before 7 days and passes at exactly 7 days', async () => {
      const { store, item, advance } = await trial()
      advance(1000)
      await store.startPatchTest(item.id)
      advance(7 * DAY - 1)
      const early = store.passPatchTest(item.id)
      expect(await codeOf(early)).toBe('forbidden')
      expect((await store.listWhitelist())[0]?.patchTest.status).toBe('in_progress')
      expect(await store.getActiveWhitelist()).toEqual([])
      advance(1)
      const passed = await store.passPatchTest(item.id)
      expect(passed.patchTest.status).toBe('passed')
      expect(passed.active).toBe(true)
      expect((await store.getActiveWhitelist()).map((i) => i.id)).toEqual([item.id])
    })

    it('says how many days remain', async () => {
      const { store, item, advance } = await trial()
      await store.startPatchTest(item.id)
      advance(2 * DAY)
      await expect(store.passPatchTest(item.id)).rejects.toThrow(/5 more day/)
    })

    it('audits the pass and cannot pass twice', async () => {
      const { store, database, item, advance } = await trial()
      await store.startPatchTest(item.id)
      advance(8 * DAY)
      await store.passPatchTest(item.id)
      expect((await database.audit.toArray()).at(-1)).toMatchObject({
        event: 'patch_test_logged',
        detail: 'Patch test passed for "Trial" (cleanser), now active',
      })
      expect(await codeOf(store.passPatchTest(item.id))).toBe('forbidden')
    })

    it('refuses when the test was never started or is not needed', async () => {
      const { store, item, advance } = await trial()
      advance(30 * DAY)
      expect(await codeOf(store.passPatchTest(item.id))).toBe('forbidden')
      const current = await store.addWhitelistItem({ name: 'Current', category: 'cleanser' })
      expect(await codeOf(store.passPatchTest(current.id))).toBe('forbidden')
      expect(await codeOf(store.passPatchTest('nope'))).toBe('not_found')
    })

    it('refuses when a reaction entry exists even if the status was tampered with', async () => {
      const { store, database, item, advance } = await trial()
      await store.startPatchTest(item.id)
      await database.whitelist.update(item.id, {
        patchTest: {
          status: 'in_progress',
          startedAt: START,
          entries: [{ ts: START, result: 'reaction', note: '' }],
        },
      })
      advance(30 * DAY)
      expect(await codeOf(store.passPatchTest(item.id))).toBe('forbidden')
      expect(await store.getActiveWhitelist()).toEqual([])
    })
  })

  it('a full happy path: add, start, log, wait, pass, use', async () => {
    const { store, database, advance } = setup()
    const item = await store.addWhitelistItem({ name: 'New sunscreen', category: 'sunscreen', alreadyUsing: false })
    expect(await store.getActiveWhitelist()).toEqual([])
    await store.startPatchTest(item.id)
    for (let day = 1; day <= 6; day++) {
      advance(DAY)
      await store.logPatchTest(item.id, 'no_reaction')
    }
    expect(await codeOf(store.passPatchTest(item.id))).toBe('forbidden')
    advance(DAY)
    await store.passPatchTest(item.id)
    expect((await store.getActiveWhitelist()).map((i) => i.name)).toEqual(['New sunscreen'])
    expect(await auditEvents(database)).toEqual([
      'whitelist_added',
      'patch_test_started',
      ...Array<AuditEvent>(6).fill('patch_test_logged'),
      'patch_test_logged',
    ])
  })
})

describe('audit', () => {
  it('lists newest first with a default limit of 100', async () => {
    const { store, advance } = setup()
    for (let i = 1; i <= 120; i++) {
      advance(1)
      await store.appendAudit('settings_changed', `row ${i}`)
    }
    const rows = await store.listAudit()
    expect(rows).toHaveLength(100)
    expect(rows[0]?.detail).toBe('row 120')
    expect(rows.at(-1)?.detail).toBe('row 21')
    const few = await store.listAudit(3)
    expect(few.map((r) => r.detail)).toEqual(['row 120', 'row 119', 'row 118'])
  })

  it('orders by insertion even when the clock does not move', async () => {
    const { store } = setup()
    await store.appendAudit('settings_changed', 'first')
    await store.appendAudit('settings_changed', 'second')
    expect((await store.listAudit()).map((r) => r.detail)).toEqual(['second', 'first'])
  })

  it('rejects an invalid limit', async () => {
    const { store } = setup()
    for (const limit of [0, -1, 1.5, Number.NaN, 10_001]) {
      expect(await codeOf(store.listAudit(limit))).toBe('invalid')
    }
  })

  it('appendAudit stamps the injected time and validates its input', async () => {
    const { store, advance } = setup()
    advance(77)
    await store.appendAudit('network_blocked', 'blocked a request to a foreign origin')
    expect(await store.listAudit()).toEqual([
      { id: 1, ts: START + 77, event: 'network_blocked', detail: 'blocked a request to a foreign origin' },
    ])
    expect(await codeOf(store.appendAudit('page_viewed' as never, 'x'))).toBe('invalid')
    expect(await codeOf(store.appendAudit('toString' as never, 'x'))).toBe('invalid')
    expect(await codeOf(store.appendAudit('settings_changed', 5 as never))).toBe('invalid')
  })

  it('truncates very long details', async () => {
    const { store } = setup()
    await store.appendAudit('settings_changed', 'x'.repeat(2000))
    const [row] = await store.listAudit(1)
    expect(row?.detail).toHaveLength(500)
  })

  it('every mutating call appends exactly one audit row with the right event', async () => {
    const { store, database, advance } = setup()
    const expectOneRow = async (event: AuditEvent, action: () => Promise<unknown>) => {
      const before = await database.audit.count()
      await action()
      const rows = await database.audit.orderBy('id').toArray()
      expect(rows.length, `rows after ${event}`).toBe(before + 1)
      expect(rows.at(-1)?.event).toBe(event)
    }

    let id = ''
    let trialId = ''
    await expectOneRow('settings_changed', () => store.updateProfile({ heightCm: 180 }))
    await expectOneRow('onboarding_completed', () => store.completeOnboarding())
    await expectOneRow('whitelist_added', async () => {
      id = (await store.addWhitelistItem({ name: 'Current', category: 'cleanser' })).id
    })
    await expectOneRow('whitelist_added', async () => {
      trialId = (await store.addWhitelistItem({ name: 'Trial', category: 'shampoo', alreadyUsing: false })).id
    })
    await expectOneRow('whitelist_updated', () => store.updateWhitelistItem(id, { notes: 'n' }))
    await expectOneRow('whitelist_toggled', () => store.setWhitelistActive(id, false))
    await expectOneRow('patch_test_started', () => store.startPatchTest(trialId))
    await expectOneRow('patch_test_logged', () => store.logPatchTest(trialId, 'mild_irritation'))
    advance(7 * DAY)
    await expectOneRow('patch_test_logged', () => store.passPatchTest(trialId))
    await expectOneRow('patch_test_logged', () => store.logPatchTest(id, 'reaction'))
    await expectOneRow('whitelist_removed', () => store.removeWhitelistItem(trialId))
    await expectOneRow('storage_persist_requested', () => store.requestPersistentStorage())
    await expectOneRow('backup_exported', () => store.appendAudit('backup_exported', 'Encrypted backup exported'))
    await expectOneRow('backup_restored', () => store.appendAudit('backup_restored', 'Backup restored'))
    await expectOneRow('network_blocked', () => store.appendAudit('network_blocked', 'Blocked'))
  })

  it('rolls the change back when its audit row cannot be written', async () => {
    const { store, database } = setup()
    const item = await store.addWhitelistItem({ name: 'Current', category: 'cleanser' })
    vi.spyOn(database.audit, 'add').mockRejectedValueOnce(new Error('disk full'))
    await expect(store.setWhitelistActive(item.id, false)).rejects.toThrow('disk full')
    expect((await store.getActiveWhitelist()).map((i) => i.id)).toEqual([item.id])
  })

  it('failed or rejected calls leave no audit row', async () => {
    const { store, database } = setup()
    const item = await store.addWhitelistItem({ name: 'Trial', category: 'cleanser', alreadyUsing: false })
    const before = await database.audit.count()
    await codeOf(store.setWhitelistActive(item.id, true))
    await codeOf(store.passPatchTest(item.id))
    await codeOf(store.addWhitelistItem({ name: 'Trial', category: 'cleanser' }))
    await codeOf(store.updateProfile({ dailyMinutes: 7 as never }))
    await codeOf(store.removeWhitelistItem('nope'))
    expect(await database.audit.count()).toBe(before)
  })
})

describe('persistent storage', () => {
  const stubStorage = (storage: unknown) => vi.stubGlobal('navigator', { storage })

  it('requestPersistentStorage saves a granted result and audits it', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persist })
    const { store, database, advance } = setup()
    await store.getProfile()
    advance(10)
    expect(await store.requestPersistentStorage()).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    const profile = await store.getProfile()
    expect(profile.storagePersisted).toBe(true)
    expect(profile.updatedAt).toBe(START + 10)
    expect((await database.audit.toArray()).at(-1)).toEqual({
      id: 1,
      ts: START + 10,
      event: 'storage_persist_requested',
      detail: 'Persistent storage granted',
    })
  })

  it('records a refusal as false', async () => {
    stubStorage({ persist: vi.fn(async () => false) })
    const { store, database } = setup()
    expect(await store.requestPersistentStorage()).toBe(false)
    expect((await store.getProfile()).storagePersisted).toBe(false)
    expect((await database.audit.toArray())[0]?.detail).toBe('Persistent storage not granted')
  })

  it('returns false when the Storage API is missing, and still records the attempt', async () => {
    vi.stubGlobal('navigator', {})
    const { store, database } = setup()
    expect(await store.requestPersistentStorage()).toBe(false)
    expect((await store.getProfile()).storagePersisted).toBe(false)
    expect((await database.audit.toArray())[0]?.detail).toBe('Persistent storage not supported on this browser')
  })

  it('returns false when navigator itself is missing', async () => {
    vi.stubGlobal('navigator', undefined)
    const { store } = setup()
    expect(await store.requestPersistentStorage()).toBe(false)
  })

  it('returns false when persist() throws', async () => {
    stubStorage({
      persist: vi.fn(async () => {
        throw new Error('blocked')
      }),
    })
    const { store, database } = setup()
    expect(await store.requestPersistentStorage()).toBe(false)
    expect((await database.audit.toArray())[0]?.detail).toBe('Persistent storage request failed')
  })

  it('does not rewrite the profile when the answer has not changed but still audits', async () => {
    stubStorage({ persist: vi.fn(async () => true) })
    const { store, database, advance } = setup()
    await store.requestPersistentStorage()
    advance(100)
    await store.requestPersistentStorage()
    expect((await store.getProfile()).updatedAt).toBe(START)
    expect(await database.audit.count()).toBe(2)
  })

  it('getStorageEstimate reads usage, quota and persisted', async () => {
    stubStorage({
      estimate: vi.fn(async () => ({ usage: 1234, quota: 99_999 })),
      persisted: vi.fn(async () => true),
    })
    const { store } = setup()
    expect(await store.getStorageEstimate()).toEqual({ usage: 1234, quota: 99_999, persisted: true })
  })

  it('getStorageEstimate reports nulls when the API is unavailable or incomplete', async () => {
    const { store } = setup()
    vi.stubGlobal('navigator', {})
    expect(await store.getStorageEstimate()).toEqual({ usage: null, quota: null, persisted: null })
    stubStorage({ estimate: async () => ({}), persisted: async () => false })
    expect(await store.getStorageEstimate()).toEqual({ usage: null, quota: null, persisted: false })
  })

  it('getStorageEstimate degrades per field when a call throws', async () => {
    stubStorage({
      estimate: async () => {
        throw new Error('nope')
      },
      persisted: async () => true,
    })
    const { store } = setup()
    expect(await store.getStorageEstimate()).toEqual({ usage: null, quota: null, persisted: true })
  })
})

describe('deleteAllData', () => {
  it('clears every table, including audit and kv, then writes one data_deleted row', async () => {
    const { store, database, advance } = setup()
    await store.updateProfile({ heightCm: 181 })
    await store.completeOnboarding()
    const item = await store.addWhitelistItem({ name: 'Synthetic', category: 'cleanser' })
    await store.addWhitelistItem({ name: 'Trial', category: 'shampoo', alreadyUsing: false })
    await store.logPatchTest(item.id, 'reaction')
    await database.kv.put({ key: 'lastBackup', value: START })
    expect(await database.audit.count()).toBeGreaterThan(3)

    advance(999)
    await store.deleteAllData()

    expect(await database.profile.count()).toBe(0)
    expect(await database.whitelist.count()).toBe(0)
    expect(await database.kv.count()).toBe(0)
    expect(await database.audit.toArray()).toEqual([
      expect.objectContaining({ event: 'data_deleted', ts: START + 999, detail: 'All local data deleted' }),
    ])
    expect(await store.listWhitelist()).toEqual([])
    expect(await store.getActiveWhitelist()).toEqual([])
  })

  it('also clears tables added by a later schema version (it iterates database.tables)', async () => {
    class FutureDB extends LookmaxxingDB {
      declare scans: Table<{ id: string }, string>
      constructor(name: string) {
        super(name)
        this.version(2).stores({ scans: 'id' })
      }
    }
    const future = new FutureDB(`lmx-store-test-${++seq}`)
    opened.push(future)
    const store = createStore(future)
    await future.scans.bulkPut([{ id: 'a' }, { id: 'b' }])
    await store.addWhitelistItem({ name: 'Synthetic', category: 'cleanser' })
    await store.deleteAllData()
    expect(await future.scans.count()).toBe(0)
    expect(await future.whitelist.count()).toBe(0)
    expect(await future.audit.count()).toBe(1)
  })

  it('leaves the store fully usable: a fresh default profile and an empty whitelist', async () => {
    const { store, advance } = setup()
    await store.updateProfile({ heightCm: 181, units: 'imperial' })
    await store.deleteAllData()
    advance(1)
    const fresh = await store.getProfile()
    expect(fresh).toMatchObject({ heightCm: null, units: 'metric', onboardedAt: null, createdAt: START + 1 })
    expect(await store.listWhitelist()).toEqual([])
  })

  it('works on a database that was never written to', async () => {
    const { store, database } = setup()
    await store.deleteAllData()
    expect(await auditEvents(database)).toEqual(['data_deleted'])
  })
})

describe('watch', () => {
  it('emits the current value, re-emits on change, and stops after unsubscribe', async () => {
    const { store } = setup()
    const seen: WhitelistItem[][] = []
    let unsubscribe = () => {}
    const sawOne = new Promise<void>((resolve, reject) => {
      unsubscribe = watch(() => store.listWhitelist()).subscribe((items) => {
        seen.push(items)
        if (items.length === 1) resolve()
      }, reject)
    })
    await store.addWhitelistItem({ name: 'Synthetic', category: 'cleanser' })
    await sawOne
    expect(seen.at(-1)?.map((i) => i.name)).toEqual(['Synthetic'])
    unsubscribe()
    const count = seen.length
    await store.addWhitelistItem({ name: 'Another', category: 'toothpaste' })
    await store.listWhitelist()
    expect(seen).toHaveLength(count)
  })

  it('works with getProfile on an empty database (a live query cannot write)', async () => {
    const { store, database } = setup()
    const seen: { heightCm: number | null; createdAt: number }[] = []
    const waiters: ((p: { heightCm: number | null }) => void)[] = []
    const next = () => new Promise<{ heightCm: number | null }>((resolve) => waiters.push(resolve))
    const unsubscribe = watch(() => store.getProfile()).subscribe((profile) => {
      seen.push(profile)
      waiters.shift()?.(profile)
    })
    const first = await next()
    expect(first.heightCm).toBeNull()
    expect(await database.profile.count()).toBe(0)
    // The first mutation creates the row, which re-runs the live query.
    const second = next()
    await store.updateProfile({ heightCm: 180 })
    expect((await second).heightCm).toBe(180)
    unsubscribe()
    expect(seen.at(-1)).toMatchObject({ heightCm: 180, createdAt: START })
    expect(await database.profile.count()).toBe(1)
  })

  it('getProfile outside a live query still creates the row on first call', async () => {
    const { store, database } = setup()
    await store.getProfile()
    expect(await database.profile.count()).toBe(1)
  })

  it('reports querier failures through onError', async () => {
    const error = await new Promise<unknown>((resolve) => {
      watch(() => {
        throw new Error('boom')
      }).subscribe(() => {}, resolve)
    })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('boom')
  })
})
