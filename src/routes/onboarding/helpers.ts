import type { Units } from '../../types'

export const MIN_HEIGHT_CM = 120
export const MAX_HEIGHT_CM = 230
const CM_PER_INCH = 2.54

export interface FtIn {
  ft: number
  inches: number
}

/** Whole inches, 12 inches carry into feet: 180 cm is 5 ft 11 in. */
export function cmToFtIn(cm: number): FtIn {
  const totalInches = Math.round(cm / CM_PER_INCH)
  return { ft: Math.floor(totalInches / 12), inches: totalInches % 12 }
}

/** Inches may be fractional. Result is rounded to 0.1 cm. */
export function ftInToCm(ft: number, inches: number): number {
  return Math.round((ft * 12 + inches) * CM_PER_INCH * 10) / 10
}

export function formatHeight(cm: number, units: Units): string {
  if (units === 'imperial') {
    const { ft, inches } = cmToFtIn(cm)
    return `${ft} ft ${inches} in`
  }
  return `${Math.round(cm * 10) / 10} cm`
}

/** Returns an error message, or null when the height is acceptable. Always judged in cm. */
export function validateHeightCm(cm: number | null): string | null {
  if (cm === null || !Number.isFinite(cm)) return 'Enter your height.'
  if (cm < MIN_HEIGHT_CM || cm > MAX_HEIGHT_CM) {
    return `Height must be between ${MIN_HEIGHT_CM} and ${MAX_HEIGHT_CM} cm (${formatHeight(MIN_HEIGHT_CM, 'imperial')} to ${formatHeight(MAX_HEIGHT_CM, 'imperial')}).`
  }
  return null
}

/** Height in cm from the two imperial inputs, or null when either is missing or invalid. */
export function imperialToCm(ft: number | null, inches: number | null): number | null {
  if (ft === null || inches === null) return null
  if (ft < 0 || inches < 0 || inches >= 12) return null
  return ftInToCm(ft, inches)
}

export interface NavigatorLike {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  standalone?: boolean
}

/** iPhone, iPod and iPad. iPadOS 13+ reports itself as a Mac, so a Mac with touch counts as iOS. */
export function detectIos(nav: NavigatorLike): boolean {
  const ua = nav.userAgent ?? ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1
}

export function detectStandalone(nav: NavigatorLike, displayModeStandalone: boolean): boolean {
  return nav.standalone === true || displayModeStandalone
}

export interface InstallState {
  ios: boolean
  standalone: boolean
  /** iOS in a Safari tab: storage is separate from the Home Screen app and can be deleted after 7 idle days. */
  blocked: boolean
}

export function installState(nav: NavigatorLike, displayModeStandalone: boolean): InstallState {
  const ios = detectIos(nav)
  const standalone = detectStandalone(nav, displayModeStandalone)
  return { ios, standalone, blocked: ios && !standalone }
}

export function readInstallState(): InstallState {
  if (typeof navigator === 'undefined') return { ios: false, standalone: false, blocked: false }
  let displayMode: boolean
  try {
    displayMode = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
  } catch {
    displayMode = false
  }
  return installState(navigator as NavigatorLike, displayMode)
}

export const STEP_NAMES = ['Promise', 'Install', 'Basics', 'Checklists', 'My stack', 'Storage', 'Done'] as const
export const STEP_KEY = 'onboardingStep'

export function clampStep(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0
  return Math.min(Math.max(value, 0), STEP_NAMES.length - 1)
}

export const PRIVACY_COPY: Record<string, { label: string; hint: string }> = {
  icloud_photos_off_or_separate_album: {
    label: 'iCloud Photos is off, or scan photos stay out of it',
    hint: 'If your camera photos sync to iCloud, your face photos leave this phone. Turn it off or keep scans out of the synced library.',
  },
  delete_source_photos_after_import: {
    label: 'I delete the original photo after importing it',
    hint: 'The app keeps a clean copy. The original stays in your photo library with its location data until you delete it.',
  },
  disk_encryption_on: {
    label: 'This device has a passcode, so its storage is encrypted',
    hint: 'Stored photos are only as safe as the device lock. No passcode means anyone holding the phone can open them.',
  },
  no_screenshots_in_synced_albums: {
    label: 'I do not screenshot results into synced albums',
    hint: 'A screenshot lands in your photo library and may sync. Keep results inside the app.',
  },
}

export const EQUIPMENT_COPY: Record<string, { label: string; hint: string }> = {
  phone_stand_or_tripod: {
    label: 'Phone stand or tripod',
    hint: 'A held phone moves. Moving changes the measurement, and you cannot tell real change from noise.',
  },
  grey_card_18pct: {
    label: '18 percent grey card',
    hint: 'Gives the app a neutral colour reference, so skin tone readings do not depend on your room light.',
  },
  soft_tape_measure: {
    label: 'Soft tape measure',
    hint: 'Waist, chest and neck are measured with tape, not estimated from a photo.',
  },
  bathroom_scale: {
    label: 'Bathroom scale',
    hint: 'Body weight feeds body fat and lean mass estimates. A trend over weeks matters, not one reading.',
  },
  plain_wall_and_window_light: {
    label: 'Plain wall and soft window light',
    hint: 'Even light and a plain background give the most repeatable photos. Harsh or mixed light hides detail.',
  },
}
