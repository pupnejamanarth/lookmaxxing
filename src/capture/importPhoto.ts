/**
 * Photo import: any image the browser can decode becomes a clean JPEG.
 *
 *   file → decoded with its Exif orientation applied → drawn on a canvas (pixels only) → encoded as JPEG →
 *   byte check: no Exif, GPS, XMP, IPTC or comment (encodeJpeg throws if there is one)
 *
 * The original file is never stored and never leaves this function: only the re-encoded pixels do. Orientation is applied
 * while decoding because the stripped output has no Exif left to carry it.
 */
import { encodeJpeg } from './metadata'

/** Largest picture, in pixels, that is ever drawn or stored. It is also the canvas limit of older iPhones (16 777 216). */
export const MAX_IMPORT_PIXELS = 16_000_000

export type ImportErrorCode = 'empty' | 'heic_unsupported' | 'unreadable'

export class ImportError extends Error {
  readonly code: ImportErrorCode
  constructor(code: ImportErrorCode, message: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}

export interface ImportedPhoto {
  /** The re-encoded JPEG, metadata-free. */
  blob: Blob
  width: number
  height: number
  /** The pixels the JPEG was encoded from (for running the face detector on the imported photo). */
  canvas: HTMLCanvasElement
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  release(): void
}

const isHeic = (file: Blob): boolean => /hei[cf]/i.test(file.type)

function unreadable(file: Blob, cause: unknown): ImportError {
  const error = isHeic(file)
    ? new ImportError(
        'heic_unsupported',
        'This browser cannot open HEIC photos. Open the app in Safari on an iPhone, or export the photo as JPEG (iPhone: Settings, Camera, Formats, Most Compatible) and import that.',
      )
    : new ImportError('unreadable', 'This file could not be read as a photo. Use a JPEG or PNG image.')
  error.cause = cause
  return error
}

/** Decodes with the Exif orientation applied. Falls back to an <img>, which applies it by default, where the option is unknown. */
async function decode(file: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
  } catch (error) {
    // A browser that does not know the option throws TypeError; one that cannot decode the data throws something else.
    if (!(error instanceof TypeError)) throw unreadable(file, error)
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined }
  } catch (error) {
    throw unreadable(file, error)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Output size for an input of this size: the same unless it has more than MAX_IMPORT_PIXELS, then scaled down keeping the aspect ratio. */
export function importSize(width: number, height: number, maxPixels: number = MAX_IMPORT_PIXELS): { width: number; height: number } {
  const pixels = width * height
  if (pixels <= maxPixels) return { width, height }
  const scale = Math.sqrt(maxPixels / pixels)
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

/**
 * Re-encodes a user-supplied photo as a clean JPEG. Throws ImportError when it cannot be decoded (with a plain message,
 * including for HEIC in a browser without a HEIC decoder) and MetadataLeakError if the output somehow carries metadata.
 */
export async function importPhoto(file: Blob): Promise<ImportedPhoto> {
  if (file.size === 0) throw new ImportError('empty', 'The file is empty.')
  const decoded = await decode(file)
  try {
    if (!(decoded.width > 0) || !(decoded.height > 0)) throw unreadable(file, new Error('the image has no size'))
    const { width, height } = importSize(decoded.width, decoded.height)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser did not provide a 2d canvas.')
    // JPEG has no transparency: a PNG with an alpha channel is composited on white instead of black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.source, 0, 0, width, height)

    return { blob: await encodeJpeg(canvas), width, height, canvas }
  } finally {
    decoded.release()
  }
}
