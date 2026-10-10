import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { CSP } from './config/csp'

/** GitHub Pages serves the project site from /<repo>/. */
export const BASE = '/lookmaxxing/'

/** Injects the privacy CSP <meta> into the production HTML only (dev HMR needs inline scripts). */
function cspPlugin(): Plugin {
  return {
    name: 'lmx-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('<!--LMX_CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
      },
    },
  }
}

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icons/*.png'],
      manifest: {
        id: BASE,
        name: 'Lookmaxing',
        short_name: 'Lookmaxing',
        description: 'Private, on-device appearance measurement. Nothing leaves your phone.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,wasm,task,tflite,json}'],
        // First-load download: the face model (3.8 MB) and the SIMD MediaPipe runtime (13.3 MB) are precached; the
        // 12.5 MB no-SIMD build is not. Only a browser without WebAssembly SIMD (before iOS 16.4 / Chrome 91) ever asks
        // for it, so it is cached the first time it is used instead of being downloaded by everyone. scripts/vendor-mediapipe.mjs
        // ships no other runtime file, and tests/e2e/vision.spec.ts checks which ones a real load requests.
        globIgnores: ['**/mediapipe/wasm/vision_wasm_nosimd_internal.*'],
        runtimeCaching: [
          {
            urlPattern: /\/mediapipe\/wasm\/vision_wasm_nosimd_internal\.(?:js|wasm)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'lmx-mediapipe-nosimd', cacheableResponse: { statuses: [200] } },
          },
        ],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
