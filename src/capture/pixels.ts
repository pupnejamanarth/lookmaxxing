/**
 * Pixel statistics for the capture quality checks: sharpness, clipped highlights, brightness percentiles and the
 * brightness of the left and right half of the face.
 *
 * Everything is computed from the pixels of ONE region of the picture (the face when the caller knows where it is,
 * otherwise the central half of the frame, the part the protocol requires the face to sit in), so a plain wall or a
 * bright window behind the head cannot decide whether the face is sharp or blown out.
 *
 * The functions only need `{ data, width, height }`, so they run on a canvas in the browser and on a synthetic
 * ImageData-like object under Node.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PixelRegions {
  /** Where sharpness, clipping and the percentiles are measured. Default: the central half of the frame. */
  face?: Rect
  /** Where the brightness of the image-left half of the face is measured. Default: the left half of `face`. */
  left?: Rect
  /** Where the brightness of the image-right half of the face is measured. Default: the right half of `face`. */
  right?: Rect
}

export interface PixelStats {
  /** Variance of the Laplacian of the luma (0–255 scale), with the region shrunk to SHARPNESS_MAX_SIDE and smoothed by a 3×3 mean first so sensor noise is not counted as detail; higher = sharper. */
  sharpness: number
  /** Share of region pixels (0–1) whose luma is at or above CLIP_LUMA: highlights with no detail left. */
  clippedShare: number
  /** Mean luma of the region, 0–255. */
  meanLuma: number
  /** 5th percentile of the region's luma, 0–255. */
  lumaP5: number
  /** 95th percentile of the region's luma, 0–255. */
  lumaP95: number
  /** Mean luma, 0–255, of the left / right half of the face (image sides). Absent in hand-built stats: the lighting check is then skipped. */
  leftLuma?: number
  rightLuma?: number
}

/** The part of ImageData the analysis reads. A real ImageData satisfies it. */
export interface PixelBuffer {
  data: ArrayLike<number>
  width: number
  height: number
}

/**
 * Longest side, in pixels, that the sharpness region is shrunk to before the Laplacian is taken. The face landmarker works
 * from a face crop of about this size, so what is blurred at this scale is what costs landmark accuracy, and the number
 * stops depending on the camera's resolution. A region already smaller is measured as it is: shrinking is the only
 * resampling done (upscaling would only blur edges and lower the number).
 */
export const SHARPNESS_MAX_SIDE = 256

/** Luma at or above this is counted as a clipped highlight (255 is white; the last few levels carry no skin detail). */
export const CLIP_LUMA = 250

/** At most this many pixels of a region are visited for the statistics; larger regions are sampled on a regular grid. */
const MAX_SAMPLES = 262_144

/** Rec. 709 luma weights, applied to the gamma-coded values (what a phone's JPEG/video stores). */
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

function isCanvas(source: HTMLCanvasElement | PixelBuffer): source is HTMLCanvasElement {
  return typeof (source as HTMLCanvasElement).getContext === 'function'
}

/** Clamps to the image and rounds to whole pixels; null when nothing of the rectangle is inside the image. */
export function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height))
  if (!(x1 > x0) || !(y1 > y0)) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The central half of the frame in each direction (25% to 75%). */
export function centralRect(width: number, height: number): Rect {
  return { x: width * 0.25, y: height * 0.25, width: width * 0.5, height: height * 0.5 }
}

interface Pixels {
  /** RGBA, row-major, width × height of `rect`. */
  data: ArrayLike<number>
  rect: Rect
}

/** The pixels of `rect`, read once from the canvas or the buffer (which may be a bigger image: `rect` is in its coordinates). */
function readRegion(source: HTMLCanvasElement | PixelBuffer, rect: Rect): Pixels {
  if (isCanvas(source)) {
    const ctx = source.getContext('2d')
    if (!ctx) throw new Error('The canvas has no 2d context to read pixels from')
    return { data: ctx.getImageData(rect.x, rect.y, rect.width, rect.height).data, rect }
  }
  const { data, width } = source
  const out = new Uint8ClampedArray(rect.width * rect.height * 4)
  for (let row = 0; row < rect.height; row++) {
    const from = ((rect.y + row) * width + rect.x) * 4
    for (let i = 0; i < rect.width * 4; i++) out[row * rect.width * 4 + i] = data[from + i] as number
  }
  return { data: out, rect }
}

function lumaAt(data: ArrayLike<number>, i: number): number {
  return LUMA_R * (data[i] as number) + LUMA_G * (data[i + 1] as number) + LUMA_B * (data[i + 2] as number)
}

/** Mean luma of a region read at full resolution (sampled on a grid when it is large). */
function meanLumaOf(px: Pixels): number {
  const { width, height } = px.rect
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)))
  let sum = 0
  let n = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      sum += lumaAt(px.data, (y * width + x) * 4)
      n++
    }
  }
  return n > 0 ? sum / n : 0
}

/** Area-averaged luma of the region, shrunk so its longest side is at most `maxSide`. Row-major Float32. */
function shrinkLuma(px: Pixels, maxSide: number): { luma: Float32Array; width: number; height: number } {
  const { width: w, height: h } = px.rect
  const scale = Math.min(1, maxSide / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  const luma = new Float32Array(tw * th)
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th))
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw))
      let sum = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += lumaAt(px.data, (y * w + x) * 4)
      luma[ty * tw + tx] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return { luma, width: tw, height: th }
}

/** 3×3 mean of the interior of the image (width−2 × height−2). Suppresses sensor noise before the Laplacian, which would otherwise count it as detail. */
export function boxBlur3(luma: ArrayLike<number>, width: number, height: number): { luma: Float32Array; width: number; height: number } {
  const w = Math.max(0, width - 2)
  const h = Math.max(0, height - 2)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = 0; dy < 3; dy++) {
        const row = (y + dy) * width + x
        sum += (luma[row] as number) + (luma[row + 1] as number) + (luma[row + 2] as number)
      }
      out[y * w + x] = sum / 9
    }
  }
  return { luma: out, width: w, height: h }
}

/** Variance of the 4-neighbour Laplacian over the interior of the image. 0 for an image too small to have one. */
export function laplacianVariance(luma: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap = (luma[i - 1] as number) + (luma[i + 1] as number) + (luma[i - width] as number) + (luma[i + width] as number) - 4 * (luma[i] as number)
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  const mean = sum / n
  return Math.max(0, sumSq / n - mean * mean)
}

/**
 * Sharpness, clipping, brightness percentiles and left/right brightness of a picture.
 *
 * `regions.face` is where to look (pass the face's bounding box when it is known); without it the central half of the
 * frame is used. Throws RangeError for an empty image.
 */
export function analyzePixels(source: HTMLCanvasElement | PixelBuffer, regions: PixelRegions = {}): PixelStats {
  const { width, height } = source
  if (!(width > 0) || !(height > 0)) throw new RangeError('Cannot analyse an empty image')

  const face = clampRect(regions.face ?? centralRect(width, height), width, height) ?? { x: 0, y: 0, width, height }
  const pixels = readRegion(source, face)

  // Sharpness on the shrunk region.
  const small = shrinkLuma(pixels, SHARPNESS_MAX_SIDE)
  const smooth = boxBlur3(small.luma, small.width, small.height)
  const sharpness = laplacianVariance(smooth.luma, smooth.width, smooth.height)

  // Clipping, mean and percentiles at full resolution (sampled): averaging first would hide a few blown pixels.
  const step = Math.max(1, Math.ceil(Math.sqrt((face.width * face.height) / MAX_SAMPLES)))
  const histogram = new Uint32Array(256)
  let sum = 0
  let clipped = 0
  let n = 0
  for (let y = 0; y < face.height; y += step) {
    for (let x = 0; x < face.width; x += step) {
      const luma = lumaAt(pixels.data, (y * face.width + x) * 4)
      histogram[Math.min(255, Math.round(luma))]!++
      sum += luma
      if (luma >= CLIP_LUMA) clipped++
      n++
    }
  }
  const percentile = (p: number): number => {
    const target = p * n
    let seen = 0
    for (let level = 0; level < 256; level++) {
      seen += histogram[level] as number
      if (seen >= target) return level
    }
    return 255
  }

  // Left / right halves: the rectangles given, else the two halves of the face region.
  const half = (given: Rect | undefined, fallback: Rect): number =>
    meanLumaOf(readRegion(source, (given ? clampRect(given, width, height) : null) ?? fallback))
  const mid = Math.floor(face.width / 2)
  const leftHalf = clampRect({ ...face, width: Math.max(1, mid) }, width, height) ?? face
  const rightHalf = clampRect({ ...face, x: face.x + mid, width: Math.max(1, face.width - mid) }, width, height) ?? face

  return {
    sharpness,
    clippedShare: n > 0 ? clipped / n : 0,
    meanLuma: n > 0 ? sum / n : 0,
    lumaP5: percentile(0.05),
    lumaP95: percentile(0.95),
    leftLuma: half(regions.left, leftHalf),
    rightLuma: half(regions.right, rightHalf),
  }
}
