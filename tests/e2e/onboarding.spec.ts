import { expect, test } from '@playwright/test'
import { asStandalone } from './helpers'

test.describe('onboarding', () => {
  test.skip(({ isMobile }) => !isMobile, 'iPhone project only')

  test('full happy path ends on Home with Setup complete', async ({ page }) => {
    await asStandalone(page)
    await page.goto('./#/onboarding')

    await expect(page.getByRole('heading', { level: 1, name: 'Before you start' })).toBeVisible()
    await page.getByRole('button', { name: 'I understand. Start' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Install the app' })).toBeVisible()
    await expect(page.getByText('Installed', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'I am not on an iPhone' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'The basics' })).toBeVisible()
    const height = page.getByLabel(/^Height/)

    // Empty
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Enter your height.' })).toBeVisible()
    // Too short
    await height.fill('100')
    await expect(page.getByRole('alert').filter({ hasText: 'Height must be between 120 and 230 cm' })).toBeVisible()
    // Too tall
    await height.fill('250')
    await expect(page.getByRole('alert').filter({ hasText: 'Height must be between 120 and 230 cm' })).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'The basics' })).toBeVisible()
    // Valid
    await height.fill('180')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('radio', { name: '30 min' }).click()
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Checklists' })).toBeVisible()
    await page.reload()
    // Resume after reload: lands on the step that was reached.
    await expect(page.getByRole('heading', { level: 1, name: 'Checklists' })).toBeVisible()
    await page.getByRole('checkbox').first().check({ force: true })
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'My current stack' })).toBeVisible()
    await expect(page.getByText('Nothing in your stack yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Skip for now' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Storage' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip for now' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Setup complete' })).toBeVisible()
    await expect(page.getByText('180 cm')).toBeVisible()
    await expect(page.getByText('30 minutes')).toBeVisible()
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page.getByText('Setup is complete.')).toBeVisible()
    await page.getByRole('button', { name: 'Go to Home' }).click()

    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Lookmaxing' })).toBeVisible()
    await expect(page.locator('strong', { hasText: 'Setup complete.' })).toBeVisible()
  })

  test('imperial height converts and validates', async ({ page }) => {
    await asStandalone(page)
    await page.goto('./#/onboarding')
    await page.getByRole('button', { name: 'I understand. Start' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('radio', { name: 'Feet and inches' }).click()
    await page.getByLabel(/^Feet/).fill('5')
    await page.getByLabel(/^Inches/).fill('12')
    await expect(page.getByRole('alert').filter({ hasText: 'Inches must be from 0 to 11.9.' })).toBeVisible()
    await page.getByLabel(/^Inches/).fill('11')
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Checklists' })).toBeVisible()
  })
})
