import { describe, expect, it } from 'vitest'
import { QC_LIMITS, evaluateFrameQc } from '../../src/capture/qc'
import { CLIP_LUMA, SHARPNESS_MAX_SIDE, analyzePixels, boxBlur3, centralRect, clampRect, laplacianVariance } from '../../src/capture/pixels'
import type { PixelBuffer } from '../../src/capture/pixels'
import { blurred, makeBuffer, makeFrame, seeded } from './capture-frames'

/** Random grey cells: plenty of edges, like the features of a face. */
function texture(size: number, cells = 32, seed = 7): PixelBuffer {
  const rand = seeded(seed)
  const grid = Array.from({ length: cells * cells }, () => 60 + Math.floor(rand() * 140))
  return makeBuffer(size, size, (x, y) => grid[Math.floor((y * cells) / size) * cells + Math.floor((x * cells) / size)] as number)
}

describe('laplacianVariance and boxBlur3', () => {
  it('is zero for a flat image and for one too small to have an interior', () => {
    expect(laplacianVariance(new Float32Array(100).fill(90), 10, 10)).toBe(0)
    expect(laplacianVariance(new Float32Array(4), 2, 2)).toBe(0)
  })

  it('is 1020² for a 0/255 checkerboard (every interior response is ±1020)', () => {
    const w = 8
    const luma = Float32Array.from({ length: w * w }, (_, i) => ((i % w) + Math.floor(i / w)) % 2 === 0 ? 255 : 0)
    expect(laplacianVariance(luma, w, w)).toBeCloseTo(1020 * 1020, 3)
  })

  it('boxBlur3 returns the interior, averaged', () => {
    const out = boxBlur3(Float32Array.from({ length: 25 }, (_, i) => i), 5, 5)
    expect([out.width, out.height]).toEqual([3, 3])
    expect(out.luma[0]).toBeCloseTo(6) // mean of rows 0–2, cols 0–2 of 0..24
    expect(out.luma[4]).toBeCloseTo(12)
  })
})

describe('analyzePixels: sharpness', () => {
  it('rates a textured image sharp, a flat one zero, and the same image blurred far lower', () => {
    const sharp = analyzePixels(texture(128), { face: { x: 0, y: 0, width: 128, height: 128 } }).sharpness
    const soft = analyzePixels(blurred(texture(128), 3, 3), { face: { x: 0, y: 0, width: 128, height: 128 } }).sharpness
    const flat = analyzePixels(makeBuffer(128, 128, () => 120), { face: { x: 0, y: 0, width: 128, height: 128 } }).sharpness
    expect(flat).toBe(0)
    expect(sharp).toBeGreaterThan(QC_LIMITS.minSharpness * 10)
    expect(soft).toBeLessThan(QC_LIMITS.minSharpness)
    expect(soft).toBeLessThan(sharp / 20)
  })

  it('is blurrier-is-lower at every blur step', () => {
    const values = [0, 1, 2, 3].map((radius) => {
      const image = radius === 0 ? texture(96) : blurred(texture(96), radius, 2)
      return analyzePixels(image, { face: { x: 0, y: 0, width: 96, height: 96 } }).sharpness
    })
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1] as number)
  })

  it('does not depend on the resolution of a large region: the same scene at 256 and at 1024 px agrees', () => {
    const whole = (n: number) => ({ face: { x: 0, y: 0, width: n, height: n } })
    const small = analyzePixels(texture(SHARPNESS_MAX_SIDE), whole(SHARPNESS_MAX_SIDE)).sharpness
    const large = analyzePixels(texture(SHARPNESS_MAX_SIDE * 4), whole(SHARPNESS_MAX_SIDE * 4)).sharpness
    expect(large).toBeCloseTo(small, 6)
  })

  it('is not raised much by sensor noise (the 3×3 mean takes it out before the Laplacian)', () => {
    const rand = seeded(3)
    const base = texture(128)
    const noisy = makeBuffer(128, 128, (x, y) => {
      const g = base.data[(y * 128 + x) * 4] as number
      return g + (rand() + rand() + rand() - 1.5) * 8 // about 4 grey levels of noise
    })
    const flatNoisy = makeBuffer(128, 128, () => 120 + (rand() + rand() + rand() - 1.5) * 8)
    const region = { face: { x: 0, y: 0, width: 128, height: 128 } }
    // Noise on a flat grey must stay under the threshold, or noise alone would pass the sharpness check.
    expect(analyzePixels(flatNoisy, region).sharpness).toBeLessThan(QC_LIMITS.minSharpness)
    expect(analyzePixels(noisy, region).sharpness).toBeLessThan(analyzePixels(base, region).sharpness * 1.1)
  })

  it('looks only at the face region: texture outside it does not make a flat face sharp', () => {
    const image = makeBuffer(200, 200, (x, y) => (x < 100 ? 120 : ((x + y) % 4 < 2 ? 40 : 220)))
    expect(analyzePixels(image, { face: { x: 0, y: 0, width: 100, height: 200 } }).sharpness).toBe(0)
    expect(analyzePixels(image, { face: { x: 100, y: 0, width: 100, height: 200 } }).sharpness).toBeGreaterThan(QC_LIMITS.minSharpness)
  })

  it('defaults to the central half of the frame', () => {
    const rim = makeBuffer(200, 200, (x, y) => {
      const centre = x >= 50 && x < 150 && y >= 50 && y < 150
      return centre ? 120 : (x + y) % 4 < 2 ? 40 : 220
    })
    expect(analyzePixels(rim).sharpness).toBe(0)
    expect(centralRect(200, 100)).toEqual({ x: 50, y: 25, width: 100, height: 50 })
  })
})

describe('analyzePixels: exposure statistics', () => {
  const whole = (w: number, h: number) => ({ face: { x: 0, y: 0, width: w, height: h } })

  it('counts clipped highlights: a blown patch fails the exposure check, a fine picture passes', () => {
    const blown = makeBuffer(100, 100, (x) => (x < 5 ? 255 : 120)) // 5% white
    const fine = makeBuffer(100, 100, (x) => (x < 5 ? CLIP_LUMA - 20 : 120))
    expect(analyzePixels(blown, whole(100, 100)).clippedShare).toBeCloseTo(0.05, 4)
    expect(analyzePixels(fine, whole(100, 100)).clippedShare).toBe(0)

    const frame = makeFrame()
    const verdict = (stats: ReturnType<typeof analyzePixels>) =>
      evaluateFrameQc({ frame, pixels: stats, shot: 'frontal_neutral', imageWidth: 1920, imageHeight: 1080 }).checks.find((c) => c.id === 'exposure')
    expect(verdict(analyzePixels(blown, whole(100, 100)))?.ok).toBe(false)
    expect(verdict(analyzePixels(fine, whole(100, 100)))?.ok).toBe(true)
  })

  it('treats a luma of 250 as clipped and 249 as not', () => {
    expect(analyzePixels(makeBuffer(10, 10, () => CLIP_LUMA), whole(10, 10)).clippedShare).toBe(1)
    expect(analyzePixels(makeBuffer(10, 10, () => CLIP_LUMA - 1), whole(10, 10)).clippedShare).toBe(0)
  })

  it('reports mean and percentiles of a known gradient', () => {
    const gradient = makeBuffer(256, 8, (x) => x)
    const stats = analyzePixels(gradient, whole(256, 8))
    expect(stats.meanLuma).toBeCloseTo(127.5, 0)
    expect(stats.lumaP5).toBeGreaterThanOrEqual(11)
    expect(stats.lumaP5).toBeLessThanOrEqual(14)
    expect(stats.lumaP95).toBeGreaterThanOrEqual(241)
    expect(stats.lumaP95).toBeLessThanOrEqual(244)
  })

  it('weights green most when computing luma', () => {
    const red = analyzePixels(makeBuffer(8, 8, () => [255, 0, 0]), whole(8, 8)).meanLuma
    const green = analyzePixels(makeBuffer(8, 8, () => [0, 255, 0]), whole(8, 8)).meanLuma
    const blue = analyzePixels(makeBuffer(8, 8, () => [0, 0, 255]), whole(8, 8)).meanLuma
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
    expect(red + green + blue).toBeCloseTo(255, 0)
  })

  it('a dark picture has a low 95th percentile and fails the exposure check as too dark', () => {
    const dark = analyzePixels(makeBuffer(64, 64, () => 12), whole(64, 64))
    expect(dark.lumaP95).toBe(12)
    expect(dark.meanLuma).toBeCloseTo(12, 5)
    const check = evaluateFrameQc({ frame: makeFrame(), pixels: dark, shot: 'frontal_neutral', imageWidth: 1920, imageHeight: 1080 }).checks.find((c) => c.id === 'exposure')
    expect(check?.ok).toBe(false)
    expect(check?.hint).toMatch(/too dark/i)
  })
})

describe('analyzePixels: left and right of the face', () => {
  const whole = { face: { x: 0, y: 0, width: 100, height: 100 } }

  it('measures the two halves of the face region', () => {
    const sideLit = makeBuffer(100, 100, (x) => (x < 50 ? 200 : 80))
    const stats = analyzePixels(sideLit, whole)
    expect(stats.leftLuma).toBeCloseTo(200, 3)
    expect(stats.rightLuma).toBeCloseTo(80, 3)
  })

  it('uses the cheek rectangles when given', () => {
    const image = makeBuffer(100, 100, (x) => (x < 20 ? 30 : x >= 80 ? 220 : 100))
    const stats = analyzePixels(image, { ...whole, left: { x: 0, y: 0, width: 20, height: 100 }, right: { x: 80, y: 0, width: 20, height: 100 } })
    expect(stats.leftLuma).toBeCloseTo(30, 3)
    expect(stats.rightLuma).toBeCloseTo(220, 3)
  })

  it('side light fails the lighting check; even light passes', () => {
    const verdict = (x: ReturnType<typeof analyzePixels>) =>
      evaluateFrameQc({ frame: makeFrame(), pixels: x, shot: 'frontal_neutral', imageWidth: 1920, imageHeight: 1080 }).checks.find((c) => c.id === 'lighting')
    expect(verdict(analyzePixels(makeBuffer(100, 100, (x) => (x < 50 ? 200 : 80)), whole))?.ok).toBe(false)
    expect(verdict(analyzePixels(makeBuffer(100, 100, (x) => (x < 50 ? 140 : 132)), whole))?.ok).toBe(true)
  })
})

describe('analyzePixels: input handling', () => {
  it('throws RangeError for an empty image', () => {
    expect(() => analyzePixels({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toThrow(RangeError)
  })

  it('clamps a region that sticks out of the image, and falls back to the whole image when it is entirely outside', () => {
    const image = texture(64)
    expect(() => analyzePixels(image, { face: { x: -50, y: -50, width: 80, height: 80 } })).not.toThrow()
    expect(analyzePixels(image, { face: { x: 500, y: 500, width: 10, height: 10 } }).sharpness).toBeGreaterThan(0)
    expect(clampRect({ x: -5.5, y: 2.2, width: 20, height: 10 }, 10, 10)).toEqual({ x: 0, y: 2, width: 10, height: 8 })
    expect(clampRect({ x: 20, y: 0, width: 5, height: 5 }, 10, 10)).toBeNull()
  })

  it('reads a canvas through getImageData of the region only, and agrees with the buffer path', () => {
    const image = texture(64)
    const calls: number[][] = []
    const canvas = {
      width: 64,
      height: 64,
      getContext: () => ({
        getImageData: (x: number, y: number, w: number, h: number) => {
          calls.push([x, y, w, h])
          const data = new Uint8ClampedArray(w * h * 4)
          for (let row = 0; row < h; row++) for (let i = 0; i < w * 4; i++) data[row * w * 4 + i] = image.data[((y + row) * 64 + x) * 4 + i] as number
          return { data }
        },
      }),
    } as unknown as HTMLCanvasElement
    const region = { face: { x: 8, y: 8, width: 40, height: 40 } }
    const viaCanvas = analyzePixels(canvas, region)
    expect(calls[0]).toEqual([8, 8, 40, 40])
    expect(viaCanvas).toEqual(analyzePixels(image, region))
  })
})
