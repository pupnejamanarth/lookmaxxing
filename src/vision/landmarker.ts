/**
 * On-device face detector: MediaPipe Face Landmarker (478-point mesh + iris, blendshapes, head-pose matrix).
 *
 * Everything it loads comes from OUR origin:
 *   - the library  <base>mediapipe/vision_bundle_nometrics.js   and the WebAssembly runtime  <base>mediapipe/wasm/
 *     (both written by scripts/vendor-mediapipe.mjs from the pinned npm package)
 *   - the model    <base>models/face_landmarker.task
 * The model is fetched through the app (so the net guard and the CSP apply), hashed with SHA-256 and compared with
 * public/models/SHA256SUMS, which is embedded in the bundle at build time. A model that does not match is never run.
 *
 * The library is NOT the npm package as published: MediaPipe Tasks POSTs usage metrics to Google, which this app must
 * never do, so the vendoring script ships a copy with that sender cut out and this file refuses to run any other.
 *
 * A phone takes a backgrounded page's WebGL context away (iOS Safari does), and MediaPipe does not notice: its detect()
 * keeps answering "no face" for ever, with no error. The detector therefore renders into a canvas it owns, watches that
 * context, and when it is lost drops the task and rebuilds it on the CPU delegate (see "context loss" below).
 */
import type { FaceLandmarker, FaceLandmarkerResult, ImageSource } from '@mediapipe/tasks-vision'
import { irisDiameterPx } from './geometry'
import { headPoseFromTransform } from './headPose'
import { namedPointsFromLandmarks } from './namedPoints'
import type { FaceDetector, FaceFrame, FaceLandmarks } from './types'

// `import.meta.env` only exists under Vite; this file is also imported by plain Node and the e2e loader (through
// src/vision/index.ts), where it must not throw. The committed model hash is read lazily for the same reason.
const BASE = import.meta.env?.BASE_URL ?? '/'
export const WASM_DIR = `${BASE}mediapipe/wasm`
export const MODEL_FILE = 'face_landmarker.task'
export const MODEL_URL = `${BASE}models/${MODEL_FILE}`

export interface FaceDetectorOptions {
  /** 'GPU' (default) falls back to the CPU on any error; 'CPU' never touches WebGL. */
  delegate?: 'GPU' | 'CPU'
  /** 'IMAGE' (default) for stills, 'VIDEO' for live frames (detect() then needs increasing timestamps). */
  runningMode?: 'IMAGE' | 'VIDEO'
}

// ───────────────────────────── model integrity ─────────────────────────────

export class ModelIntegrityError extends Error {
  readonly expected: string
  readonly actual: string
  constructor(expected: string, actual: string) {
    super(`The face model does not match its committed SHA-256 (expected ${expected}, got ${actual}); it was not run.`)
    this.name = 'ModelIntegrityError'
    this.expected = expected
    this.actual = actual
  }
}

/** Parses `sha256sum` output ("<64 hex>  <name>" or "<64 hex> *<name>") into name → lowercase hex. */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (m) sums.set((m[2] as string).replace(/^\.\//, ''), (m[1] as string).toLowerCase())
  }
  return sums
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Cannot verify the face model: this page is not a secure context (SubtleCrypto is unavailable).')
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The committed public/models/SHA256SUMS, embedded in the bundle at build time (a lazy chunk; Vite-only import). */
async function committedSums(): Promise<string> {
  return (await import('../../public/models/SHA256SUMS?raw')).default
}

/** The hash the shipped model must have, from the committed public/models/SHA256SUMS. */
export async function expectedModelSha256(sums?: string): Promise<string> {
  const expected = parseSha256Sums(sums ?? (await committedSums())).get(MODEL_FILE)
  if (!expected) throw new Error(`public/models/SHA256SUMS has no entry for ${MODEL_FILE}`)
  return expected
}

/** Throws ModelIntegrityError unless the bytes hash to the committed value. Returns the hash. */
export async function verifyModelBytes(bytes: ArrayBuffer | Uint8Array, expected?: string): Promise<string> {
  const want = (expected ?? (await expectedModelSha256())).toLowerCase()
  const actual = await sha256Hex(bytes)
  if (actual !== want) throw new ModelIntegrityError(want, actual)
  return actual
}

async function loadVerifiedModel(): Promise<Uint8Array> {
  const response = await fetch(MODEL_URL, { credentials: 'omit' })
  if (!response.ok) throw new Error(`Face model download failed (HTTP ${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  await verifyModelBytes(bytes)
  return bytes
}

// ───────────────────────────── the library ─────────────────────────────

export const LIBRARY_URL = `${BASE}mediapipe/vision_bundle_nometrics.js`
/** Named export that scripts/vendor-mediapipe.mjs appends to the patched bundle. */
const METRICS_REMOVED = 'lmxMetricsRemoved'

type Library = typeof import('@mediapipe/tasks-vision')

/** Returns the library if it carries the marker of the patched copy, otherwise throws: an unpatched one would phone home. */
export function requirePatchedLibrary(lib: object): Library {
  if ((lib as Record<string, unknown>)[METRICS_REMOVED] !== true) {
    throw new Error(
      'The MediaPipe library on this site is not the patched copy without its usage-metrics sender, so the face detector will not start.',
    )
  }
  return lib as Library
}

/** Where the detector gets MediaPipe from. A seam for unit tests (they cannot load WebAssembly); the app never replaces it. */
export const library = {
  // Not through the bundler: the file is a static asset of the site, copied and patched at vendoring time. The URL is made
  // absolute because Vite's dev server adds "?import" to site-relative ones and then refuses files that live in public/.
  load: async (): Promise<Library> =>
    requirePatchedLibrary(await import(/* @vite-ignore */ new URL(LIBRARY_URL, globalThis.location.href).href)),
}

/** MediaPipe draws every input through WebGL, on the CPU delegate too. Say so plainly instead of failing inside it. */
function assertWebGl2(): void {
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) throw new Error('This browser did not provide WebGL 2, which the face detector needs (it also uses it on the CPU).')
  gl.getExtension('WEBGL_lose_context')?.loseContext()
}

// ───────────────────────────── context loss ─────────────────────────────

/**
 * Thrown by detect() and ready() when the detector's WebGL context was lost and it could not be rebuilt (or kept being
 * lost). Not thrown for a single loss that was recovered: detect() answers null for the frames in between.
 */
export class FaceDetectorLostError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FaceDetectorLostError'
  }
}

/** Context losses in a row, with no face found in between, after which the detector stops rebuilding itself. */
export const MAX_CONTEXT_LOSSES = 3

type GlCanvas = HTMLCanvasElement | OffscreenCanvas

/** MediaPipe's own rule for its drawing surface: an OffscreenCanvas, except where Safari older than 17 cannot render WebGL into one. */
function offscreenCanvasUsable(): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false
  const agent = globalThis.navigator?.userAgent ?? ''
  if (!agent.includes('Safari') || agent.includes('Chrome')) return true
  return Number(/Version\/(\d+).*Safari/.exec(agent)?.[1] ?? 0) >= 17
}

/**
 * The canvas MediaPipe renders into. It would make an identical one for itself, but then nobody else could reach its
 * context; owning it is what lets the detector see that the context was lost.
 */
function newGlCanvas(): GlCanvas {
  return offscreenCanvasUsable() ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
}

/** The WebGL 2 context MediaPipe created on the canvas (getContext returns the existing one; call it only after a frame ran). */
function contextOf(canvas: GlCanvas): { isContextLost(): boolean } | null {
  return (canvas as { getContext(type: 'webgl2'): WebGL2RenderingContext | null }).getContext('webgl2')
}

const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden'

// ───────────────────────────── helpers ─────────────────────────────

function sourceSize(source: CanvasImageSource): [number, number] {
  const s = source as {
    videoWidth?: number
    videoHeight?: number
    naturalWidth?: number
    naturalHeight?: number
    displayWidth?: number
    displayHeight?: number
    width?: number
    height?: number
  }
  if (typeof s.videoWidth === 'number') return [s.videoWidth, s.videoHeight ?? 0]
  if (typeof s.naturalWidth === 'number') return [s.naturalWidth, s.naturalHeight ?? 0]
  if (typeof s.displayWidth === 'number') return [s.displayWidth, s.displayHeight ?? 0]
  if (typeof s.width === 'number' && typeof s.height === 'number') return [s.width, s.height]
  throw new TypeError('detect() needs an image, canvas, ImageBitmap, video frame or video element')
}

/** Row-major 4×4 from MediaPipe's flattened (column-major) matrix; null when it is not a 4×4. */
function rowMajor(matrix: { rows: number; columns: number; data: number[] } | undefined): number[] | null {
  if (!matrix || matrix.rows !== 4 || matrix.columns !== 4 || matrix.data.length !== 16) return null
  const out = new Array<number>(16)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = matrix.data[c * 4 + r] as number
  return out
}

/** The part of the source image that was handed to MediaPipe, in source pixels (the whole image when not cropped). */
interface Region {
  x: number
  y: number
  width: number
  height: number
}

function frameFromResult(result: FaceLandmarkerResult, region: Region, full: { width: number; height: number }): FaceFrame | null {
  const mesh = result.faceLandmarks[0]
  if (!mesh || mesh.length < 478) return null

  const blendshapes: Record<string, number> = {}
  for (const c of result.faceBlendshapes?.[0]?.categories ?? []) blendshapes[c.categoryName] = c.score

  const landmarks: FaceLandmarks = {
    // x and y are normalised to the region MediaPipe saw; z is normalised on the same scale as x. A crop is not
    // resized, so region pixels are source pixels and the points only need the crop's offset added.
    points: mesh.map((p) => ({ x: region.x + p.x * region.width, y: region.y + p.y * region.height, z: p.z * region.width })),
    width: full.width,
    height: full.height,
    blendshapes,
    transform: rowMajor(result.facialTransformationMatrixes?.[0]),
  }
  return {
    landmarks,
    pose: headPoseFromTransform(landmarks.transform, landmarks),
    irisPx: irisDiameterPx(landmarks),
    named: namedPointsFromLandmarks(landmarks),
  }
}

/**
 * Share of the frame, centred, that is tried when the whole frame shows no face (1 = the whole frame).
 *
 * MediaPipe's face detector is a short-range model: on the fixture it finds a face that is 13.9% of the frame width
 * and misses one at 11.5%. The capture protocol puts the lens 1.5 m from the face, where a phone's 1× lens renders it
 * at under 8% of the frame width, so on a whole-frame pass the detector would never see it. A centred crop is cut at
 * native resolution (no resampling, no lost detail) and makes the face 2–3× larger relative to the model's input; the
 * protocol keeps the face in the central half of the frame, which is what the crops cover.
 */
export const FRAME_SHARES = [1, 0.5, 0.33] as const

/** How close to the border of a crop (share of its size) the face outline may come before the crop counts as cutting it. */
const EDGE_MARGIN = 0.02

function touchesEdge(frame: FaceFrame, region: Region): boolean {
  const { faceLeft, faceRight, faceTop, faceBottom } = frame.named
  const mx = region.width * EDGE_MARGIN
  const my = region.height * EDGE_MARGIN
  return (
    faceRight.x - region.x < mx ||
    region.x + region.width - faceLeft.x < mx ||
    faceTop.y - region.y < my ||
    region.y + region.height - faceBottom.y < my
  )
}

/** Smallest crop worth running: a face cannot be found in fewer pixels than this. */
const MIN_CROP_PX = 120

function regionFor(share: number, width: number, height: number): Region | null {
  if (share >= 1) return { x: 0, y: 0, width, height }
  const w = Math.round(width * share)
  const h = Math.round(height * share)
  if (w < MIN_CROP_PX || h < MIN_CROP_PX) return null
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h }
}

// ───────────────────────────── detector ─────────────────────────────

type Fileset = Awaited<ReturnType<Library['FilesetResolver']['forVisionTasks']>>

class MediaPipeFaceDetector implements FaceDetector {
  private task: FaceLandmarker | null = null
  private starting: Promise<void> | null = null
  private closed = false
  private lastTimestamp = Number.NEGATIVE_INFINITY
  private active: 'GPU' | 'CPU' | 'unknown' = 'unknown'
  private scratch: HTMLCanvasElement | null = null
  /** Index into FRAME_SHARES of the pass that found a face last. */
  private preferred = 0
  private readonly mode: 'IMAGE' | 'VIDEO'
  private readonly wanted: 'GPU' | 'CPU'

  // What a rebuild after a context loss reuses, so it does not download and hash 3.7 MB again.
  private model: Uint8Array | null = null
  private runtime: { library: Library; fileset: Fileset } | null = null

  // Context loss.
  /** The canvas the running task renders into, and the WebGL context MediaPipe made on it. */
  private canvas: GlCanvas | null = null
  private gl: { isContextLost(): boolean } | null = null
  /** 'webglcontextlost' fired on that canvas. */
  private lostEvent = false
  /** After a loss the task is gone and the detector is rebuilding itself: detect() answers null meanwhile. */
  private recovering = false
  /** Once the GPU has failed at run time the detector stays on the CPU. */
  private cpuOnly = false
  /** Losses since a face was last found. */
  private losses = 0
  private failure: FaceDetectorLostError | null = null
  private watchingPage = false

  constructor(options: FaceDetectorOptions) {
    this.mode = options.runningMode ?? 'IMAGE'
    this.wanted = options.delegate ?? 'GPU'
  }

  get delegate(): 'GPU' | 'CPU' | 'unknown' {
    return this.active
  }

  /**
   * Resolves when a working detector is in place. It is also the way to recover: if the WebGL context has been lost it
   * rebuilds the detector first, and after a failure (including giving up on repeated losses) it tries again from scratch.
   * Await it before every burst of frames.
   */
  ready(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('FaceDetector is closed'))
    if (this.task && this.contextLost()) this.noteLoss()
    if (!this.starting) {
      if (this.failure) {
        this.failure = null
        this.losses = 0
      }
      const rebuilding = this.recovering
      this.starting = this.start().catch((error: unknown) => {
        this.starting = null // a failed start may be retried
        if (rebuilding && !this.closed) {
          this.recovering = false
          this.failure = new FaceDetectorLostError('The face detector lost its graphics context and could not restart.', { cause: error })
          throw this.failure
        }
        throw error
      })
    }
    return this.starting
  }

  private async start(): Promise<void> {
    assertWebGl2()
    const model = this.model ?? (this.model = await loadVerifiedModel())
    if (!this.runtime) {
      const lib = await library.load()
      this.runtime = { library: lib, fileset: await lib.FilesetResolver.forVisionTasks(WASM_DIR) }
    }
    const { FaceLandmarker } = this.runtime.library

    const order: ('GPU' | 'CPU')[] = this.wanted === 'CPU' || this.cpuOnly ? ['CPU'] : ['GPU', 'CPU']
    let failure: unknown = null
    for (const delegate of order) {
      const canvas = newGlCanvas()
      let task: FaceLandmarker
      try {
        task = await FaceLandmarker.createFromOptions(this.runtime.fileset, {
          canvas,
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: this.mode,
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        })
      } catch (error) {
        failure = error
        continue
      }
      let gl: { isContextLost(): boolean } | null
      try {
        this.warmUp(task)
        gl = contextOf(canvas) // exists now: the frame above ran through it
        if (gl?.isContextLost()) throw new Error('The WebGL context was lost while the face detector was starting.')
      } catch (error) {
        // Some GPUs create the graph fine and only fail on the first frame.
        failure = error
        task.close()
        continue
      }
      if (this.closed) {
        task.close()
        throw new Error('FaceDetector was closed while loading')
      }
      this.task = task
      this.active = delegate
      this.canvas = canvas
      this.gl = gl
      this.lostEvent = false
      this.recovering = false
      canvas.addEventListener('webglcontextlost', this.onContextLost)
      if (!this.watchingPage) {
        this.watchingPage = true
        document.addEventListener('visibilitychange', this.onVisibility)
      }
      return
    }
    throw failure instanceof Error ? failure : new Error('Face detector could not start')
  }

  /** One blank frame through the whole graph, so a broken delegate fails here and not on the user's first photo. */
  private warmUp(task: FaceLandmarker): void {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    // Timestamp 0 keeps the caller's own clock in charge: their first real frame is always later.
    if (this.mode === 'VIDEO') task.detectForVideo(canvas, this.nextTimestamp(0))
    else task.detect(canvas)
  }

  private nextTimestamp(requested?: number): number {
    const t = requested !== undefined && Number.isFinite(requested) ? requested : performance.now()
    this.lastTimestamp = t > this.lastTimestamp ? t : this.lastTimestamp + 1
    return this.lastTimestamp
  }

  // ───────────────────────────── context loss ─────────────────────────────

  private contextLost(): boolean {
    return this.lostEvent || this.gl?.isContextLost() === true
  }

  /**
   * The context this task renders with is gone for good (a restored context has none of MediaPipe's textures), so the task
   * is dropped. The next attempt is a CPU one: a context that was taken away once says the GPU path is not reliable here.
   * Too many losses in a row, with no face found in between, and the detector gives up and says so.
   */
  private noteLoss(): void {
    if (this.closed || !this.task) return
    this.dropTask()
    this.cpuOnly = true
    this.losses++
    if (this.losses > MAX_CONTEXT_LOSSES) {
      this.recovering = false
      this.failure = new FaceDetectorLostError(
        `The face detector's graphics context was lost ${this.losses} times in a row, so it stopped restarting itself.`,
      )
      return
    }
    this.recovering = true
  }

  /** Starts the rebuild after a loss, unless one is under way or the page is in the background (it resumes on return). */
  private resume(): void {
    if (!this.recovering || this.starting || this.closed || pageHidden()) return
    this.ready().catch(() => undefined) // whoever awaits ready() gets the error; this call only drives the rebuild
  }

  private readonly onContextLost = (): void => {
    this.lostEvent = true
    this.noteLoss()
    this.resume()
  }

  private readonly onVisibility = (): void => {
    if (pageHidden()) return
    if (this.task && this.contextLost()) this.noteLoss()
    this.resume()
  }

  /** What detect() does while there is no task: null while a rebuild is pending, otherwise the reason it cannot work. */
  private unavailable(): null {
    if (this.recovering) {
      this.resume()
      return null
    }
    throw this.failure ?? new Error('FaceDetector.detect() was called before ready() resolved')
  }

  private dropTask(): void {
    const task = this.task
    this.canvas?.removeEventListener('webglcontextlost', this.onContextLost)
    this.task = null
    this.canvas = null
    this.gl = null
    this.lostEvent = false
    this.starting = null
    this.active = 'unknown'
    try {
      task?.close()
    } catch {
      // The context it renders with is gone; there is nothing left in it to release.
    }
  }

  /**
   * Null when no face is found, and also null for the frames between a lost WebGL context and the end of the rebuild it
   * starts (`await ready()` waits for it). Throws FaceDetectorLostError if it could not be rebuilt.
   */
  detect(source: CanvasImageSource, timestampMs?: number): FaceFrame | null {
    if (this.closed) throw new Error('FaceDetector is closed')
    if (this.task && this.contextLost()) this.noteLoss()
    const task = this.task
    if (!task) return this.unavailable()
    const [width, height] = sourceSize(source)
    if (!(width > 0 && height > 0)) return null // e.g. a video that has not decoded its first frame
    const full = { width, height }

    // Try the share that found the face last time first (in VIDEO mode MediaPipe tracks from the previous frame, so
    // the input geometry must not flip between calls), then the others from the widest down.
    const order = [this.preferred, ...FRAME_SHARES.map((_, i) => i).filter((i) => i !== this.preferred)]
    let first = true
    for (const index of order) {
      const region = regionFor(FRAME_SHARES[index] as number, width, height)
      if (!region) continue
      const image = (FRAME_SHARES[index] === 1 ? source : this.cropTo(source, region)) as ImageSource
      // The caller's timestamp goes to the first pass; any retry on the same frame just has to be later.
      const stamp = first ? this.nextTimestamp(timestampMs) : this.nextTimestamp(this.lastTimestamp + 1)
      first = false
      let result: FaceLandmarkerResult
      try {
        result = this.mode === 'VIDEO' ? task.detectForVideo(image, stamp) : task.detect(image)
      } catch (error) {
        if (!this.contextLost()) throw error
        this.noteLoss() // MediaPipe threw because the context went away under it
        return this.unavailable()
      }
      const frame = frameFromResult(result, region, full)
      // A face that reaches the edge of a crop is cut by it; the next, wider pass sees all of it.
      if (frame && !(FRAME_SHARES[index] !== 1 && touchesEdge(frame, region))) {
        this.preferred = index
        this.losses = 0
        return frame
      }
    }
    // "No face" from a lost context looks exactly like "no face in the picture": ask the context.
    if (this.contextLost()) {
      this.noteLoss()
      return this.unavailable()
    }
    return null
  }

  /** Copies `region` of the source into a reused canvas, pixel for pixel. */
  private cropTo(source: CanvasImageSource, region: Region): HTMLCanvasElement {
    const canvas = this.scratch ?? (this.scratch = document.createElement('canvas'))
    if (canvas.width !== region.width || canvas.height !== region.height) {
      canvas.width = region.width
      canvas.height = region.height
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('A 2D canvas is needed to look at the middle of the frame, and the browser refused one')
    ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    return canvas
  }

  close(): void {
    this.closed = true
    if (this.watchingPage) document.removeEventListener('visibilitychange', this.onVisibility)
    this.watchingPage = false
    this.dropTask()
    this.model = null
    this.runtime = null
    this.scratch = null
  }
}

export function createFaceDetector(opts: FaceDetectorOptions = {}): FaceDetector {
  return new MediaPipeFaceDetector(opts)
}
