import { describe, expect, it } from 'vitest'
import {
  GREY_CARD_MAX_DELTA_E,
  applyGains,
  defaultPatchRadius,
  greyCardDeltaE,
  linearToLab,
  linearToSrgb,
  sampleGreyCard,
  srgbToLinear,
  whiteBalanceGains,
} from '../../src/capture/greyCard'
import { makeBuffer } from './capture-frames'

/** A picture that is `card` everywhere except a few outlier pixels. */
const cardImage = (card: [number, number, number], size = 100) => makeBuffer(size, size, () => card)

describe('sRGB ↔ linear', () => {
  it('maps the ends and the middle correctly and round-trips', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(255)).toBeCloseTo(1, 9)
    expect(srgbToLinear(128)).toBeCloseTo(0.2158, 3)
    expect(linearToSrgb(0.18)).toBeCloseTo(117.7, 0)
    for (const v of [0, 5, 40, 118, 200, 255]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6)
    expect(linearToSrgb(-1)).toBe(0)
    expect(linearToSrgb(2)).toBeCloseTo(255, 6)
  })
})

describe('sampleGreyCard', () => {
  it('returns the per-channel median of the patch around the tapped point, in sRGB and in linear light', () => {
    const sample = sampleGreyCard(cardImage([190, 170, 140]), { x: 50, y: 50 })
    expect(sample.rgb).toEqual([190, 170, 140])
    expect(sample.linear[0]).toBeCloseTo(srgbToLinear(190), 9)
    expect(sample.linear[2]).toBeCloseTo(srgbToLinear(140), 9)
    expect(sample.problem).toBeNull()
  })

  it('ignores specks, hairs and an edge of the card inside the patch (median, not mean)', () => {
    // Every 7th pixel is a hair-dark speck; the card colour must still come out.
    const image = makeBuffer(100, 100, (x, y) => ((x + y * 3) % 7 === 0 ? [10, 10, 10] : [150, 150, 150]))
    expect(sampleGreyCard(image, { x: 50, y: 50 }).rgb).toEqual([150, 150, 150])
    // A third of the patch is outside the card.
    const edge = makeBuffer(100, 100, (x) => (x < 46 ? [30, 30, 30] : [150, 150, 150]))
    expect(sampleGreyCard(edge, { x: 50, y: 50 }, 5).rgb).toEqual([150, 150, 150])
  })

  it('reads a patch whose size follows the image (1% of the short side, at least 9×9) or the radius given', () => {
    expect(defaultPatchRadius(100, 100)).toBe(4)
    expect(defaultPatchRadius(4000, 3000)).toBe(30)
    const sample = sampleGreyCard(cardImage([120, 120, 120], 100), { x: 50, y: 50 })
    expect(sample.patch).toEqual({ x: 46, y: 46, width: 9, height: 9 })
    expect(sampleGreyCard(cardImage([120, 120, 120]), { x: 50, y: 50 }, 10).patch.width).toBe(21)
  })

  it('clips the patch at the image border and refuses a tap outside the image', () => {
    const sample = sampleGreyCard(cardImage([120, 120, 120]), { x: 0, y: 99 })
    expect(sample.patch).toEqual({ x: 0, y: 95, width: 5, height: 5 })
    expect(() => sampleGreyCard(cardImage([120, 120, 120]), { x: -1, y: 5 })).toThrow(RangeError)
    expect(() => sampleGreyCard(cardImage([120, 120, 120]), { x: 5, y: 100 })).toThrow(RangeError)
  })

  it('flags a blown-out or too-dark patch, which cannot give reliable gains', () => {
    expect(sampleGreyCard(cardImage([255, 250, 252]), { x: 50, y: 50 }).problem).toBe('clipped')
    expect(sampleGreyCard(cardImage([4, 5, 3]), { x: 50, y: 50 }).problem).toBe('too_dark')
  })

  it('reads a canvas through getImageData of the patch only', () => {
    const calls: number[][] = []
    const canvas = {
      width: 100,
      height: 100,
      getContext: () => ({
        getImageData: (x: number, y: number, w: number, h: number) => {
          calls.push([x, y, w, h])
          return { data: makeBuffer(w, h, () => [100, 110, 120]).data }
        },
      }),
    } as unknown as HTMLCanvasElement
    expect(sampleGreyCard(canvas, { x: 50, y: 50 }).rgb).toEqual([100, 110, 120])
    expect(calls).toEqual([[46, 46, 9, 9]])
  })
})

describe('whiteBalanceGains', () => {
  const warm = sampleGreyCard(cardImage([200, 180, 150]), { x: 50, y: 50 })

  it('gains that turn the card neutral (anchored on the mean by default: overall brightness stays)', () => {
    const gains = whiteBalanceGains(warm)
    const [r, g, b] = warm.linear
    expect(gains[0] * r).toBeCloseTo(gains[1] * g, 9)
    expect(gains[1] * g).toBeCloseTo(gains[2] * b, 9)
    expect((gains[0] * r + gains[1] * g + gains[2] * b) / 3).toBeCloseTo((r + g + b) / 3, 9)
    // The red channel is too strong on a warm card, so it is turned down and blue turned up.
    expect(gains[0]).toBeLessThan(1)
    expect(gains[2]).toBeGreaterThan(1)
  })

  it('a corrected card is neutral in sRGB, and its ΔE falls from visible to under the protocol limit', () => {
    const corrected = applyGains(warm.rgb, whiteBalanceGains(warm))
    expect(Math.max(...corrected) - Math.min(...corrected)).toBeLessThan(0.5)
    const before = greyCardDeltaE(warm)
    expect(before).toBeGreaterThan(GREY_CARD_MAX_DELTA_E)
    expect(greyCardDeltaE(corrected.map(srgbToLinear) as unknown as [number, number, number])).toBeLessThan(0.1)
  })

  it('anchors on green (gain 1) or on a target level such as 18% when asked', () => {
    expect(whiteBalanceGains(warm, 'green')[1]).toBeCloseTo(1, 9)
    const toEighteen = whiteBalanceGains(warm, 0.18)
    for (let c = 0; c < 3; c++) expect(toEighteen[c]! * warm.linear[c]!).toBeCloseTo(0.18, 9)
  })

  it('accepts bare linear values, and a card that is already neutral gets gains of 1', () => {
    const neutral = sampleGreyCard(cardImage([128, 128, 128]), { x: 50, y: 50 })
    for (const g of whiteBalanceGains(neutral)) expect(g).toBeCloseTo(1, 9)
    for (const g of whiteBalanceGains([0.2, 0.2, 0.2])) expect(g).toBeCloseTo(1, 12)
    expect(greyCardDeltaE(neutral)).toBeLessThan(0.05)
  })

  it('refuses to derive gains from a channel that is zero or a bad anchor', () => {
    expect(() => whiteBalanceGains([0, 0.2, 0.2])).toThrow(RangeError)
    expect(() => whiteBalanceGains([0.2, 0.2, 0.2], 0)).toThrow(RangeError)
  })
})

describe('Lab / ΔE', () => {
  it('white is L 100 with no chroma and mid grey has none either', () => {
    const [L, a, b] = linearToLab([1, 1, 1])
    expect(L).toBeCloseTo(100, 1)
    expect(Math.hypot(a, b)).toBeLessThan(0.05)
    expect(Math.hypot(...linearToLab([0.18, 0.18, 0.18]).slice(1) as [number, number])).toBeLessThan(0.05)
  })

  it('a strong cast is a large ΔE', () => {
    expect(greyCardDeltaE([0.3, 0.2, 0.1])).toBeGreaterThan(20)
  })
})
