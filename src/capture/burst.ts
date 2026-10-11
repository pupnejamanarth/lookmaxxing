/**
 * Burst capture: grab a few frames from the live video, run the face detector and the quality checks on each, keep the
 * frames that pass, and hand back the best one as a clean JPEG together with the numbers a measurement needs.
 *
 * The pixels the detector saw, the pixels the checks measured and the pixels in the JPEG are the SAME canvas snapshot of
 * one video frame, so what is checked is exactly what is stored. The video is drawn as it comes from the camera: the
 * JPEG is NOT mirrored even when the live preview is (a mirrored preview is a CSS transform on the <video>, not on its pixels).
 *
 * The decisions (which frames are kept, which is best, how much the frames disagree, the record of the shot) are pure
 * functions below so they are tested without a camera.
 */
import { dist, midpoint } from '../vision'
import type { FaceDetector, FaceFrame, NamedPoints } from '../vision'
import type { ShotType } from '../catalog/schema'
import type { FrameQc, ShotQc } from '../domain/types'
import { encodeJpeg } from './metadata'
import { analyzePixels } from './pixels'
import { distanceFromIris, evaluateFrameQc, faceRegions, steadyCheck, worstChecks } from './qc'

export const DEFAULT_BURST_FRAMES = 5
/** Pause between grabbed frames, ms: long enough for the camera to deliver a new frame (30 fps = 33 ms) and to let the UI repaint. */
export const DEFAULT_BURST_INTERVAL_MS = 150

/** Head-pose sums (degrees) closer than this are a tie, and the sharper frame wins: below it the difference is detector noise. */
export const POSE_TIE_DEG = 0.5

export interface BurstResult {
  /** Every frame in which a face was found, in capture order, with its quality checks. Frames without a face are only counted in shotQc.framesTried. */
  frames: { frame: FaceFrame; qc: FrameQc }[]
  /** Indexes into `frames` of those that passed every check. */
  keptIndexes: number[]
  /** Index into `frames` of the best frame; -1 when no face was found in any frame. */
  bestIndex: number
  shotQc: ShotQc
  /** The best frame as a JPEG, metadata-free and not mirrored. When no frame passed it is the closest to passing; when no face was found, the last frame grabbed. */
  jpeg: Blob
  width: number
  height: number
}

export interface CaptureBurstArgs {
  video: HTMLVideoElement
  detector: FaceDetector
  shot: ShotType
  /** Frames to grab. Default 5. */
  frames?: number
  /** Pause between frames in ms. Default 150. */
  intervalMs?: number
  /** Iris diameter in px of the user's last accepted scan; the distance must then match within ±5%. */
  baselineIrisPx?: number | null
  /** Called after each frame with the number of frames done. */
  onProgress?(n: number): void
  /** Aborting rejects with the signal's reason and releases every frame. */
  signal?: AbortSignal
}

// ───────────────────────────── pure decisions ─────────────────────────────

/** One analysed frame with the picture sharpness of its face (the tie-breaker). */
export interface BurstSample {
  frame: FaceFrame
  qc: FrameQc
  sharpness: number
}

const poseSum = (frame: FaceFrame): number => {
  const sum = Math.abs(frame.pose.yaw) + Math.abs(frame.pose.roll) + Math.abs(frame.pose.pitch)
  return Number.isFinite(sum) ? sum : Number.POSITIVE_INFINITY
}

/**
 * Which frames are kept (all checks pass) and which is best: the smallest |yaw|+|roll|+|pitch|, and among frames within
 * POSE_TIE_DEG of it the sharpest. When no frame passes, the "best" is chosen among the frames that failed the fewest
 * checks, so the stored photo is the closest one to acceptable. Empty input gives bestIndex -1.
 */
export function selectFrames(samples: readonly BurstSample[]): { keptIndexes: number[]; bestIndex: number } {
  const keptIndexes = samples.flatMap((s, i) => (s.qc.allOk ? [i] : []))
  let pool = keptIndexes
  if (pool.length === 0) {
    const failures = (i: number) => (samples[i] as BurstSample).qc.checks.filter((c) => !c.ok).length
    const fewest = Math.min(...samples.map((_, i) => failures(i)))
    pool = samples.flatMap((_, i) => (failures(i) === fewest ? [i] : []))
  }
  if (pool.length === 0) return { keptIndexes, bestIndex: -1 }

  const bestPose = Math.min(...pool.map((i) => poseSum((samples[i] as BurstSample).frame)))
  const tied = pool.filter((i) => poseSum((samples[i] as BurstSample).frame) <= bestPose + POSE_TIE_DEG)
  const bestIndex = tied.reduce((best, i) => ((samples[i] as BurstSample).sharpness > (samples[best] as BurstSample).sharpness ? i : best))
  return { keptIndexes, bestIndex }
}

/** Distances between landmarks that the frontal metrics are built from, each divided by the pupil distance. */
function keyDistances(named: NamedPoints): number[] {
  const ipd = dist(named.pupilL, named.pupilR)
  const eyeMid = midpoint(named.pupilL, named.pupilR)
  return [
    dist(named.zygionL, named.zygionR),
    dist(named.alarL, named.alarR),
    dist(named.cheilionL, named.cheilionR),
    dist(named.gonionL, named.gonionR),
    dist(eyeMid, named.chinTip),
    dist(named.nasion, named.subnasale),
  ].map((d) => d / ipd)
}

const medianOf = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/**
 * How much the frames of a burst disagree: for each key distance (face width, nose width, mouth width, jaw width, eye-to-chin
 * height, nasion-to-subnasale), divided by the pupil distance so that the picture's scale drops out, the range (max − min)
 * across frames; the MEDIAN of those ranges. A fraction of the pupil distance (0.02 = 2%). Median, not maximum, so one jumpy
 * landmark does not fail a burst in which the face itself held still. null when fewer than 2 frames, or a point is not a number.
 */
export function burstSpread(frames: readonly FaceFrame[]): number | null {
  if (frames.length < 2) return null
  const rows = frames.map((f) => keyDistances(f.named))
  if (!rows.every((row) => row.every(Number.isFinite))) return null
  const ranges = (rows[0] as number[]).map((_, k) => {
    const column = rows.map((row) => row[k] as number)
    return Math.max(...column) - Math.min(...column)
  })
  return medianOf(ranges)
}

export interface BuildShotQcArgs {
  shot: ShotType
  framesTried: number
  /** Frames with a face, in capture order. */
  samples: readonly BurstSample[]
  keptIndexes: readonly number[]
  /** QC results of frames in which no face was found (every check fails there). */
  faceless: readonly FrameQc[]
}

/** Dimensions the distance estimate needs: the frame the iris was measured in. */
export interface FrameSize {
  width: number
  height: number
}

/**
 * The record of a shot. Checks are the worst of each across the kept frames (across all frames when none was kept, so the
 * record says what went wrong), plus the burst-agreement check (not for a single still). Iris size and distance are the median of the same frames.
 */
export function buildShotQc(args: BuildShotQcArgs, size: FrameSize): ShotQc {
  const kept = args.keptIndexes.map((i) => args.samples[i] as BurstSample)
  const basis = kept.length > 0 ? kept : [...args.samples]
  const qcs = kept.length > 0 ? kept.map((s) => s.qc) : [...args.samples.map((s) => s.qc), ...args.faceless]

  const spread = burstSpread(kept.map((s) => s.frame))
  const iris = basis.length > 0 ? medianOf(basis.map((s) => s.frame.irisPx).filter((v) => Number.isFinite(v) && v > 0)) : Number.NaN
  const metres = Number.isFinite(iris) ? distanceFromIris(iris, size.width, size.height) : Number.NaN

  return {
    shot: args.shot,
    framesTried: args.framesTried,
    framesKept: kept.length,
    // A single still has no burst to agree with: steadiness only exists for two or more frames.
    checks: [...worstChecks(qcs), ...(args.framesTried > 1 ? [steadyCheck(spread)] : [])],
    burstSpread: spread,
    estimatedDistanceM: Number.isFinite(metres) ? metres : null,
    irisPx: Number.isFinite(iris) ? iris : null,
    greyCard: false,
  }
}

// ───────────────────────────── the camera side ─────────────────────────────

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The capture was cancelled.', 'AbortError')
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('The capture was cancelled.', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('The capture was cancelled.', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Video-mode detectors need timestamps that strictly increase; wall-clock ms with a +1 floor per detector. */
const lastTimestamp = new WeakMap<FaceDetector, number>()
function nextTimestamp(detector: FaceDetector): number {
  const t = Math.max(performance.now(), (lastTimestamp.get(detector) ?? 0) + 1)
  lastTimestamp.set(detector, t)
  return t
}

/** A snapshot of the current video frame, raw (not mirrored), at the camera's own resolution. */
function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const width = video.videoWidth
  const height = video.videoHeight
  if (video.readyState < 2 || !(width > 0) || !(height > 0)) {
    throw new Error('The camera has not produced a picture yet. Wait for the preview to appear, then try again.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser did not provide a 2d canvas.')
  ctx.drawImage(video, 0, 0, width, height)
  return canvas
}

/** Frees a canvas's pixel memory now (Safari keeps it until garbage collection otherwise). */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

interface CanvasAnalysis {
  frame: FaceFrame | null
  qc: FrameQc
  sharpness: number
}

/** Detector + pixel statistics + quality checks on one canvas. */
function analyzeCanvas(canvas: HTMLCanvasElement, detector: FaceDetector, shot: ShotType, baselineIrisPx: number | null): CanvasAnalysis {
  const frame = detector.detect(canvas, nextTimestamp(detector))
  const regions = frame ? faceRegions(frame.named, canvas.width, canvas.height) : null
  const pixels = analyzePixels(canvas, regions ?? {})
  const qc = evaluateFrameQc({ frame, pixels, shot, imageWidth: canvas.width, imageHeight: canvas.height, baselineIrisPx })
  return { frame, qc, sharpness: pixels.sharpness }
}

export async function captureBurst(args: CaptureBurstArgs): Promise<BurstResult> {
  const { video, detector, shot, signal, onProgress } = args
  const count = Math.max(1, Math.floor(args.frames ?? DEFAULT_BURST_FRAMES))
  const intervalMs = Math.max(0, args.intervalMs ?? DEFAULT_BURST_INTERVAL_MS)
  const baselineIrisPx = args.baselineIrisPx ?? null

  throwIfAborted(signal)
  await detector.ready()

  const samples: BurstSample[] = []
  const canvases: HTMLCanvasElement[] = []
  const faceless: FrameQc[] = []
  let lastCanvas: HTMLCanvasElement | null = null

  try {
    for (let i = 0; i < count; i++) {
      if (i > 0) await delay(intervalMs, signal)
      throwIfAborted(signal)

      const canvas = grabFrame(video)
      const { frame, qc, sharpness } = analyzeCanvas(canvas, detector, shot, baselineIrisPx)
      if (frame) {
        samples.push({ frame, qc, sharpness })
        canvases.push(canvas)
      } else {
        faceless.push(qc)
        if (lastCanvas) release(lastCanvas)
        lastCanvas = canvas
      }
      onProgress?.(i + 1)
    }
    throwIfAborted(signal)

    const { keptIndexes, bestIndex } = selectFrames(samples)
    const best = bestIndex >= 0 ? (canvases[bestIndex] as HTMLCanvasElement) : lastCanvas
    if (!best) throw new Error('No frame was captured.')
    const size = { width: best.width, height: best.height }
    const shotQc = buildShotQc({ shot, framesTried: count, samples, keptIndexes, faceless }, size)
    const jpeg = await encodeJpeg(best)
    throwIfAborted(signal)

    return {
      frames: samples.map(({ frame, qc }) => ({ frame, qc })),
      keptIndexes,
      bestIndex,
      shotQc,
      jpeg,
      width: size.width,
      height: size.height,
    }
  } finally {
    for (const canvas of canvases) release(canvas)
    if (lastCanvas) release(lastCanvas)
  }
}

export interface InspectStillArgs {
  /** The picture to check, e.g. `importPhoto(file).canvas`. */
  canvas: HTMLCanvasElement
  detector: FaceDetector
  shot: ShotType
  baselineIrisPx?: number | null
}

export interface StillInspection {
  /** null when no face was found. */
  frame: FaceFrame | null
  qc: FrameQc
  /** framesTried 1; framesKept 1 when every check passed, else 0; no burst-agreement check; burstSpread null. */
  shotQc: ShotQc
}

/**
 * The same face detection and quality checks as one frame of a burst, for a single photo (an imported one): the record to store
 * with it. A still has no burst, so there is no steadiness check and no spread, and the measurements treat it as one frame.
 * Its distance estimate assumes a typical phone lens (the original's Exif is gone), so it is less certain than a live capture's.
 */
export async function inspectStill(args: InspectStillArgs): Promise<StillInspection> {
  await args.detector.ready()
  const { frame, qc, sharpness } = analyzeCanvas(args.canvas, args.detector, args.shot, args.baselineIrisPx ?? null)
  const samples: BurstSample[] = frame ? [{ frame, qc, sharpness }] : []
  const keptIndexes = frame && qc.allOk ? [0] : []
  const shotQc = buildShotQc(
    { shot: args.shot, framesTried: 1, samples, keptIndexes, faceless: frame ? [] : [qc] },
    { width: args.canvas.width, height: args.canvas.height },
  )
  return { frame, qc, shotQc }
}
