/**
 * Static privacy lint over the shipped source. It stands in for the Permissions-Policy header that
 * GitHub Pages cannot send, and for review of everything the CSP does not cover.
 *
 * TypeScript is parsed (not grepped) so comments never trigger a rule and type-only mentions of
 * e.g. `WebSocket` are not usage. HTML is checked on comment-stripped text.
 *
 * A deliberate exception takes a marker on the same or the previous line:
 *   // privacy-lint-allow: <reason>      (or  <!-- privacy-lint-allow: <reason> -->)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// ───────────────────────────── policy ─────────────────────────────

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Loopback never leaves the device. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** XML namespace identifiers, not addresses anything ever fetches. */
const W3_NAMESPACES = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/2000/xmlns',
  'http://www.w3.org/XML/1998/namespace',
])

/** These APIs are exactly what src/privacy/netGuard.ts wraps; only that folder may touch them. */
const NETWORK_API_DIR = 'src/privacy/'
const NETWORK_APIS = new Set([
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  // WebRTC is not covered by connect-src, so it is a way around the CSP.
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
])

/** Microphone capture (voice, v3) may only live here. */
const AUDIO_DIR = 'src/presence/'

const LOCATION_APIS = new Set(['geolocation', 'getcurrentposition', 'watchposition'])
const GET_USER_MEDIA = new Set(['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia'])

/**
 * Vendor names are matched in the specific forms they appear in (package scopes, hosts, globals),
 * because several are ordinary words this app uses legitimately: "plausible range", hair
 * "segment"ation, audio "amplitude".
 */
const ANALYTICS: readonly (readonly [string, RegExp])[] = [
  ['gtag', /(?<![a-z0-9])gtag(?![a-z0-9])/gi],
  ['google-analytics', /google-?analytics/gi],
  ['googletagmanager', /googletagmanager/gi],
  ['sentry', /(?<![a-z0-9])sentry(?![a-z0-9])/gi],
  ['mixpanel', /mixpanel/gi],
  ['segment', /@segment\/|segment\.(?:com|io)|segmentio|analytics-next|analytics\.js/gi],
  ['amplitude', /@amplitude\/|amplitude-js|amplitude\.com|(?<![a-z0-9])amplitude\.(?:init|getInstance|track|logEvent)/gi],
  ['hotjar', /hotjar/gi],
  ['clarity.ms', /clarity\.ms/gi],
  ['plausible', /plausible\.io|@plausible|plausible-tracker|plausible\.js/gi],
  ['posthog', /posthog/gi],
  ['datadog', /datadog|dd-trace|dd-rum/gi],
  ['other telemetry', /logrocket|fullstory|bugsnag|(?<![a-z0-9])rollbar(?![a-z0-9])|newrelic|matomo|piwik|applicationinsights|crashlytics|statcounter|heapanalytics/gi],
]

/** Elements whose URL attribute makes the browser load something. */
const RESOURCE_ATTRS: Readonly<Record<string, string>> = {
  script: 'src',
  link: 'href',
  img: 'src',
  iframe: 'src',
  source: 'src',
  video: 'src',
  audio: 'src',
  track: 'src',
  embed: 'src',
  input: 'src',
  object: 'data',
}

const URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s'"`<>\\^|{}()]*/gi
const MARKER_RE = /(?:\/\/|\/\*|<!--)\s*privacy-lint-allow:(.*)/

// ───────────────────────────── engine ─────────────────────────────

type Rule =
  | 'external-url'
  | 'external-resource'
  | 'geolocation'
  | 'getusermedia-audio'
  | 'network-api'
  | 'analytics'
  | 'allow-marker'

interface Hit {
  file: string
  line: number
  rule: Rule
  detail: string
}

type Emit = (pos: number, rule: Rule, detail: string) => void

const format = (hit: Hit): string => `${hit.file}:${hit.line}  [${hit.rule}] ${hit.detail}`

/** true = this URL is not allowed in source. */
function isForbiddenUrl(match: string): boolean {
  const candidate = match.replace(/[.,;!?]+$/, '')
  try {
    const url = new URL(candidate)
    const namespace = `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
    return !LOCAL_HOSTS.has(url.hostname) && !W3_NAMESPACES.has(namespace)
  } catch {
    // e.g. "http://localhost:${port}" in a template: judge by the literal host part.
    const host = /^[a-z]+:\/\/([^/?#:]*)/i.exec(candidate)?.[1] ?? ''
    return !LOCAL_HOSTS.has(host.toLowerCase())
  }
}

function isExternalRef(value: string): boolean {
  const v = value.trim()
  const candidate = v.startsWith('//') ? `https:${v}` : /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : null
  if (candidate === null || /^(?:data|blob):/i.test(candidate)) return false
  try {
    return !LOCAL_HOSTS.has(new URL(candidate).hostname)
  } catch {
    return true
  }
}

/** URL and vendor-name rules over text that is known not to be a comment. */
function scanText(raw: string, start: number, emit: Emit): void {
  for (const m of raw.matchAll(URL_RE)) {
    if (isForbiddenUrl(m[0])) emit(start + m.index, 'external-url', m[0])
  }
  for (const [name, re] of ANALYTICS) {
    for (const m of raw.matchAll(re)) emit(start + m.index, 'analytics', `${name} ("${m[0]}")`)
  }
}

function isTypeOnlyUse(id: ts.Identifier): boolean {
  const parent = id.parent
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) return true
  if (ts.isImportSpecifier(parent)) return parent.isTypeOnly || parent.parent.parent.isTypeOnly
  if (ts.isExpressionWithTypeArguments(parent)) {
    const clause = parent.parent
    // `implements WebSocket` only describes a shape; `extends WebSocket` opens sockets.
    return ts.isHeritageClause(clause) && (clause.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(clause.parent))
  }
  return false
}

function lintTypeScript(file: string, text: string): Hit[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, kind)
  const hits: Hit[] = []
  const emit: Emit = (pos, rule, detail) =>
    hits.push({ file, line: sf.getLineAndCharacterOfPosition(pos).line + 1, rule, detail })

  const networkAllowed = file.startsWith(NETWORK_API_DIR)
  let usesGetUserMedia = false
  const audioProps: number[] = []

  const checkName = (name: string, pos: number, via: 'identifier' | 'string'): void => {
    if (!networkAllowed && NETWORK_APIS.has(name)) emit(pos, 'network-api', `${name} (${via}) – use fetch, which netGuard polices`)
    if (LOCATION_APIS.has(name.toLowerCase())) emit(pos, 'geolocation', `${name} (${via})`)
    if (GET_USER_MEDIA.has(name)) usesGetUserMedia = true
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (!isTypeOnlyUse(node)) checkName(node.text, node.getStart(sf), 'identifier')
      scanText(node.text, node.getStart(sf), emit)
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sf)
      checkName(node.text.trim(), start, 'string')
      scanText(text.slice(start, node.end), start, emit)
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const start = node.getStart(sf)
      scanText(text.slice(start, node.end), start, emit)
    } else if (ts.isJsxText(node)) {
      scanText(text.slice(node.pos, node.end), node.pos, emit)
    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const name = node.name
      const isAudio = (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'audio'
      const isFalse = ts.isPropertyAssignment(node) && node.initializer.kind === ts.SyntaxKind.FalseKeyword
      if (isAudio && !isFalse) audioProps.push(name.getStart(sf))
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const element = node.parent.parent
      const tag = (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(sf) : '').toLowerCase()
      if (RESOURCE_ATTRS[tag] === node.name.getText(sf) && isExternalRef(node.initializer.text)) {
        emit(node.initializer.getStart(sf), 'external-resource', `<${tag} ${node.name.getText(sf)}="${node.initializer.text}">`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (usesGetUserMedia && !file.startsWith(AUDIO_DIR)) {
    for (const pos of audioProps) emit(pos, 'getusermedia-audio', `getUserMedia with audio is only allowed under ${AUDIO_DIR}`)
  }
  return hits
}

function lintHtml(file: string, text: string): Hit[] {
  // Blank out comments but keep every newline so line numbers stay right.
  const stripped = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
  const hits: Hit[] = []
  const emit: Emit = (pos, rule, detail) =>
    hits.push({ file, line: stripped.slice(0, pos).split('\n').length, rule, detail })

  scanText(stripped, 0, emit)
  for (const m of stripped.matchAll(/geolocation/gi)) emit(m.index, 'geolocation', m[0])

  for (const tag of stripped.matchAll(/<(script|link|img|iframe|source|video|audio|track|embed|object|input)\b([^>]*)>/gi)) {
    const name = (tag[1] ?? '').toLowerCase()
    const attrsStart = tag.index + 1 + (tag[1] ?? '').length
    for (const attr of (tag[2] ?? '').matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      const value = attr[2] ?? attr[3] ?? attr[4] ?? ''
      if (attr[1]?.toLowerCase() === RESOURCE_ATTRS[name] && isExternalRef(value)) {
        emit(attrsStart + attr.index, 'external-resource', `<${name} ${attr[1]}="${value}">`)
      }
    }
  }
  return hits
}

/** Hits on a marked line (or the line after it) are waived – if the marker says why. */
function applyMarkers(file: string, text: string, hits: Hit[]): Hit[] {
  const waived = new Set<number>()
  const bad: Hit[] = []
  text.split('\n').forEach((lineText, i) => {
    const marker = MARKER_RE.exec(lineText)
    if (!marker) return
    const reason = (marker[1] ?? '').replace(/\*\/|-->/g, '').trim()
    if (reason.length < 3) {
      bad.push({ file, line: i + 1, rule: 'allow-marker', detail: 'privacy-lint-allow needs a reason' })
      return
    }
    waived.add(i + 1)
    waived.add(i + 2)
  })
  return [...hits.filter((hit) => !waived.has(hit.line)), ...bad]
}

function lintFile(file: string, text: string): Hit[] {
  const raw = /\.html?$/.test(file) ? lintHtml(file, text) : lintTypeScript(file, text)
  return applyMarkers(file, text, raw).sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
}

// ───────────────────────────── self-test ─────────────────────────────

/** "line:rule" per hit – compact to assert on. */
const lint = (file: string, ...lines: string[]): string[] => lintFile(file, lines.join('\n')).map((h) => `${h.line}:${h.rule}`)

describe('lint rules: external URLs', () => {
  it('flags URLs in strings, templates and JSX with file:line', () => {
    const hits = lintFile('src/a.ts', ['const a = 1', "fetch('https://api.example.com/v1')"].join('\n'))
    expect(hits).toHaveLength(1)
    expect(format(hits[0]!)).toMatch(/^src\/a\.ts:2 {2}\[external-url\] https:\/\/api\.example\.com\/v1$/)

    expect(lint('src/a.ts', 'const u = `https://api.example.com/${id}`')).toEqual(['1:external-url'])
    expect(lint('src/a.tsx', 'const x = <a href="http://example.com/x">see http://example.org/y</a>')).toEqual([
      '1:external-url',
      '1:external-url',
    ])
    expect(lint('src/a.ts', 'new Worker("wss://x.example/ws")', "const b = 'ftp://x.example/f'")).toEqual(['1:external-url', '2:external-url'])
  })

  it('reports the line of a URL inside a multi-line template', () => {
    expect(lint('src/a.ts', 'const q = `', 'a', 'b https://x.example/z', '`')).toEqual(['3:external-url'])
  })

  it('ignores URLs in comments of every kind', () => {
    expect(
      lint(
        'src/a.tsx',
        '// see https://doi.org/10.1/x',
        '/* https://a.example */',
        '/**',
        ' * @see https://b.example/doc',
        ' */',
        'const x = <p>{/* https://c.example */}ok</p> // https://d.example',
      ),
    ).toEqual([])
  })

  it('does not mistake a regex literal for a URL', () => {
    expect(lint('src/a.ts', 'const re = /https?:\\/\\/[^/]+/')).toEqual([])
  })

  it('allows loopback hosts and the w3.org XML namespaces', () => {
    expect(
      lint(
        'src/a.tsx',
        'const a = <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" />',
        "const b = ['http://localhost:5173/x', 'http://127.0.0.1:4173', 'ws://localhost:5173', 'http://[::1]:3000/']",
        'const c = `http://localhost:${port}/hmr`',
      ),
    ).toEqual([])
  })

  it('rejects look-alikes of the allowed hosts and other w3.org pages', () => {
    expect(
      lint(
        'src/a.ts',
        "const a = 'https://www.w3.org/TR/WCAG21/'",
        "const b = 'http://www.w3.org.evil.example/2000/svg'",
        "const c = 'http://localhost.evil.example/'",
        "const d = 'http://localhost@evil.example/'",
        'const e = `https://${host}/x`',
      ),
    ).toEqual(['1:external-url', '2:external-url', '3:external-url', '4:external-url', '5:external-url'])
  })

  it('honours a privacy-lint-allow marker with a reason, on the same or previous line', () => {
    expect(lint('src/a.ts', "const a = 'https://doi.org/10.1/x' // privacy-lint-allow: citation link, never fetched")).toEqual([])
    expect(lint('src/a.ts', '// privacy-lint-allow: citation link, never fetched', "const a = 'https://doi.org/10.1/x'")).toEqual([])
    expect(lint('src/a.ts', '// privacy-lint-allow: citation link', 'const ok = 1', "const a = 'https://doi.org/10.1/x'")).toEqual([
      '3:external-url',
    ])
  })

  it('rejects a marker without a reason', () => {
    expect(lint('src/a.ts', "const a = 'https://doi.org/x' // privacy-lint-allow:")).toEqual(['1:allow-marker', '1:external-url'])
  })
})

describe('lint rules: location and microphone', () => {
  it('flags geolocation however it is reached', () => {
    expect(lint('src/a.ts', 'navigator.geolocation.getCurrentPosition(cb)')).toEqual(['1:geolocation', '1:geolocation'])
    expect(lint('src/a.ts', "navigator['geolocation']")).toEqual(['1:geolocation'])
    expect(lint('src/a.ts', "navigator.permissions.query({ name: 'geolocation' })")).toEqual(['1:geolocation'])
    expect(lint('src/a.ts', 'const id = geo.watchPosition(cb)')).toEqual(['1:geolocation'])
  })

  it('does not trip on prose or comments', () => {
    expect(lint('src/a.ts', "const copy = 'This app never uses geolocation or GPS.'", '// no geolocation here')).toEqual([])
  })

  it('flags getUserMedia with audio unless it is explicitly false', () => {
    expect(lint('src/a.ts', 'navigator.mediaDevices.getUserMedia({ video: true, audio: true })')).toEqual(['1:getusermedia-audio'])
    expect(lint('src/a.ts', "mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true } })")).toEqual(['1:getusermedia-audio'])
    expect(lint('src/a.ts', 'const audio = true', 'navigator.mediaDevices.getUserMedia({ video, audio })')).toEqual(['2:getusermedia-audio'])
    expect(
      lint('src/a.ts', 'const constraints = { video: true, audio: wantMic }', 'navigator.mediaDevices.getUserMedia(constraints)'),
    ).toEqual(['1:getusermedia-audio'])
  })

  it('allows video-only capture', () => {
    expect(lint('src/a.ts', 'navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })')).toEqual([])
    expect(lint('src/a.ts', 'navigator.mediaDevices.getUserMedia({ video: true })')).toEqual([])
  })

  it('allows audio under src/presence/ only', () => {
    const source = 'navigator.mediaDevices.getUserMedia({ audio: true })'
    expect(lint('src/presence/voice.ts', source)).toEqual([])
    expect(lint('src/capture/camera.ts', source)).toEqual(['1:getusermedia-audio'])
    expect(lint('src/presenceish/voice.ts', source)).toEqual(['1:getusermedia-audio'])
  })

  it('leaves an unrelated `audio` setting alone', () => {
    expect(lint('src/a.ts', 'const settings = { audio: true }')).toEqual([])
  })
})

describe('lint rules: network APIs belong to src/privacy/', () => {
  it.each([
    'const x = new XMLHttpRequest()',
    "const x = new WebSocket('/live')",
    "const x = new EventSource('/live')",
    "const x = new window.WebSocket('/live')",
    "navigator.sendBeacon('/log', data)",
    "navigator['sendBeacon']('/log', data)",
    'const pc = new RTCPeerConnection()',
    'class Evil extends WebSocket {}',
    "import { WebSocket } from 'ws'",
  ])('flags %s', (source) => {
    expect(lint('src/a.ts', source)).toEqual(['1:network-api'])
  })

  it('allows them inside src/privacy/', () => {
    expect(lint('src/privacy/netGuard.ts', "const x = new WebSocket('/live')", "navigator.sendBeacon('/x')")).toEqual([])
  })

  it('does not count type-only mentions', () => {
    expect(
      lint(
        'src/a.ts',
        'let socket: WebSocket | null = null',
        'type Ctor = typeof WebSocket',
        'interface Fake extends EventSource {}',
        'class Mock implements WebSocket {}',
        "import type { WebSocket as WS } from 'ws'",
        'const init: EventSourceInit = {}',
        'const mock = new MockWebSocket()',
      ),
    ).toEqual([])
  })

  it('honours the marker, with a reason', () => {
    expect(lint('src/a.ts', "new WebSocket('/hmr') // privacy-lint-allow: Vite HMR client, dev only")).toEqual([])
    expect(lint('src/a.ts', '// privacy-lint-allow: Vite HMR client, dev only', "new WebSocket('/hmr')")).toEqual([])
    expect(lint('src/a.ts', "new WebSocket('/hmr') // privacy-lint-allow:   ")).toEqual(['1:allow-marker', '1:network-api'])
  })
})

describe('lint rules: analytics and telemetry', () => {
  it.each([
    "import * as Sentry from '@sentry/browser'",
    "gtag('config', 'G-123')",
    "const s = 'https://www.googletagmanager.com/gtm.js'",
    "import posthog from 'posthog-js'",
    "import { datadogRum } from '@datadog/browser-rum'",
    "import * as amplitude from '@amplitude/analytics-browser'",
    "const src = 'https://plausible.io/js/script.js'",
    "const src = 'https://www.clarity.ms/tag/abc'",
    "import { AnalyticsBrowser } from '@segment/analytics-next'",
    "import mixpanel from 'mixpanel-browser'",
    "const h = 'static.hotjar.com'",
    "const ga = 'google-analytics'",
    "import Bugsnag from '@bugsnag/js'",
    'window.dataLayer.push(1); const gtag = 1',
  ])('flags %s', (source) => {
    expect(lint('src/a.ts', source).every((hit) => /:(analytics|external-url)$/.test(hit))).toBe(true)
    expect(lint('src/a.ts', source)).toContain('1:analytics')
  })

  it('does not flag ordinary words the app legitimately uses', () => {
    expect(
      lint(
        'src/a.ts',
        "const note = 'plausible range for adult men'",
        'const segmentHair = () => 1',
        "import { ImageSegmenter } from '@mediapipe/tasks-vision'",
        'const amplitude = 0.4',
        "const style = { scrollbarWidth: 'none' }",
        "const clarity = 'photo clarity'",
        '// Sentry, Mixpanel and gtag are forbidden',
      ),
    ).toEqual([])
  })
})

describe('lint rules: HTML', () => {
  it('flags external script and link elements with the right line', () => {
    const hits = lintFile(
      'index.html',
      [
        '<html>',
        '<head>',
        '  <script src="https://cdn.example/lib.js"></script>',
        '  <script src="//cdn.example/lib2.js"></script>',
        '  <link rel="stylesheet"',
        '        href="https://fonts.googleapis.com/css2?family=Inter">',
        '  <link rel="preconnect" href="https://fonts.gstatic.com" />',
        '</head>',
      ].join('\n'),
    )
    expect(hits.filter((h) => h.rule === 'external-resource').map((h) => h.line)).toEqual([3, 4, 6, 7])
    expect(hits.filter((h) => h.rule === 'external-url').map((h) => h.line)).toEqual([3, 6, 7])
    expect(format(hits[0]!)).toMatch(/^index\.html:3 {2}\[/)
  })

  it('allows first-party, placeholder and inline-data references', () => {
    expect(
      lint(
        'index.html',
        '<link rel="icon" href="%BASE_URL%icons/icon-192.png" />',
        '<link rel="manifest" href="/lookmaxxing/manifest.webmanifest">',
        '<script type="module" src="/src/main.tsx"></script>',
        '<img src="data:image/png;base64,AAAA" alt="">',
        '<script src="http://localhost:5173/@vite/client"></script>',
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      ),
    ).toEqual([])
  })

  it('ignores HTML comments but keeps line numbers', () => {
    expect(
      lint(
        'index.html',
        '<!-- <script src="https://cdn.example/x.js"></script>',
        '     still a comment https://b.example -->',
        '<script src="https://cdn.example/y.js"></script>',
      ),
    ).toEqual(['3:external-resource', '3:external-url'])
  })

  it('flags analytics, geolocation permissions and plain external links', () => {
    expect(lint('index.html', '<iframe allow="geolocation" src="/x"></iframe>')).toEqual(['1:geolocation'])
    expect(lint('index.html', '<script>window.gtag = 1</script>')).toEqual(['1:analytics'])
    expect(lint('index.html', '<a href="https://example.com">x</a>')).toEqual(['1:external-url'])
  })

  it('honours the marker in an HTML comment', () => {
    expect(lint('index.html', '<!-- privacy-lint-allow: documentation link, navigation only -->', '<a href="https://example.com">x</a>')).toEqual([])
  })
})

describe('lint rules: JSX resources', () => {
  it('flags external script/link/img attributes, including protocol-relative ones', () => {
    expect(lint('src/a.tsx', 'const a = <script src="//cdn.example/x.js" />')).toEqual(['1:external-resource'])
    expect(lint('src/a.tsx', 'const a = <link rel="stylesheet" href="https://f.example/c.css" />')).toEqual([
      '1:external-resource',
      '1:external-url',
    ])
    expect(lint('src/a.tsx', 'const a = <img src="//t.example/pixel.gif" />')).toEqual(['1:external-resource'])
  })

  it('allows relative and data: sources', () => {
    expect(lint('src/a.tsx', 'const a = <img src="/lookmaxxing/icons/a.png" alt="" /> ', 'const b = <img src="data:image/png;base64,AA" alt="" />')).toEqual([])
  })
})

// ───────────────────────────── the repository ─────────────────────────────

function walk(dir: string): string[] {
  const abs = `${ROOT}${dir}`
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .sort()
    .flatMap((name) => {
      const rel = `${dir}/${name}`
      if (name === 'node_modules') return []
      return statSync(`${ROOT}${rel}`).isDirectory() ? walk(rel) : [rel]
    })
}

function scannedFiles(): string[] {
  const rootFiles = ['index.html', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts']
  return [
    ...rootFiles,
    ...walk('config').filter((f) => f.endsWith('.ts')),
    ...walk('src').filter((f) => /\.tsx?$/.test(f)),
    ...walk('public').filter((f) => /\.html?$/.test(f)),
  ].filter((f) => existsSync(`${ROOT}${f}`))
}

describe('source privacy lint (repository)', () => {
  const files = scannedFiles()

  it('covers the files that matter', () => {
    for (const expected of ['index.html', 'vite.config.ts', 'config/csp.ts', 'src/main.tsx', 'src/types.ts']) {
      expect(files, `${expected} should be scanned`).toContain(expected)
    }
    expect(files.filter((f) => f.startsWith('src/')).length).toBeGreaterThan(5)
  })

  it('finds nothing to object to', () => {
    const lines = files.flatMap((file) => lintFile(file, readFileSync(`${ROOT}${file}`, 'utf8')).map(format))
    expect(lines, `Privacy lint violations:\n${lines.join('\n')}`).toEqual([])
  })

  it('has no analytics or telemetry package in package.json', () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as Record<string, Record<string, string> | undefined>
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]
    const offenders = names.filter((name) => ANALYTICS.some(([, re]) => name.search(new RegExp(re.source, 'i')) !== -1))
    expect(offenders).toEqual([])
  })
})
