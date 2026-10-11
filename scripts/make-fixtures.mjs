#!/usr/bin/env node
/**
 * Generates tests/fixtures/gps-tagged.jpg: a tiny SYNTHETIC picture (coloured blocks, not a person) that carries every
 * kind of metadata the photo import must strip, so the strip tests have something to strip:
 *
 *   Exif   APP1  Orientation = 6 (the picture is stored sideways and must be rotated 90° clockwise to display),
 *                an ImageDescription, and a GPS block with placeholder coordinates 0°0'0" N, 0°0'0" E ("null island")
 *   XMP    APP1  a packet that repeats the placeholder GPS and a description
 *   IPTC   APP13 Photoshop block with a caption and a city, both fake
 *   COM          a JPEG comment
 *
 * The picture itself is 64×32 pixels of flat 8×8 blocks: red top-left 16×16, green bottom-right 16×16, grey elsewhere.
 * After the Orientation-6 rotation it is 32×64 with the red block top-right and the green block bottom-left, which is
 * how tests/e2e/capture.spec.ts proves the orientation was applied in the right direction.
 *
 * No dependency: a flat 8×8 block has only a DC coefficient, so a baseline JPEG of such blocks needs no DCT.
 * The output is deterministic (no timestamps), and tests/unit/capture-metadata.test.ts checks the committed file equals
 * what this script produces.
 *
 *   node scripts/make-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WIDTH = 64
export const HEIGHT = 32
const RED = [220, 30, 30]
const GREEN = [30, 200, 60]
const GREY = [150, 150, 150]

const ascii = (text) => [...text].map((c) => c.charCodeAt(0))

// ───────────────────────────── a DC-only baseline JPEG ─────────────────────────────

/** Standard JPEG luminance DC Huffman table (ITU-T T.81 Table K.3): code counts per length, then symbols. */
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
/** The AC table only ever needs "end of block" (0x00), as a single 1-bit code. */
const AC_BITS = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
const AC_VALS = [0x00]

/** Canonical Huffman codes from a (counts, symbols) table: symbol → { code, length }. */
function huffmanCodes(bits, vals) {
  const codes = new Map()
  let code = 0
  let k = 0
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) codes.set(vals[k++], { code: code++, length })
    code <<= 1
  }
  return codes
}

function segment(marker, payload) {
  const length = payload.length + 2
  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}

function rgbToYcc([r, g, b]) {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ]
}

/** Entropy-coded data: for each 8×8 block, three components, each a DC difference then an immediate end-of-block. */
function scanData(blockColour, blocksX, blocksY) {
  const dc = huffmanCodes(DC_BITS, DC_VALS)
  const ac = huffmanCodes(AC_BITS, AC_VALS)
  const bytes = []
  let acc = 0
  let nbits = 0
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) {
      acc = (acc << 1) | ((value >> i) & 1)
      if (++nbits === 8) {
        bytes.push(acc)
        if (acc === 0xff) bytes.push(0x00)
        acc = 0
        nbits = 0
      }
    }
  }
  const previous = [0, 0, 0]
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const ycc = rgbToYcc(blockColour(bx, by))
      for (let c = 0; c < 3; c++) {
        const level = Math.round(8 * (ycc[c] - 128)) // DC of a flat block, quantiser 1
        const diff = level - previous[c]
        previous[c] = level
        const size = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1
        const { code, length } = dc.get(size)
        put(code, length)
        if (size > 0) put(diff >= 0 ? diff : diff + (1 << size) - 1, size)
        const eob = ac.get(0x00)
        put(eob.code, eob.length)
      }
    }
  }
  if (nbits > 0) put((1 << (8 - nbits)) - 1, 8 - nbits) // pad with 1-bits
  return bytes
}

function blockColour(bx, by) {
  if (bx < 2 && by < 2) return RED
  if (bx >= WIDTH / 8 - 2 && by >= HEIGHT / 8 - 2) return GREEN
  return GREY
}

// ───────────────────────────── the metadata ─────────────────────────────

/** Exif APP1 payload: Orientation 6, a description, and a GPS IFD with 0°0'0" N and 0°0'0" E. Little-endian TIFF. */
function exifPayload() {
  const out = []
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff)
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff)
  const entry = (tag, type, count, value) => {
    u16(tag)
    u16(type)
    u32(count)
    if (Array.isArray(value)) out.push(...[...value, 0, 0, 0].slice(0, 4)) // inline value, padded to its 4-byte field
    else u32(value)
  }
  const description = [...ascii('SYNTHETIC TEST FIXTURE - NOT A PERSON'), 0]

  const ifd0 = 8
  const descriptionAt = ifd0 + 2 + 3 * 12 + 4
  const gpsAt = descriptionAt + description.length + (description.length % 2)
  const latAt = gpsAt + 2 + 5 * 12 + 4
  const lonAt = latAt + 24

  out.push(...ascii('II'))
  u16(42)
  u32(ifd0)
  // IFD0
  u16(3)
  entry(0x010e, 2, description.length, descriptionAt) // ImageDescription
  entry(0x0112, 3, 1, [6, 0, 0, 0]) // Orientation: rotate 90° clockwise to display
  entry(0x8825, 4, 1, gpsAt) // GPSInfo pointer
  u32(0) // no IFD1
  out.push(...description)
  if (description.length % 2) out.push(0)
  // GPS IFD
  u16(5)
  entry(0x0000, 1, 4, [2, 3, 0, 0]) // GPSVersionID
  entry(0x0001, 2, 2, [...ascii('N'), 0]) // GPSLatitudeRef
  entry(0x0002, 5, 3, latAt) // GPSLatitude
  entry(0x0003, 2, 2, [...ascii('E'), 0]) // GPSLongitudeRef
  entry(0x0004, 5, 3, lonAt) // GPSLongitude
  u32(0)
  for (let i = 0; i < 6; i++) {
    u32(0) // 0/1 degrees, minutes, seconds for latitude, then longitude
    u32(1)
  }
  return [...ascii('Exif'), 0, 0, ...out]
}

function xmpPayload() {
  const xml =
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<exif:GPSLatitude>0,0.0N</exif:GPSLatitude><exif:GPSLongitude>0,0.0E</exif:GPSLongitude>' +
    '<dc:description>synthetic fixture, not a person</dc:description>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  return [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii(xml)]
}

function iptcPayload() {
  const dataset = (id, text) => [0x1c, 0x02, id, 0, text.length, ...ascii(text)]
  let iptc = [...dataset(90, 'Nowhere'), ...dataset(120, 'synthetic fixture, not a person')]
  if (iptc.length % 2) iptc = [...iptc, 0]
  const size = iptc.length
  return [
    ...ascii('Photoshop 3.0'),
    0,
    ...ascii('8BIM'),
    0x04,
    0x04, // resource 0x0404: IPTC-NAA record
    0,
    0, // empty Pascal name, padded to even length
    (size >>> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    ...iptc,
  ]
}

// ───────────────────────────── assembly ─────────────────────────────

/** The fixture's bytes. */
export function buildGpsTaggedJpeg() {
  const quantisation = [0, ...new Array(64).fill(1)]
  const frame = [8, HEIGHT >> 8, HEIGHT & 0xff, WIDTH >> 8, WIDTH & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]
  const huffman = [0x00, ...DC_BITS, ...DC_VALS, 0x10, ...AC_BITS, ...AC_VALS]
  const scanHeader = [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]
  const jfif = [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  return Uint8Array.from([
    0xff, 0xd8,
    ...segment(0xe1, exifPayload()),
    ...segment(0xe0, jfif),
    ...segment(0xe1, xmpPayload()),
    ...segment(0xed, iptcPayload()),
    ...segment(0xfe, ascii('synthetic fixture generated by scripts/make-fixtures.mjs; not a photo of a person')),
    ...segment(0xdb, quantisation),
    ...segment(0xc0, frame),
    ...segment(0xc4, huffman),
    ...segment(0xda, scanHeader),
    ...scanData(blockColour, WIDTH / 8, HEIGHT / 8),
    0xff, 0xd9,
  ])
}

const OUTPUT = fileURLToPath(new URL('../tests/fixtures/gps-tagged.jpg', import.meta.url))

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(OUTPUT), { recursive: true })
  const bytes = buildGpsTaggedJpeg()
  writeFileSync(OUTPUT, bytes)
  console.log(`wrote ${OUTPUT} (${bytes.length} bytes)`)
}
