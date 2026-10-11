/**
 * JPEG metadata detection, and the JPEG encoder every stored photo goes through.
 *
 * A browser canvas holds only pixels, so a picture drawn onto one and encoded again carries none of the original's Exif,
 * GPS, XMP or IPTC. That is how photos are stripped here (importPhoto.ts, burst.ts). This file is the check behind it:
 * it walks the JPEG's segments and reports what it finds, and `encodeJpeg` refuses to hand back bytes that contain any
 * personal metadata, so a browser that started writing some would fail loudly instead of leaking quietly.
 *
 * "Metadata" here means anything that is not needed to draw the picture and could say who/where/when/what with:
 *   Exif (APP1), GPS (a tag inside Exif, or in XMP), XMP (APP1), IPTC (APP13 Photoshop block), JPEG comments,
 *   any other application segment, and bytes after the end-of-image marker. The JFIF header (APP0) and the Adobe colour
 *   flag (APP14) are not metadata. An ICC colour profile (APP2) is reported separately as `icc` and is allowed to stay:
 *   it describes the colour space, not the person.
 */

export interface MetadataReport {
  /** Starts with the JPEG start-of-image marker. */
  isJpeg: boolean
  exif: boolean
  /** A GPS tag in the Exif block, or GPS fields in an XMP packet. */
  gps: boolean
  xmp: boolean
  iptc: boolean
  /** An embedded ICC colour profile. Allowed to stay (see above). */
  icc: boolean
  /** A JPEG comment (COM) segment. */
  comment: boolean
  /** Other application segments and trailing bytes, described. */
  other: string[]
}

export class MetadataLeakError extends Error {
  readonly report: MetadataReport
  constructor(report: MetadataReport) {
    super(`The re-encoded photo still carries metadata (${describeMetadata(report)}); it was not stored.`)
    this.name = 'MetadataLeakError'
    this.report = report
  }
}

const ASCII = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))

function startsWith(bytes: Uint8Array, offset: number, text: string): boolean {
  const sig = ASCII(text)
  if (offset + sig.length > bytes.length) return false
  return sig.every((b, i) => bytes[offset + i] === b)
}

function includesAscii(bytes: Uint8Array, text: string, limit = bytes.length): boolean {
  const sig = ASCII(text)
  const end = Math.min(bytes.length, limit) - sig.length
  for (let i = 0; i <= end; i++) {
    let j = 0
    while (j < sig.length && bytes[i + j] === sig[j]) j++
    if (j === sig.length) return true
  }
  return false
}

/** GPSInfo pointer tag in an Exif IFD. */
const TAG_GPS_INFO = 0x8825

/** True if IFD0 or IFD1 of the TIFF structure at `tiff` has a GPSInfo entry. Bounds-checked; malformed input answers false. */
function exifHasGps(tiff: Uint8Array): boolean {
  if (tiff.length < 8) return false
  const little = tiff[0] === 0x49 && tiff[1] === 0x49
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d
  if (!little && !big) return false
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  if (u16(2) !== 42) return false

  let ifd = u32(4)
  for (let pass = 0; pass < 2; pass++) {
    if (ifd < 8 || ifd + 2 > tiff.length) return false
    const count = u16(ifd)
    if (ifd + 2 + count * 12 + 4 > tiff.length) return false
    for (let e = 0; e < count; e++) if (u16(ifd + 2 + e * 12) === TAG_GPS_INFO) return true
    ifd = u32(ifd + 2 + count * 12)
    if (ifd === 0) return false
  }
  return false
}

/** Walks the JPEG segments of `bytes` and says what metadata they carry. Never throws: malformed data stops the walk. */
export function scanJpegMetadata(bytes: Uint8Array): MetadataReport {
  const report: MetadataReport = { isJpeg: false, exif: false, gps: false, xmp: false, iptc: false, icc: false, comment: false, other: [] }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return report
  report.isJpeg = true

  const n = bytes.length
  let i = 2
  while (i + 1 < n) {
    if (bytes[i] !== 0xff) {
      i++ // entropy-coded scan data
      continue
    }
    const marker = bytes[i + 1] as number
    if (marker === 0xff) {
      i++ // fill byte before a marker
      continue
    }
    // Markers that carry no length: stuffed 0xFF00, TEM, RST0–7, SOI.
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xd9) {
      const trailing = n - (i + 2)
      if (trailing > 0) report.other.push(`${trailing} bytes after the end of the image`)
      break
    }
    if (i + 3 >= n) break
    const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number)
    if (length < 2) {
      i += 2
      continue
    }
    const payload = bytes.subarray(i + 4, Math.min(n, i + 2 + length))
    classify(marker, payload, report)
    i += 2 + length
  }
  return report
}

function classify(marker: number, payload: Uint8Array, report: MetadataReport): void {
  switch (marker) {
    case 0xe0: // APP0: JFIF is the plain header; JFXX holds a thumbnail.
      if (startsWith(payload, 0, 'JFXX')) report.other.push('JFXX thumbnail')
      return
    case 0xe1: // APP1: Exif or XMP.
      if (startsWith(payload, 0, 'Exif\0\0')) {
        report.exif = true
        if (exifHasGps(payload.subarray(6))) report.gps = true
      } else if (includesAscii(payload, 'ns.adobe.com/xap/1.0/', 64) || includesAscii(payload, 'ns.adobe.com/xmp/extension/', 64)) {
        report.xmp = true
        if (includesAscii(payload, 'GPSLatitude') || includesAscii(payload, 'GPSLongitude')) report.gps = true
      } else {
        report.other.push('APP1 segment')
      }
      return
    case 0xe2: // APP2: ICC profile (allowed), or something else.
      if (startsWith(payload, 0, 'ICC_PROFILE\0')) report.icc = true
      else report.other.push(startsWith(payload, 0, 'MPF\0') ? 'multi-picture data' : 'APP2 segment')
      return
    case 0xed: // APP13: Photoshop block with IPTC.
      if (startsWith(payload, 0, 'Photoshop 3.0\0')) report.iptc = true
      else report.other.push('APP13 segment')
      return
    case 0xee: // APP14: Adobe colour-transform flag.
      return
    case 0xfe:
      report.comment = true
      return
    default:
      if (marker >= 0xe3 && marker <= 0xef) report.other.push(`APP${marker - 0xe0} segment`)
  }
}

/** Human-readable list of what a report found (the ICC profile is not a finding). */
export function describeMetadata(report: MetadataReport): string {
  if (!report.isJpeg) return 'not a JPEG, so it cannot be shown clean'
  const found: string[] = []
  if (report.exif) found.push('Exif')
  if (report.gps) found.push('GPS')
  if (report.xmp) found.push('XMP')
  if (report.iptc) found.push('IPTC')
  if (report.comment) found.push('a comment')
  found.push(...report.other)
  return found.join(', ')
}

/**
 * True if the JPEG carries Exif, GPS, XMP, IPTC, a comment, another application segment or trailing bytes. An ICC colour
 * profile alone is not a marker (see `scanJpegMetadata(bytes).icc`). Bytes that are not a JPEG answer true: they cannot be
 * shown clean.
 */
export function hasMetadataMarkers(bytes: Uint8Array): boolean {
  const r = scanJpegMetadata(bytes)
  return !r.isJpeg || r.exif || r.gps || r.xmp || r.iptc || r.comment || r.other.length > 0
}

/** Throws MetadataLeakError if the JPEG carries any metadata marker. */
export function assertNoMetadata(bytes: Uint8Array): void {
  if (hasMetadataMarkers(bytes)) throw new MetadataLeakError(scanJpegMetadata(bytes))
}

/** JPEG quality of every stored photo (docs/PLAN.md: 0.92). */
export const JPEG_QUALITY = 0.92

/**
 * Encodes a canvas as JPEG and verifies the bytes carry no personal metadata. The only way a photo reaches storage.
 * Throws if the browser cannot encode JPEG or if the result contains a metadata marker.
 */
export async function encodeJpeg(canvas: HTMLCanvasElement, quality: number = JPEG_QUALITY): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob || blob.type !== 'image/jpeg') throw new Error('This browser could not encode the photo as JPEG.')
  assertNoMetadata(new Uint8Array(await blob.arrayBuffer()))
  return blob
}
