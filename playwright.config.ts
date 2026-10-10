import { defineConfig, devices } from '@playwright/test'

// The cloud sandbox ships Chromium at a fixed path; locally/CI fall back to Playwright's own download.
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const hasCustomChromium = !process.env.CI || Boolean(process.env.CHROMIUM_PATH)
const launchOptions = {
  ...(hasCustomChromium ? { executablePath } : {}),
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/lookmaxxing/',
    serviceWorkers: 'allow',
    trace: 'off',
    launchOptions,
  },
  projects: [
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/lookmaxxing/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
