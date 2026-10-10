import { expect, test, type Page } from '@playwright/test'
import { ROUTES, asStandalone, open } from './helpers'

test.use({ viewport: { width: 390, height: 844 } })

/** Controls with no accessible name, using the same sources a screen reader uses, in order. */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const nameOf = (el: Element): string => {
      const label = el.getAttribute('aria-label')?.trim()
      if (label) return label
      const by = el.getAttribute('aria-labelledby')
      if (by) {
        const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim()
        if (t) return t
      }
      const own = text(el)
      if (own) return own
      const img = el.querySelector('img[alt]')?.getAttribute('alt')?.trim()
      if (img) return img
      const id = el.getAttribute('id')
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`)
        if (lab && text(lab)) return text(lab)
      }
      if (el.closest('label') && text(el.closest('label'))) return text(el.closest('label'))
      return el.getAttribute('title')?.trim() ?? ''
    }
    const sel = 'button, a[href], [role="button"], [role="link"], [role="switch"], [role="radio"], input:not([type="hidden"]), select, textarea'
    for (const el of document.querySelectorAll(sel)) {
      if (!nameOf(el)) out.push(`${el.tagName.toLowerCase()}.${el.className}`)
    }
    return out
  })
}

for (const route of ROUTES) {
  test(`route ${route}: one h1, no horizontal scroll, named controls`, async ({ page }) => {
    await asStandalone(page)
    await open(page, route)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(await unnamedControls(page)).toEqual([])
  })
}

test('tab bar is reachable and usable by keyboard', async ({ page }) => {
  await open(page, '/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveCount(4)

  let reached = false
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => Boolean(document.activeElement?.closest('nav[aria-label="Main"]')))
  }
  expect(reached).toBe(true)
  // Tab through the bar to Metrics and activate it.
  for (let i = 0; i < 4; i++) {
    const name = await page.evaluate(() => document.activeElement?.textContent?.trim())
    if (name === 'Metrics') break
    await page.keyboard.press('Tab')
  }
  await expect(nav.getByRole('link', { name: 'Metrics' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/metrics$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Metrics' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Metrics' })).toHaveAttribute('aria-current', 'page')
})
