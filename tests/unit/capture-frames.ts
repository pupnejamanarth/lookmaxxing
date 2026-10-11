/**
 * Synthetic data for the capture tests: a face drawn from proportions (no real photo, no real person), the pixel statistics of
 * a good picture, and ImageData-like buffers. Not a test file (vitest only runs *.test.ts).
 */
import type { FaceFrame, HeadPose, NamedPoint, NamedPoints, Point2 } from '../../src/vision'
import { NAMED_POINTS } from '../../src/vision'
import { assumedHfovDeg } from '../../src/capture/qc'
import type { PixelBuffer, PixelStats } from '../../src/capture/pixels'

/** Mean iris diameter (mm) and pupil distance (mm) the synthetic face uses: the iris is 11.7/63 of the pupil distance. */
export const IRIS_OVER_IPD = 11.7 / 63

/** Landmark positions in units of the pupil distance, relative to the midpoint between the pupils. y grows downward. */
const FACE: Record<NamedPoint, [number, number]> = {
  pupilL: [0.5, 0], pupilR: [-0.5, 0], irisCenterL: [0.5, 0], irisCenterR: [-0.5, 0],
  eyeInnerL: [0.2, 0], eyeInnerR: [-0.2, 0], eyeOuterL: [0.8, 0], eyeOuterR: [-0.8, 0],
  eyeTopL: [0.5, -0.08], eyeTopR: [-0.5, -0.08], eyeBottomL: [0.5, 0.08], eyeBottomR: [-0.5, 0.08],
  browInnerL: [0.25, -0.3], browInnerR: [-0.25, -0.3], browOuterL: [0.85, -0.32], browOuterR: [-0.85, -0.32],
  browMidL: [0.55, -0.34], browMidR: [-0.55, -0.34],
  zygionL: [1.1, 0.4], zygionR: [-1.1, 0.4], gonionL: [0.9, 1.4], gonionR: [-0.9, 1.4],
  noseTip: [0, 0.75], subnasale: [0, 0.9], nasion: [0, -0.05], alarL: [0.3, 0.85], alarR: [-0.3, 0.85],
  cupidBow: [0, 1.15], upperLipTop: [0, 1.15], upperLipBottom: [0, 1.2], lowerLipTop: [0, 1.22], lowerLipBottom: [0, 1.35],
  cheilionL: [0.4, 1.25], cheilionR: [-0.4, 1.25],
  chinTip: [0, 1.8], menton: [0, 1.8], trichion: [0, -1.1],
  faceTop: [0, -0.95], faceLeft: [1.15, 0.4], faceRight: [-1.15, 0.4], faceBottom: [0, 1.8],
}

export function makeNamed(center: Point2, ipdPx: number): NamedPoints {
  const named = {} as NamedPoints
  for (const name of NAMED_POINTS) {
    const [x, y] = FACE[name]
    named[name] = { x: center.x + x * ipdPx, y: center.y + y * ipdPx }
  }
  return named
}

/** Blendshapes of a relaxed, neutral face: every rule's key present and low. */
export function neutralBlendshapes(): Record<string, number> {
  const keys = [
    'mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight', 'jawOpen', 'mouthPressLeft', 'mouthPressRight',
    'mouthPucker', 'mouthFrownLeft', 'mouthFrownRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight',
    'eyeWideLeft', 'eyeWideRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
    'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookOutLeft', 'eyeLookOutRight',
    'eyeLookInLeft', 'eyeLookInRight',
  ]
  return Object.fromEntries(keys.map((k) => [k, 0.03]))
}

export interface FrameOptions {
  imageWidth?: number
  imageHeight?: number
  /** Camera distance in metres the face is drawn for (sets the pupil distance in pixels from the assumed field of view). */
  distanceM?: number
  center?: Point2
  pose?: Partial<HeadPose>
  blendshapes?: Record<string, number>
  /** Override the iris diameter in px (otherwise from the distance). */
  irisPx?: number
}

/** A pupil distance in pixels for a 63 mm pupil distance at `distanceM` in a frame of this size, with the assumed field of view. */
export function ipdPxAt(distanceM: number, imageWidth: number, imageHeight: number): number {
  const focal = imageWidth / 2 / Math.tan((assumedHfovDeg(imageWidth, imageHeight) / 2) * (Math.PI / 180))
  return (focal * 0.063) / distanceM
}

export function makeFrame(options: FrameOptions = {}): FaceFrame {
  const width = options.imageWidth ?? 1920
  const height = options.imageHeight ?? 1080
  const ipd = ipdPxAt(options.distanceM ?? 1.5, width, height)
  const center = options.center ?? { x: width / 2, y: height / 2 - ipd * 0.5 }
  return {
    landmarks: { points: [], width, height, blendshapes: options.blendshapes ?? neutralBlendshapes(), transform: null },
    pose: { yaw: 0, pitch: 0, roll: 0, ...options.pose },
    irisPx: options.irisPx ?? ipd * IRIS_OVER_IPD,
    named: makeNamed(center, ipd),
  }
}

/** Statistics of a well-exposed, sharp, evenly lit face. */
export function goodPixels(overrides: Partial<PixelStats> = {}): PixelStats {
  return { sharpness: 120, clippedShare: 0.0005, meanLuma: 140, lumaP5: 60, lumaP95: 200, leftLuma: 140, rightLuma: 135, ...overrides }
}

/** RGBA buffer filled by a function of (x, y) returning grey 0–255 or [r, g, b]. */
export function makeBuffer(width: number, height: number, pixel: (x: number, y: number) => number | [number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y)
      const [r, g, b] = typeof p === 'number' ? [p, p, p] : p
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

/** Repeated box blur of the grey channel: a stand-in for defocus. */
export function blurred(buffer: PixelBuffer, radius: number, passes = 1): PixelBuffer {
  let current = Uint8ClampedArray.from(buffer.data as ArrayLike<number>)
  const { width, height } = buffer
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8ClampedArray(current.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        let n = 0
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = Math.min(width - 1, Math.max(0, x + dx))
            const yy = Math.min(height - 1, Math.max(0, y + dy))
            sum += current[(yy * width + xx) * 4] as number
            n++
          }
        }
        const i = (y * width + x) * 4
        next[i] = next[i + 1] = next[i + 2] = sum / n
        next[i + 3] = 255
      }
    }
    current = next
  }
  return { data: current, width, height }
}

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32): no Math.random in tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
