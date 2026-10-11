/**
 * Dev-only page for tests/e2e/vision.spec.ts: runs the REAL face detector (MediaPipe, in the browser) on an image and
 * hands the result back to the test, and can draw every named point with its label so the mapping can be checked by eye.
 * Served by `vite` (dev) and, for the CSP proof, by a throwaway production build (harness/vite.prod.config.ts).
 * It is not imported by the app and is not part of the app's production build (dist/).
 */
import './guard'
import { getNetGuardStats } from '../src/privacy'
import { createFaceDetector, NAMED_POINTS } from '../src/vision'
import type { FaceDetector, FaceFrame, NamedPoint } from '../src/vision'
import { MODEL_URL, WASM_DIR, expectedModelSha256, sha256Hex } from '../src/vision/landmarker'

export interface LoadOptions {
  /** Rotate the picture clockwise by this many degrees about its centre (synthetic head roll). */
  rotateDeg?: number
  /** Mirror left–right (a mirrored face has the opposite yaw and roll). */
  mirror?: boolean
  /** Shrink the picture inside the same-size frame (0.25 = a quarter of the width): a face farther from the camera. */
  scale?: number
}

export interface AnalyseOptions extends LoadOptions {
  delegate?: 'CPU' | 'GPU'
  runningMode?: 'IMAGE' | 'VIDEO'
  /** Include the 478 raw points and the matrix in the result (large). */
  withPoints?: boolean
}

export interface Analysis {
  found: boolean
  delegate: string
  width: number
  height: number
  pointCount: number
  pose: FaceFrame['pose'] | null
  irisPx: number | null
  named: FaceFrame['named'] | null
  blendshapeCount: number
  blendshapes: Record<string, number>
  transform: number[] | null
  points?: { x: number; y: number; z: number }[]
}

const detectors = new Map<string, FaceDetector>()
const status = document.getElementById('status') as HTMLElement

/** Image → canvas, honouring EXIF orientation, optionally rotated / mirrored. The picture is never re-uploaded anywhere. */
async function loadCanvas(url: string, options: LoadOptions = {}): Promise<HTMLCanvasElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`could not load ${url}: HTTP ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  if (options.rotateDeg) ctx.rotate((options.rotateDeg * Math.PI) / 180)
  if (options.mirror) ctx.scale(-1, 1)
  if (options.scale) ctx.scale(options.scale, options.scale)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  bitmap.close()
  return canvas
}

async function detectorFor(delegate: 'CPU' | 'GPU', runningMode: 'IMAGE' | 'VIDEO'): Promise<FaceDetector> {
  const key = `${delegate}/${runningMode}`
  let detector = detectors.get(key)
  if (!detector) {
    detector = createFaceDetector({ delegate, runningMode })
    detectors.set(key, detector)
  }
  await detector.ready()
  return detector
}

function summarise(frame: FaceFrame | null, detector: FaceDetector, canvas: HTMLCanvasElement, withPoints: boolean): Analysis {
  const base = { delegate: detector.delegate, width: canvas.width, height: canvas.height }
  if (!frame) {
    return { ...base, found: false, pointCount: 0, pose: null, irisPx: null, named: null, blendshapeCount: 0, blendshapes: {}, transform: null }
  }
  const result: Analysis = {
    ...base,
    found: true,
    pointCount: frame.landmarks.points.length,
    pose: frame.pose,
    irisPx: frame.irisPx,
    named: frame.named,
    blendshapeCount: Object.keys(frame.landmarks.blendshapes).length,
    blendshapes: frame.landmarks.blendshapes,
    transform: frame.landmarks.transform,
  }
  if (withPoints) result.points = frame.landmarks.points
  return result
}

async function analyse(url: string, options: AnalyseOptions = {}): Promise<Analysis> {
  const canvas = await loadCanvas(url, options)
  const detector = await detectorFor(options.delegate ?? 'CPU', options.runningMode ?? 'IMAGE')
  const frame = detector.detect(canvas, options.runningMode === 'VIDEO' ? performance.now() : undefined)
  return summarise(frame, detector, canvas, options.withPoints === true)
}

/**
 * The live-camera path without a camera: the picture is drawn onto a canvas, the canvas is captured as a MediaStream and
 * played in a <video>, and the detector is run on that element frame by frame in VIDEO mode, exactly as the capture
 * screen will run it on a camera stream.
 */
async function analyseVideo(url: string, options: LoadOptions & { frames?: number } = {}): Promise<{ videoWidth: number; videoHeight: number; frames: Analysis[] }> {
  const canvas = await loadCanvas(url, options)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const stream = canvas.captureStream(30)
  // A captured canvas only emits a frame when its pixels change, so a corner pixel is nudged ~30 times a second.
  let tick = 0
  const nudge = setInterval(() => {
    ctx.fillStyle = tick++ % 2 ? '#808080' : '#818181'
    ctx.fillRect(0, 0, 1, 1)
  }, 33)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    const detector = await detectorFor('CPU', 'VIDEO')
    const frames: Analysis[] = []
    const total = options.frames ?? 3
    for (let n = 0; n < total; n++) {
      await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()))
      const frame = detector.detect(video, performance.now())
      frames.push(summarise(frame, detector, canvas, false))
    }
    const size = { videoWidth: video.videoWidth, videoHeight: video.videoHeight }
    video.srcObject = null
    return { ...size, frames }
  } finally {
    clearInterval(nudge)
    for (const track of stream.getTracks()) track.stop()
  }
}

/** A plain grey frame: there is no face in it. */
async function analyseBlank(width = 640, height = 480): Promise<Analysis> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, width, height)
  const detector = await detectorFor('CPU', 'IMAGE')
  return summarise(detector.detect(canvas), detector, canvas, false)
}

/** Draws the picture, cropped to the face, with every named point and its label. */
async function drawNamed(
  url: string,
  options: LoadOptions & {
    only?: NamedPoint[]
    labels?: boolean
    zoom?: number
    /** Crop rectangle in image pixels instead of the face's bounding box. */
    crop?: { x0: number; y0: number; x1: number; y1: number }
    /** Also mark these raw mesh vertex ids (white), for choosing between candidate indices. */
    ids?: number[]
  } = {},
): Promise<Analysis> {
  const canvas = await loadCanvas(url, options)
  const detector = await detectorFor('CPU', 'IMAGE')
  const frame = detector.detect(canvas)
  const view = document.getElementById('view') as HTMLCanvasElement
  const ctx = view.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  if (!frame) {
    view.width = 200
    view.height = 40
    ctx.fillText('no face', 10, 20)
    return summarise(null, detector, canvas, false)
  }
  const n = frame.named
  const xs = Object.values(n).map((p) => p.x)
  const ys = Object.values(n).map((p) => p.y)
  const pad = 40
  const x0 = options.crop?.x0 ?? Math.max(0, Math.min(...xs) - pad)
  const y0 = options.crop?.y0 ?? Math.max(0, Math.min(...ys) - pad)
  const x1 = options.crop?.x1 ?? Math.min(canvas.width, Math.max(...xs) + pad)
  const y1 = options.crop?.y1 ?? Math.min(canvas.height, Math.max(...ys) + pad)
  const zoom = options.zoom ?? 2
  view.width = Math.round((x1 - x0) * zoom)
  view.height = Math.round((y1 - y0) * zoom)
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, view.width, view.height)
  ctx.font = '12px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  for (const id of options.ids ?? []) {
    const p = frame.landmarks.points[id]
    if (!p) continue
    const x = (p.x - x0) * zoom
    const y = (p.y - y0) * zoom
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,.8)'
    ctx.strokeText(String(id), x + 4, y - 6)
    ctx.fillText(String(id), x + 4, y - 6)
  }
  const wanted = options.only ?? [...NAMED_POINTS]
  for (const name of wanted) {
    const p = n[name]
    const x = (p.x - x0) * zoom
    const y = (p.y - y0) * zoom
    // R labels sit left of the point, everything else to its right, so the two sides of the face do not collide.
    const left = name.endsWith('R')
    const color = name.endsWith('L') ? '#ffd23f' : name.endsWith('R') ? '#3fd0ff' : '#7dff7d'
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
    if (options.labels !== false) {
      ctx.textAlign = left ? 'right' : 'left'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,.8)'
      const label = name
      ctx.strokeText(label, x + (left ? -6 : 6), y)
      ctx.fillText(label, x + (left ? -6 : 6), y)
    }
  }
  return summarise(frame, detector, canvas, false)
}

/** Raw model bytes hashed in the page, next to the committed value, for an independent integrity check. */
async function modelIntegrity(): Promise<{ expected: string; actual: string; bytes: number; url: string }> {
  const response = await fetch(MODEL_URL)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { expected: await expectedModelSha256(), actual: await sha256Hex(bytes), bytes: bytes.length, url: MODEL_URL }
}

/** Starts a fresh detector (not cached) and reports whether ready() resolved or what it threw. */
async function tryStart(delegate: 'CPU' | 'GPU' = 'CPU'): Promise<{ ok: boolean; name?: string; message?: string; delegate?: string }> {
  const detector = createFaceDetector({ delegate })
  try {
    await detector.ready()
    const result = { ok: true, delegate: detector.delegate }
    detector.close()
    return result
  } catch (error) {
    detector.close()
    const e = error as Error
    return { ok: false, name: e.name, message: e.message }
  }
}

/** Closes every cached detector (this is where MediaPipe would flush its metrics) and reports the guard's counters. */
function closeAll(): { blockedCount: number; recent: { origin: string; kind: string }[] } {
  for (const detector of detectors.values()) detector.close()
  detectors.clear()
  const stats = getNetGuardStats()
  return { blockedCount: stats.blockedCount, recent: stats.recent.map((r) => ({ origin: r.origin, kind: r.kind })) }
}

/**
 * Control for the patched library: the RAW npm package of MediaPipe, closed, tries to POST its usage metrics to Google.
 * The net guard refuses that and records it. Returns what the guard recorded during the close, so the test can show
 * that (a) the library really does this and (b) the app's own detector, which loads the patched copy, never does.
 */
async function rawLibraryCloseProbe(): Promise<{ origin: string; kind: string }[]> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR)
  const model = new Uint8Array(await (await fetch(MODEL_URL)).arrayBuffer())
  const task = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'IMAGE' })
  const before = getNetGuardStats().blockedCount
  task.close() // flushes the metrics queue
  const stats = getNetGuardStats()
  return stats.recent.slice(Math.max(0, stats.recent.length - (stats.blockedCount - before))).map((r) => ({ origin: r.origin, kind: r.kind }))
}

type GlContext = WebGLRenderingContext | WebGL2RenderingContext

/** Remembers every WebGL context created from now on (MediaPipe's own sits on a canvas nobody else can reach). */
function recordContexts(): GlContext[] {
  const seen: GlContext[] = []
  const wrap = (proto: { getContext: (...args: unknown[]) => unknown } | undefined) => {
    if (!proto) return
    const original = proto.getContext
    proto.getContext = function (this: unknown, type: unknown, ...rest: unknown[]) {
      const context = original.call(this, type, ...rest) as GlContext | null
      if (context && String(type).startsWith('webgl') && !seen.includes(context)) seen.push(context)
      return context
    }
  }
  wrap(HTMLCanvasElement.prototype as never)
  wrap((window as unknown as { OffscreenCanvas?: { prototype: never } }).OffscreenCanvas?.prototype)
  return seen
}

export interface LossRound {
  /** Contexts that were healthy and have just been taken away, the way iOS does to a backgrounded page. */
  taken: number
  /** detect() right after the loss: must be a quiet null (the loss is noticed), never an exception or a stale face. */
  immediate: { found: boolean; threw: string | null }
  /** After `await detector.ready()`. */
  found: boolean
  delegate: string
  noseTip: { x: number; y: number } | null
  /** Contexts created since the loss that are alive now. */
  healthyNow: number
}

export interface LossReport {
  startedDelegate: string
  foundBefore: boolean
  noseTipBefore: { x: number; y: number } | null
  rounds: LossRound[]
}

/**
 * What a phone does to a page it backgrounds: the WebGL context MediaPipe renders with is taken away. Starts a detector,
 * proves it sees the face, takes every live context away, and checks the detector notices and rebuilds itself — twice.
 * With `htmlCanvas` the page has no OffscreenCanvas (older Safari), so MediaPipe renders through a <canvas> element.
 */
async function contextLossRecovery(
  url: string,
  options: { delegate: 'CPU' | 'GPU'; runningMode?: 'IMAGE' | 'VIDEO'; htmlCanvas?: boolean; rounds?: number },
): Promise<LossReport> {
  if (options.htmlCanvas) (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined
  const contexts = recordContexts()
  const detector = createFaceDetector({ delegate: options.delegate, runningMode: options.runningMode ?? 'IMAGE' })
  try {
    await detector.ready()
    const canvas = await loadCanvas(url)
    const stamp = () => (options.runningMode === 'VIDEO' ? performance.now() : undefined)
    const before = detector.detect(canvas, stamp())
    const report: LossReport = {
      startedDelegate: detector.delegate,
      foundBefore: before !== null,
      noseTipBefore: before && { x: before.named.noseTip.x, y: before.named.noseTip.y },
      rounds: [],
    }
    for (let round = 0; round < (options.rounds ?? 2); round++) {
      const live = contexts.filter((gl) => !gl.isContextLost())
      for (const gl of live) gl.getExtension('WEBGL_lose_context')?.loseContext()
      const taken = live.filter((gl) => gl.isContextLost()).length
      const known = contexts.length

      let immediate: LossRound['immediate']
      try {
        immediate = { found: detector.detect(canvas, stamp()) !== null, threw: null }
      } catch (error) {
        immediate = { found: false, threw: (error as Error).message }
      }
      await detector.ready()
      const frame = detector.detect(canvas, stamp())
      report.rounds.push({
        taken,
        immediate,
        found: frame !== null,
        delegate: detector.delegate,
        noseTip: frame && { x: frame.named.noseTip.x, y: frame.named.noseTip.y },
        healthyNow: contexts.slice(known).filter((gl) => !gl.isContextLost()).length,
      })
    }
    return report
  } finally {
    detector.close()
  }
}

const api = { analyse, analyseVideo, analyseBlank, rawLibraryCloseProbe, drawNamed, modelIntegrity, tryStart, closeAll, contextLossRecovery, netStats: () => getNetGuardStats(), loadCanvas }
export type VisionHarness = typeof api
;(window as unknown as { vision: VisionHarness }).vision = api
status.textContent = 'ready'
document.documentElement.dataset.ready = 'true'
