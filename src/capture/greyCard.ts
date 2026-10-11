/**
 * Grey-card white balance utilities (docs/PLAN.md §5: an 18% grey card at the chin). NOT wired into the UI in M1: no metric
 * reads colour yet, and the app refuses every colour metric without a card. They are here, tested, so that M2 can use them.
 *
 *   tapped point → median patch around it (per channel, in sRGB) → linear light → per-channel gains → neutral
 *
 * Gains are applied in LINEAR light. Scaling gamma-coded values would shift the grey axis instead of neutralising it.
 */
import { clampRect } from './pixels'
import type { PixelBuffer, Rect } from './pixels'

export type Rgb = readonly [number, number, number]

/** The grey-card white-balance error the protocol accepts (docs/PLAN.md §5: ΔE < 3). */
export const GREY_CARD_MAX_DELTA_E = 3

/** A channel at or above this (0–255) is clipped: its true value is unknown, so no gain can be derived. */
const CLIPPED_LEVEL = 250
/** A channel at or below this is too dark to carry a reliable ratio (sensor noise dominates). */
const DARK_LEVEL = 8

export interface GreyCardSample {
  /** Per-channel median of the patch, sRGB 0–255. */
  rgb: Rgb
  /** The same in linear light, 0–1. */
  linear: Rgb
  /** The patch that was read, in image pixels. */
  patch: Rect
  /** Why this patch cannot be a usable grey card, if so: a channel is blown out or too dark to read. */
  problem: 'clipped' | 'too_dark' | null
}

export function srgbToLinear(value255: number): number {
  const c = value255 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(linear: number): number {
  const c = Math.min(1, Math.max(0, linear))
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** Half-size of the sampled patch for an image of this size: 1% of the short side, at least 4 px (a 9×9 patch). */
export function defaultPatchRadius(width: number, height: number): number {
  return Math.max(4, Math.round(Math.min(width, height) * 0.01))
}

/**
 * Reads the grey card at a tapped point: the median of each channel over a square patch centred on it. The median ignores a
 * speck, a hair or an edge of the card inside the patch. Throws RangeError when the point is outside the image.
 */
export function sampleGreyCard(
  source: HTMLCanvasElement | PixelBuffer,
  point: { x: number; y: number },
  radiusPx?: number,
): GreyCardSample {
  const { width, height } = source
  const r = radiusPx ?? defaultPatchRadius(width, height)
  const patch = clampRect({ x: point.x - r, y: point.y - r, width: 2 * r + 1, height: 2 * r + 1 }, width, height)
  if (!(point.x >= 0 && point.x < width && point.y >= 0 && point.y < height) || !patch) {
    throw new RangeError('The tapped point is outside the image')
  }

  let data: ArrayLike<number>
  if (typeof (source as HTMLCanvasElement).getContext === 'function') {
    const ctx = (source as HTMLCanvasElement).getContext('2d')
    if (!ctx) throw new Error('The canvas has no 2d context to read pixels from')
    data = ctx.getImageData(patch.x, patch.y, patch.width, patch.height).data
  } else {
    const buffer = source as PixelBuffer
    const out = new Uint8ClampedArray(patch.width * patch.height * 4)
    for (let row = 0; row < patch.height; row++) {
      const from = ((patch.y + row) * width + patch.x) * 4
      for (let i = 0; i < patch.width * 4; i++) out[row * patch.width * 4 + i] = buffer.data[from + i] as number
    }
    data = out
  }

  const channels: number[][] = [[], [], []]
  for (let i = 0; i < patch.width * patch.height; i++) {
    for (let c = 0; c < 3; c++) (channels[c] as number[]).push(data[i * 4 + c] as number)
  }
  const rgb = channels.map(median) as unknown as [number, number, number]
  const linear = rgb.map(srgbToLinear) as unknown as [number, number, number]
  const problem = rgb.some((v) => v >= CLIPPED_LEVEL) ? 'clipped' : rgb.some((v) => v <= DARK_LEVEL) ? 'too_dark' : null
  return { rgb, linear, patch, problem }
}

export type GainAnchor = 'mean' | 'green' | number

/**
 * Per-channel gains (linear light) that turn the card's colour into a neutral grey.
 *
 * `anchor` decides which brightness the neutral grey keeps: 'mean' (default) the average of the three channels, so the
 * picture's overall brightness is unchanged; 'green' the green channel (gain 1); a number, a target linear level for the
 * card (e.g. 0.18 for an 18% card), which also corrects exposure. Throws RangeError for a channel that is not above zero.
 */
export function whiteBalanceGains(card: GreyCardSample | Rgb, anchor: GainAnchor = 'mean'): Rgb {
  const linear = Array.isArray(card) ? (card as Rgb) : (card as GreyCardSample).linear
  const [r, g, b] = linear
  if (!(r > 0) || !(g > 0) || !(b > 0)) throw new RangeError('A grey card needs every channel above zero to give gains')
  const target = anchor === 'mean' ? (r + g + b) / 3 : anchor === 'green' ? g : anchor
  if (!(target > 0)) throw new RangeError('The gain anchor must be above zero')
  return [target / r, target / g, target / b]
}

/** Applies gains to one sRGB pixel (0–255 per channel) in linear light and returns the corrected sRGB pixel. */
export function applyGains(rgb: Rgb, gains: Rgb): Rgb {
  return [0, 1, 2].map((c) => linearToSrgb(srgbToLinear(rgb[c] as number) * (gains[c] as number))) as unknown as [number, number, number]
}

/** CIE L*a*b* (D65) of a linear-light sRGB colour. */
export function linearToLab(linear: Rgb): [number, number, number] {
  const [r, g, b] = linear
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const fy = f(y)
  return [116 * fy - 16, 500 * (f(x) - fy), 200 * (fy - f(z))]
}

/**
 * How far the card's colour is from a neutral grey of the same lightness (CIE76 ΔE, which for a=b=0 is the chroma). The
 * protocol wants this under GREY_CARD_MAX_DELTA_E after correction; before correction it says how strong the colour cast is.
 */
export function greyCardDeltaE(card: GreyCardSample | Rgb): number {
  const linear = Array.isArray(card) ? (card as Rgb) : (card as GreyCardSample).linear
  const [, a, b] = linearToLab(linear)
  return Math.hypot(a, b)
}
