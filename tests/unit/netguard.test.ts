import { describe, expect, it } from 'vitest'
import {
  MAX_RECENT_BLOCKS,
  NET_BLOCKED_EVENT,
  getNetGuardStats,
  installNetGuard,
  isAllowedUrl,
  type NetBlockRecord,
} from '../../src/privacy'

const PROD = 'https://app.example/lookmaxxing/'
const DEV = 'http://localhost:5173/lookmaxxing/'

/** A window-shaped object that records what reached the "network" – no real I/O anywhere. */
function makeWindow(href = PROD, extra: Record<string, unknown> = {}) {
  const reached = {
    fetch: [] as unknown[][],
    xhr: [] as unknown[][],
    ws: [] as unknown[][],
    es: [] as unknown[][],
    beacon: [] as unknown[][],
  }
  const events: CustomEvent<NetBlockRecord>[] = []

  class FakeXHR {
    open(...args: unknown[]) {
      reached.xhr.push([this, ...args])
    }
  }
  class FakeWebSocket {
    static OPEN = 1
    constructor(...args: unknown[]) {
      reached.ws.push(args)
    }
  }
  class FakeEventSource {
    constructor(...args: unknown[]) {
      reached.es.push(args)
    }
  }

  const win = {
    location: { href },
    fetch: async (...args: unknown[]) => {
      reached.fetch.push(args)
      return { ok: true, redirected: false, url: '' }
    },
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWebSocket,
    EventSource: FakeEventSource,
    navigator: {
      sendBeacon: (...args: unknown[]) => {
        reached.beacon.push(args)
        return true
      },
    },
    dispatchEvent: (event: Event) => {
      events.push(event as CustomEvent<NetBlockRecord>)
      return true
    },
    ...extra,
  }
  return { win, reached, events, FakeWebSocket, FakeXHR, FakeEventSource }
}

/** Deterministic clock: 1, 2, 3, ... */
function counter() {
  let t = 0
  return () => ++t
}

const SAME_ORIGIN = [
  '/lookmaxxing/assets/index-abc123.js',
  'assets/model.task',
  'models/face_landmarker.task',
  '/lookmaxxing/sw.js',
  'https://app.example/lookmaxxing/manifest.webmanifest',
  'https://app.example',
  'https://APP.example/x',
  'https://app.example:443/x',
  '?q=1',
  '#frag',
  '',
]

const CROSS_ORIGIN = [
  'https://evil.example/x',
  '//evil.example/x',
  'http://app.example/x',
  'https://good.example@evil.example/',
  'https://app.example@evil.example/',
  'https://app.example:8443/x',
  'https://app.example.evil.example/x',
  'https://evil.example/https://app.example/',
  'https://evil.example\\@app.example/',
  'https://evil.example#@app.example/',
  'https://sub.app.example/x',
  'https://app.example./x',
  'wss://evil.example/x',
  'ftp://app.example/x',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'blob:https://evil.example/7a1b3c',
  'http://',
  'https://[',
]

describe('isAllowedUrl', () => {
  it.each(SAME_ORIGIN)('allows same-origin %j', (url) => {
    expect(isAllowedUrl(url, PROD)).toBe(true)
  })

  it.each(CROSS_ORIGIN)('blocks %j', (url) => {
    expect(isAllowedUrl(url, PROD)).toBe(false)
  })

  it('allows blob: and data: (no network involved)', () => {
    expect(isAllowedUrl('blob:https://app.example/7a1b3c', PROD)).toBe(true)
    expect(isAllowedUrl('blob:null/7a1b3c', PROD)).toBe(true)
    expect(isAllowedUrl('data:image/jpeg;base64,/9j/4AAQ', PROD)).toBe(true)
    expect(isAllowedUrl('data:text/plain,hello', PROD)).toBe(true)
  })

  it('accepts URL objects', () => {
    expect(isAllowedUrl(new URL('https://app.example/a'), PROD)).toBe(true)
    expect(isAllowedUrl(new URL('https://evil.example/a'), PROD)).toBe(false)
  })

  it('treats the host after userinfo and backslash as the real one (same parser as the browser)', () => {
    expect(isAllowedUrl('https://evil.example@app.example/x', PROD)).toBe(true)
    expect(isAllowedUrl('https://app.example\\@evil.example/', PROD)).toBe(true)
  })

  it('maps ws/wss onto the page scheme and refuses everything else', () => {
    expect(isAllowedUrl('wss://app.example/hmr', PROD)).toBe(true)
    expect(isAllowedUrl('ws://app.example/hmr', PROD)).toBe(false)
    expect(isAllowedUrl('ws://localhost:5173/', DEV)).toBe(true)
    expect(isAllowedUrl('ws://localhost:24678/', DEV)).toBe(false)
    expect(isAllowedUrl('wss://localhost:5173/', DEV)).toBe(false)
  })

  it('blocks everything but blob:/data: when the base has an opaque origin', () => {
    expect(isAllowedUrl('file:///app/x.js', 'file:///app/index.html')).toBe(false)
    expect(isAllowedUrl('x.js', 'file:///app/index.html')).toBe(false)
    expect(isAllowedUrl('x.js', 'not a url')).toBe(false)
    expect(isAllowedUrl('data:text/plain,a', 'not a url')).toBe(true)
  })
})

describe('installNetGuard – fetch', () => {
  it.each(SAME_ORIGIN)('passes same-origin %j through untouched', async (url) => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    const init = { method: 'GET' }
    await expect(win.fetch(url, init)).resolves.toMatchObject({ ok: true })
    expect(reached.fetch).toEqual([[url, init]])
    expect(getNetGuardStats(win).blockedCount).toBe(0)
  })

  it('accepts URL and Request-like inputs when same-origin', async () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    await win.fetch(new URL('https://app.example/lookmaxxing/a.json'))
    await win.fetch({ url: 'https://app.example/lookmaxxing/b.json' })
    expect(reached.fetch).toHaveLength(2)
  })

  it('calls the original with the window as this', async () => {
    const { win } = makeWindow()
    const receivers: unknown[] = []
    win.fetch = async function (this: unknown) {
      receivers.push(this)
      return { ok: true, redirected: false, url: '' }
    }
    installNetGuard({ target: win })
    await win.fetch('/x')
    expect(receivers).toEqual([win])
    expect(receivers[0]).toBe(win)
  })

  it.each(CROSS_ORIGIN)('rejects %j with TypeError and never reaches the network', async (url) => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    const result = win.fetch(url)
    await expect(result).rejects.toBeInstanceOf(TypeError)
    await expect(result).rejects.toThrow(/^Blocked by privacy guard: /)
    expect(reached.fetch).toHaveLength(0)
    expect(getNetGuardStats(win).blockedCount).toBe(1)
  })

  it('names the origin in the error', async () => {
    const { win } = makeWindow()
    installNetGuard({ target: win })
    await expect(win.fetch('https://evil.example/x')).rejects.toThrow('Blocked by privacy guard: https://evil.example')
    await expect(win.fetch('//evil.example:8443/x')).rejects.toThrow('Blocked by privacy guard: https://evil.example:8443')
    await expect(win.fetch('http://app.example/x')).rejects.toThrow('Blocked by privacy guard: http://app.example')
  })

  it('blocks a Request-like object by its url', async () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    await expect(win.fetch({ url: 'https://evil.example/x' })).rejects.toThrow(/evil\.example/)
    expect(reached.fetch).toHaveLength(0)
  })

  it('allows blob: and data: URLs', async () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    await win.fetch('blob:https://app.example/7a1b3c')
    await win.fetch('data:text/plain,hello')
    expect(reached.fetch).toHaveLength(2)
    expect(getNetGuardStats(win).blockedCount).toBe(0)
  })

  it('does not hand the app a response that was redirected off-origin', async () => {
    const { win } = makeWindow()
    win.fetch = async () => ({ ok: true, redirected: true, url: 'https://evil.example/landing?t=1' })
    installNetGuard({ target: win })
    await expect(win.fetch('/lookmaxxing/redirecting')).rejects.toThrow('Blocked by privacy guard: https://evil.example')
    expect(getNetGuardStats(win).recent).toMatchObject([{ kind: 'fetch', origin: 'https://evil.example' }])
  })

  it('passes a same-origin redirect', async () => {
    const { win } = makeWindow()
    win.fetch = async () => ({ ok: true, redirected: true, url: 'https://app.example/lookmaxxing/' })
    installNetGuard({ target: win })
    await expect(win.fetch('/lookmaxxing')).resolves.toMatchObject({ ok: true })
  })

  it('resolves relative URLs against document.baseURI, but trusts only location for "self"', async () => {
    const { win, reached } = makeWindow(PROD, { document: { baseURI: 'https://evil.example/' } })
    installNetGuard({ target: win })
    await expect(win.fetch('assets/x.js')).rejects.toThrow('https://evil.example')
    expect(reached.fetch).toHaveLength(0)
    await win.fetch('https://app.example/lookmaxxing/ok.js')
    expect(reached.fetch).toHaveLength(1)
  })

  it('blocks everything when the target has no location (deny by default)', async () => {
    const { win, reached } = makeWindow()
    const bare = { fetch: win.fetch }
    installNetGuard({ target: bare })
    await expect(bare.fetch('/x')).rejects.toThrow(/Blocked/)
    await expect(bare.fetch('https://app.example/x')).rejects.toThrow(/Blocked/)
    expect(reached.fetch).toHaveLength(0)
    await expect(bare.fetch('data:text/plain,a')).resolves.toBeDefined()
  })
})

describe('installNetGuard – XMLHttpRequest', () => {
  it('forwards same-origin open() with this and arguments intact', () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    const xhr = new win.XMLHttpRequest()
    xhr.open('GET', '/lookmaxxing/data.json', true)
    expect(reached.xhr).toEqual([[xhr, 'GET', '/lookmaxxing/data.json', true]])
  })

  it.each(['https://evil.example/x', '//evil.example/x', 'http://app.example/x', 'https://good.example@evil.example/'])(
    'throws on %j before anything is sent',
    (url) => {
      const { win, reached } = makeWindow()
      installNetGuard({ target: win })
      const xhr = new win.XMLHttpRequest()
      expect(() => xhr.open('POST', url)).toThrow(/^Blocked by privacy guard: /)
      expect(reached.xhr).toHaveLength(0)
      expect(getNetGuardStats(win).recent).toMatchObject([{ kind: 'xhr' }])
    },
  )

  it('takes URL objects', () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    const xhr = new win.XMLHttpRequest()
    xhr.open('GET', new URL('https://app.example/a'))
    expect(() => xhr.open('GET', new URL('https://evil.example/a'))).toThrow(TypeError)
    expect(reached.xhr).toHaveLength(1)
  })
})

describe('installNetGuard – WebSocket', () => {
  it('throws on a cross-origin socket', () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    expect(() => new win.WebSocket('wss://evil.example/live')).toThrow(/^Blocked by privacy guard: wss:\/\/evil\.example/)
    expect(reached.ws).toHaveLength(0)
    expect(getNetGuardStats(win).recent).toMatchObject([{ kind: 'websocket', origin: 'wss://evil.example' }])
  })

  it('refuses even same-origin sockets by default', () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    expect(() => new win.WebSocket('wss://app.example/lookmaxxing/')).toThrow(TypeError)
    expect(reached.ws).toHaveLength(0)
  })

  it('allows same-origin sockets only with allowSameOriginWebSocket', () => {
    const { win, reached } = makeWindow(DEV)
    installNetGuard({ target: win, allowSameOriginWebSocket: true })
    new win.WebSocket('ws://localhost:5173/lookmaxxing/?token=abc', 'vite-hmr')
    expect(reached.ws).toEqual([['ws://localhost:5173/lookmaxxing/?token=abc', 'vite-hmr']])
    expect(() => new win.WebSocket('ws://localhost:24678/')).toThrow(TypeError)
    expect(() => new win.WebSocket('ws://evil.example/')).toThrow(TypeError)
    expect(() => new win.WebSocket('wss://localhost:5173/')).toThrow(TypeError)
    expect(reached.ws).toHaveLength(1)
  })

  it('stays a drop-in constructor: statics, instanceof, subclassing', () => {
    const { win, FakeWebSocket } = makeWindow(DEV)
    installNetGuard({ target: win, allowSameOriginWebSocket: true })
    expect(win.WebSocket.OPEN).toBe(1)
    expect(new win.WebSocket('ws://localhost:5173/') instanceof FakeWebSocket).toBe(true)
    expect(new win.WebSocket('ws://localhost:5173/') instanceof win.WebSocket).toBe(true)
    class Sub extends win.WebSocket {}
    expect(new Sub('ws://localhost:5173/') instanceof Sub).toBe(true)
    expect(() => new Sub('ws://evil.example/')).toThrow(TypeError)
  })
})

describe('installNetGuard – EventSource', () => {
  it('throws on cross-origin, passes same-origin', () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    new win.EventSource('/lookmaxxing/stream')
    expect(reached.es).toHaveLength(1)
    expect(() => new win.EventSource('https://evil.example/stream')).toThrow(/^Blocked by privacy guard: /)
    expect(() => new win.EventSource('//evil.example/stream')).toThrow(TypeError)
    expect(reached.es).toHaveLength(1)
    expect(getNetGuardStats(win).recent.map((r) => r.kind)).toEqual(['eventsource', 'eventsource'])
  })
})

describe('installNetGuard – sendBeacon', () => {
  it('returns false for cross-origin and records it', () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    expect(win.navigator.sendBeacon('https://evil.example/collect', 'payload')).toBe(false)
    expect(win.navigator.sendBeacon('//evil.example/collect')).toBe(false)
    expect(reached.beacon).toHaveLength(0)
    expect(getNetGuardStats(win).recent).toMatchObject([
      { kind: 'beacon', origin: 'https://evil.example' },
      { kind: 'beacon', origin: 'https://evil.example' },
    ])
  })

  it('forwards same-origin beacons and returns the native result', () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    expect(win.navigator.sendBeacon('/lookmaxxing/ping', 'x')).toBe(true)
    expect(reached.beacon).toEqual([['/lookmaxxing/ping', 'x']])
  })

  it('keeps working when detached from navigator', () => {
    const { win } = makeWindow()
    const nav = win.navigator
    const receivers: unknown[] = []
    nav.sendBeacon = function (this: unknown) {
      receivers.push(this)
      return true
    }
    installNetGuard({ target: win })
    const detached = nav.sendBeacon
    detached('/x')
    expect(receivers).toHaveLength(1)
    expect(receivers[0]).toBe(nav)
  })
})

describe('installNetGuard – lifecycle', () => {
  it('is idempotent: no double wrapping, no double counting', async () => {
    const { win, reached } = makeWindow()
    installNetGuard({ target: win })
    const wrapped = {
      fetch: win.fetch,
      ws: win.WebSocket,
      es: win.EventSource,
      open: win.XMLHttpRequest.prototype.open,
      beacon: win.navigator.sendBeacon,
    }
    installNetGuard({ target: win })
    installNetGuard({ target: win, allowSameOriginWebSocket: true })
    expect(win.fetch).toBe(wrapped.fetch)
    expect(win.WebSocket).toBe(wrapped.ws)
    expect(win.EventSource).toBe(wrapped.es)
    expect(win.XMLHttpRequest.prototype.open).toBe(wrapped.open)
    expect(win.navigator.sendBeacon).toBe(wrapped.beacon)

    await win.fetch('/ok')
    expect(reached.fetch).toHaveLength(1)
    await expect(win.fetch('https://evil.example/x')).rejects.toThrow()
    expect(getNetGuardStats(win).blockedCount).toBe(1)
    // The first install's options win: same-origin sockets are still refused.
    expect(() => new win.WebSocket('wss://app.example/')).toThrow(TypeError)
  })

  it('keeps separate stats per target', async () => {
    const a = makeWindow()
    const b = makeWindow()
    installNetGuard({ target: a.win })
    installNetGuard({ target: b.win })
    await expect(a.win.fetch('https://evil.example/x')).rejects.toThrow()
    expect(getNetGuardStats(a.win).blockedCount).toBe(1)
    expect(getNetGuardStats(b.win).blockedCount).toBe(0)
  })

  it('reports installed: false before install (and for the untouched global)', () => {
    const { win } = makeWindow()
    expect(getNetGuardStats(win)).toEqual({ installed: false, blockedCount: 0, recent: [], cspBlocked: [] })
    expect(getNetGuardStats().installed).toBe(false)
    installNetGuard({ target: win })
    expect(getNetGuardStats(win)).toEqual({ installed: true, blockedCount: 0, recent: [], cspBlocked: [] })
  })

  it('does not wrap what the target does not have', () => {
    const target = { location: { href: PROD } }
    expect(() => installNetGuard({ target })).not.toThrow()
    expect(Object.keys(target)).toEqual(['location'])
    expect(getNetGuardStats(target).installed).toBe(true)
  })
})

describe('installNetGuard – recording', () => {
  it('keeps at most 50 recent blocks, newest last, while counting all', async () => {
    const { win } = makeWindow()
    installNetGuard({ target: win, now: counter() })
    for (let i = 1; i <= 60; i++) {
      await expect(win.fetch(`https://evil${i}.example/x`)).rejects.toThrow()
    }
    const stats = getNetGuardStats(win)
    expect(MAX_RECENT_BLOCKS).toBe(50)
    expect(stats.blockedCount).toBe(60)
    expect(stats.recent).toHaveLength(50)
    expect(stats.recent[0]).toEqual({ kind: 'fetch', origin: 'https://evil11.example', ts: 11 })
    expect(stats.recent[49]).toEqual({ kind: 'fetch', origin: 'https://evil60.example', ts: 60 })
    expect(stats.recent.map((r) => r.ts)).toEqual(Array.from({ length: 50 }, (_, i) => i + 11))
  })

  it('stores the origin only – never path, query, fragment or credentials', async () => {
    const { win, events } = makeWindow()
    installNetGuard({ target: win })
    const secret = 'https://user:hunter2@evil.example:8443/private/path?token=SECRET#frag'
    await expect(win.fetch(secret)).rejects.toThrow('Blocked by privacy guard: https://evil.example:8443')
    const xhr = new win.XMLHttpRequest()
    expect(() => xhr.open('GET', secret)).toThrow()
    expect(win.navigator.sendBeacon(secret)).toBe(false)
    expect(() => new win.EventSource(secret)).toThrow()
    expect(() => new win.WebSocket(secret)).toThrow()

    const stats = getNetGuardStats(win)
    expect(stats.recent).toHaveLength(5)
    for (const entry of stats.recent) expect(entry.origin).toBe('https://evil.example:8443')
    const dump = JSON.stringify([stats, events.map((e) => e.detail)])
    for (const leak of ['hunter2', 'user', 'private', 'path', 'SECRET', 'token', 'frag']) {
      expect(dump).not.toContain(leak)
    }
  })

  it('labels an unparseable URL without echoing it', async () => {
    const { win } = makeWindow()
    installNetGuard({ target: win })
    await expect(win.fetch('http://')).rejects.toThrow('Blocked by privacy guard: invalid-url')
    expect(getNetGuardStats(win).recent).toMatchObject([{ origin: 'invalid-url' }])
  })

  it('returns a copy of the buffer', async () => {
    const { win } = makeWindow()
    installNetGuard({ target: win })
    await expect(win.fetch('https://evil.example/x')).rejects.toThrow()
    const stats = getNetGuardStats(win)
    stats.recent.length = 0
    stats.recent.push({ kind: 'xhr', origin: 'forged', ts: 0 })
    expect(getNetGuardStats(win).recent).toMatchObject([{ kind: 'fetch', origin: 'https://evil.example' }])
  })

  it('dispatches a lmx:net-blocked CustomEvent with kind, origin and ts', async () => {
    const { win, events } = makeWindow()
    installNetGuard({ target: win, now: counter() })
    await expect(win.fetch('https://evil.example/x?q=1')).rejects.toThrow()
    win.navigator.sendBeacon('http://app.example/x')
    expect(NET_BLOCKED_EVENT).toBe('lmx:net-blocked')
    expect(events.map((e) => e.type)).toEqual(['lmx:net-blocked', 'lmx:net-blocked'])
    expect(events.map((e) => e.detail)).toEqual([
      { kind: 'fetch', origin: 'https://evil.example', ts: 1 },
      { kind: 'beacon', origin: 'http://app.example', ts: 2 },
    ])
  })

  it('still refuses when the event dispatch itself throws', async () => {
    const { win } = makeWindow(PROD, {
      dispatchEvent: () => {
        throw new Error('listener exploded')
      },
    })
    installNetGuard({ target: win })
    await expect(win.fetch('https://evil.example/x')).rejects.toThrow('Blocked by privacy guard')
    expect(win.navigator.sendBeacon('https://evil.example/x')).toBe(false)
    expect(getNetGuardStats(win).blockedCount).toBe(2)
  })

  it('delivers a real DOM-style event to listeners on a real EventTarget', async () => {
    const { win } = makeWindow()
    const bus = new EventTarget()
    const received: NetBlockRecord[] = []
    bus.addEventListener(NET_BLOCKED_EVENT, (e) => received.push((e as CustomEvent<NetBlockRecord>).detail))
    const target = { ...win, dispatchEvent: (e: Event) => bus.dispatchEvent(e) }
    installNetGuard({ target, now: () => 42 })
    await expect(target.fetch('https://evil.example/a')).rejects.toThrow()
    expect(received).toEqual([{ kind: 'fetch', origin: 'https://evil.example', ts: 42 }])
  })
})

describe('installNetGuard – WebRTC, WebTransport, fetchLater, CSP tally', () => {
  function makeExtra() {
    const listeners: ((e: unknown) => void)[] = []
    const later: unknown[][] = []
    class FakePC {}
    class FakeWT {}
    const extra = {
      RTCPeerConnection: FakePC,
      webkitRTCPeerConnection: FakePC,
      WebTransport: FakeWT,
      fetchLater: (...args: unknown[]) => later.push(args),
      addEventListener: (_type: string, fn: (e: unknown) => void) => listeners.push(fn),
    }
    return { extra, listeners, later }
  }

  it('refuses RTCPeerConnection, webkitRTCPeerConnection and WebTransport', () => {
    const { extra } = makeExtra()
    const made = makeWindow(PROD, extra)
    const win = made.win as Record<string, unknown> & typeof made.win
    installNetGuard({ target: win, now: counter() })
    expect(() => new (win.RTCPeerConnection as new () => unknown)()).toThrow(TypeError)
    expect(() => new (win.webkitRTCPeerConnection as new () => unknown)()).toThrow(TypeError)
    expect(() => new (win.WebTransport as new (u: string) => unknown)('/wt')).toThrow(TypeError)
    expect(getNetGuardStats(win).recent.map((r) => r.kind)).toEqual(['webrtc', 'webrtc', 'webtransport'])
  })

  it('judges fetchLater like fetch', () => {
    const { extra, later } = makeExtra()
    const made = makeWindow(PROD, extra)
    const win = made.win as Record<string, unknown> & typeof made.win
    installNetGuard({ target: win })
    const call = win.fetchLater as (u: string) => unknown
    expect(() => call('https://evil.example/x?q=1')).toThrow(/Blocked by privacy guard: https:\/\/evil\.example/)
    call('/lookmaxxing/ok')
    expect(later).toHaveLength(1)
    expect(getNetGuardStats(win).recent).toMatchObject([{ kind: 'fetchlater', origin: 'https://evil.example' }])
  })

  it('tallies CSP violations by origin only', () => {
    const { extra, listeners } = makeExtra()
    const { win } = makeWindow(PROD, extra)
    installNetGuard({ target: win })
    listeners[0]!({ blockedURI: 'https://evil.example/secret?token=1' })
    listeners[0]!({ blockedURI: 'https://evil.example/other' })
    listeners[0]!({ blockedURI: 'inline' })
    expect(getNetGuardStats(win).cspBlocked).toEqual([
      { origin: 'https://evil.example', count: 2 },
      { origin: 'inline', count: 1 },
    ])
    expect(getNetGuardStats(win).blockedCount).toBe(0)
  })
})
