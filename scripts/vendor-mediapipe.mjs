#!/usr/bin/env node
/**
 * Copies the MediaPipe WASM runtime from node_modules into public/mediapipe/ so the app serves it
 * from its OWN origin (the strict CSP forbids loading it from a CDN). Runs before dev and build.
 * public/mediapipe/ is gitignored (generated); the model files in public/models/ are committed with SHA256SUMS.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'

const src = 'node_modules/@mediapipe/tasks-vision/wasm'
const dest = 'public/mediapipe/wasm'
if (!existsSync(src)) {
  console.error('MediaPipe runtime not found – run npm ci first')
  process.exit(1)
}
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`vendored MediaPipe runtime: ${readdirSync(dest).length} files -> ${dest}`)
