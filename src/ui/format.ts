/** Small, locale-aware formatting helpers shared by screens. All take plain numbers (ms timestamps, counts). */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** plural(1, 'origin') -> 'origin', plural(2, 'origin') -> 'origins'. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many
}

/** "12 Oct 2026, 14:03" in the device locale. */
export function formatDateTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts)
  } catch {
    return new Date(ts).toISOString()
  }
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "9 days ago", "3 months ago". */
export function formatAgo(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts)
  if (diff < MINUTE_MS) return 'just now'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} min ago`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} h ago`
  const days = Math.floor(diff / DAY_MS)
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days} days ago`
  const months = Math.floor(days / 30)
  return `${months} months ago`
}

/** Whole days since `ts` (rounded down). */
export function daysSince(ts: number, now: number = Date.now()): number {
  return Math.floor(Math.max(0, now - ts) / DAY_MS)
}

/** 0 when `weekday` (0 = Sunday) is today, otherwise 1 to 6. */
export function daysUntilWeekday(weekday: number, now: Date = new Date()): number {
  return (((weekday - now.getDay()) % 7) + 7) % 7
}

/** "today", "tomorrow" or "in 3 days". */
export function formatInDays(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}
