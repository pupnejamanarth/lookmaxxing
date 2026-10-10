/**
 * Throwaway PRODUCTION build of the vision harness, for tests/e2e/vision.spec.ts only (never deployed, never in dist/).
 * It exists to prove the detector runs under the real production policy: the same Content-Security-Policy <meta> as the
 * app (config/csp.ts), minified bundles, and nothing but static files served from one origin.
 *
 *   vite build   --config harness/vite.prod.config.ts   ->  node_modules/.cache/lmx-vision-harness/
 *   vite preview --config harness/vite.prod.config.ts   ->  http://localhost:4175/lookmaxxing/harness/vision-harness.html
 */
import { defineConfig, type Plugin } from 'vite'
import { CSP } from '../config/csp'

/** Same base as the app (vite.config.ts BASE), so the runtime and model are fetched from the same paths. */
const BASE = '/lookmaxxing/'

function cspMeta(): Plugin {
  return {
    name: 'lmx-harness-csp',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('<!--LMX_CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  }
}

const OUT_DIR = 'node_modules/.cache/lmx-vision-harness'

export default defineConfig({
  base: BASE,
  plugins: [cspMeta()],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { input: { 'vision-harness': 'harness/vision-harness.html' } },
  },
  preview: { port: 4175, strictPort: true },
})
