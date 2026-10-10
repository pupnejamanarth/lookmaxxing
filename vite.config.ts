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
        name: 'Unmoggable',
        short_name: 'Unmoggable',
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
