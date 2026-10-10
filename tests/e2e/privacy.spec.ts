import { expect, test } from '@playwright/test'
import { CSP } from '../../config/csp'
import { ROUTES, open } from './helpers'

test.describe('privacy', () => {
  test('every route only talks to its own origin', async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const seen: string[] = []
    const failed: string[] = []
    context.on('request', (r) => seen.push(r.url()))
    page.on('request', (r) => seen.push(r.url()))
    page.on('requestfailed', (r) => failed.push(r.url()))
    await context.route('**/*', (route) => {
      seen.push(route.request().url())
      return route.continue()
    })

    for (const route of ROUTES) {
      await open(page, route)
    }
    // The first visit registers the service worker; let it finish its precache fetches.
    await page.evaluate(() => navigator.serviceWorker?.ready)

    expect(seen.length).toBeGreaterThan(0)
    const outside = [...seen, ...failed].filter((u) => {
      const url = new URL(u)
      return !(url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === origin)
    })
    expect(outside).toEqual([])
  })

  test('production CSP meta equals config/csp.ts', async ({ page }) => {
    await page.goto('./')
    const metas = page.locator('meta[http-equiv="Content-Security-Policy" i]')
    await expect(metas).toHaveCount(1)
    expect(await metas.getAttribute('content')).toBe(CSP)
  })

  test('the guard refuses fetch to another origin', async ({ page }) => {
    await open(page, '/')
    const result = await page.evaluate(() =>
      fetch('https://example.com').then(
        () => 'resolved',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      ),
    )
    expect(result).toContain('Blocked by privacy guard')
    expect(result).toContain('example.com')
  })

  test('CSP blocks an injected third-party script', async ({ page }) => {
    await open(page, '/')
    const violation = await page.evaluate(
      () =>
        new Promise<{ directive: string; blocked: string }>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no securitypolicyviolation event')), 8000)
          document.addEventListener('securitypolicyviolation', (e) => {
            clearTimeout(timer)
            resolve({ directive: e.effectiveDirective, blocked: e.blockedURI })
          })
          const s = document.createElement('script')
          s.src = 'https://example.com/x.js'
          document.head.append(s)
        }),
    )
    expect(violation.blocked).toContain('example.com')
    expect(violation.directive).toMatch(/^script-src/)
  })

  test('Settings privacy check shows exactly 1 origin', async ({ page, baseURL }) => {
    await open(page, '/settings')
    const card = page.locator('main')
    await expect(card.getByText('1 origin', { exact: true })).toBeVisible()
    await expect(card.getByText(new URL(baseURL!).origin).first()).toBeVisible()
    await expect(card.getByText('Unexpected origins')).toHaveCount(0)
    await expect(card.getByText('Yes', { exact: true })).toBeVisible()
  })
})
