#!/usr/bin/env node
/**
 * Post-build privacy check. Run after `npm run build`:
 *
 *   node scripts/check-dist-privacy.mjs [distDir]      (default: ./dist)
 *
 * Fails (exit 1, with file + host) when the built site could talk to anyone but its own origin:
 *   1. dist/index.html must carry the exact CSP from config/csp.ts as a
 *      <meta http-equiv="Content-Security-Policy">, placed before any script/link/img tag
 *      (a meta CSP only governs what comes after it), plus the no-referrer and noindex metas.
 *   2. Every html/js/css/webmanifest/json/svg/txt/map file is scanned for absolute
 *      http(s)/ws(s)/ftp URLs. A host that is not in scripts/dist-url-allowlist.json fails.
 *      Protocol-relative URLs in html/css attributes fail too.
 *   3. dist/sw.js must exist, and its precache list may not point at another origin or
 *      at a file that is not in dist.
 *   4. dist must not ship photos/video/audio outside icons/ (mirrors the repo guard).
 *
 * Precached binaries (.wasm/.task/.tflite) are scanned as latin1 for the same URL patterns.
 *
 * This is a guard against accidents (a dependency that phones home, a stray CDN link),
 * not a defence against someone deliberately hiding a URL behind string concatenation;
 * the runtime defence for that is the CSP itself (connect-src 'self').
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(process.argv[2] ?? join(ROOT, 'dist'))
const ALLOWLIST_FILE = join(ROOT, 'scripts', 'dist-url-allowlist.json')

const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.webmanifest', '.json', '.svg', '.txt', '.xml', '.map'])
const BINARY_EXT = new Set(['.wasm', '.task', '.tflite', '.bin', '.onnx'])
const MEDIA_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|mp4|mov|m4a|wav|mp3)$/i

/** @type {{ file: string, message: string }[]} */
const problems = []
const fail = (file, message) => problems.push({ file, message })
const rel = (p) => 'dist/' + relative(DIST, p).split(sep).join('/')

// --- expected CSP -----------------------------------------------------------------------------
async function loadExpectedCsp() {
  const file = join(ROOT, 'config', 'csp.ts')
  try {
    // Node >= 22.18 strips TypeScript types natively.
    const mod = await import(pathToFileURL(file).href)
    if (typeof mod.CSP === 'string') return mod.CSP
  } catch {
    // fall through to the source-text fallback below
  }
  // Older Node 22.x cannot import .ts. The directives object is plain JS once the type annotation
  // is gone, so evaluate just that literal and join it exactly like config/csp.ts does.
  const src = readFileSync(file, 'utf8')
  const m = /export const CSP_DIRECTIVES[^=]*=\s*(\{[\s\S]*?\n\})/.exec(src)
  if (!m) throw new Error('cannot read CSP_DIRECTIVES from config/csp.ts')
  const directives = new Function(`return (${m[1]})`)()
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

// --- html helpers -----------------------------------------------------------------------------
const decodeEntities = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Blank out comments (keeping indices stable) so a commented-out tag is never mistaken for a real one. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))

function metaTags(html) {
  const tags = []
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = {}
    for (const a of m[1].matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    }
    tags.push({ index: m.index, attrs })
  }
  return tags
}

function checkIndexHtml(expectedCsp) {
  const file = join(DIST, 'index.html')
  if (!existsSync(file)) return fail('dist/index.html', 'missing')
  const raw = readFileSync(file, 'utf8')
  if (raw.includes('<!--LMX_CSP-->')) fail('dist/index.html', 'the <!--LMX_CSP--> placeholder was not replaced by the build')
  const html = stripComments(raw)
  const metas = metaTags(html)

  const csps = metas.filter((t) => (t.attrs['http-equiv'] ?? '').toLowerCase() === 'content-security-policy')
  if (csps.length !== 1) {
    fail('dist/index.html', `expected exactly one Content-Security-Policy <meta>, found ${csps.length}`)
  } else {
    const actual = csps[0].attrs.content ?? ''
    if (actual !== expectedCsp) {
      fail('dist/index.html', `CSP differs from config/csp.ts\n      expected: ${expectedCsp}\n      found:    ${actual}`)
    }
    const firstLoader = /<(script|link|img|iframe|video|audio|source|object|embed)\b/i.exec(html)
    if (firstLoader && firstLoader.index < csps[0].index) {
      fail('dist/index.html', `the CSP <meta> must come before the first <${firstLoader[1]}> tag, or it does not apply to it`)
    }
  }

  const named = (name) => metas.filter((t) => (t.attrs.name ?? '').toLowerCase() === name)
  const referrer = named('referrer')
  if (!referrer.some((t) => t.attrs.content === 'no-referrer')) {
    fail('dist/index.html', 'missing <meta name="referrer" content="no-referrer">')
  }
  const robots = named('robots')
  if (!robots.some((t) => t.attrs.content === 'noindex, nofollow, noarchive')) {
    fail('dist/index.html', 'missing <meta name="robots" content="noindex, nofollow, noarchive">')
  }

  // The CSP has no 'unsafe-inline' for scripts, so an inline script would be blocked and the app would not start.
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\bsrc\s*=/i.test(m[1]) && !/\btype\s*=\s*["']?(?:application\/(?:ld\+)?json|importmap|speculationrules)/i.test(m[1])) {
      fail('dist/index.html', 'inline <script> found; script-src \'self\' would block it')
    }
  }
}

function checkRobotsTxt() {
  const file = join(DIST, 'robots.txt')
  if (!existsSync(file)) return fail('dist/robots.txt', 'missing')
  if (!/^\s*Disallow:\s*\/\s*$/m.test(readFileSync(file, 'utf8'))) fail('dist/robots.txt', 'must contain "Disallow: /"')
}

// --- url scan ---------------------------------------------------------------------------------
function loadAllowlist() {
  const data = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'))
  if (!Array.isArray(data.allow)) throw new Error(`${ALLOWLIST_FILE}: "allow" must be an array`)
  for (const e of data.allow) {
    const ok = typeof e.reason === 'string' && e.reason.length > 0 && (typeof e.host === 'string' || typeof e.literal === 'string')
    if (!ok) throw new Error(`${ALLOWLIST_FILE}: each entry needs a "host" (optionally "paths") or a "literal", and a "reason": ${JSON.stringify(e)}`)
  }
  return data.allow.map((e) => ({ ...e, host: e.host?.toLowerCase(), used: false }))
}

// Also matches JSON-escaped slashes (https:\/\/host) so escaping cannot hide a URL.
const URL_RE = /\b(?:https?|wss?|ftp):(?:\\?\/){2}(?:\\\/|[^\s"'`<>\\)])+/gi
const PROTOCOL_RELATIVE_RE = [
  /\b(?:src|href|action|poster|data|srcset|content)\s*=\s*["']?\s*\/\/[^\s"'>]+/gi, // html attributes
  /url\(\s*["']?\/\/[^\s"')]+/gi, // css url()
  /@import\s+["']\/\/[^\s"';]+/gi, // css @import
]

function scanFile(path, allow, seen, binary = false) {
  // latin1 keeps every byte, so ASCII URLs inside .wasm/.task/.tflite files are still found.
  const text = readFileSync(path, binary ? 'latin1' : 'utf8')
  const name = rel(path)
  const reported = new Set()
  const report = (key, message) => {
    if (reported.has(key)) return
    reported.add(key)
    fail(name, message)
  }

  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/\\\//g, '/').replace(/[;,.]+$/, '')
    const literal = allow.find((e) => e.literal && raw.startsWith(e.literal))
    if (literal) {
      literal.used = true
      continue
    }
    let url
    try {
      url = new URL(raw)
    } catch {
      report(raw, `unparseable URL-like string "${raw.slice(0, 80)}" (not in the allow-list)`)
      continue
    }
    const host = url.hostname.toLowerCase()
    const entry = allow.find(
      (e) => e.host === host && (!e.paths || e.paths.some((p) => url.pathname.startsWith(p))),
    )
    if (entry) {
      entry.used = true
      seen.add(host)
    } else {
      report(host + url.pathname, `disallowed host "${host}" in "${raw.slice(0, 100)}"`)
    }
  }

  if (!binary && (extname(path) === '.html' || extname(path) === '.css')) {
    for (const re of PROTOCOL_RELATIVE_RE) {
      for (const m of text.matchAll(re)) report(m[0], `protocol-relative external URL "${m[0].slice(0, 80)}"`)
    }
  }
}

// --- service worker -----------------------------------------------------------------------------
/** Returns the text of the first balanced [...] after `start`, skipping brackets inside quotes. */
function balancedArray(src, start) {
  let depth = 0
  let quote = ''
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) return src.slice(start, i + 1)
  }
  return null
}

function checkServiceWorker() {
  const file = join(DIST, 'sw.js')
  if (!existsSync(file)) return fail('dist/sw.js', 'missing: the service worker was not generated')
  const src = readFileSync(file, 'utf8')
  const call = /precacheAndRoute\s*\(\s*(?=\[)/.exec(src)
  const list = call ? balancedArray(src, call.index + call[0].length) : null
  if (!list) return fail('dist/sw.js', 'could not find the precacheAndRoute([...]) list, so it cannot be checked')

  const urls = [
    ...new Set(
      [...list.matchAll(/\burl\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)].map((m) =>
        (m[1] ?? m[2]).replace(/\\\//g, '/'),
      ),
    ),
  ]
  if (urls.length === 0) return fail('dist/sw.js', 'precache list has no url entries')

  for (const u of urls) {
    // Anything with a scheme or a leading // is another origin (or at least not a same-origin path).
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(u) || /^[a-z][a-z0-9+.-]*:/i.test(u)) {
      fail('dist/sw.js', `precache entry points outside this origin: "${u}"`)
      continue
    }
    if (u.startsWith('/')) continue // same-origin absolute path; cannot be mapped to a dist file without the base
    const target = resolve(DIST, decodeURIComponent(u.split(/[?#]/)[0]))
    if (!target.startsWith(DIST + sep) || !existsSync(target)) {
      fail('dist/sw.js', `precache entry "${u}" is not a file in dist/ (the service worker install would fail)`)
    }
  }
  return urls.length
}

// --- walk + main --------------------------------------------------------------------------------
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
}

if (!existsSync(DIST)) {
  console.error(`DIST PRIVACY CHECK FAILED: ${DIST} does not exist (run "npm run build" first)`)
  process.exit(1)
}

const expectedCsp = await loadExpectedCsp()
const allow = loadAllowlist()
const files = walk(DIST)
const seenHosts = new Set()
let scanned = 0

checkIndexHtml(expectedCsp)
checkRobotsTxt()
const precached = checkServiceWorker()

for (const f of files) {
  const r = relative(DIST, f).split(sep).join('/')
  if (TEXT_EXT.has(extname(f).toLowerCase())) {
    scanFile(f, allow, seenHosts)
    scanned++
  } else if (BINARY_EXT.has(extname(f).toLowerCase())) {
    scanFile(f, allow, seenHosts, true)
    scanned++
  } else if (MEDIA_EXT.test(f) && !r.startsWith('icons/')) {
    fail(rel(f), 'photo/video/audio file in the build output (only icons/ may ship images)')
  }
}

if (problems.length) {
  console.error('DIST PRIVACY CHECK FAILED:')
  for (const p of problems) console.error(`  - ${p.file}: ${p.message}`)
  process.exit(1)
}

const unused = allow.filter((e) => !e.used).map((e) => e.host ?? e.literal)
console.log(
  `dist privacy ok: CSP matches config/csp.ts, ${scanned} files scanned, ` +
    `${precached ?? 0} precache entries all local, allowed inert hosts seen: ${[...seenHosts].sort().join(', ') || 'none'}`,
)
if (unused.length) console.log(`note: allow-list entries not present in this build: ${unused.join(', ')}`)
