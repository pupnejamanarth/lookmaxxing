import { getNetGuardStats, type NetGuardTarget } from './netGuard'

/**
 * Origin audit for the Settings "Privacy check" panel: which origins did this page actually load
 * anything from? In production the answer must be exactly one – our own.
 *
 * Reads the Resource Timing buffer, which also lists loads the guard cannot see (<img>, <link>,
 * workers). The meta CSP is what prevents them; this is how we notice if it ever fails.
 */

export interface OriginCount {
  origin: string
  count: number
}

export interface OriginAudit {
  /** Every origin seen, own origin first, then by count (descending) and name. */
  origins: OriginCount[]
  /** Origins other than our own, sorted. Empty is the only acceptable answer in production. */
  external: string[]
}

/** What the audit can and cannot see. Worker traffic never shows up in the page's timing buffer. */
export interface OriginAuditReport extends OriginAudit {
  /** True when the timing buffer overflowed or was cleared: the list may be incomplete. */
  truncated: boolean
  /** CSP violations the page reported (origin only). Not every engine lists blocked loads in the timing buffer. */
  cspBlocked: { origin: string; count: number }[]
}

export const UNPARSEABLE_ORIGIN = '(unparseable)'

function normalizeOrigin(value: string): string {
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? value.trim() : origin
  } catch {
    return value.trim()
  }
}

function parseEntryUrl(name: string, selfOrigin: string): URL | null {
  try {
    return new URL(name, selfOrigin)
  } catch {
    // An unknown own origin must not stop an absolute URL from being read.
  }
  try {
    return new URL(name)
  } catch {
    return null
  }
}

/** null = not a network load (data:/blob: never leave the device), so it is not an origin. */
function originOfEntry(name: string, selfOrigin: string): string | null {
  const url = parseEntryUrl(name, selfOrigin)
  if (!url) return UNPARSEABLE_ORIGIN
  if (url.protocol === 'data:' || url.protocol === 'blob:') return null
  if (url.origin !== 'null') return url.origin
  return url.host ? `${url.protocol}//${url.host}` : url.protocol
}

export function summarizeResourceOrigins(entries: readonly { name: string }[], selfOrigin: string): OriginAudit {
  const self = normalizeOrigin(selfOrigin)
  const counts = new Map<string, number>()
  for (const { name } of entries) {
    const origin = originOfEntry(String(name), self)
    if (origin !== null) counts.set(origin, (counts.get(origin) ?? 0) + 1)
  }

  const origins: OriginCount[] = [...counts].map(([origin, count]) => ({ origin, count }))
  origins.sort((a, b) => {
    if ((a.origin === self) !== (b.origin === self)) return a.origin === self ? -1 : 1
    if (a.count !== b.count) return b.count - a.count
    return a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0
  })

  const external = origins
    .map((o) => o.origin)
    .filter((origin) => origin !== self)
    .sort()
  return { origins, external }
}

export interface PerformanceLike {
  getEntriesByType(type: string): readonly { name: string }[]
  setResourceTimingBufferSize?(maxSize: number): void
  clearResourceTimings?(): void
  addEventListener?(type: string, listener: () => void): void
}

export interface OriginAuditEnv {
  /** Defaults to globalThis.performance. */
  performance?: PerformanceLike
  /** Defaults to globalThis.location. */
  location?: { href: string; origin?: string }
  /** Where the net guard is installed (for its CSP tally). Defaults to globalThis. */
  netGuardTarget?: NetGuardTarget
}

interface WatchState {
  truncated: boolean
  captured: Set<string>
}

const watches = new WeakMap<object, WatchState>()

/**
 * Notice when the Resource Timing buffer overflows or is cleared. Origins already seen are kept so
 * a foreign load cannot disappear from the audit; `truncated` tells the UI the list may be partial.
 * Idempotent per performance object. Call once at startup.
 */
export function watchResourceTiming(env: OriginAuditEnv = {}): void {
  const perf = env.performance ?? globalThis.performance
  if (!perf || watches.has(perf)) return
  const state: WatchState = { truncated: false, captured: new Set() }
  watches.set(perf, state)
  const snapshot = (): void => {
    const self = normalizeOrigin(env.location?.origin ?? env.location?.href ?? globalThis.location?.origin ?? '')
    for (const { origin } of summarizeResourceOrigins(entriesOfType(perf, 'resource'), self).origins) state.captured.add(origin)
  }
  try {
    perf.addEventListener?.('resourcetimingbufferfull', () => {
      snapshot()
      state.truncated = true
    })
    const nativeClear = perf.clearResourceTimings
    if (typeof nativeClear === 'function') {
      perf.clearResourceTimings = function clearResourceTimings(this: unknown) {
        snapshot()
        state.truncated = true
        return nativeClear.call(perf)
      }
    }
  } catch {
    /* best effort */
  }
}

function entriesOfType(perf: PerformanceLike | undefined, type: string): { name: string }[] {
  try {
    return perf ? [...perf.getEntriesByType(type)] : []
  } catch {
    return []
  }
}

/** The audit for the running page: navigation + resource entries, relative to document.location. */
export function getOriginAudit(env: OriginAuditEnv = {}): OriginAuditReport {
  const perf = env.performance ?? globalThis.performance
  const loc = env.location ?? globalThis.location
  const navigation = entriesOfType(perf, 'navigation')
  // Some engines expose no navigation entry; the document itself must still count.
  const document = navigation.length === 0 && loc?.href ? [{ name: loc.href }] : []
  const entries = [...document, ...navigation, ...entriesOfType(perf, 'resource')]
  const selfOrigin = loc?.origin ?? loc?.href ?? ''
  const base = summarizeResourceOrigins(entries, selfOrigin)
  const watch = perf ? watches.get(perf) : undefined
  const self = normalizeOrigin(selfOrigin)
  const origins = [...base.origins]
  // Origins seen before an eviction stay visible (count 0 = no longer in the buffer).
  for (const origin of watch?.captured ?? []) {
    if (origin !== self && !origins.some((o) => o.origin === origin)) origins.push({ origin, count: 0 })
  }
  const external = origins.map((o) => o.origin).filter((o) => o !== self).sort()
  return {
    origins,
    external,
    truncated: watch?.truncated ?? false,
    cspBlocked: getNetGuardStats(env.netGuardTarget).cspBlocked,
  }
}

/**
 * Resource Timing keeps only 250 entries by default and then silently drops the rest, which would
 * let a late foreign load go unseen. Call once at startup.
 */
export function raiseResourceTimingBuffer(size = 2000, env: OriginAuditEnv = {}): void {
  const perf = env.performance ?? globalThis.performance
  try {
    perf?.setResourceTimingBufferSize?.(size)
  } catch {
    /* best effort – the audit just sees fewer entries */
  }
}
