import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CSP } from '../../config/csp'

const SCRIPT = join(process.cwd(), 'scripts', 'check-dist-privacy.mjs')
const dirs: string[] = []

const indexHtml = (csp = CSP) => `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="referrer" content="no-referrer" />
<meta name="robots" content="noindex, nofollow, noarchive" />
<script type="module" src="/assets/app.js"></script>
</head><body></body></html>`

const sw = (url = 'assets/app.js') =>
  `precacheAndRoute([{url:"index.html",revision:"a"},{url:"${url}",revision:null}])`

function makeDist(overrides: Record<string, string | Buffer> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'lmx-dist-'))
  dirs.push(dir)
  const files: Record<string, string | Buffer> = {
    'index.html': indexHtml(),
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'sw.js': sw(),
    'assets/app.js': 'console.log("hi")',
    ...overrides,
  }
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

const run = (dist: string) => {
  const r = spawnSync(process.execPath, [SCRIPT, dist], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('check-dist-privacy', () => {
  it('passes a good dist', () => {
    expect(run(makeDist()).code).toBe(0)
  })

  it('allows an inert allow-listed namespace', () => {
    const d = makeDist({ 'assets/app.js': 'x="http://www.w3.org/2000/svg"' })
    expect(run(d).code).toBe(0)
  })

  it('rejects a w3.org URL outside the allowed paths', () => {
    const r = run(makeDist({ 'assets/app.js': 'fetch("https://www.w3.org/evil")' }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('www.w3.org')
  })

  it('rejects a CDN script URL and names the file and host', () => {
    const r = run(makeDist({ 'assets/app.js': 'import("https://cdn.example.com/x.js")' }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('dist/assets/app.js')
    expect(r.out).toContain('cdn.example.com')
  })

  it('rejects a protocol-relative URL in html', () => {
    const html = indexHtml().replace('</head>', '<link rel="stylesheet" href="//evil.com/x.css"></head>')
    const r = run(makeDist({ 'index.html': html }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('evil.com')
  })

  it('rejects a missing CSP meta', () => {
    const html = indexHtml().replace(/<meta http-equiv[^>]*>/, '')
    const r = run(makeDist({ 'index.html': html }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('Content-Security-Policy')
  })

  it('rejects an altered CSP', () => {
    const r = run(makeDist({ 'index.html': indexHtml(CSP.replace("connect-src 'self'", "connect-src 'self' https://a.test")) }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('CSP differs')
  })

  it('rejects a CSP meta placed after a script tag', () => {
    const html = indexHtml()
    const meta = /<meta http-equiv[^>]*>/.exec(html)![0]
    const moved = html.replace(meta, '').replace('</head>', `${meta}</head>`)
    expect(run(makeDist({ 'index.html': moved })).code).toBe(1)
  })

  it('rejects an external url in the sw.js precache list', () => {
    const r = run(makeDist({ 'sw.js': sw('https://evil.com/a.js') }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('sw.js')
  })

  it('rejects a protocol-relative precache entry', () => {
    expect(run(makeDist({ 'sw.js': sw('//evil.com/a.js') })).code).toBe(1)
  })

  it('fails when the precacheAndRoute list cannot be found', () => {
    const r = run(makeDist({ 'sw.js': 'self.skipWaiting()' }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('precacheAndRoute')
  })

  it('rejects a URL hidden inside a binary (wasm) file', () => {
    const bin = Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.from('https://tracker.example.org/p')])
    const r = run(makeDist({ 'assets/m.wasm': bin }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('tracker.example.org')
  })
})
