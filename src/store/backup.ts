/**
 * Encrypted backup and restore of the whole local database.
 *
 *  - The file is AES-GCM-256 under a PBKDF2-SHA256 (600 000 rounds) key; layout in ./backupCrypto.
 *  - The plaintext is a generic container of EVERY table (./backupCodec), so tables added by later schema
 *    versions are backed up without touching this file.
 *  - Nothing leaves the device: exportBackup returns a Blob for the UI to hand to the user's own save dialog.
 *  - exportBackup and inspectBackup only read. restoreBackup replaces everything in one transaction, so a
 *    failure at any point leaves the previous data exactly as it was.
 *  - The passphrase and the decrypted data are never logged and never appear in an error message.
 *
 * exportBackup does not write an audit row: the UI knows whether the user actually saved the file and
 * records 'backup_exported' (store.appendAudit) at that point.
 */
import { version as APP_VERSION } from '../../package.json'
import { type BackupHeader, FORMAT_VERSION, MAX_BACKUP_BYTES, normalizePassphrase, open, seal } from './backupCrypto'
import {
  type RestorePlan,
  type TableSnapshot,
  encodeSnapshot,
  packContainer,
  planRestore,
  unpackContainer,
} from './backupCodec'
import { BackupError } from './backupError'
import { db, type LookmaxxingDB } from './db'

export { BackupError } from './backupError'
export type { BackupErrorCode } from './backupError'

export interface BackupSummary {
  createdAt: number
  appVersion: string
  formatVersion: number
  /** Rows per table. For inspect/restore: the tables this app version has and will restore. */
  tables: Record<string, number>
  /** Binary values (photos and other files) stored in the backup, and their total size. */
  blobCount: number
  blobBytes: number
  /** Always set by the three functions below: backup tables this app version does not have (skipped). */
  ignoredTables?: string[]
}

/** Test seams: an injectable clock and a lower size cap (it can never exceed the built-in 600 MB). */
export interface BackupDeps {
  now?: () => number
  maxBytes?: number
}

const MIN_PASSPHRASE_CHARS = 12

export function validatePassphrase(p: string): { ok: boolean; reason?: string } {
  if (typeof p !== 'string') return { ok: false, reason: 'Enter a passphrase.' }
  // Judged the way it will be used: normalized, and counted in characters rather than UTF-16 units.
  const text = normalizePassphrase(p)
  const chars = [...text]
  if (chars.length < MIN_PASSPHRASE_CHARS) return { ok: false, reason: `Use at least ${MIN_PASSPHRASE_CHARS} characters.` }
  if (chars.every((char) => char === chars[0])) return { ok: false, reason: 'Use more than one repeated character.' }
  if (/^\p{Nd}+$/u.test(text)) return { ok: false, reason: 'Use more than digits. A few unrelated words work well.' }
  return { ok: true }
}

/** Local calendar date, e.g. unmoggable-2026-10-10.lmxbackup. */
export function backupFilename(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date')
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `unmoggable-${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.lmxbackup`
}

const sizeLimit = (deps: BackupDeps): number => Math.min(MAX_BACKUP_BYTES, deps.maxBytes ?? MAX_BACKUP_BYTES)

/** One read-only transaction, so the file is a consistent snapshot even while the app is running. */
function snapshot(database: LookmaxxingDB): Promise<TableSnapshot[]> {
  return database.transaction('r', database.tables, async () => {
    const tables: TableSnapshot[] = []
    for (const table of database.tables) {
      const keyPath = table.schema.primKey.keyPath
      if (!keyPath || keyPath.length === 0) {
        throw new BackupError('invalid_content', `Table "${table.name}" has no inline primary key and cannot be backed up.`)
      }
      tables.push({ name: table.name, primaryKey: keyPath, rows: await table.toArray() })
    }
    return tables
  })
}

function summarize(
  meta: Pick<BackupHeader, 'createdAt' | 'appVersion' | 'formatVersion'>,
  tables: Record<string, number>,
  blobCount: number,
  blobBytes: number,
  ignoredTables: string[],
): BackupSummary {
  return {
    createdAt: meta.createdAt,
    appVersion: meta.appVersion,
    formatVersion: meta.formatVersion,
    tables,
    blobCount,
    blobBytes,
    ignoredTables,
  }
}

export async function exportBackup(
  passphrase: string,
  database: LookmaxxingDB = db,
  deps: BackupDeps = {},
): Promise<{ blob: Blob; filename: string; summary: BackupSummary }> {
  const strength = validatePassphrase(passphrase)
  if (!strength.ok) throw new BackupError('weak_passphrase', strength.reason)

  const maxBytes = sizeLimit(deps)
  const tables = await snapshot(database)
  const { manifest, parts } = encodeSnapshot(tables, database.verno, maxBytes)
  const plaintext = await packContainer(manifest, parts, maxBytes)
  const createdAt = Math.trunc((deps.now ?? Date.now)())
  const blob = await seal(plaintext, passphrase, { createdAt, appVersion: APP_VERSION }, maxBytes)

  const counts = Object.fromEntries(tables.map((table) => [table.name, table.rows.length]))
  const blobBytes = parts.reduce((sum, part) => sum + part.size, 0)
  const meta = { createdAt, appVersion: APP_VERSION, formatVersion: FORMAT_VERSION }
  return { blob, filename: backupFilename(new Date(createdAt)), summary: summarize(meta, counts, parts.length, blobBytes, []) }
}

/** Everything restore checks, minus the write. */
async function load(
  file: Blob | ArrayBuffer | Uint8Array,
  passphrase: string,
  database: LookmaxxingDB,
  deps: BackupDeps,
): Promise<{ header: BackupHeader; plan: RestorePlan }> {
  const { header, plaintext } = await open(file, passphrase, sizeLimit(deps))
  const { manifest, parts } = unpackContainer(plaintext)
  return { header, plan: planRestore(manifest, parts, database) }
}

/** Decrypts and validates exactly like restoreBackup, but writes nothing. */
export async function inspectBackup(
  file: Blob | ArrayBuffer | Uint8Array,
  passphrase: string,
  database: LookmaxxingDB = db,
  deps: BackupDeps = {},
): Promise<BackupSummary> {
  const { header, plan } = await load(file, passphrase, database, deps)
  return summarize(header, plan.counts, plan.blobCount, plan.blobBytes, plan.ignoredTables)
}

/**
 * Replaces ALL current data with the backup's. Every table is cleared and refilled inside one read-write
 * transaction, and the 'backup_restored' audit row is added last, in that same transaction: either all of it
 * happens or none of it does. Tables the app has but the backup lacks end up empty.
 */
export async function restoreBackup(
  file: Blob | ArrayBuffer | Uint8Array,
  passphrase: string,
  database: LookmaxxingDB = db,
  deps: BackupDeps = {},
): Promise<BackupSummary> {
  const { header, plan } = await load(file, passphrase, database, deps)
  const rowCount = Object.values(plan.counts).reduce((sum, count) => sum + count, 0)
  const skipped = plan.ignoredTables.length > 0 ? `, ${plan.ignoredTables.length} unknown tables skipped` : ''
  const detail = `Restored backup from ${new Date(header.createdAt).toISOString().slice(0, 10)}: ${rowCount} records, ${plan.blobCount} files${skipped}`

  const rowsByTable = new Map(plan.tables.map((entry) => [entry.table.name, entry.rows]))
  await database.transaction('rw', database.tables, async () => {
    for (const table of database.tables) {
      await table.clear()
      const rows = rowsByTable.get(table.name)
      if (rows && rows.length > 0) await table.bulkAdd(rows)
    }
    await database.audit.add({ ts: (deps.now ?? Date.now)(), event: 'backup_restored', detail })
  })
  return summarize(header, plan.counts, plan.blobCount, plan.blobBytes, plan.ignoredTables)
}
