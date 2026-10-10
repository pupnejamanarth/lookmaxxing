import { expect, test, type Page } from '@playwright/test'
import { open } from './helpers'

const BRANDS = /cerave|neutrogena|la roche|the ordinary|nivea|olay|gillette|rogaine|nizoral|head & shoulders|vaseline|loreal|l'oreal|garnier|clinique/i

async function addItem(page: Page, name: string, opts: { trial?: boolean } = {}) {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Name/).fill(name)
  if (opts.trial) {
    await dialog.getByRole('switch', { name: /I already use this/ }).click()
    await dialog.getByRole('button', { name: 'Add as trial' }).click()
  } else {
    await dialog.getByRole('button', { name: 'Add product' }).click()
  }
  await expect(dialog).toHaveCount(0)
}

const card = (page: Page, name: string) => page.getByRole('article').filter({ hasText: name })

test('whitelist: empty state, active item, trial item, permanent exclusion', async ({ page }) => {
  await open(page, '/whitelist')
  await expect(page.getByText('No products yet')).toBeVisible()
  await expect(page.getByText(/only set of products the app may ever mention/)).toBeVisible()
  await expect(page.getByText('It starts empty.')).toBeVisible()

  await addItem(page, 'Synthetic item A')
  const a = card(page, 'Synthetic item A')
  await expect(a).toBeVisible()
  await expect(page.getByText('No products yet')).toHaveCount(0)
  await expect(a.getByRole('switch', { name: /^Active/ })).toBeChecked()

  await addItem(page, 'Synthetic item B', { trial: true })
  const b = card(page, 'Synthetic item B')
  const bActive = b.getByRole('switch', { name: /^Active/ })
  await expect(bActive).not.toBeChecked()
  await expect(bActive).toBeDisabled()
  await expect(b.getByText('Patch test required')).toBeVisible()

  await b.getByRole('button', { name: 'Start patch test' }).click()
  await expect(b.getByText('Patch test running')).toBeVisible()
  await expect(b.getByRole('button', { name: 'Mark passed' })).toBeDisabled()
  await expect(bActive).toBeDisabled()

  await b.getByRole('button', { name: /Log today/ }).click()
  await b.getByLabel("Today's result").selectOption({ value: 'reaction' })
  await b.getByRole('button', { name: 'Save result' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Log reaction' }).click()

  await expect(b.getByText('Excluded for good', { exact: true }).first()).toBeVisible()
  await expect(bActive).not.toBeChecked()
  await expect(bActive).toBeDisabled()
  await expect(b.getByRole('button', { name: /Start patch test|Mark passed|Log today/ })).toHaveCount(0)

  // Persistence
  await page.reload()
  await expect(card(page, 'Synthetic item A').getByRole('switch', { name: /^Active/ })).toBeChecked()
  const b2 = card(page, 'Synthetic item B')
  await expect(b2.getByText('Excluded for good', { exact: true }).first()).toBeVisible()
  await expect(b2.getByRole('switch', { name: /^Active/ })).toBeDisabled()
  await expect(b2.getByRole('switch', { name: /^Active/ })).not.toBeChecked()

  // The app adds no product or brand name of its own.
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(BRANDS)
})

test('app text never names a product or brand', async ({ page }) => {
  for (const route of ['/', '/whitelist', '/metrics', '/methods/natural', '/methods/banned', '/methods/doctor', '/about', '/settings']) {
    await open(page, route)
    const text = await page.locator('main').innerText()
    expect(text, route).not.toMatch(BRANDS)
  }
})
