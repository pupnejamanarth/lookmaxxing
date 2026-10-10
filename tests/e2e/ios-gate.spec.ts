import { expect, test } from '@playwright/test'

test.describe('iOS install gate', () => {
  test.skip(({ isMobile }) => !isMobile, 'iPhone project only')

  test('a Safari tab shows install instructions and no continue button', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: false, configurable: true })
    })
    await page.goto('./#/onboarding')
    await page.getByRole('button', { name: 'I understand. Start' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Install the app' })).toBeVisible()
    await expect(page.getByText('Install this app before you continue')).toBeVisible()
    await expect(page.getByText('Tap Add to Home Screen.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /continue/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  })

  test('"I am not on an iPhone" lets the user through', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: false, configurable: true })
    })
    await page.goto('./#/onboarding')
    await page.getByRole('button', { name: 'I understand. Start' }).click()
    await page.getByRole('button', { name: 'I am not on an iPhone' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'The basics' })).toBeVisible()
  })
})
