import { describe, expect, it } from 'vitest'
import {
  clampStep,
  cmToFtIn,
  detectIos,
  detectStandalone,
  formatHeight,
  ftInToCm,
  imperialToCm,
  installState,
  validateHeightCm,
} from '../../src/routes/onboarding/helpers'

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

describe('height conversion', () => {
  it('converts cm to feet and inches with carry', () => {
    expect(cmToFtIn(180)).toEqual({ ft: 5, inches: 11 })
    expect(cmToFtIn(182.88)).toEqual({ ft: 6, inches: 0 })
    expect(cmToFtIn(152.4)).toEqual({ ft: 5, inches: 0 })
  })

  it('converts feet and inches to cm rounded to 0.1', () => {
    expect(ftInToCm(6, 0)).toBe(182.9)
    expect(ftInToCm(5, 11)).toBe(180.3)
    expect(ftInToCm(5, 9.5)).toBe(176.5)
  })

  it('round trips within half an inch', () => {
    for (let cm = 120; cm <= 230; cm += 1) {
      const { ft, inches } = cmToFtIn(cm)
      expect(Math.abs(ftInToCm(ft, inches) - cm)).toBeLessThanOrEqual(1.4)
    }
  })

  it('formats both unit systems', () => {
    expect(formatHeight(180, 'metric')).toBe('180 cm')
    expect(formatHeight(180.25, 'metric')).toBe('180.3 cm')
    expect(formatHeight(180, 'imperial')).toBe('5 ft 11 in')
  })

  it('validates 120 to 230 cm', () => {
    expect(validateHeightCm(120)).toBeNull()
    expect(validateHeightCm(230)).toBeNull()
    expect(validateHeightCm(119.9)).toMatch(/between 120 and 230/)
    expect(validateHeightCm(231)).not.toBeNull()
    expect(validateHeightCm(null)).toBe('Enter your height.')
    expect(validateHeightCm(Number.NaN)).not.toBeNull()
  })

  it('rejects incomplete or impossible imperial input', () => {
    expect(imperialToCm(null, 5)).toBeNull()
    expect(imperialToCm(5, null)).toBeNull()
    expect(imperialToCm(5, 12)).toBeNull()
    expect(imperialToCm(-1, 3)).toBeNull()
    expect(imperialToCm(5, 10)).toBe(177.8)
  })
})

describe('install detection', () => {
  it('detects iPhone and iPad user agents', () => {
    expect(detectIos({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
    expect(detectIos({ userAgent: 'iPad', platform: 'iPad' })).toBe(true)
  })

  it('detects iPadOS that reports as a Mac, but not a real Mac', () => {
    expect(detectIos({ userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(detectIos({ userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(detectIos({ userAgent: WIN_UA, platform: 'Win32', maxTouchPoints: 10 })).toBe(false)
    expect(detectIos({})).toBe(false)
  })

  it('detects standalone from navigator.standalone or display-mode', () => {
    expect(detectStandalone({ standalone: true }, false)).toBe(true)
    expect(detectStandalone({}, true)).toBe(true)
    expect(detectStandalone({ standalone: false }, false)).toBe(false)
  })

  it('blocks only iOS outside the Home Screen app', () => {
    const phone = { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 }
    expect(installState(phone, false)).toEqual({ ios: true, standalone: false, blocked: true })
    expect(installState({ ...phone, standalone: true }, false).blocked).toBe(false)
    expect(installState(phone, true).blocked).toBe(false)
    expect(installState({ userAgent: WIN_UA, platform: 'Win32' }, false)).toEqual({ ios: false, standalone: false, blocked: false })
  })
})

describe('resume step', () => {
  it('clamps stored values', () => {
    expect(clampStep(undefined)).toBe(0)
    expect(clampStep('3')).toBe(0)
    expect(clampStep(2.5)).toBe(0)
    expect(clampStep(-4)).toBe(0)
    expect(clampStep(99)).toBe(6)
    expect(clampStep(4)).toBe(4)
  })
})
