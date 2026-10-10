import type { BackupErrorCode } from '../../store/backupError'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 1536 -> "1.5 KB". Null or invalid -> "unknown". */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'unknown'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
  return `${text} ${UNITS[unit]}`
}

/** Local date, 2026-10-10. Null or invalid -> "unknown". */
export function formatDate(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 41.2 of 100 -> "41%". Under 1% reads "under 1%". Unknown when either is missing. */
export function formatPercent(usage: number | null, quota: number | null): string {
  if (usage === null || quota === null || quota <= 0) return 'unknown'
  const pct = (usage / quota) * 100
  if (pct > 0 && pct < 1) return 'under 1%'
  return `${Math.round(pct)}%`
}

const BACKUP_MESSAGES: Record<BackupErrorCode, string> = {
  weak_passphrase: 'The passphrase is too weak. Use at least 12 characters.',
  bad_magic: 'This is not a Lookmaxing backup file.',
  unsupported_version: 'This backup was made by a different version of the app and cannot be opened.',
  wrong_passphrase_or_corrupt: 'Wrong passphrase, or the file is damaged. The app cannot tell which.',
  too_large: 'This backup is too large to handle on this device.',
  invalid_content: 'The backup file is damaged or its contents are not valid.',
  kdf_params_out_of_range: 'This backup uses unsafe encryption settings and was not opened.',
}

/** Plain message for any error thrown by the backup module. Never includes data from the file. */
export function backupErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code: unknown = Reflect.get(error, 'code')
    if (typeof code === 'string' && Object.hasOwn(BACKUP_MESSAGES, code)) return BACKUP_MESSAGES[code as BackupErrorCode]
    if (Reflect.get(error, 'name') === 'QuotaExceededError') return 'The device ran out of storage space.'
  }
  return 'Something went wrong. Nothing was changed.'
}

/** Errors from navigator.share: a user cancel is not a failure. */
export function isShareCancel(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'name') === 'AbortError'
}

/** Table names are internal ("kv"); show them in words. */
export function tableLabel(name: string): string {
  const labels: Record<string, string> = {
    profile: 'Profile',
    whitelist: 'Whitelist items',
    audit: 'Activity log rows',
    kv: 'Settings values',
  }
  if (Object.hasOwn(labels, name)) return labels[name]
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown table'
}

export type OriginVerdict = { ok: true } | { ok: false; reason: string }

/** Production must load from exactly one origin. Anything else is a failure. */
export function judgeOrigins(total: number, external: readonly string[]): OriginVerdict {
  if (external.length > 0) return { ok: false, reason: `Loaded from ${external.length} other ${external.length === 1 ? 'origin' : 'origins'}.` }
  if (total !== 1) return { ok: false, reason: `Expected 1 origin, found ${total}.` }
  return { ok: true }
}
