import { expect, test } from '@playwright/test'
import { BANNED, METRICS, NATURAL_METHODS, getMetric, getSource } from '../../src/catalog'
import { CATEGORY_IDS } from '../../src/catalog/schema'
import { CATEGORY_LABEL } from '../../src/routes/catalog/helpers'
import { open } from './helpers'

test.describe('metrics browser', () => {
  test('lists every category and all metrics', async ({ page }) => {
    expect(METRICS.length).toBeGreaterThan(0)
    await open(page, '/metrics')
    await expect(page.getByRole('status').filter({ hasText: `Showing ${METRICS.length} of ${METRICS.length}` })).toBeVisible()

    const present = CATEGORY_IDS.filter((c) => METRICS.some((m) => m.category === c))
    expect(present.length).toBeGreaterThanOrEqual(8)
    for (const c of present) {
      await expect(page.getByRole('button', { name: new RegExp(`^${CATEGORY_LABEL[c]}\\s`) }).first()).toBeVisible()
    }
    await expect(page.getByRole('link', { name: /F01/ }).first()).toBeVisible()
  })

  test('filters narrow the list and clear restores it', async ({ page }) => {
    await open(page, '/metrics')
    const status = page.getByRole('status').filter({ hasText: 'Showing' })

    const pseudo = METRICS.filter((m) => m.evidence === 'PSEUDOSCIENCE')
    expect(pseudo.length).toBeGreaterThan(0)
    await page.getByText(/^Filters/).click()
    await page.getByRole('button', { name: 'PSEUDOSCIENCE', exact: true }).click()
    await expect(status).toContainText(`Showing ${pseudo.length} of ${METRICS.length}`)
    await expect(page.getByRole('link', { name: /F10/ })).toBeVisible()

    await page.getByRole('button', { name: 'Clear all' }).click()
    await expect(status).toContainText(`Showing ${METRICS.length} of ${METRICS.length}`)

    await page.getByRole('button', { name: 'Skin', exact: true }).click()
    const skin = METRICS.filter((m) => m.category === 'skin').length
    await expect(status).toContainText(`Showing ${skin} of ${METRICS.length}`)
    await page.getByRole('button', { name: 'Clear all' }).click()

    await page.getByRole('searchbox', { name: 'Search' }).fill('zzzz-no-such-metric')
    await expect(page.getByText('No metric matches')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(status).toContainText(`Showing ${METRICS.length} of ${METRICS.length}`)

    await page.getByRole('searchbox', { name: 'Search' }).fill('F10')
    await expect(page.getByRole('link', { name: /F10/ })).toBeVisible()
    await expect(status).toContainText(`of ${METRICS.length}`)
  })

  test('pseudoscience metric F10 is flagged plainly with its community claim', async ({ page }) => {
    const f10 = getMetric('F10')!
    expect(f10.evidence).toBe('PSEUDOSCIENCE')
    expect(f10.communityClaim).toBeTruthy()

    await open(page, '/metrics')
    await page.getByRole('link', { name: /F10/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: f10.name })).toBeVisible()
    await expect(page.getByText('PSEUDOSCIENCE', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Flagged as pseudoscience')).toBeVisible()
    await expect(page.getByText('Community claim', { exact: true })).toBeVisible()
  })

  test('a detail page shows sources with verified and unverified badges', async ({ page }) => {
    const mixed = METRICS.find((m) => {
      const s = m.sourceIds.map(getSource)
      return s.some((x) => x?.verified) && s.some((x) => x && !x.verified)
    })
    const m = mixed ?? METRICS.find((x) => x.sourceIds.length > 0)!
    await open(page, `/metrics/${m.id}`)
    const sources = page.locator('.ui-card', { has: page.getByRole('heading', { level: 2, name: 'Sources' }) })
    await expect(sources.getByText(/^Cited for:/).first()).toBeVisible()
    const kinds = m.sourceIds.map((id) => getSource(id)?.verified)
    if (kinds.includes(true)) await expect(sources.getByText('VERIFIED', { exact: true }).first()).toBeVisible()
    if (kinds.includes(false)) await expect(sources.getByText('unverified', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'How it is scored' })).toBeVisible()
  })

  test('unknown metric id shows a plain not-found', async ({ page }) => {
    await open(page, '/metrics/ZZ99')
    await expect(page.getByRole('heading', { level: 1, name: 'Metric not found' })).toBeVisible()
  })
})

test.describe('methods', () => {
  test('natural methods show excluded items with the reason', async ({ page }) => {
    expect(NATURAL_METHODS.some((m) => m.status.startsWith('EXCLUDED'))).toBe(true)
    await open(page, '/methods/natural')
    await expect(page.getByRole('heading', { level: 2, name: 'EXCLUDED' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 4, name: 'Excluded and why' }).first()).toBeVisible()
    await expect(page.getByText(/not medical advice/i).first()).toBeVisible()
  })

  test('banned section lists every banned item', async ({ page }) => {
    expect(BANNED.length).toBeGreaterThan(0)
    await open(page, '/methods')
    await page.getByRole('link', { name: 'Banned' }).click()
    await expect(page).toHaveURL(/#\/methods\/banned$/)
    await expect(page.getByText('The app will never suggest these.')).toBeVisible()
    await expect(page.getByText('BANNED', { exact: true })).toHaveCount(BANNED.length)
    await page.getByRole('link', { name: 'See a doctor' }).click()
    await expect(page.getByText('The app never diagnoses or treats.').first()).toBeVisible()
  })
})
