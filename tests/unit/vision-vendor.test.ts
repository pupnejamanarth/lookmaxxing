import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = resolve(ROOT, 'scripts/vendor-mediapipe.mjs')

/** The only files the app can request: the SIMD and no-SIMD builds of the classic (non-module) runtime. */
const SHIPPED = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

let dirs: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lmx-vendor-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

const run = (cwd: string) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' })

describe('scripts/vendor-mediapipe.mjs', () => {
  it('ships exactly the SIMD and no-SIMD runtimes, drops the module build and stale files, and writes a notice without URLs', () => {
    const cwd = scratch()
    symlinkSync(resolve(ROOT, 'node_modules'), join(cwd, 'node_modules'))
    // Leftovers from an older run of the script: the module build and a half-written temp file.
    mkdirSync(join(cwd, 'public/mediapipe/wasm'), { recursive: true })
    writeFileSync(join(cwd, 'public/mediapipe/wasm/vision_wasm_module_internal.js'), 'stale')
    writeFileSync(join(cwd, 'public/mediapipe/wasm/vision_wasm_module_internal.wasm'), 'stale')

    const result = run(cwd)
    expect(result.status, result.stderr).toBe(0)
    expect(readdirSync(join(cwd, 'public/mediapipe/wasm')).sort()).toEqual(SHIPPED)
    expect(readdirSync(join(cwd, 'public/mediapipe')).sort()).toEqual(['NOTICE.txt', 'vision_bundle_nometrics.js', 'wasm'])

    const notice = readFileSync(join(cwd, 'public/mediapipe/NOTICE.txt'), 'utf8')
    expect(notice).toContain('@mediapipe/tasks-vision 1.1.0')
    expect(notice).toContain('Apache-2.0')
    expect(notice).not.toMatch(/https?:/)

    // The library copy has its metrics sender cut out, no Google endpoint, a marker export, and is otherwise the real file.
    // (booleans, not toContain: a failure would print the whole 150 kB bundle)
    const original = readFileSync(join(cwd, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), 'utf8')
    const patched = readFileSync(join(cwd, 'public/mediapipe/vision_bundle_nometrics.js'), 'utf8')
    expect(original.includes('https://odml.pa.googleapis.com/v1/log')).toBe(true)
    expect(original.includes('await fetch(t.url,')).toBe(true)
    expect(patched.includes('odml.pa.googleapis.com')).toBe(false)
    expect(patched.includes('await fetch(t.url,')).toBe(false)
    expect(patched.includes('await Promise.reject(Error("usage metrics are not sent"),')).toBe(true)
    expect(patched.includes('sourceMappingURL')).toBe(false)
    expect(patched.trimEnd().endsWith('export const lmxMetricsRemoved=!0;')).toBe(true)
    expect(patched.includes('FaceLandmarker')).toBe(true) // the library itself is intact
    expect(Math.abs(patched.length - original.length)).toBeLessThan(400)

    // Running it again changes nothing (two npm scripts may run it at once).
    const again = run(cwd)
    expect(again.status, again.stderr).toBe(0)
    expect(readdirSync(join(cwd, 'public/mediapipe/wasm')).sort()).toEqual(SHIPPED)
  })

  it('refuses a runtime whose bytes are not the pinned ones, and copies nothing', () => {
    const cwd = scratch()
    const pkg = join(cwd, 'node_modules/@mediapipe/tasks-vision')
    mkdirSync(join(pkg, 'wasm'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@mediapipe/tasks-vision', version: '9.9.9', license: 'Apache-2.0' }))
    for (const name of SHIPPED) writeFileSync(join(pkg, 'wasm', name), 'not the real runtime')

    const result = run(cwd)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not match the pinned SHA-256')
    expect(existsSync(join(cwd, 'public/mediapipe/NOTICE.txt'))).toBe(false)
    expect(readdirSync(join(cwd, 'public/mediapipe/wasm'))).toEqual([])
  })

  it('refuses a library bundle that is not the pinned one: the patch is only valid for that exact file', () => {
    const cwd = scratch()
    const pkg = join(cwd, 'node_modules/@mediapipe/tasks-vision')
    mkdirSync(pkg, { recursive: true })
    symlinkSync(resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm'), join(pkg, 'wasm')) // genuine runtime
    writeFileSync(join(pkg, 'package.json'), readFileSync(resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/package.json')))
    writeFileSync(join(pkg, 'vision_bundle.mjs'), `${readFileSync(resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), 'utf8')}\n// changed`)

    const result = run(cwd)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('vision_bundle.mjs does not match the pinned SHA-256')
    expect(existsSync(join(cwd, 'public/mediapipe/vision_bundle_nometrics.js'))).toBe(false)
  })

  it('says what to do when the package is not installed', () => {
    const result = run(scratch())
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('npm ci')
  })

  it('names a missing runtime file instead of crashing', () => {
    const cwd = scratch()
    mkdirSync(join(cwd, 'node_modules/@mediapipe/tasks-vision/wasm'), { recursive: true })
    const result = run(cwd)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('vision_wasm_internal.js')
  })
})
