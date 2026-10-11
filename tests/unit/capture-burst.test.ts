import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSE_TIE_DEG, buildShotQc, burstSpread, captureBurst, inspectStill, selectFrames } from '../../src/capture/burst'
import type { BurstSample } from '../../src/capture/burst'
import { QC_LIMITS, evaluateFrameQc, shotQcPassed } from '../../src/capture/qc'
import type { FaceDetector, FaceFrame } from '../../src/vision'
import { goodPixels, makeBuffer, makeFrame, seeded } from './capture-frames'

const W = 1080
const H = 1920

const sample = (frameOptions: Parameters<typeof makeFrame>[0] = {}, pixels = goodPixels(), sharpness = pixels.sharpness): BurstSample => {
  const frame = makeFrame({ imageWidth: W, imageHeight: H, ...frameOptions })
  return { frame, qc: evaluateFrameQc({ frame, pixels, shot: 'frontal_neutral', imageWidth: W, imageHeight: H }), sharpness }
}

describe('selectFrames', () => {
  it('keeps the frames that pass every check', () => {
    const samples = [sample(), sample({ pose: { yaw: 8 } }), sample({ pose: { pitch: 1 } }), sample({}, goodPixels({ sharpness: 2 }))]
    expect(selectFrames(samples).keptIndexes).toEqual([0, 2])
  })

  it('picks the frame with the smallest |yaw|+|roll|+|pitch|', () => {
    const samples = [sample({ pose: { yaw: 2, roll: 1 } }), sample({ pose: { yaw: 0.2, roll: 0.3, pitch: 0.1 } }), sample({ pose: { yaw: -1.5 } })]
    expect(selectFrames(samples).bestIndex).toBe(1)
  })

  it('breaks a tie (within the pose tolerance) with the sharper frame', () => {
    const samples = [
      sample({ pose: { yaw: 1 } }, goodPixels({ sharpness: 80 })),
      sample({ pose: { yaw: 1 + POSE_TIE_DEG - 0.01 } }, goodPixels({ sharpness: 300 })),
      sample({ pose: { yaw: 1 + POSE_TIE_DEG + 0.5 } }, goodPixels({ sharpness: 900 })),
    ]
    expect(selectFrames(samples).bestIndex).toBe(1)
  })

  it('does not trade pose for sharpness beyond the tolerance', () => {
    const samples = [sample({ pose: { yaw: 0.1 } }, goodPixels({ sharpness: 50 })), sample({ pose: { yaw: 2 } }, goodPixels({ sharpness: 900 }))]
    expect(selectFrames(samples).bestIndex).toBe(0)
  })

  it('chooses only among kept frames when there are any', () => {
    const samples = [sample({ pose: { yaw: 0 } }, goodPixels({ sharpness: 2 })), sample({ pose: { yaw: 2.5 } })]
    expect(selectFrames(samples)).toEqual({ keptIndexes: [1], bestIndex: 1 })
  })

  it('when none pass, the best is among the frames that fail the fewest checks, then by pose', () => {
    const samples = [
      sample({ pose: { yaw: 9 }, blendshapes: { mouthSmileLeft: 1, mouthSmileRight: 1 } }), // two failures
      sample({ pose: { yaw: 9 } }), // one failure, bigger turn
      sample({ pose: { yaw: 4 } }), // one failure, smaller turn
    ]
    expect(selectFrames(samples)).toEqual({ keptIndexes: [], bestIndex: 2 })
  })

  it('answers -1 for no frames at all', () => {
    expect(selectFrames([])).toEqual({ keptIndexes: [], bestIndex: -1 })
  })
})

describe('burstSpread', () => {
  const frames = (n: number, jitter = 0, scale = 1): FaceFrame[] => {
    const rand = seeded(11)
    return Array.from({ length: n }, () => {
      const frame = makeFrame({ imageWidth: W, imageHeight: H })
      // Move every point by up to `jitter` px and scale about the origin.
      for (const key of Object.keys(frame.named) as (keyof typeof frame.named)[]) {
        const p = frame.named[key]
        frame.named[key] = { x: p.x * scale + (rand() - 0.5) * 2 * jitter, y: p.y * scale + (rand() - 0.5) * 2 * jitter }
      }
      return frame
    })
  }

  it('is 0 for identical frames and null for fewer than two', () => {
    expect(burstSpread(frames(4))).toBeCloseTo(0, 9)
    expect(burstSpread(frames(1))).toBeNull()
    expect(burstSpread([])).toBeNull()
  })

  it('does not depend on the size of the face in the picture (distances are divided by the pupil distance)', () => {
    const a = makeFrame({ imageWidth: W, imageHeight: H, distanceM: 1.5 })
    const b = makeFrame({ imageWidth: W, imageHeight: H, distanceM: 2.0 })
    expect(burstSpread([a, b])).toBeCloseTo(0, 9)
  })

  it('grows with landmark jitter, as a fraction of the pupil distance', () => {
    const small = burstSpread(frames(5, 0.2))!
    const large = burstSpread(frames(5, 2))!
    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small * 3)
    expect(small).toBeLessThan(QC_LIMITS.maxBurstSpread)
  })

  it('is null when a point is not a number (never a made-up spread)', () => {
    const [a, b] = frames(2)
    b!.named.zygionL = { x: Number.NaN, y: 0 }
    expect(burstSpread([a!, b!])).toBeNull()
  })

  it('uses the median of the per-distance ranges: one jumpy landmark does not fail the burst', () => {
    const [a, b, c] = frames(3)
    b!.named.gonionL = { x: b!.named.gonionL.x + 30, y: b!.named.gonionL.y }
    expect(burstSpread([a!, b!, c!])).toBeCloseTo(0, 9)
  })
})

describe('buildShotQc', () => {
  const size = { width: W, height: H }
  const args = (samples: BurstSample[], framesTried = samples.length, faceless: ReturnType<typeof evaluateFrameQc>[] = []) => {
    const { keptIndexes } = selectFrames(samples)
    return { shot: 'frontal_neutral' as const, framesTried, samples, keptIndexes, faceless }
  }

  it('counts frames, takes the iris as the median of kept frames and estimates the distance from it', () => {
    const samples = [sample({ distanceM: 1.5 }), sample({ distanceM: 1.5 }), sample({ distanceM: 1.5 }), sample({ distanceM: 1.5 }), sample({ pose: { yaw: 9 } })]
    const qc = buildShotQc(args(samples, 6), size)
    expect(qc.shot).toBe('frontal_neutral')
    expect(qc.framesTried).toBe(6)
    expect(qc.framesKept).toBe(4)
    expect(qc.irisPx).toBeCloseTo(samples[0]!.frame.irisPx, 9)
    expect(qc.estimatedDistanceM).toBeCloseTo(1.5, 6)
    expect(qc.burstSpread).toBeCloseTo(0, 9)
    expect(qc.greyCard).toBe(false)
    expect(shotQcPassed(qc)).toBe(true)
  })

  it('has one check per id, the worst across kept frames, plus the burst-agreement check', () => {
    const samples = [sample({ pose: { yaw: 0.2 } }), sample({ pose: { yaw: 2.9 } }), sample({ pose: { yaw: 1 } })]
    const qc = buildShotQc(args(samples), size)
    expect(new Set(qc.checks.map((c) => c.id)).size).toBe(qc.checks.length)
    expect(qc.checks.find((c) => c.id === 'yaw')?.value).toBeCloseTo(2.9)
    expect(qc.checks.at(-1)?.id).toBe('steady')
    expect(qc.checks.at(-1)?.ok).toBe(true)
  })

  it('a burst whose frames disagree fails the steady check and the shot', () => {
    const jumpy = (dx: number) => {
      const s = sample()
      s.frame.named.zygionL = { x: s.frame.named.zygionL.x + dx, y: s.frame.named.zygionL.y }
      s.frame.named.alarL = { x: s.frame.named.alarL.x + dx, y: s.frame.named.alarL.y }
      s.frame.named.cheilionL = { x: s.frame.named.cheilionL.x + dx, y: s.frame.named.cheilionL.y }
      s.frame.named.gonionL = { x: s.frame.named.gonionL.x + dx, y: s.frame.named.gonionL.y }
      s.frame.named.chinTip = { x: s.frame.named.chinTip.x + dx, y: s.frame.named.chinTip.y }
      s.frame.named.nasion = { x: s.frame.named.nasion.x + dx, y: s.frame.named.nasion.y }
      return s
    }
    const qc = buildShotQc(args([jumpy(0), jumpy(30), jumpy(-30)]), size)
    expect(qc.burstSpread).toBeGreaterThan(QC_LIMITS.maxBurstSpread)
    expect(qc.checks.at(-1)).toMatchObject({ id: 'steady', ok: false })
    expect(shotQcPassed(qc)).toBe(false)
  })

  it('with one kept frame the spread is unknown and steadiness fails', () => {
    const qc = buildShotQc(args([sample(), sample({ pose: { yaw: 9 } })]), size)
    expect(qc.framesKept).toBe(1)
    expect(qc.burstSpread).toBeNull()
    expect(qc.checks.at(-1)).toMatchObject({ id: 'steady', ok: false, value: null })
    expect(shotQcPassed(qc)).toBe(false)
  })

  it('when no frame passed it still reports what went wrong, from all frames', () => {
    const samples = [sample({ pose: { yaw: 8 } }), sample({ pose: { yaw: 6 } })]
    const qc = buildShotQc(args(samples), size)
    expect(qc.framesKept).toBe(0)
    expect(qc.checks.find((c) => c.id === 'yaw')).toMatchObject({ ok: false })
    expect(qc.checks.find((c) => c.id === 'yaw')?.value).toBeCloseTo(8)
    expect(qc.irisPx).not.toBeNull()
    expect(qc.estimatedDistanceM).not.toBeNull()
    expect(shotQcPassed(qc)).toBe(false)
  })

  it('when no face was found in any frame the face check fails and nothing is invented', () => {
    const noFace = evaluateFrameQc({ frame: null, pixels: goodPixels(), shot: 'frontal_neutral', imageWidth: W, imageHeight: H })
    const qc = buildShotQc(args([], 5, [noFace, noFace, noFace, noFace, noFace]), size)
    expect(qc.framesTried).toBe(5)
    expect(qc.framesKept).toBe(0)
    expect(qc.irisPx).toBeNull()
    expect(qc.estimatedDistanceM).toBeNull()
    expect(qc.burstSpread).toBeNull()
    expect(qc.checks.find((c) => c.id === 'face')).toMatchObject({ ok: false })
    expect(qc.checks.find((c) => c.id === 'face')?.hint).toMatch(/No face found/)
  })

  it('produces a record the store accepts: finite numbers or null, strings for limit and hint', () => {
    const qc = buildShotQc(args([sample(), sample(), sample()]), size)
    expect(JSON.parse(JSON.stringify(qc))).toEqual(qc)
    for (const c of qc.checks) expect(c.value === null || Number.isFinite(c.value)).toBe(true)
  })
})

// ───────────────────────────── captureBurst with a fake camera ─────────────────────────────

const CLEAN_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xdb, 0, 4, 0, 1, 0xff, 0xda, 0, 4, 0, 0, 1, 2, 0xff, 0xd9])

class FakeCanvas {
  static all: FakeCanvas[] = []
  static drawn: unknown[][] = []
  static encoded: unknown[][] = []
  width = 0
  height = 0
  constructor() {
    FakeCanvas.all.push(this)
  }
  getContext = () => ({
    drawImage: (...args: unknown[]) => FakeCanvas.drawn.push(args),
    // A sharp, evenly lit picture: grey cells, so every pixel check has something to measure.
    getImageData: (x: number, y: number, w: number, h: number) => {
      const buffer = makeBuffer(w, h, (px, py) => (((px + x) >> 2) + ((py + y) >> 2)) % 2 === 0 ? 70 : 190)
      return { data: buffer.data }
    },
  })
  toBlob = (cb: (b: Blob | null) => void, type: string, quality: number) => {
    FakeCanvas.encoded.push([type, quality, this.width, this.height])
    cb(new Blob([CLEAN_JPEG], { type: 'image/jpeg' }))
  }
}

function fakeVideo(width = W, height = H) {
  return { videoWidth: width, videoHeight: height, readyState: 4 } as unknown as HTMLVideoElement
}

function fakeDetector(frames: (FaceFrame | null)[]) {
  let call = 0
  const timestamps: (number | undefined)[] = []
  const detector: FaceDetector = {
    ready: vi.fn(async () => undefined),
    detect: (_source: CanvasImageSource, timestampMs?: number) => {
      timestamps.push(timestampMs)
      return frames[Math.min(call++, frames.length - 1)] ?? null
    },
    close: () => undefined,
    delegate: 'CPU',
  }
  return { detector, timestamps }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeCanvas.all = []
  FakeCanvas.drawn = []
  FakeCanvas.encoded = []
})

function stubDom(): void {
  vi.stubGlobal('document', { createElement: () => new FakeCanvas() })
}

describe('captureBurst', () => {
  const goodFrame = (extra: Parameters<typeof makeFrame>[0] = {}) => makeFrame({ imageWidth: W, imageHeight: H, ...extra })

  it('grabs the requested number of frames, reports progress and returns the best frame as a clean, un-mirrored JPEG', async () => {
    stubDom()
    const { detector, timestamps } = fakeDetector([goodFrame({ pose: { yaw: 2 } }), goodFrame({ pose: { yaw: 0.1 } }), goodFrame({ pose: { yaw: 1 } })])
    const progress: number[] = []
    const result = await captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', frames: 3, intervalMs: 0, onProgress: (n) => progress.push(n) })

    expect(detector.ready).toHaveBeenCalled()
    expect(progress).toEqual([1, 2, 3])
    expect(result.frames).toHaveLength(3)
    expect(result.keptIndexes).toEqual([0, 1, 2])
    expect(result.bestIndex).toBe(1)
    expect(result.width).toBe(W)
    expect(result.height).toBe(H)
    expect(result.jpeg.type).toBe('image/jpeg')
    expect(result.shotQc.framesTried).toBe(3)
    expect(result.shotQc.framesKept).toBe(3)

    // Each frame is the video drawn as it comes, with no transform: the JPEG is not mirrored.
    expect(FakeCanvas.drawn).toHaveLength(3)
    for (const args of FakeCanvas.drawn) expect(args.slice(1)).toEqual([0, 0, W, H])
    // Encoded once, as JPEG at quality 0.92, at the video's full size.
    expect(FakeCanvas.encoded).toEqual([['image/jpeg', 0.92, W, H]])
    // A video-mode detector needs timestamps that strictly increase.
    expect(timestamps).toHaveLength(3)
    for (let i = 1; i < timestamps.length; i++) expect(timestamps[i] as number).toBeGreaterThan(timestamps[i - 1] as number)
  })

  it('defaults to 5 frames', async () => {
    stubDom()
    const { detector } = fakeDetector([goodFrame()])
    const result = await captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', intervalMs: 0 })
    expect(result.shotQc.framesTried).toBe(5)
    expect(FakeCanvas.drawn).toHaveLength(5)
  })

  it('counts frames without a face as tried but does not list them, and still returns the frames that have one', async () => {
    stubDom()
    const { detector } = fakeDetector([null, goodFrame(), null, goodFrame(), goodFrame()])
    const result = await captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', frames: 5, intervalMs: 0 })
    expect(result.shotQc.framesTried).toBe(5)
    expect(result.frames).toHaveLength(3)
    expect(result.shotQc.framesKept).toBe(3)
  })

  it('with no face anywhere it returns the last picture, bestIndex -1 and a face check that fails', async () => {
    stubDom()
    const { detector } = fakeDetector([null])
    const result = await captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', frames: 3, intervalMs: 0 })
    expect(result.frames).toEqual([])
    expect(result.bestIndex).toBe(-1)
    expect(result.keptIndexes).toEqual([])
    expect(result.jpeg.size).toBeGreaterThan(0)
    expect(result.shotQc.framesKept).toBe(0)
    expect(result.shotQc.checks.find((c) => c.id === 'face')?.ok).toBe(false)
  })

  it('passes the baseline iris size on to the quality checks', async () => {
    stubDom()
    const frame = goodFrame()
    const { detector } = fakeDetector([frame])
    const loose = await captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', frames: 3, intervalMs: 0 })
    expect(loose.shotQc.checks.find((c) => c.id === 'distance')?.ok).toBe(true)
    const strict = await captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', frames: 3, intervalMs: 0, baselineIrisPx: frame.irisPx * 1.2 })
    expect(strict.shotQc.checks.find((c) => c.id === 'distance')?.ok).toBe(false)
    expect(strict.shotQc.framesKept).toBe(0)
  })

  it('releases every frame it grabbed', async () => {
    stubDom()
    const { detector } = fakeDetector([goodFrame(), null])
    await captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', frames: 4, intervalMs: 0 })
    expect(FakeCanvas.all).toHaveLength(4)
    for (const canvas of FakeCanvas.all) expect([canvas.width, canvas.height]).toEqual([0, 0])
  })

  it('stops when aborted, rejects with the abort reason and releases the frames', async () => {
    stubDom()
    const { detector } = fakeDetector([goodFrame()])
    const controller = new AbortController()
    const promise = captureBurst({
      video: fakeVideo(),
      detector,
      shot: 'frontal_neutral',
      frames: 5,
      intervalMs: 10,
      signal: controller.signal,
      onProgress: (n) => {
        if (n === 2) controller.abort()
      },
    })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeCanvas.all.length).toBeLessThanOrEqual(3)
    for (const canvas of FakeCanvas.all) expect(canvas.width).toBe(0)
    expect(FakeCanvas.encoded).toEqual([])
  })

  it('rejects at once when the signal is already aborted, without touching the camera', async () => {
    stubDom()
    const { detector } = fakeDetector([goodFrame()])
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(captureBurst({ video: fakeVideo(), detector, shot: 'frontal_neutral', signal: controller.signal })).rejects.toThrow('stop')
    expect(FakeCanvas.all).toHaveLength(0)
  })

  it('says plainly when the camera has no picture yet', async () => {
    stubDom()
    const { detector } = fakeDetector([goodFrame()])
    await expect(captureBurst({ video: fakeVideo(0, 0), detector, shot: 'frontal_neutral', intervalMs: 0 })).rejects.toThrow(/has not produced a picture/)
  })
})

describe('a single still (an imported photo)', () => {
  const size = { width: W, height: H }

  it('has no steadiness check and no spread, and one kept frame is enough', () => {
    const one = sample()
    const qc = buildShotQc({ shot: 'frontal_neutral', framesTried: 1, samples: [one], keptIndexes: [0], faceless: [] }, size)
    expect(qc.framesTried).toBe(1)
    expect(qc.framesKept).toBe(1)
    expect(qc.burstSpread).toBeNull()
    expect(qc.checks.some((c) => c.id === 'steady')).toBe(false)
    expect(qc.estimatedDistanceM).toBeCloseTo(1.5, 6)
    expect(shotQcPassed(qc)).toBe(true)
  })

  it('a still that fails a check is not usable, and says which', () => {
    const bad = sample({ pose: { yaw: 7 } })
    const qc = buildShotQc({ shot: 'frontal_neutral', framesTried: 1, samples: [bad], keptIndexes: [], faceless: [] }, size)
    expect(qc.framesKept).toBe(0)
    expect(qc.checks.find((c) => c.id === 'yaw')?.ok).toBe(false)
    expect(shotQcPassed(qc)).toBe(false)
  })

  it('a burst of several frames still needs the minimum kept frames', () => {
    const two = [sample(), sample()]
    const qc = buildShotQc({ shot: 'frontal_neutral', framesTried: 5, samples: two, keptIndexes: [0, 1], faceless: [] }, size)
    expect(shotQcPassed(qc)).toBe(false)
  })

  describe('inspectStill', () => {
    it('detects, checks and returns the record to store with the photo', async () => {
      stubDom()
      const frame = makeFrame({ imageWidth: W, imageHeight: H })
      const { detector } = fakeDetector([frame])
      const canvas = new FakeCanvas()
      canvas.width = W
      canvas.height = H
      const result = await inspectStill({ canvas: canvas as unknown as HTMLCanvasElement, detector, shot: 'frontal_neutral' })
      expect(detector.ready).toHaveBeenCalled()
      expect(result.frame).toBe(frame)
      expect(result.qc.allOk).toBe(true)
      expect(result.shotQc).toMatchObject({ shot: 'frontal_neutral', framesTried: 1, framesKept: 1, burstSpread: null, greyCard: false })
      expect(shotQcPassed(result.shotQc)).toBe(true)
    })

    it('with no face it fails honestly and invents nothing', async () => {
      stubDom()
      const { detector } = fakeDetector([null])
      const canvas = new FakeCanvas()
      canvas.width = W
      canvas.height = H
      const result = await inspectStill({ canvas: canvas as unknown as HTMLCanvasElement, detector, shot: 'frontal_neutral' })
      expect(result.frame).toBeNull()
      expect(result.shotQc).toMatchObject({ framesKept: 0, irisPx: null, estimatedDistanceM: null })
      expect(result.shotQc.checks[0]).toMatchObject({ id: 'face', ok: false })
      expect(shotQcPassed(result.shotQc)).toBe(false)
    })

    it('applies the baseline distance like a burst does', async () => {
      stubDom()
      const frame = makeFrame({ imageWidth: W, imageHeight: H })
      const { detector } = fakeDetector([frame])
      const canvas = new FakeCanvas()
      canvas.width = W
      canvas.height = H
      const result = await inspectStill({ canvas: canvas as unknown as HTMLCanvasElement, detector, shot: 'frontal_neutral', baselineIrisPx: frame.irisPx * 1.3 })
      expect(result.shotQc.checks.find((c) => c.id === 'distance')?.ok).toBe(false)
      expect(result.shotQc.framesKept).toBe(0)
    })
  })
})
