/**
 * Runs once, before React renders. Order matters: the network guard goes first so nothing that
 * loads afterwards can keep a reference to the unguarded fetch/XHR/WebSocket.
 */
import { NET_BLOCKED_EVENT, installNetGuard, raiseResourceTimingBuffer } from './privacy'
import type { NetBlockRecord } from './privacy'
import { store } from './store'

/** At most one audit row per origin per minute, and a hard cap per page load, so a loop cannot flood the log. */
const AUDIT_GAP_MS = 60_000
const AUDIT_MAX_ROWS = 25

function isBlockRecord(value: unknown): value is NetBlockRecord {
  return typeof value === 'object' && value !== null && typeof (value as NetBlockRecord).origin === 'string'
}

function auditBlockedRequests(): void {
  const lastWrite = new Map<string, number>()
  let written = 0

  window.addEventListener(NET_BLOCKED_EVENT, (event) => {
    const record: unknown = (event as CustomEvent).detail
    if (!isBlockRecord(record) || written >= AUDIT_MAX_ROWS) return
    const now = Date.now()
    const previous = lastWrite.get(record.origin)
    if (previous !== undefined && now - previous < AUDIT_GAP_MS) return
    lastWrite.set(record.origin, now)
    written += 1
    // Origin only: the guard never records paths, queries or credentials.
    store.appendAudit('network_blocked', `Blocked ${record.kind} request to ${record.origin}`).catch(() => {
      /* the audit row is best effort; the in-memory counter still shows the block */
    })
  })
}

let booted = false

export function boot(): void {
  if (booted) return
  booted = true

  installNetGuard({ allowSameOriginWebSocket: import.meta.env.DEV })
  raiseResourceTimingBuffer()
  auditBlockedRequests()

  // Creates the default profile row so every screen can assume it exists.
  store.getProfile().catch((error: unknown) => {
    console.error('Local storage is not available', error)
  })

  if (import.meta.env.PROD) {
    // autoUpdate: a new build installs itself on the next open. No prompt, no data is touched.
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        registerSW({ immediate: true })
      })
      .catch((error: unknown) => {
        console.error('Offline support could not start', error)
      })
  }
}
