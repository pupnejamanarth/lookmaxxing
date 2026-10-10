import { expect, type Page } from '@playwright/test'

/** Makes the page believe it runs from the Home Screen, so the iOS install gate passes. */
export async function asStandalone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
  })
}

/** Removes the Web Share API so the backup always takes the plain download path. */
export async function withoutShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })
}

export const ROUTES = [
  '/',
  '/onboarding',
  '/metrics',
  '/metrics/F01',
  '/methods',
  '/methods/natural',
  '/methods/banned',
  '/methods/doctor',
  '/whitelist',
  '/settings',
  '/about',
  '/does-not-exist',
] as const

export async function open(page: Page, route: string): Promise<void> {
  await page.goto(`./#${route}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/** Waits until the app has finished its first render and the local database answered. */
export async function waitForApp(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Main' }).or(page.getByRole('heading', { level: 1 })).first()).toBeVisible()
}
