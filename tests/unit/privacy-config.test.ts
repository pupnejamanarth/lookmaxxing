import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CSP, CSP_DIRECTIVES } from '../../config/csp'

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

/** Every source expression the policy may ever contain. A new token must be argued for here. */
const ALLOWED_TOKENS = new Set([
  "'self'",
  "'none'",
  "'wasm-unsafe-eval'",
  "'unsafe-inline'",
  'blob:',
  'data:',
  'mediastream:',
])

const directive = (name: string): readonly string[] => CSP_DIRECTIVES[name] ?? []
const tokens = Object.entries(CSP_DIRECTIVES).flatMap(([name, values]) => values.map((value) => ({ name, value })))

describe('CSP policy (config/csp.ts)', () => {
  it("locks the fallback, connections, plugins and forms down", () => {
    expect(directive('default-src')).toEqual(["'self'"])
    expect(directive('connect-src')).toEqual(["'self'"])
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('form-action')).toEqual(["'none'"])
    expect(directive('base-uri')).toEqual(["'self'"])
  })

  it('never lists a host, a scheme source or a wildcard', () => {
    for (const { name, value } of tokens) {
      expect(ALLOWED_TOKENS.has(value), `${name} contains ${value}`).toBe(true)
    }
    expect(CSP).not.toMatch(/\*/)
    expect(CSP).not.toMatch(/https?:|wss?:|ftp:/i)
    expect(CSP).not.toMatch(/\b[a-z0-9-]+\.[a-z]{2,}\b/i)
    expect(CSP).not.toMatch(/:\/\//)
  })

  it("never allows 'unsafe-eval'", () => {
    expect(tokens.filter(({ value }) => value === "'unsafe-eval'")).toEqual([])
    expect(CSP).not.toMatch(/'unsafe-eval'/)
  })

  it("allows 'wasm-unsafe-eval' in script-src and nowhere else", () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'")
    const elsewhere = tokens.filter(({ name, value }) => value === "'wasm-unsafe-eval'" && name !== 'script-src')
    expect(elsewhere).toEqual([])
  })

  it("keeps scripts first-party only: no inline, no remote", () => {
    expect(directive('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(tokens.filter(({ name, value }) => value === "'unsafe-inline'" && name !== 'style-src')).toEqual([])
  })

  it('has no directive that would reopen a network path', () => {
    for (const name of Object.keys(CSP_DIRECTIVES)) {
      expect(['frame-src', 'child-src', 'prefetch-src', 'report-uri', 'report-to']).not.toContain(name)
    }
  })

  it('serializes every directive exactly once', () => {
    const names = CSP.split(';').map((part) => part.trim().split(/\s+/)[0])
    expect(names).toEqual(Object.keys(CSP_DIRECTIVES))
    expect(new Set(names).size).toBe(names.length)
    expect(CSP).not.toMatch(/[\r\n"]/)
  })
})

describe('CSP delivery', () => {
  const source = readFileSync(root('index.html'), 'utf8')

  it('index.html has exactly one CSP placeholder, before any script', () => {
    const placeholder = '<!--LMX_CSP-->'
    expect(source.split(placeholder)).toHaveLength(2)
    const firstScript = source.search(/<script\b/i)
    expect(firstScript).toBeGreaterThan(-1)
    expect(source.indexOf(placeholder)).toBeLessThan(firstScript)
  })

  it('index.html sends no referrer', () => {
    expect(source).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/i)
  })

  it('vite.config.ts injects the policy from config/csp.ts into the build', () => {
    const vite = readFileSync(root('vite.config.ts'), 'utf8')
    expect(vite).toMatch(/import\s*\{\s*CSP\s*\}\s*from\s*'\.\/config\/csp'/)
    expect(vite).toContain('<!--LMX_CSP-->')
    expect(vite).toContain('Content-Security-Policy')
  })

  const dist = root('dist/index.html')
  // dist/ is a build output and may not exist when the unit tests run before `vite build`.
  it.skipIf(!existsSync(dist))('dist/index.html carries the exact CSP in a single <meta>, before any script', () => {
    const html = readFileSync(dist, 'utf8')
    const metas = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/gi)]
    expect(metas).toHaveLength(1)
    expect(metas[0]?.[1]).toBe(CSP)
    expect(html).not.toContain('LMX_CSP')
    const firstScript = html.search(/<script\b/i)
    if (firstScript !== -1) expect(html.indexOf('Content-Security-Policy')).toBeLessThan(firstScript)
  })
})
