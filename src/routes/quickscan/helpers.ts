import type { CameraErrorCode } from '../../capture'
import type { ImportErrorCode } from '../../capture/importPhoto'
import type { FrameQc, QcCheck } from '../../domain/types'
import type { NamedPoints } from '../../vision/types'

/** Plain messages for each way the camera can fail. */
export const CAMERA_MESSAGE: Record<CameraErrorCode, string> = {
  denied: 'Camera access was refused. Allow the camera for this app in the browser or phone settings, then try again. Nothing is recorded or sent anywhere.',
  no_camera: 'No camera was found on this device. Use "Upload a photo instead".',
  in_use: 'The camera is busy in another app or tab. Close it there and try again.',
  insecure: 'The camera only works on a secure (https) page. Open the app from its normal address.',
  unknown: 'The camera could not be started. Try again, or use "Upload a photo instead".',
}

export const IMPORT_MESSAGE: Record<ImportErrorCode, string> = {
  empty: 'That file is empty.',
  heic_unsupported: 'This browser cannot read that photo format. On an iPhone set Settings > Camera > Formats > Most Compatible, or choose a JPEG.',
  unreadable: 'That file could not be read as a photo. Choose a JPEG or PNG.',
}

export const CHECK_LABEL: Record<QcCheck['id'], string> = {
  face: 'Face',
  yaw: 'Turn',
  roll: 'Tilt',
  pitch: 'Chin',
  distance: 'Distance',
  centered: 'Centred',
  sharpness: 'Sharp',
  exposure: 'Light',
  expression: 'Neutral face',
  lighting: 'Even light',
  steady: 'Steady',
}

/** The first check that failed, in the order a person should fix things. */
export function firstFailing(qc: FrameQc | null): QcCheck | null {
  return qc?.checks.find((c) => !c.ok) ?? null
}

/** Scales every named point by k (the live checks read pixels from a shrunken copy of the frame). */
export function scaleNamed(named: NamedPoints, k: number): NamedPoints {
  const out = {} as Record<string, { x: number; y: number }>
  for (const [name, p] of Object.entries(named)) out[name] = { x: p.x * k, y: p.y * k }
  return out as unknown as NamedPoints
}

/**
 * Tracks how long every check has been green without a break. progress 0..1; `ready` once it has held for holdMs.
 * A single failing frame resets it: auto-capture must only fire on a steady, correct pose.
 */
export function createStableTracker(holdMs: number) {
  let since: number | null = null
  return {
    update(ok: boolean, nowMs: number): { progress: number; ready: boolean } {
      if (!ok) {
        since = null
        return { progress: 0, ready: false }
      }
      if (since === null) since = nowMs
      const progress = Math.min(1, (nowMs - since) / holdMs)
      return { progress, ready: progress >= 1 }
    },
    reset() {
      since = null
    },
  }
}

/** "tomorrow at 00:00" style text for when the daily limit opens. */
export function nextAllowedText(ts: number | null): string {
  if (ts === null) return 'tomorrow'
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(ts)
  } catch {
    return 'tomorrow'
  }
}
