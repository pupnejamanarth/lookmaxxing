import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const Y4M = 'tests/.generated/portrait.y4m'
const sandboxChromium = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
// Only point at the sandbox's Chromium when it exists; CI uses Playwright's own download.
const executablePath = existsSync(sandboxChromium) ? sandboxChromium : undefined

test.beforeAll(() => {
  if (existsSync(Y4M)) return
  mkdirSync('tests/.generated', { recursive: true })
  // The sample portrait looped as a 640x480 camera feed (a still image of a stock portrait, not a real user's photo).
  execFileSync('ffmpeg', ['-y', '-loop', '1', '-i', 'tests/fixtures/portrait.jpg', '-t', '6', '-r', '15', '-vf', 'scale=-2:480,pad=640:480:(ow-iw)/2:0,format=yuv420p', Y4M], { stdio: 'ignore' })
})

test.use({
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
  },
})

test('live quality checks refuse a head that is 4.7 degrees off and say how to fix it', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('#/scan')
  await page.getByRole('button', { name: /start camera/i }).click()
  // The sample portrait looks slightly down: the pitch check (limit 4 degrees) must hold the scan back, with a concrete hint.
  await expect(page.locator('.qs-hint')).toContainText(/chin/i, { timeout: 90_000 })
  await expect(page.locator('.qs-pill').first()).toBeVisible()
  expect(page.url()).toContain('#/scan')
  await page.waitForTimeout(3000)
  expect(page.url()).not.toMatch(/#\/scans\//)
})

test('upload path: a photo is measured, scored with reasons, saved, and the daily limit applies', async ({ page, baseURL }) => {
  test.setTimeout(150_000)
  const foreign: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (!u.startsWith(baseURL!) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u)
  })
  await page.goto('#/scan')
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/portrait.jpg')
  await page.waitForURL(/#\/scans\/[0-9a-f-]+/, { timeout: 120_000 })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/not available/i).first()).toBeVisible()
  await page.goto('#/scan')
  await expect(page.getByText('One quick scan per day')).toBeVisible()
  expect(foreign).toEqual([])
})
