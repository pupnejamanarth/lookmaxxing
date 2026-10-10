#!/usr/bin/env node
/**
 * Renders the app icon (a thick ring with a small gap and an inner notch; abstract, no
 * face, no text) to PNG with the preinstalled Chromium via Playwright, then verifies the
 * result. Run it by hand after changing the design:  node scripts/make-icons.mjs
 *
 * Writes public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
 * Everything is drawn from the inline SVG below; no network, no image inputs.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const BG = '#0b0d10'
const BG_RGB = [0x0b, 0x0d, 0x10]
const ACCENT = '#7cf2c4'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/** `scale` grows the mark inside its 512 box; the maskable icon keeps it inside the 80% safe circle. */
const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: 1.1 },
  { file: 'icon-512.png', size: 512, scale: 1.1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 1.0, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, scale: 1.1, opaqueRgb: true },
]

// --- the mark (512 x 512 design grid) -----------------------------------------------------
const C = 256
const RADIUS = 150 // centre line of the ring
const STROKE = 58 // ring thickness
const GAP_CENTER = -50 // degrees, clockwise from +x: gap sits up and to the right
const GAP_HALF = 13 // half-width of the gap in degrees
const NOTCH_ANGLE = GAP_CENTER + 180 // notch sits on the opposite side of the ring

const polar = (deg) => {
  const a = (deg * Math.PI) / 180
  return [C + RADIUS * Math.cos(a), C + RADIUS * Math.sin(a)]
}

function markSvg(size, scale) {
  const [x1, y1] = polar(GAP_CENTER + GAP_HALF)
  const [x2, y2] = polar(GAP_CENTER - GAP_HALF)
  const f = (n) => n.toFixed(2)
  const inner = C + RADIUS - STROKE / 2 // x of the ring's inner edge while the notch points along +x
  // Square slot cut into the inner edge, like a tick on a dial: starts inside the hole, 30 units into the ring wall.
  const notch = `${inner - 16},${C - 11} ${inner + 30},${C - 11} ${inner + 30},${C + 11} ${inner - 16},${C + 11}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
      <rect width="512" height="512" fill="#fff" />
      <polygon points="${notch}" fill="#000" transform="rotate(${NOTCH_ANGLE} ${C} ${C})" />
    </mask>
  </defs>
  <rect width="512" height="512" fill="${BG}" />
  <g transform="translate(${C} ${C}) scale(${scale}) translate(${-C} ${-C})">
    <path d="M ${f(x1)} ${f(y1)} A ${RADIUS} ${RADIUS} 0 1 1 ${f(x2)} ${f(y2)}"
      fill="none" stroke="${ACCENT}" stroke-width="${STROKE}" stroke-linecap="butt" mask="url(#cut)" />
  </g>
</svg>`
}

// --- minimal PNG helpers (8-bit, non-interlaced RGB/RGBA only; that is all Chromium emits) ---
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readChunks(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  const chunks = []
  for (let off = 8; off < png.length; ) {
    const len = png.readUInt32BE(off)
    chunks.push({ type: png.toString('latin1', off + 4, off + 8), data: png.subarray(off + 8, off + 8 + len) })
    off += 12 + len
  }
  return chunks
}

function decodePng(png) {
  const chunks = readChunks(png)
  const ihdr = chunks.find((c) => c.type === 'IHDR').data
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const [bitDepth, colorType, , , interlace] = [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  const stride = width * bpp
  const px = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0
      const b = y > 0 ? px[(y - 1) * stride + i] : 0
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0
      let add = 0
      if (filter === 1) add = a
      else if (filter === 2) add = b
      else if (filter === 3) add = (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`)
      px[y * stride + i] = (src[i] + add) & 0xff
    }
  }
  return { width, height, bpp, px }
}

function encodeRgbPng({ width, height, px, bpp }) {
  // Drop the alpha channel (if any) so the file has no transparency by construction.
  const rowLen = width * 3
  const raw = Buffer.alloc((rowLen + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (rowLen + 1)] = 0
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) raw[y * (rowLen + 1) + 1 + x * 3 + k] = px[(y * width + x) * bpp + k]
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'latin1')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// --- render + verify ------------------------------------------------------------------------
const launchOptions = { args: ['--no-sandbox'] }
if (existsSync(CHROMIUM)) launchOptions.executablePath = CHROMIUM
else if (process.env.CHROMIUM_PATH) {
  console.error(`CHROMIUM_PATH points to ${CHROMIUM}, which does not exist.`)
  process.exit(1)
} else if (!existsSync(chromium.executablePath())) {
  console.error('No Chromium found. Run "npx playwright install chromium" or set CHROMIUM_PATH to a Chromium binary.')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
const browser = await chromium.launch(launchOptions)
const problems = []
try {
  for (const t of TARGETS) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${BG}">${markSvg(t.size, t.scale)}</body></html>`,
    )
    let png = await page.screenshot({ type: 'png', omitBackground: false })
    await page.close()

    let img = decodePng(png)
    if (img.width !== t.size || img.height !== t.size) problems.push(`${t.file}: is ${img.width}x${img.height}, wanted ${t.size}x${t.size}`)

    if (img.bpp === 4) {
      const translucent = img.px.some((v, i) => i % 4 === 3 && v !== 255)
      if (translucent) problems.push(`${t.file}: contains transparent pixels`)
    }
    if (t.opaqueRgb) {
      png = encodeRgbPng(img)
      img = decodePng(png)
      if (img.bpp !== 3) problems.push(`${t.file}: still has an alpha channel`)
    }
    if (t.maskable) {
      // Everything that is not background must sit inside the central 80% (a circle of radius 0.4 * size).
      const limit = 0.4 * t.size
      let outside = 0
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const o = (y * img.width + x) * img.bpp
          const isBg = img.px[o] === BG_RGB[0] && img.px[o + 1] === BG_RGB[1] && img.px[o + 2] === BG_RGB[2]
          if (!isBg && Math.hypot(x + 0.5 - t.size / 2, y + 0.5 - t.size / 2) > limit) outside++
        }
      }
      if (outside) problems.push(`${t.file}: ${outside} pixels fall outside the 80% safe zone`)
    }

    writeFileSync(join(OUT_DIR, t.file), png)
    console.log(`wrote public/icons/${t.file}  ${img.width}x${img.height}  ${png.length} bytes  ${img.bpp === 3 ? 'RGB' : 'RGBA'}`)
  }
} finally {
  await browser.close()
}

if (problems.length) {
  console.error('ICON CHECK FAILED:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('icons ok')
