/**
 * The local data store: profile, "my current stack" whitelist, patch tests and the audit log.
 *
 * Rules enforced here (the UI and planner rely on them):
 *  - The whitelist is EMPTY by default and nothing in this file ever proposes an entry.
 *  - getActiveWhitelist() is the only list the planner may use.
 *  - A logged 'reaction' excludes a product for good: it cannot be re-activated, re-tested or passed.
 *  - Every mutation writes its audit row in the same transaction as the change.
 *  - Only fields the app is allowed to hold are accepted (no name, email, date of birth, location).
 */
import Dexie, { liveQuery } from 'dexie'
import { PRODUCT_CATEGORIES } from '../catalog/schema'
import type {
  AuditEntry,
  AuditEvent,
  PatchTestEntry,
  PatchTestResult,
  PatchTestStatus,
  ProductCategory,
  Profile,
  WhitelistItem,
} from '../types'
import { db, type LookmaxxingDB } from './db'

export type StoreErrorCode = 'invalid' | 'not_found' | 'forbidden' | 'duplicate'

export class StoreError extends Error {
  readonly code: StoreErrorCode

  constructor(code: StoreErrorCode, message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

export interface StoreDeps {
  now?: () => number
  uuid?: () => string
}

export interface Store {
  /** Creates the default row on first call (inside watch() it returns the defaults and the first write creates the row). */
  getProfile(): Promise<Profile>
  /** Validates ranges and rejects unknown fields; throws StoreError('invalid'). */
  updateProfile(patch: Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'sexProfile'>>): Promise<Profile>
  /** Requires heightCm. Sets onboardedAt once. */
  completeOnboarding(): Promise<Profile>

  /** By addedAt ascending. */
  listWhitelist(): Promise<WhitelistItem[]>
  /** active AND patch test not failed. The ONLY list the planner may use. Empty by default. */
  getActiveWhitelist(): Promise<WhitelistItem[]>
  addWhitelistItem(input: {
    name: string
    category: ProductCategory
    notes?: string
    alreadyUsing?: boolean
  }): Promise<WhitelistItem>
  updateWhitelistItem(id: string, patch: { name?: string; category?: ProductCategory; notes?: string }): Promise<WhitelistItem>
  /** Throws 'forbidden' for a patch-test-failed item, or a trial item whose patch test has not passed. */
  setWhitelistActive(id: string, active: boolean): Promise<WhitelistItem>
  removeWhitelistItem(id: string): Promise<void>

  startPatchTest(id: string): Promise<WhitelistItem>
  /** 'reaction' fails the product permanently; 'mild_irritation' keeps the test running. */
  logPatchTest(id: string, result: PatchTestResult, note?: string): Promise<WhitelistItem>
  /** Only after PATCH_TEST_DAYS days with no reaction; activates the item. */
  passPatchTest(id: string): Promise<WhitelistItem>

  /** Newest first. */
  listAudit(limit?: number): Promise<AuditEntry[]>
  appendAudit(event: AuditEvent, detail: string): Promise<void>

  requestPersistentStorage(): Promise<boolean>
  getStorageEstimate(): Promise<{ usage: number | null; quota: number | null; persisted: boolean | null }>
  /** Clears every table, then writes a single 'data_deleted' audit row. */
  deleteAllData(): Promise<void>
}

// ───────────────────────────── constants ─────────────────────────────

const DAY_MS = 86_400_000
export const PATCH_TEST_DAYS = 7

const PROFILE_ID = 'me'
const NAME_MAX = 80
const NOTES_MAX = 500
const AUDIT_DETAIL_MAX = 500
const AUDIT_LIST_MAX = 10_000
const CHECKLIST_MAX_ENTRIES = 64
const CHECKLIST_KEY_MAX = 64

/** Record, not a list: adding a ProductCategory without deciding its patch-test need fails to compile. */
const NEEDS_PATCH_TEST: Record<ProductCategory, boolean> = {
  cleanser: true,
  moisturizer: true,
  sunscreen: true,
  topical_active: true,
  shampoo: true,
  conditioner: true,
  hair_styling: true,
  shaving: true,
  natural_topical: true,
  deodorant: true,
  fragrance: true,
  toothpaste: false,
  mouthwash: false,
  oral_care_other: false,
  supplement: false,
  medication: false,
  other: false,
}

const AUDIT_EVENTS: Record<AuditEvent, true> = {
  onboarding_completed: true,
  settings_changed: true,
  whitelist_added: true,
  whitelist_updated: true,
  whitelist_toggled: true,
  whitelist_removed: true,
  patch_test_started: true,
  patch_test_logged: true,
  storage_persist_requested: true,
  backup_exported: true,
  backup_restored: true,
  data_deleted: true,
  network_blocked: true,
}

const PATCH_TEST_RESULTS: readonly PatchTestResult[] = ['no_reaction', 'mild_irritation', 'reaction']

// ───────────────────────────── validation helpers ─────────────────────────────

const invalid = (message: string) => new StoreError('invalid', message)
const forbidden = (message: string) => new StoreError('forbidden', message)

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(`${label} must be an object`)
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key}"`)
  }
}

function checklist(label: string, value: unknown): Record<string, boolean> {
  assertObject(value, label)
  const entries = Object.entries(value)
  if (entries.length > CHECKLIST_MAX_ENTRIES) throw invalid(`${label} has too many entries`)
  const out: Record<string, boolean> = {}
  for (const [key, flag] of entries) {
    if (key.length === 0 || key.length > CHECKLIST_KEY_MAX || key === '__proto__') throw invalid(`${label} has an invalid key`)
    if (typeof flag !== 'boolean') throw invalid(`${label}.${key} must be true or false`)
    out[key] = flag
  }
  return out
}

type ProfilePatch = Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'sexProfile'>>

/** One validator per patchable field; a mapped type so a new Profile field cannot be forgotten. */
const profileValidators: { [K in keyof Required<ProfilePatch>]: (value: unknown) => Required<ProfilePatch>[K] } = {
  heightCm: (v) => {
    if (v === null) return null
    if (typeof v === 'number' && Number.isFinite(v) && v >= 120 && v <= 230) return v
    throw invalid('Height must be between 120 and 230 cm')
  },
  units: (v) => {
    if (v === 'metric' || v === 'imperial') return v
    throw invalid('Units must be "metric" or "imperial"')
  },
  dailyMinutes: (v) => {
    if (v === 15 || v === 30 || v === 60) return v
    throw invalid('Daily minutes must be 15, 30 or 60')
  },
  trainingDaysPerWeek: (v) => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7) return v
    throw invalid('Training days per week must be a whole number from 0 to 7')
  },
  scanWeekday: (v) => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6) return v
    throw invalid('Scan weekday must be a whole number from 0 (Sunday) to 6 (Saturday)')
  },
  installedToHomeScreen: (v) => {
    if (v === null || typeof v === 'boolean') return v
    throw invalid('installedToHomeScreen must be true, false or empty')
  },
  storagePersisted: (v) => {
    if (v === null || typeof v === 'boolean') return v
    throw invalid('storagePersisted must be true, false or empty')
  },
  privacyChecklist: (v) => checklist('privacyChecklist', v),
  equipmentChecklist: (v) => checklist('equipmentChecklist', v),
  onboardedAt: (v) => {
    if (v === null) return null
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
    throw invalid('onboardedAt must be a timestamp or empty')
  },
}

function validateProfilePatch(patch: unknown): Partial<Profile> {
  assertObject(patch, 'Settings patch')
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (!Object.hasOwn(profileValidators, key)) throw invalid(`Unknown setting "${key}"`)
    out[key] = profileValidators[key as keyof ProfilePatch](value)
  }
  return out as Partial<Profile>
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ea = Object.entries(a)
  const eb = Object.entries(b)
  return ea.length === eb.length && ea.every(([k, v]) => Object.hasOwn(b, k) && (b as Record<string, unknown>)[k] === v)
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw invalid('Name must be text')
  const name = value.trim()
  if (name.length === 0) throw invalid('Name cannot be empty')
  if (name.length > NAME_MAX) throw invalid(`Name can be at most ${NAME_MAX} characters`)
  return name
}

function cleanNotes(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw invalid('Notes must be text')
  const notes = value.trim()
  if (notes.length > NOTES_MAX) throw invalid(`Notes can be at most ${NOTES_MAX} characters`)
  return notes
}

function cleanCategory(value: unknown): ProductCategory {
  if (typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value)) return value as ProductCategory
  throw invalid('Unknown product category')
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid('Missing product id')
  return value
}

/** Duplicate detection key: case-, width- and whitespace-insensitive. */
const dupKey = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()

const clip = (text: string) => (text.length > AUDIT_DETAIL_MAX ? `${text.slice(0, AUDIT_DETAIL_MAX - 1)}…` : text)

const describeItem = (item: Pick<WhitelistItem, 'name' | 'category'>) => `"${item.name}" (${item.category})`

function defaultProfile(ts: number): Profile {
  return {
    id: PROFILE_ID,
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
    createdAt: ts,
    updatedAt: ts,
  }
}

/** crypto.randomUUID needs a secure context; a dev server opened over a LAN IP on a phone is not one. */
function defaultUuid(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage
}

// ───────────────────────────── store ─────────────────────────────

interface ItemChange {
  next: WhitelistItem
  event: AuditEvent
  detail: string
}

export function createStore(database: LookmaxxingDB, deps: StoreDeps = {}): Store {
  const now = deps.now ?? Date.now
  const uuid = deps.uuid ?? defaultUuid

  /** Call inside a transaction that includes `profile`. */
  async function loadProfile(): Promise<Profile> {
    const existing = await database.profile.get(PROFILE_ID)
    if (existing) return existing
    const created = defaultProfile(now())
    await database.profile.add(created)
    return created
  }

  /** Read, change and audit one whitelist item atomically. `change` returns null for a no-op. */
  async function changeItem(
    id: unknown,
    change: (item: WhitelistItem, ts: number) => ItemChange | null | Promise<ItemChange | null>,
  ): Promise<WhitelistItem> {
    const itemId = cleanId(id)
    return database.transaction('rw', database.whitelist, database.audit, async () => {
      const item = await database.whitelist.get(itemId)
      if (!item) throw new StoreError('not_found', 'Product not found')
      const ts = now()
      const result = await change(item, ts)
      if (!result) return item
      await database.whitelist.put(result.next)
      await database.audit.add({ ts, event: result.event, detail: clip(result.detail) })
      return result.next
    })
  }

  async function assertNoDuplicate(name: string, category: ProductCategory, exceptId: string | null): Promise<void> {
    const sameCategory = await database.whitelist.where('category').equals(category).toArray()
    const key = dupKey(name)
    if (sameCategory.some((item) => item.id !== exceptId && dupKey(item.name) === key)) {
      throw new StoreError('duplicate', `"${name}" is already in your list under ${category}`)
    }
  }

  return {
    async getProfile() {
      const existing = await database.profile.get(PROFILE_ID)
      if (existing) return existing
      try {
        return await database.transaction('rw', database.profile, loadProfile)
      } catch (e) {
        // Inside watch() (a live query) writes are forbidden. Show the defaults; the row is
        // created by the first mutation, which also makes the live query re-run.
        if (e instanceof Dexie.ReadOnlyError) return defaultProfile(now())
        throw e
      }
    },

    async updateProfile(patch) {
      const validated = validateProfilePatch(patch)
      return database.transaction('rw', database.profile, database.audit, async () => {
        const profile = await loadProfile()
        const changed = (Object.keys(validated) as (keyof Profile)[]).filter((key) => !sameValue(profile[key], validated[key]))
        if (changed.length === 0) return profile
        const ts = now()
        const next: Profile = { ...profile, ...validated, updatedAt: ts }
        await database.profile.put(next)
        // Field names only: values (height etc.) stay out of the audit log.
        await database.audit.add({ ts, event: 'settings_changed', detail: clip(`Changed settings: ${changed.join(', ')}`) })
        return next
      })
    },

    async completeOnboarding() {
      return database.transaction('rw', database.profile, database.audit, async () => {
        const profile = await loadProfile()
        if (profile.onboardedAt !== null) return profile
        if (profile.heightCm === null) throw invalid('Enter your height before finishing setup')
        const ts = now()
        const next: Profile = { ...profile, onboardedAt: ts, updatedAt: ts }
        await database.profile.put(next)
        await database.audit.add({ ts, event: 'onboarding_completed', detail: 'Onboarding completed' })
        return next
      })
    },

    listWhitelist() {
      return database.whitelist.orderBy('addedAt').toArray()
    },

    async getActiveWhitelist() {
      // Filtered in memory: booleans are not valid IndexedDB keys, so there is no usable 'active' index.
      const all = await database.whitelist.orderBy('addedAt').toArray()
      return all.filter((item) => item.active === true && item.patchTest.status !== 'failed')
    },

    async addWhitelistItem(input) {
      assertObject(input, 'Product')
      assertKnownKeys(input, ['name', 'category', 'notes', 'alreadyUsing'])
      const name = cleanName(input.name)
      const category = cleanCategory(input.category)
      const notes = cleanNotes(input.notes)
      const alreadyUsing = input.alreadyUsing ?? true
      if (typeof alreadyUsing !== 'boolean') throw invalid('alreadyUsing must be true or false')
      // Only a NEW product that goes on skin, scalp or hair is a trial; everything else is usable at once.
      const trial = !alreadyUsing && NEEDS_PATCH_TEST[category]

      return database.transaction('rw', database.whitelist, database.audit, async () => {
        await assertNoDuplicate(name, category, null)
        const ts = now()
        const item: WhitelistItem = {
          id: uuid(),
          name,
          category,
          notes,
          active: !trial,
          addedAt: ts,
          updatedAt: ts,
          patchTest: { status: trial ? 'not_started' : 'not_needed', startedAt: null, entries: [] },
        }
        await database.whitelist.add(item)
        const detail = `Added ${describeItem(item)}${trial ? ' as a trial, patch test required' : ''}`
        await database.audit.add({ ts, event: 'whitelist_added', detail: clip(detail) })
        return item
      })
    },

    async updateWhitelistItem(id, patch) {
      assertObject(patch, 'Product patch')
      assertKnownKeys(patch, ['name', 'category', 'notes'])
      const name = patch.name === undefined ? undefined : cleanName(patch.name)
      const category = patch.category === undefined ? undefined : cleanCategory(patch.category)
      const notes = patch.notes === undefined ? undefined : cleanNotes(patch.notes)

      // Category changes never alter the patch-test status: the record of what was tested stays as it was.
      return changeItem(id, async (item, ts) => {
        const changed: string[] = []
        if (name !== undefined && name !== item.name) changed.push('name')
        if (category !== undefined && category !== item.category) changed.push('category')
        if (notes !== undefined && notes !== item.notes) changed.push('notes')
        if (changed.length === 0) return null
        const next: WhitelistItem = {
          ...item,
          name: name ?? item.name,
          category: category ?? item.category,
          notes: notes ?? item.notes,
          updatedAt: ts,
        }
        await assertNoDuplicate(next.name, next.category, item.id)
        return { next, event: 'whitelist_updated', detail: `Updated ${describeItem(next)}: changed ${changed.join(', ')}` }
      })
    },

    async setWhitelistActive(id, active) {
      if (typeof active !== 'boolean') throw invalid('active must be true or false')
      return changeItem(id, (item, ts) => {
        const { status } = item.patchTest
        if (active && status === 'failed') {
          throw forbidden('A reaction was logged for this product. It stays excluded and cannot be re-activated.')
        }
        if (active && (status === 'not_started' || status === 'in_progress')) {
          throw forbidden('This product can only be activated after its patch test has passed.')
        }
        if (item.active === active) return null
        return {
          next: { ...item, active, updatedAt: ts },
          event: 'whitelist_toggled',
          detail: `${active ? 'Activated' : 'Deactivated'} ${describeItem(item)}`,
        }
      })
    },

    async removeWhitelistItem(id) {
      const itemId = cleanId(id)
      await database.transaction('rw', database.whitelist, database.audit, async () => {
        const item = await database.whitelist.get(itemId)
        if (!item) throw new StoreError('not_found', 'Product not found')
        await database.whitelist.delete(itemId)
        await database.audit.add({ ts: now(), event: 'whitelist_removed', detail: clip(`Removed ${describeItem(item)}`) })
      })
    },

    startPatchTest(id) {
      return changeItem(id, (item, ts) => {
        const { status } = item.patchTest
        if (status === 'failed') throw forbidden('A reaction was logged for this product. It cannot be tested again.')
        if (status !== 'not_started' && status !== 'in_progress') {
          throw forbidden('This product does not need a patch test.')
        }
        const restart = status === 'in_progress'
        return {
          next: { ...item, updatedAt: ts, patchTest: { ...item.patchTest, status: 'in_progress', startedAt: ts } },
          event: 'patch_test_started',
          detail: `${restart ? 'Restarted' : 'Started'} patch test for ${describeItem(item)}`,
        }
      })
    },

    async logPatchTest(id, result, note) {
      if (!PATCH_TEST_RESULTS.includes(result)) throw invalid('Unknown patch test result')
      const cleanedNote = cleanNotes(note)
      return changeItem(id, (item, ts) => {
        const { status } = item.patchTest
        if (status === 'failed') throw forbidden('A reaction was already logged for this product.')
        // A reaction can always be reported (even for a product already in use); other results need a running test.
        if (result !== 'reaction' && status !== 'in_progress') throw forbidden('Start the patch test before logging a result.')
        const entry: PatchTestEntry = { ts, result, note: cleanedNote }
        const entries = [...item.patchTest.entries, entry]
        if (result === 'reaction') {
          return {
            next: { ...item, active: false, updatedAt: ts, patchTest: { ...item.patchTest, status: 'failed', entries } },
            event: 'patch_test_logged',
            detail: `Patch test for ${describeItem(item)}: reaction, product excluded for good`,
          }
        }
        return {
          next: { ...item, updatedAt: ts, patchTest: { ...item.patchTest, entries } },
          event: 'patch_test_logged',
          detail: `Patch test for ${describeItem(item)}: ${result}`,
        }
      })
    },

    passPatchTest(id) {
      return changeItem(id, (item, ts) => {
        const { status, startedAt, entries } = item.patchTest
        const blocked: Partial<Record<PatchTestStatus, string>> = {
          failed: 'A reaction was logged for this product. It cannot pass.',
          passed: 'The patch test has already passed.',
          not_needed: 'This product does not need a patch test.',
          not_started: 'Start the patch test first.',
        }
        if (status !== 'in_progress') throw forbidden(blocked[status] ?? 'The patch test is not running.')
        if (entries.some((e) => e.result === 'reaction')) throw forbidden('A reaction was logged for this product. It cannot pass.')
        if (startedAt === null) throw forbidden('Start the patch test first.')
        const remaining = PATCH_TEST_DAYS * DAY_MS - (ts - startedAt)
        if (remaining > 0) {
          throw forbidden(`The patch test needs ${PATCH_TEST_DAYS} days; ${Math.ceil(remaining / DAY_MS)} more day(s) to go.`)
        }
        return {
          next: { ...item, active: true, updatedAt: ts, patchTest: { ...item.patchTest, status: 'passed' } },
          event: 'patch_test_logged',
          detail: `Patch test passed for ${describeItem(item)}, now active`,
        }
      })
    },

    async listAudit(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_LIST_MAX) {
        throw invalid(`limit must be a whole number from 1 to ${AUDIT_LIST_MAX}`)
      }
      return database.audit.orderBy('id').reverse().limit(limit).toArray()
    },

    async appendAudit(event, detail) {
      if (typeof event !== 'string' || !Object.hasOwn(AUDIT_EVENTS, event)) throw invalid('Unknown audit event')
      if (typeof detail !== 'string') throw invalid('Audit detail must be text')
      await database.audit.add({ ts: now(), event, detail: clip(detail) })
    },

    async requestPersistentStorage() {
      let granted = false
      let outcome = 'not supported on this browser'
      const storage = storageManager()
      if (storage && typeof storage.persist === 'function') {
        try {
          granted = (await storage.persist()) === true
          outcome = granted ? 'granted' : 'not granted'
        } catch {
          outcome = 'request failed'
        }
      }
      // The browser call is made first: awaiting anything but Dexie work would auto-commit a transaction.
      await database.transaction('rw', database.profile, database.audit, async () => {
        const profile = await loadProfile()
        const ts = now()
        if (profile.storagePersisted !== granted) {
          await database.profile.put({ ...profile, storagePersisted: granted, updatedAt: ts })
        }
        await database.audit.add({ ts, event: 'storage_persist_requested', detail: `Persistent storage ${outcome}` })
      })
      return granted
    },

    async getStorageEstimate() {
      let usage: number | null = null
      let quota: number | null = null
      let persisted: boolean | null = null
      const storage = storageManager()
      if (storage) {
        try {
          const estimate = await storage.estimate()
          usage = typeof estimate.usage === 'number' ? estimate.usage : null
          quota = typeof estimate.quota === 'number' ? estimate.quota : null
        } catch {
          // estimate() missing or rejected: report unknown
        }
        try {
          const flag = await storage.persisted()
          persisted = typeof flag === 'boolean' ? flag : null
        } catch {
          // persisted() missing or rejected: report unknown
        }
      }
      return { usage, quota, persisted }
    },

    async deleteAllData() {
      await database.transaction('rw', database.tables, async () => {
        for (const table of database.tables) await table.clear()
        await database.audit.add({ ts: now(), event: 'data_deleted', detail: 'All local data deleted' })
      })
    },
  }
}

export const store: Store = createStore(db)

/** Thin wrapper over Dexie liveQuery: re-runs `querier` whenever the tables it read change. */
export function watch<T>(querier: () => Promise<T> | T): {
  subscribe(cb: (value: T) => void, onError?: (e: unknown) => void): () => void
} {
  return {
    subscribe(cb, onError) {
      // async wrapper: Dexie does not catch a querier that throws synchronously.
      const subscription = liveQuery(async () => querier()).subscribe({
        next: cb,
        error: onError ?? ((e: unknown) => console.error('Live query failed', e)),
      })
      return () => subscription.unsubscribe()
    },
  }
}
