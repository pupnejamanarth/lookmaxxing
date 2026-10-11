/**
 * Per-frame quality control (docs/PLAN.md §5): is this frame good enough to measure the face from?
 *
 * Every limit is a named constant in QC_LIMITS with the reason it has that value. Every check returns a plain-language
 * hint, the instruction a person can act on, never a code. A check that cannot be computed FAILS (it is never skipped
 * silently), except the lighting check when the caller supplied no left/right brightness.
 *
 * The functions are pure: they take a detected FaceFrame and pixel statistics, so they are tested with synthetic data.
 */
import { estimateDistanceM } from '../vision'
import type { FaceFrame, NamedPoints } from '../vision'
import type { ShotType } from '../catalog/schema'
import type { FrameQc, QcCheck, ShotQc } from '../domain/types'
import type { PixelStats, Rect } from './pixels'

// ───────────────────────────── limits ─────────────────────────────

export const QC_LIMITS = {
  /** Degrees. docs/PLAN.md §4.2 and §5: a frontal ratio measured with the head turned or tilted more than this is refused. */
  maxYawDeg: 3,
  maxRollDeg: 3,
  /**
   * Degrees. docs/PLAN.md §5. The catalog's per-metric refusal text for frontal metrics is stricter (2° from level) and is
   * applied by the metrics module on top of this gate, so a frame that passes here can still refuse a single metric.
   */
  maxPitchDeg: 4,

  /** Share of the iris pixel width that may differ from the user's baseline (docs/PLAN.md §5: "within ±5 %"). */
  baselineIrisTolerance: 0.05,
  /** Metres. Under this a lens enlarges the nose and face width: docs/PLAN.md §4.2 hard fail "closer than 1.2 m for proportions". */
  minDistanceM: 1.2,
  /**
   * Metres. App-chosen. Beyond it the iris is under about 8 px on a 1080-pixel-wide frame, where one pixel of landmark
   * error is more than 12 % of its width, so the scale and the distance estimate stop being usable.
   */
  maxDistanceM: 2.2,
  /** Metres. docs/PLAN.md §5 protocol distance for face shots; only used to tell the user how far to move. */
  targetDistanceM: 1.5,

  /** Share of each frame dimension the face must stay inside, centred (docs/PLAN.md §5 "central 50 %"): 25 % to 75 % of width and height. */
  centralShare: 0.5,

  /**
   * Laplacian variance (pixels.ts: 3×3 mean, then Laplacian, on a face region of at most 256 px) below which a face is too
   * soft to place landmarks on. CALIBRATED on the one fixture portrait (a sharp studio photo) shrunk to face widths of
   * 96–192 px and then blurred with a Gaussian of known size, with sensor noise added, in Chromium. Measured: sharp 100–130;
   * 0.5 px blur 67–91; 1 px 26–40; 1.5 px 11–24; 2 px 6–15; 3 px 2–9 (noise of 4 grey levels adds under 7, of 8 levels up to 22).
   * 20 sits at a blur of about 1.3 px: at a 100–190 px face that is where eyelid and lip edges stop being placeable to a pixel.
   * Limits: one face and one studio photo; a phone video frame is softer than that, so on a real device this may refuse
   * frames that are acceptable. Re-tune from real captures: the measured sharpness is stored with every shot's checks.
   */
  minSharpness: 20,

  /** Share of face pixels at or above CLIP_LUMA that makes a frame "blown out" (docs/PLAN.md §5: under 1 %). */
  maxClippedShare: 0.01,
  /**
   * 95th-percentile luma (0–255) below which the face is underexposed: even its brightest parts are near black, the
   * sensor noise is then louder than skin detail, and a noisy image would pass the sharpness test falsely. App-chosen and low
   * on purpose: a correctly exposed deep skin tone has highlights well above it, so it must not refuse dark skin.
   */
  minLumaP95: 50,

  /** Relative brightness difference between the two halves of the face that counts as uneven light (app-chosen). */
  maxLightImbalance: 0.2,
  /** Below this mean luma the left/right ratio is dominated by noise; the exposure check owns that case. */
  lightingMinMeanLuma: 30,

  /** Smile blendshape (mean of mouthSmileLeft/Right) needed in a frontal SMILE shot, and the limits that must still hold (app-chosen). */
  smileMin: 0.35,
  smileShotEyesClosedMax: 0.6,
  smileShotJawOpenMax: 0.45,

  /** Burst agreement: median spread of the IPD-normalised key distances across kept frames (app-chosen, uncalibrated: stored per scan so it can be re-tuned). */
  maxBurstSpread: 0.05,
  /** Frames of a burst that must pass for the shot to count (the burst result is their median). */
  minKeptFrames: 3,

  /** Profile yaw: docs/PLAN.md §5 "profile angle 85–95°". Three-quarter is an app-chosen 45° ± 5° (MediaPipe's pose is least reliable near 90°; M2 adds manual landmarks). */
  profileYawDeg: 90,
  profileYawToleranceDeg: 5,
  threeQuarterYawDeg: 45,
  threeQuarterYawToleranceDeg: 5,
} as const

/**
 * Horizontal field of view across the LONGER side of the frame, degrees. 65° is the default of src/vision/geometry.ts
 * (a phone's 1× lens). It is applied to the long edge: a portrait frame (the way the phone is held) is 9:16 or 3:4, so the
 * field across its width is much narrower, and using 65° across a 1080-pixel-wide portrait frame would read a 1.5 m shot
 * as under 1.1 m and refuse every correct capture.
 */
export const ASSUMED_LONG_EDGE_FOV_DEG = 65

/** Field of view across the image width, from the assumed long-edge field of view. */
export function assumedHfovDeg(imageWidth: number, imageHeight: number): number {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return ASSUMED_LONG_EDGE_FOV_DEG
  const half = (ASSUMED_LONG_EDGE_FOV_DEG / 2) * (Math.PI / 180)
  const widthShare = imageWidth / Math.max(imageWidth, imageHeight)
  return 2 * Math.atan(Math.tan(half) * widthShare) * (180 / Math.PI)
}

/** Camera distance in metres from iris size and frame size; NaN when unknown, Infinity when no iris is visible. */
export function distanceFromIris(irisPx: number, imageWidth: number, imageHeight: number): number {
  return estimateDistanceM(irisPx, imageWidth, assumedHfovDeg(imageWidth, imageHeight))
}

// ───────────────────────────── shots ─────────────────────────────

type PoseKind = 'frontal' | 'three_quarter' | 'profile' | 'none'
type ExpressionMode = 'neutral' | 'smile' | null

interface ShotProfile {
  pose: PoseKind
  needsFace: boolean
  distance: boolean
  centered: boolean
  expression: ExpressionMode
  lighting: boolean
}

const FRONTAL: ShotProfile = { pose: 'frontal', needsFace: true, distance: true, centered: true, expression: 'neutral', lighting: true }
const ANGLED: ShotProfile = { pose: 'three_quarter', needsFace: true, distance: true, centered: true, expression: 'neutral', lighting: false }
const NO_FACE_RULES: ShotProfile = { pose: 'none', needsFace: false, distance: false, centered: false, expression: null, lighting: false }

/** What each shot is checked for. Shots that are not a head at 1.5 m (close-ups, body, entries) only get the picture checks. */
const SHOT_PROFILES: Partial<Record<ShotType, ShotProfile>> = {
  frontal_neutral: FRONTAL,
  frontal_smile: { ...FRONTAL, expression: 'smile' },
  hairline_front: FRONTAL,
  hair_natural: { ...FRONTAL, expression: null },
  three_quarter_left: ANGLED,
  three_quarter_right: ANGLED,
  profile_left: { ...ANGLED, pose: 'profile' },
  profile_right: { ...ANGLED, pose: 'profile' },
}

function profileFor(shot: ShotType): ShotProfile {
  return SHOT_PROFILES[shot] ?? NO_FACE_RULES
}

// ───────────────────────────── building checks ─────────────────────────────

/** How far past its limit a check is (≤ 1 = inside, bigger = worse). Kept beside the check, not in it: QcCheck is a stored shape. */
const severities = new WeakMap<QcCheck, number>()
const NOT_COMPUTABLE = 99

const PASS_HINT: Record<QcCheck['id'], string> = {
  face: 'Face found.',
  yaw: 'Head turn is within the limit.',
  roll: 'Head tilt is within the limit.',
  pitch: 'Chin height is within the limit.',
  distance: 'Distance is right.',
  centered: 'Face is in the middle of the frame.',
  sharpness: 'Sharp enough.',
  exposure: 'Exposure is fine.',
  expression: 'Expression is right for this shot.',
  lighting: 'Light is even across the face.',
  steady: 'The burst frames agree.',
}

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function make(id: QcCheck['id'], ok: boolean, value: number | null, limit: string, failHint: string, severity: number): QcCheck {
  const c: QcCheck = { id, ok, value: finiteOrNull(value), limit, hint: ok ? PASS_HINT[id] : failHint }
  severities.set(c, severity)
  return c
}

const round = (n: number, digits = 1): number => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

const unreadable = (id: QcCheck['id'], limit: string, why: string): QcCheck => make(id, false, null, limit, why, NOT_COMPUTABLE)
const NEEDS_FACE = 'Cannot be checked until your face is found.'

// ───────────────────────────── the checks ─────────────────────────────

function faceCheck(frame: FaceFrame | null): QcCheck {
  const limit = 'a face with both eyes and irises found'
  return frame
    ? make('face', true, 1, limit, '', 0)
    : make('face', false, 0, limit, 'No face found. Face the camera with your whole head in view, eyes open, in front-on light.', NOT_COMPUTABLE)
}

function angleCheck(id: 'yaw' | 'roll' | 'pitch', value: number | undefined, kind: PoseKind): QcCheck {
  const target = id === 'yaw' ? (kind === 'profile' ? QC_LIMITS.profileYawDeg : kind === 'three_quarter' ? QC_LIMITS.threeQuarterYawDeg : 0) : 0
  const tolerance =
    id === 'yaw'
      ? kind === 'profile'
        ? QC_LIMITS.profileYawToleranceDeg
        : kind === 'three_quarter'
          ? QC_LIMITS.threeQuarterYawToleranceDeg
          : QC_LIMITS.maxYawDeg
      : id === 'roll'
        ? QC_LIMITS.maxRollDeg
        : QC_LIMITS.maxPitchDeg
  const limit = target === 0 ? `within ${tolerance}°` : `${target - tolerance}–${target + tolerance}° of turn`
  const v = finiteOrNull(value)
  if (v === null) return unreadable(id, limit, frameMissingHint(value))

  // A profile or three-quarter view may face either way; only the size of the turn is judged.
  const error = target === 0 ? Math.abs(v) : Math.abs(Math.abs(v) - target)
  const ok = error <= tolerance
  const off = `${round(error)}°`
  let hint = ''
  if (!ok) {
    if (id === 'yaw') {
      if (target === 0) hint = `Turn your head a little to your ${v > 0 ? 'right' : 'left'}: it is turned ${off} too far. Look straight into the lens.`
      else hint = `Turn your head ${Math.abs(v) < target ? 'further' : 'back'} toward the side-on angle: it is ${off} off ${target}°.`
    } else if (id === 'roll') {
      hint = `Level your head: tilt it a little to your ${v > 0 ? 'right' : 'left'} (${off} off). Your eyes should sit on a level line.`
    } else {
      hint = v > 0 ? `Raise your chin a little (${off} too far down). Ear canal level with the lower eyelid.` : `Tilt your chin down a little (${off} too far up). Ear canal level with the lower eyelid.`
    }
  }
  return make(id, ok, v, limit, hint, error / tolerance)
}

function frameMissingHint(value: number | undefined): string {
  return value === undefined ? NEEDS_FACE : 'The head angle could not be measured. Face the camera and keep your whole head in view.'
}

function distanceCheck(frame: FaceFrame | null, imageWidth: number, imageHeight: number, baselineIrisPx: number | null | undefined): QcCheck {
  const baseline = typeof baselineIrisPx === 'number' && baselineIrisPx > 0 ? baselineIrisPx : null
  const range = `${QC_LIMITS.minDistanceM}–${QC_LIMITS.maxDistanceM} m from the lens`
  const limit = baseline === null ? range : `${range}, iris within ${QC_LIMITS.baselineIrisTolerance * 100}% of your last scan`
  if (!frame) return unreadable('distance', limit, NEEDS_FACE)
  if (!(frame.irisPx > 0)) return unreadable('distance', limit, 'Your irises could not be read, so the distance is unknown. Open both eyes fully, look at the lens, take glasses off.')

  const metres = distanceFromIris(frame.irisPx, imageWidth, imageHeight)
  if (!Number.isFinite(metres)) return unreadable('distance', limit, 'The distance could not be estimated from this frame.')

  const { minDistanceM: min, maxDistanceM: max, targetDistanceM: target } = QC_LIMITS
  const deviation = baseline === null ? 0 : frame.irisPx / baseline - 1
  const baselineOk = Math.abs(deviation) <= QC_LIMITS.baselineIrisTolerance
  const rangeOk = metres >= min && metres <= max
  const ok = rangeOk && baselineOk

  let hint = ''
  if (!rangeOk && metres < min) {
    hint = `Move back about ${round(Math.max(0.1, target - metres))} m (aim for ${target} m). You are too close and this distorts your nose and face width.`
  } else if (!rangeOk) {
    hint = `Move closer about ${round(Math.max(0.1, metres - target))} m (aim for ${target} m). You are too far: the face is too small to measure precisely.`
  } else if (!baselineOk) {
    const cm = Math.max(5, Math.round((Math.abs(metres * deviation) * 100) / 5) * 5)
    const pct = round(Math.abs(deviation) * 100)
    hint = `${deviation > 0 ? 'Move back' : 'Move closer'} about ${cm} cm: you are ${pct}% ${deviation > 0 ? 'closer' : 'farther'} than in your last scan, and a different distance changes your proportions.`
  }
  const severity = Math.max(
    metres < min ? min / metres : metres > max ? metres / max : 0,
    baseline === null ? 0 : Math.abs(deviation) / QC_LIMITS.baselineIrisTolerance,
    ok ? 0.5 : 1.01,
  )
  return make('distance', ok, metres, limit, hint, severity)
}

/** Bounding box of the face outline in image pixels, or null if a point is not a number. */
export function faceBox(named: NamedPoints): Rect | null {
  const xs = [named.faceLeft.x, named.faceRight.x]
  const ys = [named.faceTop.y, named.faceBottom.y]
  if (![...xs, ...ys].every(Number.isFinite)) return null
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function centeredCheck(frame: FaceFrame | null, imageWidth: number, imageHeight: number): QcCheck {
  const limit = `face inside the middle ${QC_LIMITS.centralShare * 100}% of the frame`
  if (!frame) return unreadable('centered', limit, NEEDS_FACE)
  const box = faceBox(frame.named)
  if (!box) return unreadable('centered', limit, 'The face outline could not be measured. Face the camera with your whole head in view.')

  const margin = (1 - QC_LIMITS.centralShare) / 2
  const left = imageWidth * margin
  const right = imageWidth * (1 - margin)
  const top = imageHeight * margin
  const bottom = imageHeight * (1 - margin)
  const over = {
    left: Math.max(0, left - box.x),
    right: Math.max(0, box.x + box.width - right),
    top: Math.max(0, top - box.y),
    bottom: Math.max(0, box.y + box.height - bottom),
  }
  const px = Math.max(over.left, over.right, over.top, over.bottom)
  const ok = px <= 0
  const tooBig = box.width > right - left || box.height > bottom - top

  let hint = ''
  if (!ok) {
    if (tooBig) hint = 'Move back so your whole head fits in the middle of the frame.'
    else if (Math.max(over.top, over.bottom) >= Math.max(over.left, over.right)) {
      hint = `Centre your face in the frame: it is too ${over.top > over.bottom ? 'high' : 'low'}. Move your phone, not your head.`
    } else hint = 'Centre your face in the frame: it is too far to the side. Move your phone, not your head.'
  }
  const share = Math.max(over.left / imageWidth, over.right / imageWidth, over.top / imageHeight, over.bottom / imageHeight)
  return make('centered', ok, share, limit, hint, ok ? 0.5 : 1 + share * 10)
}

function sharpnessCheck(pixels: PixelStats): QcCheck {
  const limit = `sharpness at least ${QC_LIMITS.minSharpness}`
  const ok = pixels.sharpness >= QC_LIMITS.minSharpness
  const hint = 'The picture is blurred. Hold still or use a stand, tap the face to focus, and wipe the lens.'
  return make('sharpness', ok, pixels.sharpness, limit, hint, QC_LIMITS.minSharpness / Math.max(pixels.sharpness, 1e-6))
}

function exposureCheck(pixels: PixelStats): QcCheck {
  const limit = `under ${QC_LIMITS.maxClippedShare * 100}% blown highlights and not underexposed`
  const blown = pixels.clippedShare >= QC_LIMITS.maxClippedShare
  const dark = pixels.lumaP95 < QC_LIMITS.minLumaP95
  const ok = !blown && !dark
  let hint = ''
  if (blown) hint = `Too bright: ${round(pixels.clippedShare * 100)}% of the face is blown out. Move out of direct light or lower the exposure.`
  else if (dark) hint = 'Too dark: the face is underexposed. Face a window with daylight or add soft light in front of you.'
  const severity = Math.max(pixels.clippedShare / QC_LIMITS.maxClippedShare, QC_LIMITS.minLumaP95 / Math.max(pixels.lumaP95, 1e-6))
  return make('exposure', ok, pixels.clippedShare, limit, hint, severity)
}

/** One thing a neutral face must not be doing: the mean of these blendshapes (0–1) has to stay at or under `limit`. */
interface NeutralRule {
  keys: readonly string[]
  limit: number
  hint: string
}

/**
 * Blendshape limits for a neutral face. App-chosen, from the ARKit/MediaPipe 0–1 scale, in which a relaxed face sits
 * near 0 for every one of these; they are generous on the eyes and brows (resting brows and narrow eyes read well above 0
 * on some faces) and tight on the mouth, where a smile is what moves the soft-tissue landmarks the metrics use. Checked on
 * one smiling portrait (it must fail) only: re-tune from stored `expression` values once real neutral captures exist.
 */
export const NEUTRAL_RULES: readonly NeutralRule[] = [
  { keys: ['mouthSmileLeft', 'mouthSmileRight'], limit: 0.25, hint: 'Relax your smile: lips lightly closed, no smile.' },
  { keys: ['cheekSquintLeft', 'cheekSquintRight'], limit: 0.35, hint: 'Relax your cheeks: they are pushed up as if smiling.' },
  { keys: ['jawOpen'], limit: 0.1, hint: 'Close your mouth: lips together, teeth not clenched.' },
  { keys: ['mouthPressLeft', 'mouthPressRight'], limit: 0.5, hint: 'Soften your lips: they are pressed together hard.' },
  { keys: ['mouthPucker'], limit: 0.3, hint: 'Relax your lips: they are pursed.' },
  { keys: ['mouthFrownLeft', 'mouthFrownRight'], limit: 0.35, hint: 'Relax your mouth: the corners are pulled down.' },
  { keys: ['eyeBlinkLeft', 'eyeBlinkRight'], limit: 0.5, hint: 'Open your eyes fully and look into the lens.' },
  { keys: ['eyeSquintLeft', 'eyeSquintRight'], limit: 0.5, hint: 'Stop squinting: open your eyes fully.' },
  { keys: ['eyeWideLeft', 'eyeWideRight'], limit: 0.5, hint: 'Relax your eyes: they are opened wide.' },
  { keys: ['browDownLeft', 'browDownRight'], limit: 0.6, hint: 'Relax your brows: they are pulled down.' },
  { keys: ['browInnerUp'], limit: 0.4, hint: 'Relax your brows: they are raised.' },
  { keys: ['browOuterUpLeft', 'browOuterUpRight'], limit: 0.4, hint: 'Relax your brows: they are raised.' },
  { keys: ['eyeLookUpLeft', 'eyeLookUpRight'], limit: 0.5, hint: 'Look into the lens, not above it.' },
  { keys: ['eyeLookDownLeft', 'eyeLookDownRight'], limit: 0.5, hint: 'Look into the lens, not down at the screen.' },
  { keys: ['eyeLookOutLeft', 'eyeLookInRight'], limit: 0.5, hint: 'Look into the lens: your eyes are turned to the side.' },
  { keys: ['eyeLookInLeft', 'eyeLookOutRight'], limit: 0.5, hint: 'Look into the lens: your eyes are turned to the side.' },
]

const mean = (shapes: Record<string, number>, keys: readonly string[]): number | null => {
  const values = keys.map((k) => shapes[k])
  return values.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (values as number[]).reduce((s, v) => s + v, 0) / values.length : null
}

function expressionCheck(frame: FaceFrame | null, mode: 'neutral' | 'smile'): QcCheck {
  const limit =
    mode === 'neutral'
      ? 'neutral face: no smile, mouth closed, eyes open and on the lens, brows relaxed'
      : `a real smile (smile signal at least ${QC_LIMITS.smileMin}) with eyes open and mouth not wide open`
  if (!frame) return unreadable('expression', limit, NEEDS_FACE)
  const shapes = frame.landmarks.blendshapes
  if (Object.keys(shapes).length === 0) return unreadable('expression', limit, 'The expression could not be read from this frame.')

  if (mode === 'smile') {
    const smile = mean(shapes, ['mouthSmileLeft', 'mouthSmileRight'])
    const blink = mean(shapes, ['eyeBlinkLeft', 'eyeBlinkRight']) ?? 0
    const jaw = mean(shapes, ['jawOpen']) ?? 0
    if (smile === null) return unreadable('expression', limit, 'The smile could not be read from this frame.')
    const ok = smile >= QC_LIMITS.smileMin && blink <= QC_LIMITS.smileShotEyesClosedMax && jaw <= QC_LIMITS.smileShotJawOpenMax
    const hint =
      smile < QC_LIMITS.smileMin
        ? 'Smile naturally: the smile is too faint to count.'
        : blink > QC_LIMITS.smileShotEyesClosedMax
          ? 'Keep your eyes open while you smile.'
          : 'Smile without opening your mouth wide.'
    return make('expression', ok, smile, limit, hint, ok ? 0.5 : 1 + Math.max(0, QC_LIMITS.smileMin - smile) * 5)
  }

  let worst = { ratio: 0, hint: '' }
  for (const rule of NEUTRAL_RULES) {
    const level = mean(shapes, rule.keys)
    if (level === null) continue
    const ratio = level / rule.limit
    if (ratio > worst.ratio) worst = { ratio, hint: rule.hint }
  }
  return make('expression', worst.ratio <= 1, worst.ratio, limit, worst.hint, worst.ratio)
}

function lightingCheck(pixels: PixelStats): QcCheck | null {
  const { leftLuma, rightLuma } = pixels
  if (typeof leftLuma !== 'number' || typeof rightLuma !== 'number') return null
  const limit = `left and right of the face within ${QC_LIMITS.maxLightImbalance * 100}% of each other in brightness`
  const average = (leftLuma + rightLuma) / 2
  if (average < QC_LIMITS.lightingMinMeanLuma) {
    return make('lighting', false, null, limit, 'Too dark to judge the light. Face a window with daylight or add soft light in front of you.', NOT_COMPUTABLE)
  }
  const imbalance = Math.abs(leftLuma - rightLuma) / average
  const ok = imbalance <= QC_LIMITS.maxLightImbalance
  const hint = `The light is uneven: one side of your face is ${round(imbalance * 100, 0)}% brighter than the other. Face the window squarely, or add a second diffused light on the dark side.`
  return make('lighting', ok, imbalance, limit, hint, imbalance / QC_LIMITS.maxLightImbalance)
}

// ───────────────────────────── the frame ─────────────────────────────

export interface FrameQcArgs {
  frame: FaceFrame | null
  pixels: PixelStats
  shot: ShotType
  imageWidth: number
  imageHeight: number
  /** Iris diameter (px) of the user's last accepted scan. With it the distance must match within ±5%. */
  baselineIrisPx?: number | null
}

/** Runs every check that applies to this shot on one frame. Order = the order a person should fix things in. */
export function evaluateFrameQc(args: FrameQcArgs): FrameQc {
  const { frame, pixels, shot, imageWidth, imageHeight, baselineIrisPx } = args
  const profile = profileFor(shot)
  const checks: QcCheck[] = []

  if (profile.needsFace) checks.push(faceCheck(frame))
  if (profile.pose !== 'none') {
    checks.push(angleCheck('yaw', frame?.pose.yaw, profile.pose))
    checks.push(angleCheck('roll', frame?.pose.roll, profile.pose))
    checks.push(angleCheck('pitch', frame?.pose.pitch, profile.pose))
  }
  if (profile.distance) checks.push(distanceCheck(frame, imageWidth, imageHeight, baselineIrisPx))
  if (profile.centered) checks.push(centeredCheck(frame, imageWidth, imageHeight))
  checks.push(sharpnessCheck(pixels), exposureCheck(pixels))
  if (profile.expression) checks.push(expressionCheck(frame, profile.expression))
  if (profile.lighting) {
    const lighting = frame ? lightingCheck(pixels) : unreadable('lighting', 'even light across the face', NEEDS_FACE)
    if (lighting) checks.push(lighting)
  }
  return { allOk: checks.every((c) => c.ok), checks }
}

// ───────────────────────────── regions of a detected face ─────────────────────────────

export interface FaceRegions {
  face: Rect
  left?: Rect
  right?: Rect
}

/**
 * Where to measure a detected face: its bounding box (padded 4%) for sharpness and exposure, and one cheek patch each side
 * (between the cheek edge and the nose wing, from just under the eyes down to the mouth corners) for the lighting check.
 * Cheeks, not the whole box: its corners hold hair and background that would decide the left/right comparison.
 */
export function faceRegions(named: NamedPoints, imageWidth: number, imageHeight: number): FaceRegions | null {
  const box = faceBox(named)
  if (!box || !(box.width > 0) || !(box.height > 0)) return null
  const pad = 0.04
  const face: Rect = {
    x: Math.max(0, box.x - box.width * pad),
    y: Math.max(0, box.y - box.height * pad),
    width: Math.min(imageWidth, box.width * (1 + 2 * pad)),
    height: Math.min(imageHeight, box.height * (1 + 2 * pad)),
  }

  const eyeY = Math.max(named.eyeBottomL.y, named.eyeBottomR.y)
  const mouthY = (named.cheilionL.y + named.cheilionR.y) / 2
  const top = eyeY + 0.2 * (mouthY - eyeY)
  const patch = (outerX: number, innerX: number): Rect | undefined => {
    const span = Math.abs(innerX - outerX)
    const inset = span * 0.2
    const rect = { x: Math.min(outerX, innerX) + inset, y: top, width: span - 2 * inset, height: mouthY - top }
    return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 1 && rect.height > 1 ? rect : undefined
  }
  // Image-left is the subject's right (types.ts): zygionR / alarR.
  return { face, left: patch(named.zygionR.x, named.alarR.x), right: patch(named.alarL.x, named.zygionL.x) }
}

// ───────────────────────────── the shot ─────────────────────────────

/**
 * For each check id, the instance from the frame where it was worst (the nearest to, or furthest past, its limit), so the
 * shot's record answers "how bad did this get across the burst" and not "how good was the luckiest frame".
 */
export function worstChecks(results: readonly FrameQc[]): QcCheck[] {
  const worst = new Map<QcCheck['id'], QcCheck>()
  for (const qc of results) {
    for (const c of qc.checks) {
      const current = worst.get(c.id)
      const severity = severities.get(c) ?? (c.ok ? 0 : 2)
      if (!current || severity > (severities.get(current) ?? (current.ok ? 0 : 2)) || (!c.ok && current.ok)) worst.set(c.id, c)
    }
  }
  return [...worst.values()]
}

/** Builds the 'steady' check from the spread of a burst. `null` spread (fewer than 2 kept frames) fails: steadiness is unproven. */
export function steadyCheck(burstSpread: number | null): QcCheck {
  const limit = `burst spread under ${QC_LIMITS.maxBurstSpread * 100}% of your pupil distance`
  if (burstSpread === null) {
    return make('steady', false, null, limit, 'Fewer than two frames passed the checks, so steadiness cannot be confirmed. Hold still and fix the failed checks.', NOT_COMPUTABLE)
  }
  const ok = burstSpread <= QC_LIMITS.maxBurstSpread
  return make(
    'steady',
    ok,
    burstSpread,
    limit,
    `The frames disagree by ${round(burstSpread * 100)}% of your pupil distance. Hold still, or put the phone on a stand and stay put for the whole burst.`,
    burstSpread / QC_LIMITS.maxBurstSpread,
  )
}

/**
 * True when a shot may be used: enough frames passed and every aggregated check holds. A burst needs MIN_KEPT_FRAMES kept
 * frames; a single still (framesTried 1, e.g. an imported photo) needs its one frame.
 */
export function shotQcPassed(qc: ShotQc): boolean {
  const needed = qc.framesTried <= 1 ? 1 : QC_LIMITS.minKeptFrames
  return qc.framesKept >= needed && qc.checks.length > 0 && qc.checks.every((c) => c.ok)
}
