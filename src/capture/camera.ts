/**
 * Camera access for the capture screens. Video only, never audio: the page's Content-Security-Policy cannot block the
 * microphone, so this file never asks for it and tests/unit/source-lint.test.ts fails the build if any file outside the
 * voice module does.
 *
 * Every stream this file opens is handed back inside a CameraHandle whose stop() ends all its tracks; every path that
 * abandons a stream (a failed lens switch, a failed attach) stops it first.
 */

export type CameraErrorCode = 'denied' | 'no_camera' | 'in_use' | 'insecure' | 'unknown'

const MESSAGES: Record<CameraErrorCode, string> = {
  denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then reload the page.',
  no_camera: 'No camera was found on this device (or none matches what the scan needs).',
  in_use: 'The camera could not start. Another app may be using it: close other apps that use the camera and try again.',
  insecure: 'The camera only works on a secure page (https). Open the installed app or the https address.',
  unknown: 'The camera failed to start for an unknown reason. Reload the page and try again.',
}

export class CameraError extends Error {
  readonly code: CameraErrorCode
  constructor(code: CameraErrorCode, cause?: unknown, message?: string) {
    super(message ?? MESSAGES[code])
    this.name = 'CameraError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Maps what getUserMedia throws (a DOMException name) to a CameraError with a plain message. Never throws. */
export function mapCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraError(isInsecure() ? 'insecure' : 'denied', error)
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new CameraError('no_camera', error)
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('in_use', error)
    default:
      return new CameraError('unknown', error)
  }
}

function isInsecure(): boolean {
  return typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext
}

export interface OpenCameraOptions {
  facing: 'user' | 'environment'
  /** On the rear camera, switch to the telephoto lens when the device lists one (a longer lens distorts a face less at the same framing). */
  preferTelephoto?: boolean
  /** Ideal width of the longer side in pixels. Default 1920. */
  idealWidth?: number
}

export interface CameraHandle {
  stream: MediaStream
  track: MediaStreamTrack
  /** The device's own name for the lens, e.g. "Back Telephoto Camera". Empty if the browser gives none. */
  label: string
  /** What the camera actually delivers (width, height, frame rate, device id). */
  settings: MediaTrackSettings
  /** Ends every track. Safe to call twice. */
  stop(): void
}

export const DEFAULT_IDEAL_WIDTH = 1920

/** getUserMedia constraints: video only, the facing mode as a preference, and the highest sensible resolution as a preference. */
export function buildConstraints(opts: OpenCameraOptions, deviceId?: string): MediaStreamConstraints {
  const width = opts.idealWidth ?? DEFAULT_IDEAL_WIDTH
  const video: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: Math.round((width * 9) / 16) },
  }
  if (deviceId) video.deviceId = { exact: deviceId }
  else video.facingMode = { ideal: opts.facing }
  return { video, audio: false }
}

/** Looser constraints for browsers that reject a size preference outright. */
function relaxedConstraints(opts: OpenCameraOptions): MediaStreamConstraints {
  return { video: { facingMode: { ideal: opts.facing } }, audio: false }
}

/**
 * The deviceId of a rear telephoto lens among the listed cameras, or null. Labels are only filled in after permission was
 * granted, which is why this runs on the devices listed once a stream is open. "Back Telephoto Camera" is how iOS names it;
 * other platforms use "tele" in a label.
 */
export function pickTelephoto(devices: readonly Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]): string | null {
  const tele = devices.find((d) => d.kind === 'videoinput' && d.deviceId !== '' && /tele/i.test(d.label) && !/front|user|face/i.test(d.label))
  return tele ? tele.deviceId : null
}

function mediaDevices(): MediaDevices {
  if (isInsecure()) throw new CameraError('insecure')
  const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!md || typeof md.getUserMedia !== 'function') throw new CameraError(isInsecure() ? 'insecure' : 'no_camera')
  return md
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}

/** Asks for the stream; on a size/constraint rejection retries once with only the facing preference. */
async function requestStream(md: MediaDevices, opts: OpenCameraOptions): Promise<MediaStream> {
  try {
    return await md.getUserMedia(buildConstraints(opts))
  } catch (error) {
    const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
    if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') throw mapCameraError(error)
  }
  try {
    return await md.getUserMedia(relaxedConstraints(opts))
  } catch (error) {
    throw mapCameraError(error)
  }
}

/** Replaces `stream` with the telephoto lens when one exists and opens; keeps (or reopens) the original otherwise. */
async function useTelephoto(md: MediaDevices, stream: MediaStream, opts: OpenCameraOptions): Promise<MediaStream> {
  const id = await md.enumerateDevices().then(pickTelephoto, () => null)
  const current = stream.getVideoTracks()[0]?.getSettings().deviceId
  if (id === null || id === current) return stream

  // One camera at a time: some phones end the first stream when a second lens starts.
  stopStream(stream)
  try {
    return await md.getUserMedia(buildConstraints(opts, id))
  } catch {
    return requestStream(md, opts)
  }
}

export async function openCamera(opts: OpenCameraOptions): Promise<CameraHandle> {
  const md = mediaDevices()
  let stream = await requestStream(md, opts)
  try {
    if (opts.preferTelephoto && opts.facing === 'environment') stream = await useTelephoto(md, stream, opts)
    const track = stream.getVideoTracks()[0]
    if (!track) throw new CameraError('no_camera')
    const opened = stream
    let stopped = false
    return {
      stream: opened,
      track,
      label: track.label,
      settings: track.getSettings(),
      stop() {
        if (stopped) return
        stopped = true
        stopStream(opened)
      },
    }
  } catch (error) {
    stopStream(stream)
    throw mapCameraError(error)
  }
}

/**
 * Shows a stream in a <video> the way iOS Safari needs it: muted, inline (no full-screen takeover), then play(). Call it
 * from the tap that started the camera: Safari refuses to start video outside a user gesture. Rejects with a CameraError.
 */
export async function attachToVideo(video: HTMLVideoElement, handle: CameraHandle): Promise<void> {
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('muted', '')
  video.srcObject = handle.stream
  try {
    await video.play()
  } catch (error) {
    // NotAllowedError here is the autoplay policy (no tap behind this call), not a refused camera permission.
    throw new CameraError('unknown', error, 'The camera preview could not start. Tap the button again to start it.')
  }
}
