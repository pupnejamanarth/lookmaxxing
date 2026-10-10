/**
 * Runtime network lockdown. Second line of defence behind the meta CSP (`connect-src 'self'`).
 *
 * Wraps every script-reachable way of opening a connection – fetch, XMLHttpRequest, WebSocket,
 * EventSource and navigator.sendBeacon – and refuses anything whose resolved URL is not this
 * origin. blob:/data: URLs never touch the network, so they pass. Every refusal is recorded
 * (origin only – never the path, query or credentials) and announced as a `lmx:net-blocked`
 * CustomEvent on the target.
 *
 * Install it before any other code runs: a reference captured earlier (`const f = fetch`)
 * is not wrapped.
 */

export const NET_BLOCKED_EVENT = 'lmx:net-blocked'
export const MAX_RECENT_BLOCKS = 50

export type NetBlockKind = 'fetch' | 'xhr' | 'websocket' | 'eventsource' | 'beacon'

/** Also the `detail` of the `lmx:net-blocked` event. */
export interface NetBlockRecord {
  kind: NetBlockKind
  /** Origin only, e.g. "https://evil.example". "invalid-url" when the URL could not be parsed. */
  origin: string
  ts: number
}

export interface NetGuardStats {
  installed: boolean
  /** Total refusals since install (not capped). */
  blockedCount: number
  /** Newest last, at most MAX_RECENT_BLOCKS. A copy – mutating it does not affect the guard. */
  recent: NetBlockRecord[]
}

/**
 * What the guard touches on its target. Everything is `unknown` on purpose: a real `window`
 * and the plain fake objects used in tests both fit, and each member is feature-detected.
 */
export interface NetGuardTarget {
  location?: { href: string }
  document?: { baseURI?: string }
  fetch?: unknown
  XMLHttpRequest?: unknown
  WebSocket?: unknown
  EventSource?: unknown
  navigator?: unknown
  dispatchEvent?: unknown
  CustomEvent?: unknown
}

export interface NetGuardOptions {
  /** Defaults to globalThis. */
  target?: NetGuardTarget
  /** Vite dev HMR only. Same-origin ws:// (wss:// on https pages) is still refused unless this is set. */
  allowSameOriginWebSocket?: boolean
  /** Clock for the recorded timestamps. Defaults to Date.now. */
  now?: () => number
}

interface Verdict {
  allowed: boolean
  origin: string
}

interface GuardState {
  blockedCount: number
  recent: NetBlockRecord[]
}

type AnyFn = (...args: unknown[]) => unknown

// Symbol.for so the state survives a duplicated module instance (Vite HMR re-evaluation).
const STATE_KEY = Symbol.for('lmx.netGuard.state')

const isFn = (value: unknown): value is AnyFn => typeof value === 'function'

function parseUrl(raw: string, resolveBase: string): URL | null {
  try {
    return new URL(raw, resolveBase)
  } catch {
    // An unusable base must not stop an absolute URL (e.g. data:) from being judged.
  }
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function originOfHref(href: string): string {
  try {
    return new URL(href).origin
  } catch {
    return 'null'
  }
}

function labelOf(url: URL): string {
  return url.origin !== 'null' ? url.origin : url.protocol
}

/**
 * Judge a URL. `selfHref` decides which origin counts as "ours"; `resolveBase` is only used to
 * resolve relative URLs (document.baseURI can differ from location.href because of <base>, and a
 * hostile <base> must make relative requests *blocked*, not move the trusted origin).
 */
function inspectUrl(raw: string | URL, selfHref: string, resolveBase: string): Verdict {
  const url = parseUrl(String(raw), resolveBase)
  if (!url) return { allowed: false, origin: 'invalid-url' }
  const self = originOfHref(selfHref)

  switch (url.protocol) {
    case 'data:':
      return { allowed: true, origin: 'data:' }
    case 'blob:': {
      // A blob URL is looked up in the browser's own blob store; no request is made. Still, one
      // that names a foreign origin cannot be ours, so it is refused rather than waved through.
      const inner = url.origin
      return { allowed: inner === 'null' || inner === self, origin: labelOf(url) }
    }
    case 'http:':
    case 'https:':
      return { allowed: self !== 'null' && url.origin === self, origin: labelOf(url) }
    case 'ws:':
    case 'wss:': {
      const mapped = `${url.protocol === 'ws:' ? 'http:' : 'https:'}//${url.host}`
      return { allowed: self !== 'null' && mapped === self, origin: labelOf(url) }
    }
    default:
      return { allowed: false, origin: labelOf(url) }
  }
}

/** True when `url` (resolved against `baseHref`) stays on the origin of `baseHref`, or is blob:/data:. */
export function isAllowedUrl(url: string | URL, baseHref: string): boolean {
  return inspectUrl(url, baseHref, baseHref).allowed
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input
  if (typeof input === 'object' && input !== null) {
    const url = Reflect.get(input, 'url')
    if (typeof url === 'string') return url // Request
  }
  return String(input) // URL, or anything with a toString
}

function readState(target: object): GuardState | undefined {
  const state: unknown = Reflect.get(target, STATE_KEY)
  return typeof state === 'object' && state !== null ? (state as GuardState) : undefined
}

function replaceMember(obj: object, key: string, value: unknown): void {
  const existing = Object.getOwnPropertyDescriptor(obj, key)
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: existing?.enumerable ?? false,
  })
}

function stringMember(obj: unknown, key: string): string {
  if (typeof obj !== 'object' || obj === null) return ''
  const value: unknown = Reflect.get(obj, key)
  return typeof value === 'string' ? value : ''
}

/** Idempotent: a second call on the same target (even from a duplicated module) changes nothing. */
export function installNetGuard(opts: NetGuardOptions = {}): void {
  const target: NetGuardTarget = opts.target ?? globalThis
  if (readState(target)) return

  const state: GuardState = { blockedCount: 0, recent: [] }
  Object.defineProperty(target, STATE_KEY, { value: state, configurable: true })

  const now = opts.now ?? Date.now
  const allowSocket = opts.allowSameOriginWebSocket === true

  const selfHref = (): string => stringMember(target.location, 'href')
  const verdictFor = (raw: string | URL): Verdict =>
    inspectUrl(raw, selfHref(), stringMember(target.document, 'baseURI') || selfHref())

  const announce = (record: NetBlockRecord): void => {
    const dispatch: unknown = Reflect.get(target, 'dispatchEvent')
    const Ctor: unknown = Reflect.get(target, 'CustomEvent') ?? globalThis.CustomEvent
    if (!isFn(dispatch) || !isFn(Ctor)) return
    try {
      dispatch.call(target, Reflect.construct(Ctor, [NET_BLOCKED_EVENT, { detail: { ...record } }]))
    } catch {
      /* a broken listener must never turn a refusal into an allowance */
    }
  }

  const record = (kind: NetBlockKind, origin: string): void => {
    const entry: NetBlockRecord = { kind, origin, ts: now() }
    state.blockedCount += 1
    state.recent.push(entry)
    if (state.recent.length > MAX_RECENT_BLOCKS) state.recent.splice(0, state.recent.length - MAX_RECENT_BLOCKS)
    announce(entry)
  }

  const refuse = (kind: NetBlockKind, origin: string): TypeError => {
    record(kind, origin)
    return new TypeError(`Blocked by privacy guard: ${origin}`)
  }

  const nativeFetch: unknown = Reflect.get(target, 'fetch')
  if (isFn(nativeFetch)) {
    replaceMember(target, 'fetch', async function guardedFetch(...args: unknown[]): Promise<unknown> {
      const verdict = verdictFor(requestUrl(args[0]))
      if (!verdict.allowed) throw refuse('fetch', verdict.origin)
      const response = await nativeFetch.apply(target, args)
      // The request to a redirect target has already left (CSP connect-src is what stops it);
      // all that is left to do is to not hand the foreign response to the app.
      if (typeof response === 'object' && response !== null && Reflect.get(response, 'redirected') === true) {
        const finalUrl = stringMember(response, 'url')
        const landed = finalUrl ? verdictFor(finalUrl) : null
        if (landed && !landed.allowed) throw refuse('fetch', landed.origin)
      }
      return response
    })
  }

  const xhr: unknown = Reflect.get(target, 'XMLHttpRequest')
  const xhrProto: unknown = isFn(xhr) ? Reflect.get(xhr, 'prototype') : undefined
  if (typeof xhrProto === 'object' && xhrProto !== null) {
    const nativeOpen: unknown = Reflect.get(xhrProto, 'open')
    if (isFn(nativeOpen)) {
      replaceMember(xhrProto, 'open', function guardedOpen(this: unknown, ...args: unknown[]): unknown {
        const verdict = verdictFor(String(args[1] ?? ''))
        if (!verdict.allowed) throw refuse('xhr', verdict.origin)
        return nativeOpen.apply(this, args)
      })
    }
  }

  const guardConstructor = (key: 'WebSocket' | 'EventSource', kind: NetBlockKind, sameOriginOk: boolean): void => {
    const Native: unknown = Reflect.get(target, key)
    if (!isFn(Native)) return
    // A Proxy keeps the statics (WebSocket.OPEN), the prototype and subclassing intact.
    replaceMember(
      target,
      key,
      new Proxy(Native, {
        construct(ctor, args, newTarget) {
          const verdict = verdictFor(String(args[0]))
          if (!verdict.allowed || !sameOriginOk) throw refuse(kind, verdict.origin)
          return Reflect.construct(ctor, args, newTarget)
        },
      }),
    )
  }
  guardConstructor('WebSocket', 'websocket', allowSocket)
  guardConstructor('EventSource', 'eventsource', true)

  const nav = target.navigator
  if (typeof nav === 'object' && nav !== null) {
    const nativeBeacon: unknown = Reflect.get(nav, 'sendBeacon')
    if (isFn(nativeBeacon)) {
      replaceMember(nav, 'sendBeacon', function guardedBeacon(...args: unknown[]): unknown {
        const verdict = verdictFor(String(args[0]))
        if (!verdict.allowed) {
          record('beacon', verdict.origin)
          return false
        }
        // Bound to navigator so a detached `const send = navigator.sendBeacon` still works.
        return nativeBeacon.apply(nav, args)
      })
    }
  }
}

/** Read the guard's counters. `target` defaults to globalThis. */
export function getNetGuardStats(target: NetGuardTarget = globalThis): NetGuardStats {
  const state = readState(target)
  if (!state) return { installed: false, blockedCount: 0, recent: [] }
  return {
    installed: true,
    blockedCount: state.blockedCount,
    recent: state.recent.map((entry) => ({ ...entry })),
  }
}
