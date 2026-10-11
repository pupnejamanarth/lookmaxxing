import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MetadataLeakError, assertNoMetadata, describeMetadata, encodeJpeg, hasMetadataMarkers, scanJpegMetadata } from '../../src/capture/metadata'

const FIXTURE = readFileSync(new URL('../fixtures/gps-tagged.jpg', import.meta.url))
const PORTRAIT = readFileSync(new URL('../fixtures/portrait.jpg', import.meta.url))

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0))
const segment = (marker: number, payload: number[]): number[] => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
const BODY = [...segment(0xdb, [0, ...new Array(64).fill(1)]), ...segment(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]), ...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]
const jpeg = (...segments: number[][]): Uint8Array<ArrayBuffer> => Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...BODY, 0xff, 0xd9])

/** A little- or big-endian Exif TIFF with the given IFD0 tags (no values needed: only presence is read). */
function exif(tags: number[], bigEndian = false): number[] {
  const u16 = (v: number) => (bigEndian ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8])
  const u32 = (v: number) => (bigEndian ? [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff] : [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24])
  const entries = tags.flatMap((tag) => [...u16(tag), ...u16(3), ...u32(1), ...u16(1), 0, 0])
  return [...ascii('Exif'), 0, 0, ...ascii(bigEndian ? 'MM' : 'II'), ...u16(42), ...u32(8), ...u16(tags.length), ...entries, ...u32(0)]
}

describe('the committed fixture tests/fixtures/gps-tagged.jpg', () => {
  it('is a small synthetic JPEG that carries every kind of metadata the import must strip', () => {
    const bytes = new Uint8Array(FIXTURE)
    expect(bytes.length).toBeLessThan(4096)
    const report = scanJpegMetadata(bytes)
    expect(report).toMatchObject({ isJpeg: true, exif: true, gps: true, xmp: true, iptc: true, comment: true })
    expect(hasMetadataMarkers(bytes)).toBe(true)
    expect(() => assertNoMetadata(bytes)).toThrow(MetadataLeakError)
    expect(describeMetadata(report)).toBe('Exif, GPS, XMP, IPTC, a comment')
  })

  it('is exactly what scripts/make-fixtures.mjs produces (so it is reproducible and still synthetic)', async () => {
    const url = pathToFileURL(fileURLToPath(new URL('../../scripts/make-fixtures.mjs', import.meta.url))).href
    const { buildGpsTaggedJpeg } = (await import(/* @vite-ignore */ url)) as { buildGpsTaggedJpeg: () => Uint8Array }
    expect(Buffer.from(buildGpsTaggedJpeg()).equals(FIXTURE)).toBe(true)
  })

  it('holds only placeholders: coordinates 0°0\'0" N / E, and says it is not a person', () => {
    const text = Buffer.from(FIXTURE).toString('latin1')
    expect(text).toContain('SYNTHETIC TEST FIXTURE - NOT A PERSON')
    expect(text).toContain('<exif:GPSLatitude>0,0.0N</exif:GPSLatitude>')
    expect(text).toContain('<exif:GPSLongitude>0,0.0E</exif:GPSLongitude>')
  })
})

describe('hasMetadataMarkers', () => {
  it('a JPEG with only the JFIF header is clean', () => {
    expect(hasMetadataMarkers(jpeg(JFIF))).toBe(false)
    expect(scanJpegMetadata(jpeg(JFIF))).toEqual({ isJpeg: true, exif: false, gps: false, xmp: false, iptc: false, icc: false, comment: false, other: [] })
  })

  it('finds Exif without GPS, and reports gps false', () => {
    const bytes = jpeg(JFIF, segment(0xe1, exif([0x0112])))
    expect(scanJpegMetadata(bytes)).toMatchObject({ exif: true, gps: false })
    expect(hasMetadataMarkers(bytes)).toBe(true)
  })

  it('finds a GPS tag in a little-endian and in a big-endian Exif block', () => {
    expect(scanJpegMetadata(jpeg(segment(0xe1, exif([0x010e, 0x8825])))).gps).toBe(true)
    expect(scanJpegMetadata(jpeg(segment(0xe1, exif([0x0112, 0x8825], true)))).gps).toBe(true)
    expect(scanJpegMetadata(jpeg(segment(0xe1, exif([0x0112], true)))).gps).toBe(false)
  })

  it('finds XMP, and GPS written inside it', () => {
    const packet = (xml: string) => segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii(xml)])
    expect(scanJpegMetadata(jpeg(packet('<x:xmpmeta/>')))).toMatchObject({ xmp: true, gps: false })
    expect(scanJpegMetadata(jpeg(packet('<exif:GPSLatitude>1</exif:GPSLatitude>')))).toMatchObject({ xmp: true, gps: true })
  })

  it('finds an IPTC block in APP13, and a comment', () => {
    expect(scanJpegMetadata(jpeg(segment(0xed, [...ascii('Photoshop 3.0'), 0, ...ascii('8BIM')]))).iptc).toBe(true)
    expect(scanJpegMetadata(jpeg(segment(0xfe, ascii('hello')))).comment).toBe(true)
    expect(hasMetadataMarkers(jpeg(segment(0xfe, ascii('hello'))))).toBe(true)
  })

  it('flags an ICC profile separately and does not count it as a marker', () => {
    const bytes = jpeg(JFIF, segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 0, 0, 0, 0]))
    expect(scanJpegMetadata(bytes).icc).toBe(true)
    expect(hasMetadataMarkers(bytes)).toBe(false)
  })

  it('does not count the Adobe colour flag (APP14) as metadata', () => {
    expect(hasMetadataMarkers(jpeg(JFIF, segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1])))).toBe(false)
  })

  it('flags other application segments, multi-picture data and a thumbnail extension', () => {
    expect(scanJpegMetadata(jpeg(segment(0xec, ascii('Ducky')))).other).toEqual(['APP12 segment'])
    expect(scanJpegMetadata(jpeg(segment(0xe2, [...ascii('MPF'), 0, 1, 2]))).other).toEqual(['multi-picture data'])
    expect(scanJpegMetadata(jpeg(segment(0xe0, [...ascii('JFXX'), 0, 0x10]))).other).toEqual(['JFXX thumbnail'])
    expect(scanJpegMetadata(jpeg(segment(0xe1, ascii('whatever')))).other).toEqual(['APP1 segment'])
  })

  it('flags bytes appended after the end of the image', () => {
    const bytes = Uint8Array.from([...jpeg(JFIF), 1, 2, 3])
    expect(scanJpegMetadata(bytes).other).toEqual(['3 bytes after the end of the image'])
    expect(hasMetadataMarkers(bytes)).toBe(true)
  })

  it('walks past scan data (stuffed 0xFF00 and restart markers) and still finds a segment that follows it', () => {
    const late = Uint8Array.from([0xff, 0xd8, ...JFIF, ...BODY, ...segment(0xe1, exif([0x8825])), 0xff, 0xd9])
    expect(scanJpegMetadata(late)).toMatchObject({ exif: true, gps: true })
  })

  it('cannot show anything that is not a JPEG to be clean', () => {
    expect(hasMetadataMarkers(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
    expect(hasMetadataMarkers(new Uint8Array(0))).toBe(true)
    expect(describeMetadata(scanJpegMetadata(new Uint8Array(0)))).toMatch(/not a JPEG/)
  })

  it('never throws on truncated or corrupt data', () => {
    for (let n = 0; n < FIXTURE.length; n += 7) expect(() => scanJpegMetadata(new Uint8Array(FIXTURE).subarray(0, n))).not.toThrow()
    const corrupt = new Uint8Array(FIXTURE)
    for (let i = 20; i < corrupt.length; i += 11) corrupt[i] = 0xff
    expect(() => scanJpegMetadata(corrupt)).not.toThrow()
    // A length field that points past the end of the data.
    expect(() => scanJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]))).not.toThrow()
    // An Exif IFD offset that points outside the block.
    const badOffset = exif([0x8825])
    badOffset[14] = 0xff
    expect(() => scanJpegMetadata(jpeg(segment(0xe1, badOffset)))).not.toThrow()
  })

  it('finds the markers in a real photo and in none of what it keeps after segments are removed', () => {
    // The sample portrait is a real JPEG: whatever it carries, removing every metadata segment must leave a clean file.
    const report = scanJpegMetadata(new Uint8Array(PORTRAIT))
    expect(report.isJpeg).toBe(true)
    const kept: number[] = [0xff, 0xd8]
    const bytes = new Uint8Array(PORTRAIT)
    let i = 2
    while (i + 3 < bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1] as number
      const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number)
      if (marker === 0xda) break
      const drop = (marker >= 0xe1 && marker <= 0xed) || marker === 0xfe
      if (!drop) kept.push(...bytes.subarray(i, i + 2 + length))
      i += 2 + length
    }
    const stripped = Uint8Array.from([...kept, ...bytes.subarray(i)])
    expect(hasMetadataMarkers(stripped)).toBe(false)
  })
})

describe('encodeJpeg', () => {
  const canvasWith = (blob: Blob | null) => ({ toBlob: (cb: (b: Blob | null) => void) => cb(blob) }) as unknown as HTMLCanvasElement

  it('returns the encoded blob when it is a clean JPEG', async () => {
    const clean = new Blob([jpeg(JFIF)], { type: 'image/jpeg' })
    await expect(encodeJpeg(canvasWith(clean))).resolves.toBe(clean)
  })

  it('refuses a JPEG that carries GPS or any other marker', async () => {
    await expect(encodeJpeg(canvasWith(new Blob([new Uint8Array(FIXTURE)], { type: 'image/jpeg' })))).rejects.toThrow(MetadataLeakError)
    await expect(encodeJpeg(canvasWith(new Blob([new Uint8Array(FIXTURE)], { type: 'image/jpeg' })))).rejects.toThrow(/Exif, GPS, XMP, IPTC/)
  })

  it('refuses when the browser cannot produce a JPEG', async () => {
    await expect(encodeJpeg(canvasWith(null))).rejects.toThrow(/could not encode/)
    await expect(encodeJpeg(canvasWith(new Blob([jpeg(JFIF)], { type: 'image/png' })))).rejects.toThrow(/could not encode/)
  })

  it('asks for quality 0.92 by default', async () => {
    let asked: unknown[] = []
    const canvas = { toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => { asked = [type, quality]; cb(new Blob([jpeg(JFIF)], { type: 'image/jpeg' })) } } as unknown as HTMLCanvasElement
    await encodeJpeg(canvas)
    expect(asked).toEqual(['image/jpeg', 0.92])
  })
})
