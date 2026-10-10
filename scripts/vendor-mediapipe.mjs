#!/usr/bin/env node
/**
 * Copies the MediaPipe WASM runtime from node_modules into public/mediapipe/ so the app serves it from its OWN
 * origin (the strict CSP forbids loading it from a CDN). Runs before dev and build.
 * public/mediapipe/ is gitignored (generated); the model in public/models/ is committed with SHA256SUMS.
 *
 * Only the files the app can ever request are copied. src/vision/landmarker.ts asks for the classic (non-module)
 * runtime, and @mediapipe/tasks-vision picks between exactly two builds at run time:
 *
 *   vision_wasm_internal.{js,wasm}         SIMD build   (every browser from 2023 on, incl. iOS Safari 16.4+)
 *   vision_wasm_nosimd_internal.{js,wasm}  fallback for browsers without WebAssembly SIMD
 *
 * The package also ships vision_wasm_module_internal.*, the ES-module variant for module workers. The app runs the
 * detector on the main thread, so that pair (13 MB) is never requested and is NOT shipped. The list below is checked
 * by tests/e2e/vision.spec.ts, which records which runtime files a real detector load fetches.
 *
 * It also writes public/mediapipe/vision_bundle_nometrics.js, the library's JavaScript with its usage-metrics sender
 * cut out (see patchBundle). src/vision/landmarker.ts loads THAT file, not the npm package, so no MediaPipe object can
 * ever send anything: not the live detector, not one left half-built by a failed GPU start, not after close().
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'

const SRC = 'node_modules/@mediapipe/tasks-vision'
const DEST = 'public/mediapipe'
const WASM_DEST = `${DEST}/wasm`

/**
 * SHA-256 of each shipped file as published in @mediapipe/tasks-vision 1.1.0 (the version package.json pins exactly).
 * npm's lockfile already pins the tarball; this pins what actually gets copied into the site, so a different build
 * of the runtime cannot slip in. Bumping the package means re-reading its notes, re-running tests/e2e/vision.spec.ts
 * (the metrics switch-off in src/vision/landmarker.ts depends on the library's internals) and updating these hashes.
 */
const BUNDLE = 'vision_bundle.mjs'
/** SHA-256 of the unmodified bundle in the pinned package; the patch below is only valid for exactly this file. */
const BUNDLE_SHA256 = '9d5fc9ef74b22329cf9aa88dc543956d192b8c254210b187271614713eb5b10c'

const WASM_FILES = {
  'vision_wasm_internal.js': '7c652617b5bef832f42878ce8c5f752b0724bca6054e4bc1013a37d4b1949723',
  'vision_wasm_internal.wasm': '782eda3ec1f414fdb4f1d66a8b59093eb4d5ab437e06117796abf05962d68eef',
  'vision_wasm_nosimd_internal.js': '510fc70a170eb8b46767a7abab2af89a7a8341fa5b3ebfb8a5de41a79b7fa9df',
  'vision_wasm_nosimd_internal.wasm': 'b802041d105876865d6a0806f2ff7c4419a7f1b80bc01340fe36e759c2030011',
}

if (!existsSync(`${SRC}/wasm`)) {
  console.error('MediaPipe runtime not found – run npm ci first')
  process.exit(1)
}

mkdirSync(WASM_DEST, { recursive: true })

/**
 * Writes only when the content differs, via a temp file + rename, so two npm scripts starting at once (the dev and the
 * preview server both run this as a pre-step) never see a half-written file, and an unchanged file is not touched.
 */
function place(to, data) {
  if (existsSync(to) && readFileSync(to).equals(data)) return
  const tmp = `${to}.${process.pid}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, to)
}

let bytes = 0
for (const [name, sha256] of Object.entries(WASM_FILES)) {
  const from = `${SRC}/wasm/${name}`
  if (!existsSync(from)) {
    console.error(`MediaPipe runtime file missing: ${from} – the installed @mediapipe/tasks-vision is not the pinned version`)
    process.exit(1)
  }
  const data = readFileSync(from)
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== sha256) {
    console.error(`${from} does not match the pinned SHA-256 (expected ${sha256}, got ${actual}); not copied`)
    process.exit(1)
  }
  place(`${WASM_DEST}/${name}`, data)
  bytes += data.length
}

/**
 * @mediapipe/tasks-vision builds a metrics logger for every task. It records the platform, library version and
 * per-frame latency (no image data) and POSTs them to a Google endpoint every 60 s and when the task is closed; the
 * README calls this "metrics about the performance and utilization of the APIs ... sent to Google" and offers no
 * switch. This app must never make a request to another origin, so the sender is cut out of the file it ships:
 *   1. the fetch() that sends the batch becomes a rejected promise, which the logger already handles as "network
 *      failed": it drops the batch and stops itself;
 *   2. the endpoint URL is replaced by about:blank, so the string is not in the site at all (the dist privacy check
 *      scans for it);
 *   3. the source-map comment goes (the map is not shipped);
 *   4. a named export marks the file, so landmarker.ts can refuse a bundle that was not patched.
 * Each replaced text must occur exactly once, in exactly the pinned file, or the script stops.
 */
const BUNDLE_PATCHES = [
  ['await fetch(t.url,', 'await Promise.reject(Error("usage metrics are not sent"),'],
  ['https://odml.pa.googleapis.com/v1/log', 'about:blank'],
  ['//# sourceMappingURL=vision_bundle_mjs.js.map', ''],
]
export const METRICS_REMOVED_EXPORT = 'lmxMetricsRemoved'

function patchBundle(source) {
  let out = source
  for (const [from, to] of BUNDLE_PATCHES) {
    const count = out.split(from).length - 1
    if (count !== 1) {
      console.error(`cannot patch ${BUNDLE}: expected exactly one "${from}", found ${count}`)
      process.exit(1)
    }
    out = out.replace(from, () => to)
  }
  return `${out.trimEnd()}\nexport const ${METRICS_REMOVED_EXPORT}=!0;\n`
}

{
  const original = readFileSync(`${SRC}/${BUNDLE}`)
  const actual = createHash('sha256').update(original).digest('hex')
  if (actual !== BUNDLE_SHA256) {
    console.error(`${SRC}/${BUNDLE} does not match the pinned SHA-256 (expected ${BUNDLE_SHA256}, got ${actual}); not patched`)
    process.exit(1)
  }
  place(`${DEST}/vision_bundle_nometrics.js`, Buffer.from(patchBundle(original.toString('utf8'))))
}

// A previous run (or an older version of this script) may have left files that must not ship, e.g. the module build.
for (const name of readdirSync(WASM_DEST)) {
  if (!(name in WASM_FILES) && !name.endsWith('.tmp')) rmSync(`${WASM_DEST}/${name}`, { force: true })
}

// Apache-2.0 asks redistributions to keep the notice. No URL in it: dist/ is scanned for third-party hosts.
const { version, license } = JSON.parse(readFileSync(`${SRC}/package.json`, 'utf8'))
place(
  `${DEST}/NOTICE.txt`,
  Buffer.from(
    `This folder holds the WebAssembly runtime of @mediapipe/tasks-vision ${version}, copyright The MediaPipe Authors,\n` +
      `distributed under the ${license} license. It runs entirely in the browser: no image or measurement leaves the device.\n`,
  ),
)

const shipped = readdirSync(WASM_DEST)
console.log(
  `vendored MediaPipe runtime: ${shipped.length} wasm files + vision_bundle_nometrics.js, ${(bytes / 1e6).toFixed(2)} MB -> ${DEST} ` +
    `(${shipped.map((f) => `${f} ${(statSync(`${WASM_DEST}/${f}`).size / 1e6).toFixed(2)} MB`).join(', ')})`,
)
