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
}

export interface OriginAuditEnv {
  /** Defaults to globalThis.performance. */
  performance?: PerformanceLike
  /** Defaults to globalThis.location. */
  location?: { href: string; origin?: string }
}

function entriesOfType(perf: PerformanceLike | undefined, type: string): { name: string }[] {
  try {
    return perf ? [...perf.getEntriesByType(type)] : []
  } catch {
    return []
  }
}

/** The audit for the running page: navigation + resource entries, relative to document.location. */
export function getOriginAudit(env: OriginAuditEnv = {}): OriginAudit {
  const perf = env.performance ?? globalThis.performance
  const loc = env.location ?? globalThis.location
  const navigation = entriesOfType(perf, 'navigation')
  // Some engines expose no navigation entry; the document itself must still count.
  const document = navigation.length === 0 && loc?.href ? [{ name: loc.href }] : []
  const entries = [...document, ...navigation, ...entriesOfType(perf, 'resource')]
  return summarizeResourceOrigins(entries, loc?.origin ?? loc?.href ?? '')
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
