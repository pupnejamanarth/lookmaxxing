import type { Table } from 'dexie'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { version as APP_VERSION } from '../../package.json'
import {
  BackupError,
  backupFilename,
  exportBackup,
  inspectBackup,
  restoreBackup,
  validatePassphrase,
  type BackupSummary,
} from '../../src/store/backup'
import { encodeSnapshot, packContainer, planRestore, unpackContainer } from '../../src/store/backupCodec'
import { MAX_BACKUP_BYTES, open, seal } from '../../src/store/backupCrypto'
import { LookmaxxingDB } from '../../src/store/db'
import { createStore } from '../../src/store/store'

// Synthetic data only: nothing below is a real person, photo or passphrase.
const PASS = 'correct horse battery staple'
const EXPORT_AT = Date.UTC(2026, 5, 15, 12, 0, 0)
const RESTORE_AT = Date.UTC(2026, 5, 16, 9, 30, 0)
const STORE_AT = 1_700_000_000_000
const PNG_LIKE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
const PATTERN = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256)

interface ExtraRow {
  id: string
  image: Blob
  note: string
}

/** A later schema version: one more table. Backups must pick it up with no change to backup.ts. */
class ExtraDB extends LookmaxxingDB {
  declare extra: Table<ExtraRow, string>

  constructor(name: string) {
    super(name)
    this.version(2).stores({ extra: 'id' })
  }
}

let seq = 0
const opened: LookmaxxingDB[] = []

function track<T extends LookmaxxingDB>(database: T): T {
  opened.push(database)
  return database
}

const newDb = (): LookmaxxingDB => track(new LookmaxxingDB(`lmx-backup-test-${++seq}`))
const newExtraDb = (): ExtraDB => track(new ExtraDB(`lmx-backup-test-${++seq}`))

async function seed(database: LookmaxxingDB): Promise<void> {
  let n = 0
  const store = createStore(database, { now: () => STORE_AT, uuid: () => `id-${++n}` })
  await store.updateProfile({ heightCm: 181, dailyMinutes: 60 })
  await store.completeOnboarding()
  await store.addWhitelistItem({ name: 'Gentle cleanser', category: 'cleanser' })
  const trial = await store.addWhitelistItem({ name: 'Trial serum', category: 'topical_active', alreadyUsing: false })
  await store.startPatchTest(trial.id)
  await database.kv.bulkPut([
    {
      key: 'shots',
      value: {
        count: 2,
        list: [
          { id: 1, image: new Blob([PNG_LIKE], { type: 'image/png' }), tags: ['front', 'neutral'] },
          { id: 2, nested: { deeper: [{ thumb: new Blob([PATTERN], { type: 'image/webp' }) }] } },
        ],
      },
    },
    { key: 'plain', value: { n: 1, s: 'héllo ✓', flag: false, nothing: null } },
  ])
}

/** Rows of every table, with binary values replaced by their bytes so toEqual can compare them. */
async function plain(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return { $blob: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) }
  if (ArrayBuffer.isView(value)) {
    return { $view: value.constructor.name, bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) }
  }
  if (value instanceof ArrayBuffer) return { $buffer: Array.from(new Uint8Array(value)) }
  if (value instanceof Date) return { $date: value.getTime() }
  if (Array.isArray(value)) return Promise.all(value.map(plain))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await plain(item)])))
  }
  return value
}

async function dump(database: LookmaxxingDB): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const table of database.tables) out[table.name] = await plain(await table.toArray())
  return out
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    if (e instanceof BackupError) return e.code
    throw e
  }
  return 'resolved'
}

const bytesOf = async (blob: Blob): Promise<Uint8Array<ArrayBuffer>> => new Uint8Array(await blob.arrayBuffer())

// ───────── byte-level helpers: they re-implement the documented layout on purpose ─────────

const MAGIC_BYTES = new TextEncoder().encode('LMXBK001')

function splitFile(file: Uint8Array): { magic: Uint8Array<ArrayBuffer>; header: Uint8Array<ArrayBuffer>; body: Uint8Array<ArrayBuffer> } {
  const headerLength = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(8)
  return { magic: file.slice(0, 8), header: file.slice(12, 12 + headerLength), body: file.slice(12 + headerLength) }
}

function joinFile(magic: Uint8Array, header: Uint8Array, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + header.length + body.length)
  out.set(magic, 0)
  new DataView(out.buffer).setUint32(8, header.length)
  out.set(header, 12)
  out.set(body, 12 + header.length)
  return out
}

/** Re-writes the header (and the length prefix) and keeps the ciphertext untouched. */
function withHeader(file: Uint8Array, edit: (header: Record<string, unknown>) => void, space?: number): Uint8Array<ArrayBuffer> {
  const { magic, header, body } = splitFile(file)
  const json = JSON.parse(new TextDecoder().decode(header)) as Record<string, unknown>
  edit(json)
  return joinFile(magic, new TextEncoder().encode(JSON.stringify(json, null, space)), body)
}

function container(manifest: unknown, parts: Uint8Array[] = [], trailing = 0): Uint8Array<ArrayBuffer> {
  const manifestBytes = manifest instanceof Uint8Array ? manifest : new TextEncoder().encode(JSON.stringify(manifest))
  const total = 4 + manifestBytes.length + parts.reduce((sum, part) => sum + 4 + part.length, 0) + trailing
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, manifestBytes.length)
  out.set(manifestBytes, 4)
  let offset = 4 + manifestBytes.length
  for (const part of parts) {
    view.setUint32(offset, part.length)
    out.set(part, offset + 4)
    offset += 4 + part.length
  }
  return out
}

const manifestOf = (tables: Record<string, unknown>, extra: Record<string, unknown> = {}, blobs = 0) => ({
  container: 'lmx-container',
  containerVersion: 1,
  schemaVersion: 1,
  blobs,
  tables,
  ...extra,
})

const craft = (plaintext: Uint8Array<ArrayBuffer>): Promise<Blob> => seal(plaintext, PASS, { createdAt: EXPORT_AT, appVersion: 'test' })

/**
 * Derives every key with ONE PBKDF2 round instead of 600 000, for tests whose subject is not the KDF. The
 * stored header still says 600 000, so the parameter checks run for real.
 */
function fastKdf(): void {
  const original = crypto.subtle.deriveKey.bind(crypto.subtle) as (...args: unknown[]) => Promise<CryptoKey>
  vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(((algorithm: Pbkdf2Params, ...rest: unknown[]) =>
    original({ ...algorithm, iterations: 1 }, ...rest)) as never)
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.delete()))
})

// ───────────────────────────── passphrase and filename ─────────────────────────────

describe('validatePassphrase', () => {
  it('accepts a long passphrase made of words', () => {
    expect(validatePassphrase(PASS)).toEqual({ ok: true })
    expect(validatePassphrase('1234567890ab')).toEqual({ ok: true })
  })

  it('rejects short, repeated-character and digits-only passphrases with a reason', () => {
    for (const weak of ['', 'short', 'elevenchars', 'aaaaaaaaaaaa', '            ', '123456789012', '００００００００００００', '3141592653589793']) {
      const result = validatePassphrase(weak)
      expect(result.ok, JSON.stringify(weak)).toBe(false)
      expect(result.reason, JSON.stringify(weak)).toMatch(/\S/)
    }
    expect(validatePassphrase('elevenchars').ok).toBe(false)
    expect(validatePassphrase('twelve chars').ok).toBe(true)
  })

  it('counts characters, not UTF-16 units', () => {
    const faces = ['😀', '😁', '😂', '😃', '😄', '😅', '😆', '😇', '😈', '😉', '😊', '😋']
    expect(validatePassphrase(faces.join('')).ok).toBe(true)
    expect(validatePassphrase(faces.slice(0, 11).join('')).ok).toBe(false)
  })

  it('is not fooled by a non-string', () => {
    expect(validatePassphrase(undefined as never).ok).toBe(false)
    expect(validatePassphrase(123456789012 as never).ok).toBe(false)
  })
})

describe('backupFilename', () => {
  it('is unmoggable-YYYY-MM-DD.lmxbackup in local time', () => {
    expect(backupFilename(new Date(2026, 9, 10, 23, 59))).toBe('unmoggable-2026-10-10.lmxbackup')
    expect(backupFilename(new Date(2026, 0, 5, 0, 1))).toBe('unmoggable-2026-01-05.lmxbackup')
    expect(backupFilename()).toMatch(/^unmoggable-\d{4}-\d{2}-\d{2}\.lmxbackup$/)
  })

  it('refuses an invalid date', () => {
    expect(() => backupFilename(new Date(NaN))).toThrow(RangeError)
  })
})

// ───────────────────── the real thing: 600 000 PBKDF2 rounds ─────────────────────

describe('backup file (real PBKDF2)', () => {
  let source: LookmaxxingDB
  let exported: Awaited<ReturnType<typeof exportBackup>>
  let file: Uint8Array<ArrayBuffer>
  let sourceDump: Record<string, unknown>

  beforeAll(async () => {
    source = new LookmaxxingDB(`lmx-backup-golden-${++seq}`)
    await seed(source)
    sourceDump = await dump(source)
    exported = await exportBackup(PASS, source, { now: () => EXPORT_AT })
    file = await bytesOf(exported.blob)
  })

  afterAll(async () => {
    await source.delete()
  })

  it('summarises what it exported', () => {
    const { summary, filename } = exported
    expect(filename).toBe(backupFilename(new Date(EXPORT_AT)))
    expect(summary).toMatchObject({ createdAt: EXPORT_AT, appVersion: APP_VERSION, formatVersion: 1, blobCount: 2, ignoredTables: [] })
    expect(summary.blobBytes).toBe(PNG_LIKE.length + PATTERN.length)
    expect(summary.tables.profile).toBe(1)
    expect(summary.tables.whitelist).toBe(2)
    expect(summary.tables.kv).toBe(2)
    expect(summary.tables.audit).toBeGreaterThanOrEqual(4)
    expect(Object.keys(summary.tables).sort()).toEqual(['audit', 'kv', 'profile', 'whitelist'])
  })

  it('round-trips identical rows and identical Blob bytes and type, replacing everything already there', async () => {
    const target = newDb()
    await target.profile.put({ id: 'me', sexProfile: 'male', heightCm: 150 } as never)
    await target.whitelist.put({ id: 'stale', name: 'Stale product' } as never)
    await target.audit.add({ ts: 1, event: 'settings_changed', detail: 'stale audit row' })
    await target.kv.put({ key: 'stale', value: 'stale' })

    const inspected = await inspectBackup(exported.blob, PASS, target)
    expect(inspected).toEqual({ ...exported.summary, ignoredTables: [] })
    expect(await target.kv.get('stale')).toBeDefined()

    const restored = await restoreBackup(exported.blob, PASS, target, { now: () => RESTORE_AT })
    expect(restored).toEqual(inspected)

    const auditAfter = await target.audit.toArray()
    const sourceAudit = (sourceDump.audit as { id: number }[]).map((row) => row.id)
    expect(auditAfter.slice(0, -1).map((row) => row.id)).toEqual(sourceAudit)
    const after = await dump(target)
    expect({ ...after, audit: (after.audit as unknown[]).slice(0, -1) }).toEqual(sourceDump)

    const shots = (await target.kv.get('shots'))?.value as {
      list: [{ image: Blob }, { nested: { deeper: [{ thumb: Blob }] } }]
    }
    const image = shots.list[0].image
    const thumb = shots.list[1].nested.deeper[0].thumb
    expect(image).toBeInstanceOf(Blob)
    expect(image.type).toBe('image/png')
    expect(Array.from(await bytesOf(image))).toEqual(Array.from(PNG_LIKE))
    expect(thumb.type).toBe('image/webp')
    expect(Array.from(await bytesOf(thumb))).toEqual(Array.from(PATTERN))
    expect(await target.whitelist.get('stale')).toBeUndefined()
  })

  it('appends exactly one backup_restored audit row, last, after the replace', async () => {
    const target = newDb()
    await restoreBackup(exported.blob, PASS, target, { now: () => RESTORE_AT })
    const rows = await target.audit.orderBy('id').toArray()
    const restoredRows = rows.filter((row) => row.event === 'backup_restored')
    expect(restoredRows).toHaveLength(1)
    const last = rows.at(-1)!
    expect(last).toBe(restoredRows[0])
    expect(last.ts).toBe(RESTORE_AT)
    expect(last.detail).toMatch(/^Restored backup from 2026-06-15: \d+ records, 2 files$/)
    const previousIds = rows.slice(0, -1).map((row) => row.id!)
    expect(last.id).toBeGreaterThan(Math.max(...previousIds))
    expect(rows).toHaveLength((sourceDump.audit as unknown[]).length + 1)
  })

  it('matches the documented layout when read with plain Web Crypto', async () => {
    expect(Array.from(file.slice(0, 8))).toEqual(Array.from(MAGIC_BYTES))
    const { header, body } = splitFile(file)
    const parsed = JSON.parse(new TextDecoder().decode(header)) as {
      formatVersion: number
      kdf: { name: string; hash: string; iterations: number; salt: string }
      cipher: { name: string; iv: string }
      createdAt: number
      appVersion: string
    }
    expect(Object.keys(parsed).sort()).toEqual(['appVersion', 'cipher', 'createdAt', 'formatVersion', 'kdf'])
    expect(parsed.formatVersion).toBe(1)
    expect(parsed.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 })
    expect(parsed.cipher.name).toBe('AES-GCM')
    expect(parsed.createdAt).toBe(EXPORT_AT)
    expect(parsed.appVersion).toBe(APP_VERSION)
    const salt = Uint8Array.from(atob(parsed.kdf.salt), (c) => c.charCodeAt(0))
    const iv = Uint8Array.from(atob(parsed.cipher.iv), (c) => c.charCodeAt(0))
    expect(salt).toHaveLength(16)
    expect(iv).toHaveLength(12)

    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )
    // The header is the additional authenticated data: without it the same key and IV must fail.
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body)).rejects.toThrow()
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: header }, key, body))
    expect(body.length).toBe(plaintext.length + 16)

    const manifestLength = new DataView(plaintext.buffer).getUint32(0)
    const manifest = JSON.parse(new TextDecoder().decode(plaintext.subarray(4, 4 + manifestLength))) as {
      container: string
      containerVersion: number
      blobs: number
      tables: Record<string, { rows: unknown[] }>
    }
    expect(manifest).toMatchObject({ container: 'lmx-container', containerVersion: 1, blobs: 2 })
    expect(Object.keys(manifest.tables).sort()).toEqual(['audit', 'kv', 'profile', 'whitelist'])
    let offset = 4 + manifestLength
    const sizes: number[] = []
    for (let i = 0; i < manifest.blobs; i++) {
      const length = new DataView(plaintext.buffer).getUint32(offset)
      sizes.push(length)
      offset += 4 + length
    }
    expect(offset).toBe(plaintext.length)
    expect(sizes).toEqual([PNG_LIKE.length, PATTERN.length])
    expect(JSON.stringify(manifest.tables.kv)).toContain('__lmxblob')
  })

  it('does not contain the data or the passphrase in the clear', () => {
    const text = new TextDecoder('latin1').decode(file)
    for (const secret of ['Gentle cleanser', 'Trial serum', 'profile', 'whitelist', 'heightCm', 'image/png', PASS, 'PNG']) {
      expect(text, secret).not.toContain(secret)
    }
  })

  it('reports a wrong passphrase as wrong_passphrase_or_corrupt and writes nothing', async () => {
    const target = newDb()
    expect(await codeOf(restoreBackup(exported.blob, 'a different passphrase', target))).toBe('wrong_passphrase_or_corrupt')
    expect(await codeOf(inspectBackup(exported.blob, '', target))).toBe('wrong_passphrase_or_corrupt')
    expect(await target.audit.count()).toBe(0)
  })
})

// ───────────────────── everything else (1-round KDF, same code paths) ─────────────────────

describe('backup file (fast KDF)', () => {
  beforeEach(fastKdf)

  async function exportSeeded(): Promise<{ source: LookmaxxingDB; exported: Awaited<ReturnType<typeof exportBackup>>; file: Uint8Array<ArrayBuffer> }> {
    const source = newDb()
    await seed(source)
    const exported = await exportBackup(PASS, source, { now: () => EXPORT_AT })
    return { source, exported, file: await bytesOf(exported.blob) }
  }

  describe('passphrases and input types', () => {
    it('is case sensitive, and treats canonically equivalent spellings as one passphrase', async () => {
      const source = newDb()
      const target = newDb()
      const composed = 'caf\u00e9 au lait 123'
      const decomposed = 'cafe\u0301 au lait 123'
      const fullwidth = '\uff43af\u00e9 au lait 123'
      const { blob } = await exportBackup(composed, source)
      expect((await inspectBackup(blob, decomposed, target)).formatVersion).toBe(1)
      expect((await inspectBackup(blob, fullwidth, target)).formatVersion).toBe(1)
      expect(await codeOf(inspectBackup(blob, composed.toUpperCase(), target))).toBe('wrong_passphrase_or_corrupt')
      expect(await codeOf(inspectBackup(blob, `${composed} `, target))).toBe('wrong_passphrase_or_corrupt')
    })

    it('accepts a Blob, an ArrayBuffer or a Uint8Array that is a window into a larger buffer', async () => {
      const { file, exported } = await exportSeeded()
      const target = newDb()
      const padded = new Uint8Array(file.length + 40)
      padded.fill(0xaa)
      padded.set(file, 17)
      const view = padded.subarray(17, 17 + file.length)
      for (const input of [exported.blob, file.buffer, view]) {
        expect(await inspectBackup(input, PASS, target)).toEqual({ ...exported.summary, ignoredTables: [] })
      }
    })
  })

  describe('export', () => {
    it('rejects weak passphrases before touching the data or the crypto', async () => {
      const source = newDb()
      await seed(source)
      const importKey = vi.spyOn(crypto.subtle, 'importKey')
      for (const weak of ['', 'short', 'aaaaaaaaaaaa', '123456789012']) {
        const error = await exportBackup(weak, source).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(BackupError)
        expect((error as BackupError).code).toBe('weak_passphrase')
        expect((error as BackupError).message).toBe(validatePassphrase(weak).reason)
      }
      expect(importKey).not.toHaveBeenCalled()
    })

    it('is read-only', async () => {
      const source = newDb()
      await seed(source)
      const before = await dump(source)
      const transaction = vi.spyOn(source, 'transaction')
      await exportBackup(PASS, source)
      expect(transaction.mock.calls.every(([mode]) => mode === 'r')).toBe(true)
      expect(await dump(source)).toEqual(before)
    })

    it('differs on every export of the same data (random salt and IV)', async () => {
      const source = newDb()
      await seed(source)
      const a = await bytesOf((await exportBackup(PASS, source, { now: () => EXPORT_AT })).blob)
      const b = await bytesOf((await exportBackup(PASS, source, { now: () => EXPORT_AT })).blob)
      expect(a).toHaveLength(b.length)
      expect(Array.from(a)).not.toEqual(Array.from(b))
      const headerA = JSON.parse(new TextDecoder().decode(splitFile(a).header)) as { kdf: { salt: string }; cipher: { iv: string } }
      const headerB = JSON.parse(new TextDecoder().decode(splitFile(b).header)) as { kdf: { salt: string }; cipher: { iv: string } }
      expect(headerA.kdf.salt).not.toBe(headerB.kdf.salt)
      expect(headerA.cipher.iv).not.toBe(headerB.cipher.iv)
      expect(splitFile(a).body).not.toEqual(splitFile(b).body)

      const target = newDb()
      expect((await inspectBackup(a, PASS, target)).tables).toEqual((await inspectBackup(b, PASS, target)).tables)
    })

    it('refuses to make a file bigger than the cap', async () => {
      const source = newDb()
      await source.kv.put({ key: 'big', value: new Blob([new Uint8Array(4000)]) })
      const before = await dump(source)
      expect(await codeOf(exportBackup(PASS, source, { maxBytes: 2000 }))).toBe('too_large')
      expect(await dump(source)).toEqual(before)
      // Just under the cap works, and the file it makes is within it.
      const { blob } = await exportBackup(PASS, source, { maxBytes: 8000 })
      expect(blob.size).toBeLessThanOrEqual(8000)
      expect(await codeOf(inspectBackup(blob, PASS, newDb(), { maxBytes: 8000 }))).toBe('resolved')
    })

    it('includes tables added by later schema versions, blobs and all, with no change to the backup code', async () => {
      const first = newExtraDb()
      await seed(first)
      await first.extra.bulkPut([
        { id: 'a', image: new Blob([PATTERN], { type: 'image/jpeg' }), note: 'first' },
        { id: 'b', image: new Blob([], { type: '' }), note: 'empty file' },
      ])
      const { blob, summary } = await exportBackup(PASS, first)
      expect(summary.tables).toMatchObject({ extra: 2, kv: 2 })
      expect(summary.blobCount).toBe(4)

      const second = newExtraDb()
      await restoreBackup(blob, PASS, second)
      const rows = await second.extra.orderBy('id').toArray()
      expect(rows.map((row) => row.note)).toEqual(['first', 'empty file'])
      expect(rows[0]!.image.type).toBe('image/jpeg')
      expect(Array.from(await bytesOf(rows[0]!.image))).toEqual(Array.from(PATTERN))
      expect(rows[1]!.image.size).toBe(0)
    })

    it('fails loudly, without leaking the value, on data it cannot represent', async () => {
      const source = newDb()
      await source.kv.put({ key: 'm', value: { secret: new Map([['topsecret-marker', 1]]) } })
      const error = await exportBackup(PASS, source).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BackupError)
      expect((error as BackupError).code).toBe('invalid_content')
      expect((error as BackupError).message).toContain('"kv"')
      expect((error as BackupError).message).not.toContain('topsecret-marker')

      await source.kv.clear()
      for (const value of [new Set([1]), 12n]) {
        await source.kv.put({ key: 'v', value })
        expect(await codeOf(exportBackup(PASS, source)), String(value)).toBe('invalid_content')
      }
    })
  })

  describe('review fixes', () => {
    it('round-trips user keys that look like codec tags, and -0', async () => {
      const source = newDb()
      const value = { __lmxblob: 1, nested: [{ __lmxsomething: true }], zero: -0 }
      await source.kv.put({ key: 'k', value })
      const target = newDb()
      await restoreBackup((await exportBackup(PASS, source)).blob, PASS, target)
      const got = (await target.kv.get('k'))!.value as typeof value
      expect(got.__lmxblob).toBe(1)
      expect(got.nested).toEqual([{ __lmxsomething: true }])
      expect(Object.is(got.zero, -0)).toBe(true)
    })

    it('refuses a backup from a newer schema and malformed known rows', async () => {
      const target = newDb()
      const newer = await craft(container(manifestOf({}, { schemaVersion: 99 })))
      expect(await codeOf(inspectBackup(newer, PASS, target))).toBe('invalid_content')
      const bad = await craft(container(manifestOf({ whitelist: { rows: [{ id: 'x', active: true }] } })))
      expect(await codeOf(inspectBackup(bad, PASS, target))).toBe('invalid_content')
    })

    it('forces active=false on a failed patch-test item', async () => {
      const row = {
        id: 'w', name: 'n', category: 'cleanser', notes: '', active: true, addedAt: 1, updatedAt: 1,
        patchTest: { status: 'failed', startedAt: 1, entries: [] },
      }
      const target = newDb()
      await restoreBackup(await craft(container(manifestOf({ whitelist: { rows: [row] } }))), PASS, target)
      expect((await target.whitelist.get('w'))!.active).toBe(false)
    })

    it('reports bad_magic for an oversize file without the magic', async () => {
      const junk = new Blob([new Uint8Array(64)])
      expect(await codeOf(inspectBackup(junk, PASS, newDb(), { maxBytes: 16 }))).toBe('bad_magic')
    })
  })

  describe('opening a file that is not (or no longer) a good backup', () => {
    it('rejects a bad magic number', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      const wrongMagic = file.slice()
      wrongMagic[0] ^= 0x01
      const candidates: unknown[] = [
        wrongMagic,
        new Uint8Array(0),
        new Uint8Array(7),
        MAGIC_BYTES.slice(0, 7),
        new TextEncoder().encode('{"this":"is json, not a backup"}'),
        new Uint8Array(500).fill(7),
        new Blob(['hello']),
        'not binary at all',
        null,
      ]
      for (const candidate of candidates) {
        expect(await codeOf(restoreBackup(candidate as never, PASS, target)), String(candidate)).toBe('bad_magic')
      }
      expect(await target.audit.count()).toBe(0)
    })

    it('rejects a truncated file as damaged', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      const { header } = splitFile(file)
      const cuts = [8, 11, 12, 12 + 10, 12 + header.length - 1, 12 + header.length, 12 + header.length + 15, file.length - 16, file.length - 1]
      for (const cut of cuts) {
        expect(await codeOf(inspectBackup(file.slice(0, cut), PASS, target)), `cut at ${cut}`).toBe('wrong_passphrase_or_corrupt')
      }
      expect(await codeOf(inspectBackup(new Uint8Array([...file, 0]), PASS, target))).toBe('wrong_passphrase_or_corrupt')
    })

    it('rejects an unsupported formatVersion before doing any key work', async () => {
      const { file } = await exportSeeded()
      const importKey = vi.spyOn(crypto.subtle, 'importKey')
      for (const version of [2, 3, 99, 2 ** 31]) {
        const edited = withHeader(file, (header) => {
          header.formatVersion = version
        })
        const error = await inspectBackup(edited, PASS, newDb()).catch((e: unknown) => e)
        expect((error as BackupError).code, `version ${version}`).toBe('unsupported_version')
      }
      for (const version of [0, -1, 1.5, '1', null]) {
        const edited = withHeader(file, (header) => {
          header.formatVersion = version
        })
        expect(await codeOf(inspectBackup(edited, PASS, newDb())), `version ${String(version)}`).toBe('wrong_passphrase_or_corrupt')
      }
      expect(importKey).not.toHaveBeenCalled()
    })

    it('refuses KDF iterations outside [600 000, 5 000 000] BEFORE running PBKDF2', async () => {
      const { file } = await exportSeeded()
      const importKey = vi.spyOn(crypto.subtle, 'importKey')
      const deriveKey = vi.spyOn(crypto.subtle, 'deriveKey')
      deriveKey.mockClear()
      for (const iterations of [0, 1, 1000, 599_999, 5_000_001, 100_000_000, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
        const edited = withHeader(file, (header) => {
          ;(header.kdf as Record<string, unknown>).iterations = iterations
        })
        expect(await codeOf(inspectBackup(edited, PASS, newDb())), `${iterations} iterations`).toBe('kdf_params_out_of_range')
        expect(await codeOf(restoreBackup(edited, PASS, newDb())), `${iterations} iterations`).toBe('kdf_params_out_of_range')
      }
      expect(importKey).not.toHaveBeenCalled()
      expect(deriveKey).not.toHaveBeenCalled()

      // The bounds themselves are allowed through to the cipher (which then rejects the edited header).
      for (const iterations of [600_000, 5_000_000]) {
        const edited = withHeader(file, (header) => {
          ;(header.kdf as Record<string, unknown>).iterations = iterations
        })
        const expected = iterations === 600_000 ? 'resolved' : 'wrong_passphrase_or_corrupt'
        expect(await codeOf(inspectBackup(edited, PASS, newDb())), `${iterations} iterations`).toBe(expected)
      }
      expect(importKey).toHaveBeenCalled()

      for (const iterations of [600_000.5, '600000', null, [600_000]]) {
        const edited = withHeader(file, (header) => {
          ;(header.kdf as Record<string, unknown>).iterations = iterations
        })
        expect(await codeOf(inspectBackup(edited, PASS, newDb())), String(iterations)).toBe('wrong_passphrase_or_corrupt')
      }
    })

    it('refuses an oversize file before reading or decrypting it', async () => {
      const { file } = await exportSeeded()
      const importKey = vi.spyOn(crypto.subtle, 'importKey')
      const target = newDb()

      const huge = new Blob([file])
      Object.defineProperty(huge, 'size', { value: MAX_BACKUP_BYTES + 1 })
      const arrayBuffer = vi.spyOn(huge, 'arrayBuffer')
      expect(await codeOf(restoreBackup(huge, PASS, target))).toBe('too_large')
      expect(await codeOf(inspectBackup(huge, PASS, target))).toBe('too_large')

      const atTheCap = new Blob([file])
      Object.defineProperty(atTheCap, 'size', { value: MAX_BACKUP_BYTES })
      expect(await codeOf(inspectBackup(atTheCap, PASS, target))).not.toBe('too_large')

      const small = { maxBytes: file.length - 1 }
      expect(await codeOf(inspectBackup(file, PASS, target, small))).toBe('too_large')
      expect(await codeOf(inspectBackup(file, PASS, target, { maxBytes: file.length }))).toBe('resolved')
      // The cap can be lowered but never raised.
      expect(await codeOf(inspectBackup(huge, PASS, target, { maxBytes: MAX_BACKUP_BYTES * 4 }))).toBe('too_large')
      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(importKey.mock.calls.length).toBeLessThanOrEqual(2)
      expect(await target.audit.count()).toBe(0)
    })

    it('fails when ANY single ciphertext or tag byte is flipped', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      const bodyStart = 12 + splitFile(file).header.length
      expect(file.length - bodyStart).toBeGreaterThan(500)
      const unexpected: string[] = []
      for (const mask of [0x01, 0xff]) {
        for (let i = bodyStart; i < file.length; i++) {
          const bad = file.slice()
          bad[i] ^= mask
          const code = await codeOf(inspectBackup(bad, PASS, target))
          if (code !== 'wrong_passphrase_or_corrupt') unexpected.push(`byte ${i} ^ ${mask}: ${code}`)
        }
      }
      expect(unexpected).toEqual([])
    })

    it('fails when ANY single header byte (magic, length or JSON) is flipped', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      const bodyStart = 12 + splitFile(file).header.length
      const allowed = new Set(['bad_magic', 'wrong_passphrase_or_corrupt', 'unsupported_version', 'kdf_params_out_of_range'])
      const codes = new Map<string, number>()
      const unexpected: string[] = []
      for (const mask of [0x01, 0x80, 0xff]) {
        for (let i = 0; i < bodyStart; i++) {
          const bad = file.slice()
          bad[i] ^= mask
          const code = await codeOf(inspectBackup(bad, PASS, target))
          codes.set(code, (codes.get(code) ?? 0) + 1)
          if (!allowed.has(code)) unexpected.push(`byte ${i} ^ ${mask}: ${code}`)
        }
      }
      expect(unexpected).toEqual([])
      expect(codes.get('bad_magic')).toBe(24)
    })

    it('authenticates the header bytes (AAD): a valid-looking header edit still fails', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      // Control: rewriting the header with the very same bytes keeps the file valid.
      expect(await codeOf(inspectBackup(withHeader(file, () => {}), PASS, target))).toBe('resolved')
      // Same fields, different bytes (pretty-printed).
      expect(await codeOf(inspectBackup(withHeader(file, () => {}, 2), PASS, target))).toBe('wrong_passphrase_or_corrupt')
      // A different but well-formed timestamp or app version.
      const createdAt = withHeader(file, (header) => {
        header.createdAt = (header.createdAt as number) + 1
      })
      expect(await codeOf(inspectBackup(createdAt, PASS, target))).toBe('wrong_passphrase_or_corrupt')
      const appVersion = withHeader(file, (header) => {
        header.appVersion = '9.9.9'
      })
      expect(await codeOf(inspectBackup(appVersion, PASS, target))).toBe('wrong_passphrase_or_corrupt')
      // Extra, ignored-by-the-parser header keys are covered too.
      const extra = withHeader(file, (header) => {
        header.note = 'added later'
      })
      expect(await codeOf(inspectBackup(extra, PASS, target))).toBe('wrong_passphrase_or_corrupt')
    })

    it('rejects a header with the wrong shape as damaged', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      const edits: ((header: Record<string, unknown>) => void)[] = [
        (h) => delete h.kdf,
        (h) => delete h.cipher,
        (h) => delete h.createdAt,
        (h) => delete h.appVersion,
        (h) => (h.kdf = []),
        (h) => ((h.kdf as Record<string, unknown>).name = 'scrypt'),
        (h) => ((h.kdf as Record<string, unknown>).hash = 'SHA-1'),
        (h) => ((h.kdf as Record<string, unknown>).salt = 'AAAA'),
        (h) => ((h.kdf as Record<string, unknown>).salt = 42),
        (h) => ((h.cipher as Record<string, unknown>).name = 'AES-CBC'),
        (h) => ((h.cipher as Record<string, unknown>).iv = 'AAAAAAAAAAAAAAAA'),
        (h) => (h.createdAt = -1),
        (h) => (h.createdAt = 1.5),
        (h) => (h.createdAt = 8.65e15),
        (h) => (h.appVersion = 'x'.repeat(65)),
        (h) => (h.appVersion = 7),
      ]
      for (const [i, edit] of edits.entries()) {
        expect(await codeOf(inspectBackup(withHeader(file, edit), PASS, target)), `edit ${i}`).toBe('wrong_passphrase_or_corrupt')
      }
      // Header length that points outside the file, or at nothing.
      for (const length of [0, 4097, file.length, 0xffffffff]) {
        const bad = file.slice()
        new DataView(bad.buffer).setUint32(8, length)
        expect(await codeOf(inspectBackup(bad, PASS, target)), `length ${length}`).toBe('wrong_passphrase_or_corrupt')
      }
    })
  })

  describe('inspect', () => {
    it('writes nothing: no transaction, no hook, no change', async () => {
      const { file, exported } = await exportSeeded()
      const target = newDb()
      await target.profile.put({ id: 'me', sexProfile: 'male', heightCm: 150 } as never)
      await target.kv.put({ key: 'keep', value: { photo: new Blob([PATTERN], { type: 'image/png' }) } })
      await target.audit.add({ ts: 5, event: 'settings_changed', detail: 'before' })
      const before = await dump(target)

      let writes = 0
      for (const table of target.tables) {
        table.hook('creating', () => {
          writes++
        })
        table.hook('updating', () => {
          writes++
        })
        table.hook('deleting', () => {
          writes++
        })
      }
      const transaction = vi.spyOn(target, 'transaction')
      const clear = vi.spyOn(target.kv, 'clear')

      const summary = await inspectBackup(file, PASS, target)
      expect(summary).toEqual({ ...exported.summary, ignoredTables: [] })
      expect(writes).toBe(0)
      expect(transaction).not.toHaveBeenCalled()
      expect(clear).not.toHaveBeenCalled()
      expect(await dump(target)).toEqual(before)
    })

    it('rejects the same bad contents restore does', async () => {
      const target = newDb()
      const plaintext = container(manifestOf({ kv: { rows: [{ nokey: 1 }] } }))
      const file = await craft(plaintext)
      expect(await codeOf(inspectBackup(file, PASS, target))).toBe('invalid_content')
      expect(await codeOf(restoreBackup(file, PASS, target))).toBe('invalid_content')
    })
  })

  describe('restore', () => {
    it('is atomic: a failure after earlier tables were already rewritten leaves the old data intact', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      await target.profile.put({ id: 'me', sexProfile: 'male', heightCm: 150 } as never)
      await target.whitelist.put({ id: 'mine', name: 'My own product' } as never)
      await target.audit.bulkAdd([
        { ts: 1, event: 'settings_changed', detail: 'one' },
        { ts: 2, event: 'settings_changed', detail: 'two' },
      ])
      await target.kv.put({ key: 'precious', value: { photo: new Blob([PNG_LIKE], { type: 'image/png' }) } })
      const before = await dump(target)
      expect(target.tables.at(-1)!.name).toBe('kv')

      // kv is refilled last: by then profile, whitelist and audit were cleared and refilled.
      target.kv.hook('creating', () => {
        throw new Error('disk on fire')
      })
      const error = await restoreBackup(file, PASS, target, { now: () => RESTORE_AT }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(BackupError)
      expect(await dump(target)).toEqual(before)
    })

    it('is atomic: a failure on the final backup_restored row undoes the whole replace', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      await target.profile.put({ id: 'me', sexProfile: 'male', heightCm: 150 } as never)
      await target.kv.put({ key: 'precious', value: 'still here' })
      const before = await dump(target)

      target.audit.hook('creating', (_key, row) => {
        if (row.event === 'backup_restored') throw new Error('quota exceeded')
      })
      await expect(restoreBackup(file, PASS, target)).rejects.toThrow()
      expect(await dump(target)).toEqual(before)
    })

    it('does not touch the data when the file is bad', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      await seed(target)
      const before = await dump(target)
      const bad = file.slice()
      bad[bad.length - 1] ^= 1
      expect(await codeOf(restoreBackup(bad, PASS, target))).toBe('wrong_passphrase_or_corrupt')
      expect(await codeOf(restoreBackup(file, 'wrong passphrase here', target))).toBe('wrong_passphrase_or_corrupt')
      expect(await dump(target)).toEqual(before)
    })

    it('ignores tables this schema does not have, and counts them', async () => {
      const source = newExtraDb()
      await seed(source)
      await source.extra.put({ id: 'x', image: new Blob([PATTERN], { type: 'image/png' }), note: 'from the future' })
      const exported = await exportBackup(PASS, source)
      expect(exported.summary.tables.extra).toBe(1)
      // Re-label as schema 1 so only the unknown table (not a newer schema) is under test.
      const { plaintext } = await open(exported.blob, PASS)
      const { manifest, parts } = unpackContainer(plaintext)
      manifest.schemaVersion = 1
      const blob = await craft(
        await packContainer(manifest, parts.map((bytes) => ({ size: bytes.length, read: async () => bytes })), MAX_BACKUP_BYTES),
      )

      const target = newDb()
      const inspected = await inspectBackup(blob, PASS, target)
      expect(inspected.ignoredTables).toEqual(['extra'])
      expect(inspected.tables).not.toHaveProperty('extra')
      // The ignored table's file is not counted either.
      expect(inspected.blobCount).toBe(2)
      expect(inspected.blobBytes).toBe(PNG_LIKE.length + PATTERN.length)

      const restored = await restoreBackup(blob, PASS, target, { now: () => RESTORE_AT })
      expect(restored).toEqual(inspected)
      expect(target.tables.map((table) => table.name)).not.toContain('extra')
      expect(await target.whitelist.count()).toBe(2)
      const rows = await target.audit.toArray()
      expect(rows.filter((row) => row.event === 'backup_restored')).toHaveLength(1)
      expect(rows.at(-1)!.detail).toContain('1 unknown tables skipped')
    })

    it('empties tables the app has but the backup lacks', async () => {
      const source = newDb()
      await seed(source)
      const { blob } = await exportBackup(PASS, source)
      const target = newExtraDb()
      await target.extra.put({ id: 'old', image: new Blob(['x']), note: 'should vanish' })
      const summary = await restoreBackup(blob, PASS, target)
      expect(await target.extra.count()).toBe(0)
      expect(summary.ignoredTables).toEqual([])
      expect(summary.tables).not.toHaveProperty('extra')
    })

    it('keeps the audit id sequence going after the restored ids', async () => {
      const { file } = await exportSeeded()
      const target = newDb()
      await target.audit.bulkAdd(Array.from({ length: 50 }, (_, i) => ({ ts: i, event: 'settings_changed' as const, detail: `old ${i}` })))
      await restoreBackup(file, PASS, target)
      const ids = (await target.audit.orderBy('id').toArray()).map((row) => row.id!)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
      const next = await target.audit.add({ ts: 1, event: 'settings_changed', detail: 'after' })
      expect(next).toBeGreaterThan(ids.at(-1)!)
    })

    it('round-trips Dates, binary buffers and special numbers', async () => {
      const source = newDb()
      const buffer = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]).buffer
      const window = new Uint8Array(buffer, 2, 4)
      await source.kv.bulkPut([
        {
          key: 'exotic',
          value: {
            when: new Date(1_700_000_123_456),
            never: new Date(NaN),
            nan: NaN,
            up: Infinity,
            down: -Infinity,
            floats: new Float32Array([1.5, -2.25, 1e-3]),
            doubles: new Float64Array([Math.PI]),
            ints: new Int16Array([-5, 300]),
            big: new BigInt64Array([-(2n ** 40n)]),
            clamped: new Uint8ClampedArray([0, 255]),
            window,
            raw: buffer,
            list: [1, [2, [3, { deep: new Date(5) }]]],
            empty: {},
            emptyList: [],
            text: 'ünïcödé ✓ 日本語',
            dropped: undefined,
          },
        },
      ])
      const { blob, summary } = await exportBackup(PASS, source)
      expect(summary.blobCount).toBe(7)
      const target = newDb()
      await restoreBackup(blob, PASS, target)
      const stored = (await target.kv.get('exotic'))!.value as Record<string, unknown>
      expect(stored.when).toEqual(new Date(1_700_000_123_456))
      expect(Number.isNaN((stored.never as Date).getTime())).toBe(true)
      expect(stored.nan).toBeNaN()
      expect([stored.up, stored.down]).toEqual([Infinity, -Infinity])
      expect(stored.floats).toBeInstanceOf(Float32Array)
      expect(Array.from(stored.floats as Float32Array)).toEqual(Array.from(new Float32Array([1.5, -2.25, 1e-3])))
      expect(Array.from(stored.doubles as Float64Array)).toEqual([Math.PI])
      expect(stored.ints).toBeInstanceOf(Int16Array)
      expect(Array.from(stored.ints as Int16Array)).toEqual([-5, 300])
      expect(Array.from(stored.big as BigInt64Array)).toEqual([-(2n ** 40n)])
      expect(stored.clamped).toBeInstanceOf(Uint8ClampedArray)
      // Only the viewed bytes are stored, not the whole underlying buffer.
      expect(Array.from(stored.window as Uint8Array)).toEqual([7, 6, 5, 4])
      expect((stored.window as Uint8Array).buffer.byteLength).toBe(4)
      expect(stored.raw).toBeInstanceOf(ArrayBuffer)
      expect(Array.from(new Uint8Array(stored.raw as ArrayBuffer))).toEqual([9, 8, 7, 6, 5, 4, 3, 2])
      expect(stored.list).toEqual([1, [2, [3, { deep: new Date(5) }]]])
      expect(stored.empty).toEqual({})
      expect(stored.emptyList).toEqual([])
      expect(stored.text).toBe('ünïcödé ✓ 日本語')
      expect(stored).not.toHaveProperty('dropped')
    })
  })

  describe('crafted (but correctly encrypted) files', () => {
    const profileRow = {
      id: 'me', sexProfile: 'male', heightCm: 178, units: 'metric', dailyMinutes: 30, trainingDaysPerWeek: 3, scanWeekday: 0,
      privacyChecklist: {}, equipmentChecklist: {}, onboardedAt: null, createdAt: 1, updatedAt: 1,
    }

    it('restores a hand-built container, which proves the helpers above match the format', async () => {
      const bytes = Uint8Array.from([1, 2, 3, 4, 5])
      const plaintext = container(
        manifestOf(
          {
            profile: { rows: [profileRow] },
            kv: {
              rows: [
                { key: 'blob', value: { __lmxblob: 0, type: 'image/png' } },
                { key: 'file', value: { __lmxblob: 1, type: 'text/plain', name: 'n.txt', lastModified: 77 } },
                { key: 'date', value: { __lmxdate: 5 } },
                { key: 'ints', value: { __lmxbin: 0, kind: 'Uint8Array' } },
              ],
            },
            audit: { rows: [{ id: 41, ts: 1, event: 'settings_changed', detail: 'x' }] },
            nope: { rows: [{ whatever: 1 }] },
          },
          {},
          2,
        ),
        [bytes, Uint8Array.from([104, 105])],
      )
      const target = newDb()
      const summary = await restoreBackup(await craft(plaintext), PASS, target)
      expect(summary).toMatchObject({
        appVersion: 'test',
        createdAt: EXPORT_AT,
        tables: { profile: 1, kv: 4, audit: 1 },
        ignoredTables: ['nope'],
        blobCount: 2,
        blobBytes: 7,
      })
      expect(await target.profile.get('me')).toEqual(profileRow)
      const blob = (await target.kv.get('blob'))!.value as Blob
      expect(blob.type).toBe('image/png')
      expect(Array.from(await bytesOf(blob))).toEqual([1, 2, 3, 4, 5])
      expect(((await target.kv.get('date'))!.value as Date).getTime()).toBe(5)
      expect(Array.from((await target.kv.get('ints'))!.value as Uint8Array)).toEqual([1, 2, 3, 4, 5])
      expect((await target.audit.toArray()).map((row) => [row.id, row.event])).toEqual([
        [41, 'settings_changed'],
        [42, 'backup_restored'],
      ])
    })

    const badCases: [string, () => Uint8Array<ArrayBuffer>][] = [
      ['row without its primary key', () => container(manifestOf({ profile: { rows: [{ heightCm: 180 }] } }))],
      ['row with a null primary key', () => container(manifestOf({ kv: { rows: [{ key: null, value: 1 }] } }))],
      ['row with a boolean primary key', () => container(manifestOf({ kv: { rows: [{ key: true, value: 1 }] } }))],
      ['row with an object primary key', () => container(manifestOf({ kv: { rows: [{ key: { a: 1 }, value: 1 } ] } }))],
      ['row with an empty-array primary key', () => container(manifestOf({ kv: { rows: [{ key: [], value: 1 }] } }))],
      ['row with a non-finite primary key', () => container(manifestOf({ audit: { rows: [{ id: { __lmxnum: 'NaN' }, ts: 1 }] } }))],
      ['row that is a number', () => container(manifestOf({ whitelist: { rows: [5] } }))],
      ['row that is null', () => container(manifestOf({ whitelist: { rows: [null] } }))],
      ['row that is a string', () => container(manifestOf({ whitelist: { rows: ['id'] } }))],
      ['row that is an array', () => container(manifestOf({ whitelist: { rows: [['id']] } }))],
      ['row that revives to a Date', () => container(manifestOf({ kv: { rows: [{ __lmxdate: 1 }] } }))],
      ['duplicate primary keys', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: 1 }, { key: 'a', value: 2 }] } }))],
      ['rows that are not a list', () => container(manifestOf({ kv: { rows: { key: 'a' } } }))],
      ['table entry that is not an object', () => container(manifestOf({ kv: [] }))],
      ['tables that are a list', () => container(manifestOf([] as never))],
      ['file reference out of range', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxblob: 0, type: '' } }] } }))],
      ['negative file reference', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxblob: -1, type: '' } }] } }, {}, 1), [new Uint8Array(2)])],
      ['fractional file reference', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxblob: 0.5, type: '' } }] } }, {}, 1), [new Uint8Array(2)])],
      ['file reference with a stray key', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxblob: 0, type: '', extra: 1 } }] } }, {}, 1), [new Uint8Array(2)])],
      ['file reference without a type', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxblob: 0 } }] } }, {}, 1), [new Uint8Array(2)])],
      ['file with a non-text name', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxblob: 0, type: '', name: 5 } }] } }, {}, 1), [new Uint8Array(2)])],
      ['typed array of an unknown kind', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxbin: 0, kind: 'Function' } }] } }, {}, 1), [new Uint8Array(4)])],
      ['typed array with a ragged length', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxbin: 0, kind: 'Float32Array' } }] } }, {}, 1), [new Uint8Array(6)])],
      ['malformed date', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxdate: 'yesterday' } }] } }))],
      ['date out of range', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxdate: 9e15 } }] } }))],
      ['malformed special number', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxnum: 'banana' } }] } }))],
      ['unknown tagged value', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: { __lmxeval: 'alert(1)' } }] } }))],
      ['data nested far too deeply', () => container(manifestOf({ kv: { rows: [{ key: 'a', value: JSON.parse(`${'['.repeat(200)}${']'.repeat(200)}`) }] } }))],
      ['__proto__ field', () => container(manifestOf({ kv: { rows: [JSON.parse('{"key":"a","value":{"__proto__":{"polluted":true}}}')] } }))],
      ['manifest that is not JSON', () => container(new TextEncoder().encode('{not json'))],
      ['manifest that is not UTF-8', () => container(new Uint8Array([0xff, 0xfe, 0xfd]))],
      ['manifest that is not an object', () => container([1, 2, 3] as never)],
      ['wrong container name', () => container(manifestOf({}, { container: 'something-else' }))],
      ['missing container version', () => container(manifestOf({}, { containerVersion: undefined }))],
      ['fractional container version', () => container(manifestOf({}, { containerVersion: 1.5 }))],
      ['missing schema version', () => container(manifestOf({}, { schemaVersion: 'one' }))],
      ['file count that does not fit', () => container(manifestOf({}, {}, 9))],
      ['negative file count', () => container(manifestOf({}, {}, -1))],
      ['trailing bytes after the last file', () => container(manifestOf({}), [], 3)],
      ['file longer than the data', () => {
        const plaintext = container(manifestOf({}, {}, 1), [new Uint8Array(4)])
        new DataView(plaintext.buffer).setUint32(plaintext.length - 8, 5000)
        return plaintext
      }],
      ['manifest length longer than the data', () => {
        const plaintext = container(manifestOf({}))
        new DataView(plaintext.buffer).setUint32(0, 5000)
        return plaintext
      }],
      ['too short for a length', () => new Uint8Array([0, 0])],
      ['nothing at all', () => new Uint8Array(0)],
    ]

    it.each(badCases)('rejects %s as invalid_content and changes nothing', async (_name, build) => {
      const file = await craft(build())
      const target = newDb()
      await seed(target)
      const before = await dump(target)
      expect(await codeOf(inspectBackup(file, PASS, target))).toBe('invalid_content')
      expect(await codeOf(restoreBackup(file, PASS, target))).toBe('invalid_content')
      expect(await dump(target)).toEqual(before)
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('reports a newer container format as unsupported_version', async () => {
      const file = await craft(container(manifestOf({}, { containerVersion: 2 })))
      expect(await codeOf(inspectBackup(file, PASS, newDb()))).toBe('unsupported_version')
    })

    it('never puts file contents in an error message', async () => {
      const file = await craft(container(manifestOf({ kv: { rows: [{ key: 'topsecret-marker', value: { __lmxnum: 'topsecret-marker' } }] } })))
      const error = await inspectBackup(file, PASS, newDb()).catch((e: unknown) => e)
      expect((error as BackupError).code).toBe('invalid_content')
      expect((error as BackupError).message).not.toContain('topsecret-marker')
    })
  })

  describe('container codec', () => {
    it('round-trips a File with its name and timestamp (IndexedDB itself may hand back a plain Blob)', async () => {
      const database = newDb()
      const file = new File([PNG_LIKE], 'front.png', { type: 'image/png', lastModified: 1_650_000_000_000 })
      const { manifest, parts } = encodeSnapshot(
        [{ name: 'kv', primaryKey: 'key', rows: [{ key: 'f', value: { file, again: file } }] }],
        1,
        MAX_BACKUP_BYTES,
      )
      expect(manifest.blobs).toBe(2)
      const unpacked = unpackContainer(await packContainer(manifest, parts, MAX_BACKUP_BYTES))
      const plan = planRestore(unpacked.manifest, unpacked.parts, database)
      const value = plan.tables[0]!.rows[0]!.value as { file: File; again: File }
      expect(value.file).toBeInstanceOf(File)
      expect(value.file.name).toBe('front.png')
      expect(value.file.type).toBe('image/png')
      expect(value.file.lastModified).toBe(1_650_000_000_000)
      expect(Array.from(await bytesOf(value.again))).toEqual(Array.from(PNG_LIKE))
      expect(plan.blobCount).toBe(2)
      expect(plan.blobBytes).toBe(PNG_LIKE.length * 2)
    })

    it('refuses values that are not data, and runaway nesting, without overflowing the stack', () => {
      class Thing {
        value = 1
      }
      const rows = (value: unknown) => [{ name: 'kv', primaryKey: 'key', rows: [{ key: 'k', value }] }]
      for (const value of [new Thing(), () => 1, Symbol('s'), 7n, new Map(), new Set(), new Error('e'), /re/, new DataView(new ArrayBuffer(2))]) {
        expect(() => encodeSnapshot(rows(value), 1, MAX_BACKUP_BYTES), String(typeof value)).toThrow(BackupError)
      }
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      expect(() => encodeSnapshot(rows(cyclic), 1, MAX_BACKUP_BYTES)).toThrow(BackupError)
      expect(() => encodeSnapshot(rows({ __proto__: null, a: 1 }), 1, MAX_BACKUP_BYTES)).not.toThrow()
    })

    it('stops adding files once the cap is exceeded, before reading any of them', () => {
      const big = new Blob([new Uint8Array(1000)])
      const arrayBuffer = vi.spyOn(big, 'arrayBuffer')
      const rows = [{ name: 'kv', primaryKey: 'key', rows: [{ key: 'k', value: [big, big, big] }] }]
      expect(() => encodeSnapshot(rows, 1, 2500)).toThrow(expect.objectContaining({ code: 'too_large' }))
      expect(arrayBuffer).not.toHaveBeenCalled()
    })
  })
})

describe('public surface', () => {
  it('exposes the documented types of summary and error', async () => {
    const summary: BackupSummary = { createdAt: 1, appVersion: '0', formatVersion: 1, tables: {}, blobCount: 0, blobBytes: 0 }
    expect(summary.ignoredTables).toBeUndefined()
    const error = new BackupError('bad_magic')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BackupError')
    expect(error.code).toBe('bad_magic')
    expect(error.message).toMatch(/not an Unmoggable backup/)
  })
})
