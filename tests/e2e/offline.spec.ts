import { expect, test } from '@playwright/test'
import { open } from './helpers'

test('works offline after the service worker took control', async ({ page, context }) => {
  await open(page, '/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  // First load is not controlled yet; a reload under the active worker is.
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Unmoggable' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Metrics' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Metrics' })).toBeVisible()
  await expect(page.getByRole('link', { name: /F01/ }).first()).toBeVisible()

  await page.goto('./#/methods')
  await expect(page.getByRole('heading', { level: 1, name: 'Methods' })).toBeVisible()
})
