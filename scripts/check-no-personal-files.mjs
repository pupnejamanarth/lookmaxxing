#!/usr/bin/env node
/**
 * Privacy guard. Fails (exit 1) if any file that could contain personal data would be
 * committed: photos, video, audio, databases, encrypted backups.
 *
 * Looks at tracked files AND untracked-but-not-ignored files, so it also catches a file
 * that was force-added or sits behind a mistaken gitignore edit.
 *
 * Allow-list (synthetic / non-personal only):
 *   public/icons/**      app icons
 *   tests/fixtures/**    synthetic fixtures (generated, never real people)
 *   public/models/**     on-device ML model files (.task/.tflite) – must be listed in SHA256SUMS
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const FORBIDDEN_EXT =
  /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|mp4|mov|m4a|wav|mp3|sqlite3?|db|lmxbackup|zip|7z|tar|gz)$/i
const ALLOWED_PREFIXES = ['public/icons/', 'tests/fixtures/']
const MODEL_DIR = 'public/models/'
const MODEL_EXT = /\.(task|tflite|wasm|bin)$/i

function list() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  })
  return out.split('\0').filter(Boolean)
}

const files = list().filter((f) => existsSync(f))
const problems = []

let modelSums = ''
if (existsSync(`${MODEL_DIR}SHA256SUMS`)) modelSums = readFileSync(`${MODEL_DIR}SHA256SUMS`, 'utf8')

for (const f of files) {
  if (f.startsWith(MODEL_DIR) && MODEL_EXT.test(f)) {
    const name = f.slice(MODEL_DIR.length)
    if (!modelSums.includes(name)) problems.push(`${f}: model file is not listed in ${MODEL_DIR}SHA256SUMS`)
    continue
  }
  if (FORBIDDEN_EXT.test(f) && !ALLOWED_PREFIXES.some((p) => f.startsWith(p))) {
    problems.push(`${f}: binary/personal-data file type outside the allow-list`)
  }
}

if (problems.length) {
  console.error('PRIVACY GUARD FAILED – these files must not be committed:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`privacy guard ok (${files.length} files checked)`)
