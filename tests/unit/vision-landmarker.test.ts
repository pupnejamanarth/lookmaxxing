import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ───────────────────────────── a fake MediaPipe ─────────────────────────────
// The real library needs a browser (WebAssembly + WebGL + canvas); tests/e2e/vision.spec.ts runs it for real.
// Here it is replaced so the logic around it can be tested exactly: delegate fallback, timestamps, integrity,
// the central crops and the way a result becomes a FaceFrame.

interface FakeTask {
  delegate: string
  runningMode: string
  options: Record<string, unknown>
  detect: ReturnType<typeof vi.fn>
  detectForVideo: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

const lib = vi.hoisted(() => ({
  tasks: [] as unknown[],
  /** Called for every createFromOptions; throw to simulate a failure. */
  onCreate: null as null | ((options: Record<string, unknown>, delegate: string) => void),
  /** Applied to each new fake task, e.g. to make its first frame throw. */
  decorate: null as null | ((task: unknown) => void),
  result: { faceLandmarks: [] as unknown[], faceBlendshapes: [] as unknown[], facialTransformationMatrixes: [] as unknown[] },
  /** What a detect call returns for a given image; default: always `result`. */
  respond: null as null | ((image: unknown) => unknown),
  filesetCalls: [] as unknown[][],
}))

const fakeLibrary = {
  FilesetResolver: {
    forVisionTasks: async (...args: unknown[]) => {
      lib.filesetCalls.push(args)
      return { wasmLoaderPath: 'loader.js', wasmBinaryPath: 'module.wasm' }
    },
  },
  FaceLandmarker: {
    createFromOptions: async (_fileset: unknown, options: { baseOptions: { delegate: string }; runningMode: string }) => {
      const delegate = options.baseOptions.delegate
      lib.onCreate?.(options as unknown as Record<string, unknown>, delegate)
      const task: FakeTask = {
        delegate,
        runningMode: options.runningMode,
        options: options as unknown as Record<string, unknown>,
        detect: vi.fn((image: unknown) => (lib.respond ? lib.respond(image) : lib.result)),
        detectForVideo: vi.fn((image: unknown) => (lib.respond ? lib.respond(image) : lib.result)),
        close: vi.fn(),
      }
      lib.decorate?.(task)
      lib.tasks.push(task)
      return task
    },
  },
}

import { NAMED_POINTS } from '../../src/vision/types'
import {
  LIBRARY_URL,
  MODEL_FILE,
  MODEL_URL,
  ModelIntegrityError,
  WASM_DIR,
  createFaceDetector,
  expectedModelSha256,
  library,
  parseSha256Sums,
  requirePatchedLibrary,
  sha256Hex,
  verifyModelBytes,
} from '../../src/vision/landmarker'

const modelBytes = readFileSync(new URL('../../public/models/face_landmarker.task', import.meta.url))
const tasks = () => lib.tasks as FakeTask[]

// ───────────────────────────── model integrity ─────────────────────────────

describe('model integrity', () => {
  it('sha256Hex matches a known vector', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('parses sha256sum output in text and binary mode, with CRLF and upper case', () => {
    const a = 'a'.repeat(64)
    const b = 'B'.repeat(64)
    const sums = parseSha256Sums(`${a}  one.task\r\n${b} *./two.task\n\nnot a hash line\n`)
    expect(sums.get('one.task')).toBe(a)
    expect(sums.get('two.task')).toBe('b'.repeat(64))
    expect(sums.size).toBe(2)
  })

  it('the committed SHA256SUMS is the hash of the committed model file', async () => {
    const actual = createHash('sha256').update(modelBytes).digest('hex')
    expect(await expectedModelSha256()).toBe(actual)
  })

  it('has no entry for a missing model name', async () => {
    await expect(expectedModelSha256(`${'0'.repeat(64)}  other.task\n`)).rejects.toThrow(MODEL_FILE)
  })

  it('verifyModelBytes returns the hash for the real model and throws ModelIntegrityError for any change', async () => {
    expect(await verifyModelBytes(modelBytes)).toBe(await expectedModelSha256())

    const tampered = new Uint8Array(modelBytes)
    tampered[tampered.length >> 1] ^= 0x01
    const error = await verifyModelBytes(tampered).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelIntegrityError)
    expect((error as ModelIntegrityError).expected).toBe(await expectedModelSha256())
    expect((error as ModelIntegrityError).actual).not.toBe(await expectedModelSha256())
    expect((error as Error).message).toContain('not run')

    await expect(verifyModelBytes(modelBytes.subarray(0, modelBytes.length - 1))).rejects.toBeInstanceOf(ModelIntegrityError)
    await expect(verifyModelBytes(new Uint8Array(0))).rejects.toBeInstanceOf(ModelIntegrityError)
  })
})

// ───────────────────────────── the detector ─────────────────────────────

let fetchCalls: string[] = []
let serve: () => Uint8Array
/** drawImage calls made on the scratch canvas: [source, sx, sy, sw, sh, dx, dy, dw, dh]. */
let drawn: unknown[][] = []
let webgl2 = true

beforeEach(() => {
  lib.tasks.length = 0
  lib.filesetCalls.length = 0
  lib.onCreate = null
  lib.decorate = null
  lib.respond = null
  lib.result = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }
  fetchCalls = []
  serve = () => new Uint8Array(modelBytes)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchCalls.push(String(url))
      return new Response(serve() as BufferSource, { status: 200 })
    }),
  )
  drawn = []
  webgl2 = true
  vi.spyOn(library, 'load').mockImplementation(async () => fakeLibrary as unknown as Awaited<ReturnType<typeof library.load>>)
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      isScratchCanvas: true,
      getContext: (type: string) =>
        type === 'webgl2'
          ? webgl2
            ? { getExtension: () => null }
            : null
          : { drawImage: (...args: unknown[]) => drawn.push(args) },
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createFaceDetector: loading', () => {
  it('loads the model and the runtime from this origin only, verified, and hands the model over as bytes', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    expect(detector.delegate).toBe('unknown')
    await detector.ready()

    expect(fetchCalls).toEqual([MODEL_URL])
    expect(MODEL_URL.startsWith('/')).toBe(true)
    expect(MODEL_URL.endsWith('/models/face_landmarker.task')).toBe(true)
    expect(lib.filesetCalls).toEqual([[WASM_DIR]]) // no useModule flag: the classic (non-module) loader
    expect(WASM_DIR.endsWith('/mediapipe/wasm')).toBe(true)

    const options = tasks()[0]!.options as { baseOptions: Record<string, unknown> } & Record<string, unknown>
    expect(options.baseOptions.modelAssetPath).toBeUndefined() // the library must never fetch the model itself
    expect(options.baseOptions.modelAssetBuffer).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(options.baseOptions.modelAssetBuffer as Uint8Array).equals(modelBytes)).toBe(true)
    expect(options.numFaces).toBe(1)
    expect(options.outputFaceBlendshapes).toBe(true)
    expect(options.outputFacialTransformationMatrixes).toBe(true)
    expect(options.runningMode).toBe('IMAGE')
    expect(detector.delegate).toBe('CPU')
  })

  it('refuses a model that does not match the committed hash, and never starts the runtime', async () => {
    serve = () => {
      const bytes = new Uint8Array(modelBytes)
      bytes[100] ^= 0xff
      return bytes
    }
    const detector = createFaceDetector({ delegate: 'CPU' })
    await expect(detector.ready()).rejects.toBeInstanceOf(ModelIntegrityError)
    expect(tasks()).toHaveLength(0)
    expect(lib.filesetCalls).toHaveLength(0)
    expect(detector.delegate).toBe('unknown')
    expect(() => detector.detect({ width: 10, height: 10 } as unknown as CanvasImageSource)).toThrow(/before ready/)
  })

  it('reports a failed download rather than running on nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(createFaceDetector({ delegate: 'CPU' }).ready()).rejects.toThrow(/HTTP 404/)
    expect(tasks()).toHaveLength(0)
  })

  it('ready() is shared between callers and idempotent', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    await Promise.all([detector.ready(), detector.ready()])
    await detector.ready()
    expect(tasks()).toHaveLength(1)
    expect(fetchCalls).toHaveLength(1)
  })

  it('a failed start can be retried', async () => {
    let attempts = 0
    lib.onCreate = () => {
      if (++attempts === 1) throw new Error('boom')
    }
    const detector = createFaceDetector({ delegate: 'CPU' })
    await expect(detector.ready()).rejects.toThrow('boom')
    await detector.ready()
    expect(detector.delegate).toBe('CPU')
  })
})

describe('createFaceDetector: delegate', () => {
  it('tries the GPU first and keeps it when it works', async () => {
    const detector = createFaceDetector()
    await detector.ready()
    expect(tasks().map((t) => t.delegate)).toEqual(['GPU'])
    expect(detector.delegate).toBe('GPU')
  })

  it('falls back to the CPU when the GPU graph cannot be created', async () => {
    lib.onCreate = (_o, delegate) => {
      if (delegate === 'GPU') throw new Error('WebGL2 is not available')
    }
    const detector = createFaceDetector({ delegate: 'GPU' })
    await detector.ready()
    expect(tasks().map((t) => t.delegate)).toEqual(['CPU'])
    expect(detector.delegate).toBe('CPU')
  })

  it('falls back to the CPU when the GPU graph is created but fails its first frame, and closes the broken one', async () => {
    lib.decorate = (task) => {
      const t = task as FakeTask
      if (t.delegate === 'GPU') {
        t.detect.mockImplementation(() => {
          throw new Error('GL context lost')
        })
      }
    }
    const detector = createFaceDetector()
    await detector.ready()
    expect(tasks().map((t) => t.delegate)).toEqual(['GPU', 'CPU'])
    expect(tasks()[0]!.close).toHaveBeenCalledTimes(1)
    expect(tasks()[1]!.close).not.toHaveBeenCalled()
    expect(detector.delegate).toBe('CPU')
  })

  it('never touches the GPU when the CPU is asked for', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    expect(tasks().map((t) => t.delegate)).toEqual(['CPU'])
  })

  it('throws the last error when neither delegate works', async () => {
    lib.onCreate = (_o, delegate) => {
      throw new Error(`${delegate} failed`)
    }
    await expect(createFaceDetector().ready()).rejects.toThrow('CPU failed')
  })
})

describe('createFaceDetector: the library', () => {
  it('only a copy carrying the patched marker is accepted (an unpatched MediaPipe would send usage metrics to Google)', () => {
    const lib = { FaceLandmarker: {}, FilesetResolver: {} }
    expect(() => requirePatchedLibrary(lib)).toThrow(/not the patched copy/)
    expect(() => requirePatchedLibrary({ ...lib, lmxMetricsRemoved: false })).toThrow(/not the patched copy/)
    expect(() => requirePatchedLibrary({ ...lib, lmxMetricsRemoved: 'true' })).toThrow(/not the patched copy/)
    expect(requirePatchedLibrary({ ...lib, lmxMetricsRemoved: true })).toMatchObject({ lmxMetricsRemoved: true })
  })

  it('is loaded from this site as a static file, not through the package', () => {
    expect(LIBRARY_URL.startsWith('/')).toBe(true)
    expect(LIBRARY_URL.endsWith('/mediapipe/vision_bundle_nometrics.js')).toBe(true)
  })

  it('a library that is refused stops the detector before it touches the runtime', async () => {
    vi.spyOn(library, 'load').mockRejectedValue(new Error('not the patched copy'))
    await expect(createFaceDetector({ delegate: 'CPU' }).ready()).rejects.toThrow('not the patched copy')
    expect(lib.filesetCalls).toHaveLength(0)
    expect(tasks()).toHaveLength(0)
  })

  it('says so plainly when the browser has no WebGL 2, before downloading anything', async () => {
    webgl2 = false
    await expect(createFaceDetector({ delegate: 'CPU' }).ready()).rejects.toThrow(/WebGL 2/)
    expect(fetchCalls).toEqual([])
    expect(tasks()).toHaveLength(0)
  })
})

// ───────────────────────────── detect() ─────────────────────────────

/** A 478-point normalised mesh with distinct values per vertex. */
function meshResult() {
  const faceLandmarks = [
    Array.from({ length: 478 }, (_, i) => ({ x: 0.2 + (i % 50) / 200, y: 0.1 + (i % 70) / 200, z: -0.01 - i / 100_000, visibility: 0 })),
  ]
  // Column-major 4×4, as MediaPipe flattens it: identity rotation, translation in elements 12–14.
  const data = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.4, 22.5, -65, 1]
  return {
    faceLandmarks,
    faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.12 }, { categoryName: 'mouthSmileLeft', score: 0.8 }], headIndex: 0, headName: '' }],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data }],
  }
}

const source = (width: number, height: number) => ({ width, height }) as unknown as CanvasImageSource

describe('createFaceDetector: detect', () => {
  it('turns a result into a FaceFrame in image pixels', async () => {
    lib.result = meshResult()
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const frame = detector.detect(source(640, 480))!
    const norm = (lib.result.faceLandmarks as ReturnType<typeof meshResult>['faceLandmarks'])[0]!

    expect(frame.landmarks.width).toBe(640)
    expect(frame.landmarks.height).toBe(480)
    expect(frame.landmarks.points).toHaveLength(478)
    for (const i of [0, 33, 263, 468, 477]) {
      expect(frame.landmarks.points[i]!.x).toBeCloseTo(norm[i]!.x * 640, 9)
      expect(frame.landmarks.points[i]!.y).toBeCloseTo(norm[i]!.y * 480, 9)
      expect(frame.landmarks.points[i]!.z).toBeCloseTo(norm[i]!.z * 640, 9) // depth is on the scale of x
    }
    expect(frame.landmarks.blendshapes).toEqual({ jawOpen: 0.12, mouthSmileLeft: 0.8 })
    expect(Object.keys(frame.named).sort()).toEqual([...NAMED_POINTS].sort())
    expect(frame.irisPx).toBeGreaterThan(0)
  })

  it('hands the matrix over row-major (MediaPipe flattens it column-major) and reads the pose from it', async () => {
    lib.result = meshResult()
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const frame = detector.detect(source(640, 480))!
    // Translation sits in the last COLUMN of a row-major matrix: elements 3, 7, 11.
    expect(frame.landmarks.transform).toEqual([1, 0, 0, -0.4, 0, 1, 0, 22.5, 0, 0, 1, -65, 0, 0, 0, 1])
    expect(frame.pose.yaw).toBeCloseTo(0, 9)
    expect(frame.pose.pitch).toBeCloseTo(0, 9)
    expect(frame.pose.roll).toBeCloseTo(0, 9)
  })

  it('transposes a general matrix correctly', async () => {
    const result = meshResult()
    // column-major value (row r, column c) = 10·r + c
    result.facialTransformationMatrixes = [
      { rows: 4, columns: 4, data: Array.from({ length: 16 }, (_, k) => 10 * (k % 4) + Math.floor(k / 4)) },
    ]
    lib.result = result
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const frame = detector.detect(source(100, 100))!
    expect(frame.landmarks.transform).toEqual(Array.from({ length: 16 }, (_, k) => 10 * Math.floor(k / 4) + (k % 4)))
  })

  it('falls back to the landmarks for the pose when MediaPipe returns no matrix', async () => {
    const result = meshResult()
    result.facialTransformationMatrixes = []
    lib.result = result
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const frame = detector.detect(source(640, 480))!
    expect(frame.landmarks.transform).toBeNull()
    expect(Number.isFinite(frame.pose.yaw)).toBe(true)
  })

  it('returns null when there is no face, or the mesh is short', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    expect(detector.detect(source(640, 480))).toBeNull()
    const result = meshResult()
    result.faceLandmarks = [result.faceLandmarks[0]!.slice(0, 468)]
    lib.result = result
    expect(detector.detect(source(640, 480))).toBeNull()
  })

  it('returns null for a source with no pixels yet (a video before its first frame) without asking MediaPipe', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const calls = tasks()[0]!.detect.mock.calls.length
    expect(detector.detect({ videoWidth: 0, videoHeight: 0 } as unknown as CanvasImageSource)).toBeNull()
    expect(tasks()[0]!.detect.mock.calls.length).toBe(calls)
  })

  it('reads the size of every kind of source', async () => {
    lib.result = meshResult()
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const size = (s: object) => {
      const frame = detector.detect(s as unknown as CanvasImageSource)!
      return [frame.landmarks.width, frame.landmarks.height]
    }
    expect(size({ videoWidth: 1280, videoHeight: 720 })).toEqual([1280, 720]) //     <video>
    expect(size({ naturalWidth: 820, naturalHeight: 1024 })).toEqual([820, 1024]) //  <img>
    expect(size({ displayWidth: 640, displayHeight: 360 })).toEqual([640, 360]) //    VideoFrame
    expect(size({ width: 300, height: 200 })).toEqual([300, 200]) //                  canvas / ImageBitmap
    expect(() => detector.detect({} as unknown as CanvasImageSource)).toThrow(TypeError)
  })

  it('must be ready first, and is unusable after close()', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    expect(() => detector.detect(source(10, 10))).toThrow(/before ready/)
    await detector.ready()
    detector.close()
    expect(tasks()[0]!.close).toHaveBeenCalledTimes(1)
    expect(() => detector.detect(source(10, 10))).toThrow(/closed/)
    await expect(detector.ready()).rejects.toThrow(/closed/)
  })

  it('a detector closed while it is still loading ends up closed, not running', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    const ready = detector.ready()
    detector.close()
    await expect(ready).rejects.toThrow(/closed while loading/)
    expect(tasks()[0]!.close).toHaveBeenCalled()
  })
})

describe('createFaceDetector: faces too small for the whole frame', () => {
  const isScratch = (image: unknown) => (image as { isScratchCanvas?: boolean }).isScratchCanvas === true
  const noFace = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }

  it('a face the whole frame shows is found on the first pass, with no crop made', async () => {
    lib.result = meshResult()
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const task = tasks()[0]!
    task.detect.mockClear()
    expect(detector.detect(source(1080, 1920))).not.toBeNull()
    expect(task.detect).toHaveBeenCalledTimes(1)
    expect(drawn).toHaveLength(0)
  })

  it('when the whole frame shows nothing, retries on the central half at native resolution and maps the points back', async () => {
    lib.result = meshResult()
    lib.respond = (image) => (isScratch(image) ? lib.result : noFace)
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const task = tasks()[0]!
    task.detect.mockClear()

    const frame = detector.detect(source(1080, 1920))!
    expect(task.detect).toHaveBeenCalledTimes(2) // whole frame, then the half crop

    // The crop is the centred 50%: 540 × 960 starting at (270, 480), copied 1:1.
    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.slice(1)).toEqual([270, 480, 540, 960, 0, 0, 540, 960])

    const norm = (lib.result.faceLandmarks as ReturnType<typeof meshResult>['faceLandmarks'])[0]!
    expect(frame.landmarks.width).toBe(1080) // the full frame, not the crop
    expect(frame.landmarks.height).toBe(1920)
    for (const i of [1, 33, 263, 468]) {
      expect(frame.landmarks.points[i]!.x).toBeCloseTo(270 + norm[i]!.x * 540, 9)
      expect(frame.landmarks.points[i]!.y).toBeCloseTo(480 + norm[i]!.y * 960, 9)
      expect(frame.landmarks.points[i]!.z).toBeCloseTo(norm[i]!.z * 540, 9) // same scale as the pixels
    }
  })

  it('goes on to the narrower crop when the half still shows nothing', async () => {
    lib.result = meshResult()
    lib.respond = (image) => (isScratch(image) && drawn.length >= 2 ? lib.result : noFace)
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    expect(detector.detect(source(1080, 1920))).not.toBeNull()
    expect(drawn.map((d) => d[3])).toEqual([540, 356]) // widths of the 0.5 and 0.33 crops
    expect(drawn[1]!.slice(1, 5)).toEqual([362, 643, 356, 634])
  })

  it('does not accept a face that touches the edge of a crop (it is cut by it) and moves on to a wider pass', async () => {
    lib.result = meshResult()
    const whole = (lib.result.faceLandmarks as ReturnType<typeof meshResult>['faceLandmarks'])[0]!
    // The same face as the crop sees it when it is too big for the crop: vertex 234 sits on the crop border.
    const cut = meshResult()
    cut.faceLandmarks[0]![234] = { ...cut.faceLandmarks[0]![234]!, x: 0.004 }

    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const task = tasks()[0]!

    // The face is small: only the crop finds it, and the detector settles on the crop.
    lib.respond = (image) => (isScratch(image) ? lib.result : noFace)
    expect(detector.detect(source(1080, 1920))).not.toBeNull()

    // The face comes closer. The crop now shows it cut at the edge; that result is thrown away and the whole frame is used.
    lib.respond = (image) => (isScratch(image) ? cut : lib.result)
    task.detect.mockClear()
    const frame = detector.detect(source(1080, 1920))!
    expect(task.detect).toHaveBeenCalledTimes(2) // the crop (rejected), then the whole frame
    expect(frame.landmarks.points[234]!.x).toBeCloseTo(whole[234]!.x * 1080, 9) // mapped as a whole-frame result

    // ...and the whole frame is where it starts from next time.
    task.detect.mockClear()
    detector.detect(source(1080, 1920))
    expect(task.detect).toHaveBeenCalledTimes(1)
  })

  it('a face that is cut by every crop and not seen by the whole frame is no face', async () => {
    const cut = meshResult()
    cut.faceLandmarks[0]![234] = { ...cut.faceLandmarks[0]![234]!, x: 0.004 }
    lib.respond = (image) => (isScratch(image) ? cut : noFace)
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    expect(detector.detect(source(1080, 1920))).toBeNull()
  })

  it('remembers which pass worked, so the next frame goes straight to it', async () => {
    lib.result = meshResult()
    lib.respond = (image) => (isScratch(image) ? lib.result : noFace)
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const task = tasks()[0]!
    detector.detect(source(1080, 1920))
    task.detect.mockClear()
    drawn = []
    detector.detect(source(1080, 1920))
    expect(task.detect).toHaveBeenCalledTimes(1) // no wasted whole-frame pass
    expect(drawn).toHaveLength(1)
  })

  it('returns null when no pass finds a face, trying each one once', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const task = tasks()[0]!
    task.detect.mockClear()
    expect(detector.detect(source(1080, 1920))).toBeNull()
    expect(task.detect).toHaveBeenCalledTimes(3)
  })

  it('does not cut crops from a frame too small to hold a face in them', async () => {
    const detector = createFaceDetector({ delegate: 'CPU' })
    await detector.ready()
    const task = tasks()[0]!
    task.detect.mockClear()
    expect(detector.detect(source(200, 200))).toBeNull() // crops would be 100 and 66 px
    expect(task.detect).toHaveBeenCalledTimes(1)
    expect(drawn).toHaveLength(0)
  })

  it('in VIDEO mode every pass on one frame gets a later timestamp, and the caller\'s clock is used for the first', async () => {
    lib.respond = () => noFace
    const detector = createFaceDetector({ delegate: 'CPU', runningMode: 'VIDEO' })
    await detector.ready()
    const task = tasks()[0]!
    task.detectForVideo.mockClear()
    detector.detect(source(1080, 1920), 5000)
    detector.detect(source(1080, 1920), 5033)
    const stamps = task.detectForVideo.mock.calls.map((c) => c[1] as number)
    expect(stamps).toHaveLength(6)
    expect(stamps[0]).toBe(5000)
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!)
    expect(stamps[3]).toBe(5033) // the second frame's first pass keeps the caller's time
  })
})

describe('createFaceDetector: running modes', () => {
  it('IMAGE mode uses detect()', async () => {
    const detector = createFaceDetector({ delegate: 'CPU', runningMode: 'IMAGE' })
    await detector.ready()
    const task = tasks()[0]!
    task.detect.mockClear()
    detector.detect(source(10, 10), 5)
    expect(task.detect).toHaveBeenCalledTimes(1)
    expect(task.detectForVideo).not.toHaveBeenCalled()
    expect(task.runningMode).toBe('IMAGE')
  })

  it('VIDEO mode uses detectForVideo() with strictly increasing timestamps, whatever the caller passes', async () => {
    const detector = createFaceDetector({ delegate: 'CPU', runningMode: 'VIDEO' })
    await detector.ready()
    const task = tasks()[0]!
    expect(task.runningMode).toBe('VIDEO')
    task.detectForVideo.mockClear()

    detector.detect(source(10, 10), 1000)
    detector.detect(source(10, 10), 1033)
    detector.detect(source(10, 10), 1033) //   same frame time twice
    detector.detect(source(10, 10), 900) //    clock went backwards
    detector.detect(source(10, 10), Number.NaN)
    detector.detect(source(10, 10)) //         no timestamp: the page clock
    const stamps = task.detectForVideo.mock.calls.map((c) => c[1] as number)
    expect(stamps).toHaveLength(6)
    expect(stamps[0]).toBe(1000)
    expect(stamps[1]).toBe(1033)
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!)
  })

  it('the warm-up frame does not consume the caller\'s clock', async () => {
    const detector = createFaceDetector({ delegate: 'CPU', runningMode: 'VIDEO' })
    await detector.ready()
    const task = tasks()[0]!
    // One warm-up call happened at timestamp 0; the caller's very first frame at 0 is bumped just above it.
    expect(task.detectForVideo.mock.calls[0]![1]).toBe(0)
    task.detectForVideo.mockClear()
    detector.detect(source(10, 10), 0)
    expect(task.detectForVideo.mock.calls[0]![1]).toBe(1)
  })
})
