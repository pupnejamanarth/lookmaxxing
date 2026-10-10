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
  webServer: [
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173/lookmaxxing/',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    // Dev-only vision harness (harness/vision-harness.html): the real face detector in a page of its own. It is served by
    // `vite` (dev) and is not part of the production build.
    {
      command: 'npm run dev -- --port 4174 --strictPort',
      url: 'http://localhost:4174/lookmaxxing/harness/vision-harness.html',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    // The same harness built for production and served with the app's real CSP, to prove the detector needs nothing
    // the policy forbids (tests/e2e/vision.spec.ts). Output goes to node_modules/.cache, never to dist/. It is built when
    // the server starts, so stop a server left over from an earlier run before testing changed harness or vision code.
    {
      command:
        'node scripts/vendor-mediapipe.mjs && npx vite build --config harness/vite.prod.config.ts && npx vite preview --config harness/vite.prod.config.ts',
      url: 'http://localhost:4175/lookmaxxing/harness/vision-harness.html',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
})
