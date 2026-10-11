/**
 * When the frontal metrics must NOT be computed, and how good the capture was when they are.
 *
 * Three jobs:
 *  1. assessFrame / analyseScan: decide which burst frames are usable at all (a complete, plausible face mesh) and
 *     collect the capture facts every gate reads: head pose, camera distance, centring, expression, light, irises.
 *  2. evaluateGates: for one metric, turn those facts into refusal reasons (each with the measured value and the limit)
 *     and re-capture instructions. Which gates apply to a metric is the table GATE_PROFILES, which mirrors the
 *     `refusalConditions` of that metric in the catalog; a unit test fails if the two drift apart.
 *  3. qcFactorFor: the 0–1 photo-quality factor of a measurement that was NOT refused.
 *
 * Limits come from the capture module (QC_LIMITS), so the metrics refuse exactly where the live guide stops the user.
 * The one deliberate difference: the catalog text says "head pitch above 2° from level", PLAN §4.2/§5 say 4°. A frontal
 * photo of the stock portrait, which looks level, reads 3.9° of pitch, and the mesh pitch is itself good to only a few
 * degrees, so refusing at 2° would refuse ordinary good captures. The metrics refuse at 4° (QC_LIMITS.maxPitchDeg) and
 * start losing quality factor from 2° (QC_FACTOR.pitch), which keeps the catalog's number meaningful.
 */
import { NEUTRAL_RULES, QC_LIMITS, distanceFromIris, faceBox } from '../capture/qc'
import type { ShotType } from '../catalog/schema'
import type { QcCheck, ScanRecord, ShotQc } from '../domain/types'
import { IRIS, dist } from '../vision/geometry'
import { NAMED_POINTS } from '../vision/types'
import type { FaceFrame } from '../vision/types'
import { geoFromFrame } from './frontal'
import type { FrontalMetricId, GeoInput } from './frontal'
import { median, product, round, softLimitFactor } from './stats'

// ───────────────────────────── limits ─────────────────────────────

/** Fewest usable frames a burst may have (PLAN §5: "burst agreement"; the capture module keeps at least 3). */
export const MIN_USABLE_FRAMES = QC_LIMITS.minKeptFrames

/** Camera distance for ordinary proportions (PLAN §4.2 hard fail) and for nose widths and FWHR (catalog F10, F14). */
export const MIN_DISTANCE_PROPORTIONS_M = QC_LIMITS.minDistanceM
export const MIN_DISTANCE_NOSE_M = 1.5
/** Uncertainty of a distance taken from the iris (src/vision/geometry.ts: "good to about ±15%"). */
export const DISTANCE_ESTIMATE_REL_ERROR = 0.15

/** Pupil distance in pixels under which no landmark can be trusted to a useful fraction of it. */
export const MIN_IPD_PX = 24
/** Plausible band of pupil distance ÷ cheekbone width. Real faces sit near 0.46; outside this the mesh is garbage. */
export const IPD_OVER_FACE_WIDTH = { min: 0.3, max: 0.7 } as const
/** Plausible band of (pupil line to chin tip) ÷ pupil distance. Real faces sit near 1.6–1.9. */
export const CHIN_DEPTH_OVER_IPD = { min: 1.2, max: 2.6 } as const
/** Largest difference between the two iris diameters, as a share of their mean, before the irises count as misread. */
export const IRIS_PAIR_MAX_MISMATCH = 0.25

/**
 * Quality factor constants. For each capture error the factor is 1 while the error is "clean", falls in a straight line to
 * `atLimit` at the refusal limit, and metrics refuse beyond that. They are multiplied into Measurement.qcFactor, and
 * scoring multiplies confidence by it (confidence = method × qcFactor × repeatability). App-chosen: a capture sitting
 * exactly on every limit gets 0.85³ × 0.9 × 0.9 × 0.9 ≈ 0.45, a LOW confidence, which is the intent.
 */
export const QC_FACTOR = {
  yaw: { clean: 1, atLimit: 0.85 },
  roll: { clean: 1, atLimit: 0.85 },
  /** Clean up to the catalog's 2°; the refusal limit is QC_LIMITS.maxPitchDeg. */
  pitch: { clean: 2, atLimit: 0.85 },
  /** Distance: full marks from the protocol distance up to DISTANCE_FULL_TO_M; the lowest factor at the nearest allowed and at the far QC limit. */
  distance: { fullFromM: QC_LIMITS.targetDistanceM, fullToM: 1.9, atEnds: 0.85 },
  /** Offset of the face centre from the frame centre, as a share of the frame side: clean within 10%, 25% = the edge of the central half. */
  centre: { clean: 0.1, limit: 0.25, atLimit: 0.9 },
  /** Worst neutral-expression signal ÷ its limit: clean up to half the limit. */
  expression: { clean: 0.5, limit: 1, atLimit: 0.9 },
} as const

// ───────────────────────────── gate profiles ─────────────────────────────

export type ExpressionGroup = 'mouth' | 'brow' | 'eye'
export type ExtraGate = 'lighting' | 'jawHidden' | 'chinHidden' | 'lipEdgeHidden' | 'illness' | 'bothIrises'

export interface GateProfile {
  /** Yaw, roll and pitch limits. */
  pose: boolean
  /** Face inside the central half of the frame. */
  centred: boolean
  /** Minimum estimated camera distance in metres; null = no distance gate. */
  minDistanceM: number | null
  /** Which families of the neutral-expression rules must hold. */
  expression: readonly ExpressionGroup[]
  extra: readonly ExtraGate[]
}

const FRONTAL: Omit<GateProfile, 'expression' | 'extra' | 'minDistanceM'> = { pose: true, centred: true }
const FACE_NEUTRAL: readonly ExpressionGroup[] = ['mouth', 'brow']
const EYES_OPEN: readonly ExpressionGroup[] = ['mouth', 'brow', 'eye']

/** Mirrors `refusalConditions` in src/catalog/data/face.ts. Kept in sync by tests/unit/metrics-frontal.test.ts. */
export const GATE_PROFILES: Record<Exclude<FrontalMetricId, 'F21'>, GateProfile> = {
  F01: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: FACE_NEUTRAL, extra: ['jawHidden', 'illness'] },
  F05: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: FACE_NEUTRAL, extra: ['lighting'] },
  F07: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: EYES_OPEN, extra: [] },
  F08: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: EYES_OPEN, extra: [] },
  F10: { ...FRONTAL, minDistanceM: MIN_DISTANCE_NOSE_M, expression: FACE_NEUTRAL, extra: [] },
  F11: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: FACE_NEUTRAL, extra: [] },
  F12: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: EYES_OPEN, extra: [] },
  F14: { ...FRONTAL, minDistanceM: MIN_DISTANCE_NOSE_M, expression: FACE_NEUTRAL, extra: [] },
  F15: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: FACE_NEUTRAL, extra: [] },
  F16: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: FACE_NEUTRAL, extra: ['chinHidden'] },
  F17: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: FACE_NEUTRAL, extra: ['jawHidden'] },
  F22: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: FACE_NEUTRAL, extra: ['lipEdgeHidden'] },
  F23: { ...FRONTAL, minDistanceM: MIN_DISTANCE_PROPORTIONS_M, expression: ['eye'], extra: ['bothIrises'] },
}

/** A metric computed from the points of others is refused wherever any of them would be. */
export function mergeProfiles(...profiles: GateProfile[]): GateProfile {
  return {
    pose: profiles.some((p) => p.pose),
    centred: profiles.some((p) => p.centred),
    minDistanceM: profiles.reduce<number | null>((m, p) => (p.minDistanceM === null ? m : m === null ? p.minDistanceM : Math.max(m, p.minDistanceM)), null),
    expression: [...new Set(profiles.flatMap((p) => p.expression))],
    extra: [...new Set(profiles.flatMap((p) => p.extra))],
  }
}

/** F21 reads the nose width (as F14) and the mouth-to-chin split (as F16). */
export const F21_PROFILE: GateProfile = mergeProfiles(GATE_PROFILES.F14, GATE_PROFILES.F16)

export function gateProfileFor(id: FrontalMetricId): GateProfile {
  return id === 'F21' ? F21_PROFILE : GATE_PROFILES[id]
}

// ───────────────────────────── per-frame assessment ─────────────────────────────

export interface UsableFrame {
  /** Position in the frames the caller supplied. */
  index: number
  frame: FaceFrame
  geo: GeoInput
}

export type Assessment = { ok: true; usable: UsableFrame } | { ok: false; why: string }

/** What is wrong with the order or proportions of the points, or null. In the pupil-line frame y grows downward. */
function implausibleOrder(geo: GeoInput): string | null {
  const { pts } = geo
  const dx = pts.pupilL.x - pts.pupilR.x
  const dy = pts.pupilL.y - pts.pupilR.y
  const ipd = Math.hypot(dx, dy)
  if (!(ipd >= MIN_IPD_PX)) return `the pupil distance is ${round(ipd, 1)} px (minimum ${MIN_IPD_PX} px), too small to measure`
  const ux = dx / ipd
  const uy = dy / ipd
  const ox = (pts.pupilL.x + pts.pupilR.x) / 2
  const oy = (pts.pupilL.y + pts.pupilR.y) / 2
  const X = (p: { x: number; y: number }) => ((p.x - ox) * ux + (p.y - oy) * uy) / ipd
  const Y = (p: { x: number; y: number }) => (-(p.x - ox) * uy + (p.y - oy) * ux) / ipd

  // Head up, left eye on the left side of the pupil line's origin: a face upside down, mirrored or scrambled fails here.
  const order: [string, number, number][] = [
    ['brows above the pupil line', Y({ x: (pts.browMidL.x + pts.browMidR.x) / 2, y: (pts.browMidL.y + pts.browMidR.y) / 2 }), 0],
    ['pupil line above the base of the nose', 0, Y(pts.subnasale)],
    ['base of the nose above the upper lip', Y(pts.subnasale), Y(pts.upperLipTop)],
    ['upper lip above the lower lip', Y(pts.upperLipTop), Y(pts.lowerLipBottom)],
    ['lower lip above the chin', Y(pts.lowerLipBottom), Y(pts.chinTip)],
    ['inner eye corners inside the outer ones (left eye)', X(pts.eyeInnerL), X(pts.eyeOuterL)],
    ['inner eye corners inside the outer ones (right eye)', X(pts.eyeOuterR), X(pts.eyeInnerR)],
    ['right inner eye corner left of the left one', X(pts.eyeInnerR), X(pts.eyeInnerL)],
  ]
  for (const [what, a, b] of order) if (!(a < b)) return `the landmarks are out of order (expected ${what})`

  const face = Math.abs(X(pts.zygionL) - X(pts.zygionR))
  const ratio = face > 0 ? 1 / face : Number.NaN
  if (!(ratio >= IPD_OVER_FACE_WIDTH.min && ratio <= IPD_OVER_FACE_WIDTH.max)) {
    return `the pupil distance is ${round(ratio * 100, 0)}% of the cheekbone width (plausible ${IPD_OVER_FACE_WIDTH.min * 100}–${IPD_OVER_FACE_WIDTH.max * 100}%)`
  }
  const chin = Y(pts.chinTip)
  if (!(chin >= CHIN_DEPTH_OVER_IPD.min && chin <= CHIN_DEPTH_OVER_IPD.max)) {
    return `the chin is ${round(chin, 2)} pupil distances below the pupil line (plausible ${CHIN_DEPTH_OVER_IPD.min}–${CHIN_DEPTH_OVER_IPD.max})`
  }
  return null
}

/** Is this frame a complete, plausible face mesh with a known head pose? Never throws: a malformed frame is just unusable. */
export function assessFrame(frame: FaceFrame | null | undefined, index: number): Assessment {
  if (!frame || typeof frame !== 'object') return { ok: false, why: 'no face mesh' }
  const named = frame.named as Partial<Record<string, { x: number; y: number }>> | undefined
  if (!named) return { ok: false, why: 'no named landmarks' }
  for (const key of NAMED_POINTS) {
    const p = named[key]
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { ok: false, why: `landmark ${key} is missing` }
  }
  const pose = frame.pose
  if (!pose || ![pose.yaw, pose.pitch, pose.roll].every(Number.isFinite)) return { ok: false, why: 'head pose could not be measured' }
  if (!(Number.isFinite(frame.irisPx) && frame.irisPx > 0)) return { ok: false, why: 'iris not detected' }
  const lm = frame.landmarks
  if (!lm || !(lm.width > 0) || !(lm.height > 0)) return { ok: false, why: 'image size unknown' }
  const geo = geoFromFrame(frame)
  if (!geo) return { ok: false, why: 'landmarks incomplete' }
  const bad = implausibleOrder(geo)
  if (bad) return { ok: false, why: bad }
  return { ok: true, usable: { index, frame, geo } }
}

// ───────────────────────────── scan-level diagnostics ─────────────────────────────

type NeutralRule = (typeof NEUTRAL_RULES)[number]

export interface PoseStat {
  /** Mean of |angle| over the usable frames, degrees. */
  meanAbs: number
  /** Mean signed angle (direction of the error, for the instruction). */
  mean: number
}

export interface ExpressionReading {
  rule: NeutralRule
  group: ExpressionGroup
  /** Median signal over the frames, 0–1; null when the face model gave none of the rule's blendshapes. */
  level: number | null
}

export interface ScanDiagnostics {
  shot: ShotType
  shotQc: ShotQc
  conditions: ScanRecord['conditions']
  framesTotal: number
  usable: UsableFrame[]
  rejected: { index: number; why: string }[]
  yaw: PoseStat
  roll: PoseStat
  pitch: PoseStat
  /** Metres; from the capture record when it has one, else from the iris size of the usable frames. */
  distanceM: number | null
  centre: { overshoot: number; side: 'left' | 'right' | 'top' | 'bottom' | null; offset: number }
  expression: ExpressionReading[]
  lighting: QcCheck | null
  /** Median iris diameters in px (null when the frames carry no mesh points). */
  irises: { left: number; right: number } | null
  /** Median iris diameter in px over the usable frames. */
  irisPx: number
  imageWidth: number
  imageHeight: number
}

export function expressionGroup(rule: NeutralRule): ExpressionGroup {
  const key = rule.keys[0] ?? ''
  if (key.startsWith('brow')) return 'brow'
  if (key.startsWith('eye')) return 'eye'
  return 'mouth'
}

const RULE_LABELS: readonly (readonly [string, string])[] = [
  ['mouthSmile', 'smile'],
  ['cheekSquint', 'cheeks raised'],
  ['jawOpen', 'mouth open'],
  ['mouthPress', 'lips pressed together'],
  ['mouthPucker', 'lips pursed'],
  ['mouthFrown', 'mouth corners pulled down'],
  ['eyeBlink', 'eyes closing'],
  ['eyeSquint', 'eyes squinting'],
  ['eyeWide', 'eyes wide open'],
  ['browDown', 'brows pulled down'],
  ['browInnerUp', 'brows raised'],
  ['browOuterUp', 'brows raised'],
  ['eyeLook', 'gaze off the lens'],
]

export function ruleLabel(rule: NeutralRule): string {
  const key = rule.keys[0] ?? ''
  return RULE_LABELS.find(([prefix]) => key.startsWith(prefix))?.[1] ?? rule.keys.join('/')
}

function blendshapeLevel(shapes: Record<string, number> | undefined, keys: readonly string[]): number | null {
  if (!shapes) return null
  const values = keys.map((k) => shapes[k])
  return values.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (values as number[]).reduce((s, v) => s + v, 0) / values.length : null
}

function poseStat(values: readonly number[]): PoseStat {
  if (values.length === 0) return { meanAbs: Number.NaN, mean: Number.NaN }
  return { meanAbs: values.reduce((s, v) => s + Math.abs(v), 0) / values.length, mean: values.reduce((s, v) => s + v, 0) / values.length }
}

/** How far the face outline reaches outside the central share of the frame, per side, as a share of that frame side. */
function centreOf(frame: FaceFrame): { share: number; side: 'left' | 'right' | 'top' | 'bottom' | null; offset: number } | null {
  const box = faceBox(frame.named)
  const { width: w, height: h } = frame.landmarks
  if (!box) return null
  const margin = (1 - QC_LIMITS.centralShare) / 2
  const over = {
    left: Math.max(0, w * margin - box.x) / w,
    right: Math.max(0, box.x + box.width - w * (1 - margin)) / w,
    top: Math.max(0, h * margin - box.y) / h,
    bottom: Math.max(0, box.y + box.height - h * (1 - margin)) / h,
  }
  const worst = (Object.entries(over) as [keyof typeof over, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))
  const offset = Math.max(Math.abs(box.x + box.width / 2 - w / 2) / w, Math.abs(box.y + box.height / 2 - h / 2) / h)
  return { share: worst[1], side: worst[1] > 0 ? worst[0] : null, offset }
}

export function analyseScan(args: {
  frames: readonly (FaceFrame | null | undefined)[]
  shotQc: ShotQc
  conditions?: ScanRecord['conditions']
}): ScanDiagnostics {
  const { frames, shotQc } = args
  const usable: UsableFrame[] = []
  const rejected: { index: number; why: string }[] = []
  frames.forEach((frame, index) => {
    const a = assessFrame(frame, index)
    if (a.ok) usable.push(a.usable)
    else rejected.push({ index, why: a.why })
  })

  const poses = usable.map((u) => u.frame.pose)
  const first = usable[0]?.frame.landmarks
  const imageWidth = first?.width ?? Number.NaN
  const imageHeight = first?.height ?? Number.NaN

  const fromRecord = shotQc.estimatedDistanceM
  let distanceM: number | null = typeof fromRecord === 'number' && Number.isFinite(fromRecord) && fromRecord > 0 ? fromRecord : null
  if (distanceM === null && usable.length > 0) {
    const d = median(usable.map((u) => distanceFromIris(u.frame.irisPx, u.frame.landmarks.width, u.frame.landmarks.height)))
    distanceM = Number.isFinite(d) && d > 0 ? d : null
  }

  const centres = usable.map((u) => centreOf(u.frame)).filter((c): c is NonNullable<typeof c> => c !== null)
  const sorted = [...centres].sort((a, b) => a.share - b.share)
  const mid = sorted[sorted.length >> 1]
  const offsets = centres.map((c) => c.offset)

  const expression: ExpressionReading[] = NEUTRAL_RULES.map((rule) => {
    const levels = usable.map((u) => blendshapeLevel(u.frame.landmarks.blendshapes, rule.keys)).filter((v): v is number => v !== null)
    return { rule, group: expressionGroup(rule), level: levels.length > 0 ? median(levels) : null }
  })

  const diameters = (pair: readonly number[]): number[] =>
    usable
      .map((u) => {
        const a = u.frame.landmarks.points?.[pair[0] as number]
        const b = u.frame.landmarks.points?.[pair[1] as number]
        return a && b ? dist(a, b) : Number.NaN
      })
      .filter((d) => Number.isFinite(d))
  const left = diameters(IRIS.horizontalL)
  const right = diameters(IRIS.horizontalR)

  return {
    shot: shotQc.shot,
    shotQc,
    conditions: args.conditions ?? {},
    framesTotal: frames.length,
    usable,
    rejected,
    yaw: poseStat(poses.map((p) => p.yaw)),
    roll: poseStat(poses.map((p) => p.roll)),
    pitch: poseStat(poses.map((p) => p.pitch)),
    distanceM,
    centre: { overshoot: mid?.share ?? Number.NaN, side: mid?.side ?? null, offset: offsets.length > 0 ? median(offsets) : Number.NaN },
    expression,
    lighting: shotQc.checks.find((c) => c.id === 'lighting') ?? null,
    irises: left.length > 0 && right.length > 0 ? { left: median(left), right: median(right) } : null,
    irisPx: usable.length > 0 ? median(usable.map((u) => u.frame.irisPx)) : Number.NaN,
    imageWidth,
    imageHeight,
  }
}

// ───────────────────────────── gates ─────────────────────────────

export interface GateResult {
  reasons: string[]
  recapture: string[]
}

const f1 = (x: number): string => x.toFixed(1)
const f2 = (x: number): string => x.toFixed(2)
const pct = (share: number): string => `${round(share * 100, 1)}%`
const lowerFirst = (s: string): string => s.replace(/[.;]\s*$/, '').replace(/^./, (c) => c.toLowerCase())

/** Reasons that stop every frontal metric, and the only ones reported when they apply (the other facts need usable frames). */
export function frameGate(diag: ScanDiagnostics): GateResult {
  const reasons: string[] = []
  const recapture: string[] = []
  if (diag.shot !== 'frontal_neutral') {
    reasons.push(`The capture is a ${diag.shot.replace(/_/g, ' ')} shot, and this metric is measured on the frontal neutral shot`)
    recapture.push('take the frontal neutral shot: face the lens with a relaxed, neutral face')
  }
  if (diag.shotQc.framesKept < MIN_USABLE_FRAMES) {
    reasons.push(`Only ${diag.shotQc.framesKept} of ${diag.shotQc.framesTried} frames passed the capture checks (minimum ${MIN_USABLE_FRAMES})`)
    recapture.push(`hold still for the whole burst and fix the failed capture checks until at least ${MIN_USABLE_FRAMES} frames pass`)
  }
  if (diag.usable.length < MIN_USABLE_FRAMES) {
    const causes = [...new Set(diag.rejected.map((r) => r.why))].slice(0, 2)
    reasons.push(
      `Only ${diag.usable.length} of ${diag.framesTotal} frames had a complete, plausible face mesh (minimum ${MIN_USABLE_FRAMES})${causes.length > 0 ? `: ${causes.join('; ')}` : ''}`,
    )
    recapture.push('keep your whole face in view with both eyes open, in front-on light, and hold still for the whole burst')
  }
  return { reasons, recapture }
}

function poseGate(diag: ScanDiagnostics, out: GateResult): void {
  const n = diag.usable.length
  const { yaw, roll, pitch } = diag
  if (yaw.meanAbs > QC_LIMITS.maxYawDeg) {
    out.reasons.push(`Head yaw averaged ${f1(yaw.meanAbs)}° over ${n} frames (limit ${QC_LIMITS.maxYawDeg}°). A turned head shifts depth into the left-right distances`)
    out.recapture.push(`turn your head ${f1(Math.abs(yaw.mean))}° back to your ${yaw.mean > 0 ? 'right' : 'left'} so your nose points straight at the lens`)
  }
  if (roll.meanAbs > QC_LIMITS.maxRollDeg) {
    out.reasons.push(`Head roll averaged ${f1(roll.meanAbs)}° over ${n} frames (limit ${QC_LIMITS.maxRollDeg}°)`)
    out.recapture.push(`level your head: tilt it ${f1(Math.abs(roll.mean))}° to your ${roll.mean > 0 ? 'right' : 'left'} so both pupils sit on one level line`)
  }
  if (pitch.meanAbs > QC_LIMITS.maxPitchDeg) {
    out.reasons.push(`Head pitch averaged ${f1(pitch.meanAbs)}° over ${n} frames (limit ${QC_LIMITS.maxPitchDeg}°). A nodding head moves the nose and chin against the eyes`)
    out.recapture.push(`${pitch.mean > 0 ? 'raise' : 'lower'} your chin ${f1(Math.abs(pitch.mean))}° with the ear canal level with the lower eyelid, and keep the camera at eye height`)
  }
}

function distanceGate(diag: ScanDiagnostics, minM: number, out: GateResult): void {
  const d = diag.distanceM
  if (d === null) {
    out.reasons.push(`The camera distance could not be estimated, because no iris size was read (minimum ${minM} m)`)
    out.recapture.push('open both eyes fully, look at the lens and take glasses off so the irises can be read')
  } else if (d < minM) {
    out.reasons.push(
      `Estimated camera distance ${f2(d)} m (minimum ${minM} m; the estimate from iris size is good to about ${DISTANCE_ESTIMATE_REL_ERROR * 100}%). A camera this close enlarges the nose and the centre of the face against the outline`,
    )
    out.recapture.push(`move the camera back to about ${QC_LIMITS.targetDistanceM} m from your face (now about ${f1(d)} m)`)
  }
}

function centreGate(diag: ScanDiagnostics, out: GateResult): void {
  const { overshoot, side } = diag.centre
  if (side !== null && overshoot > 0) {
    const dimension = side === 'left' || side === 'right' ? 'width' : 'height'
    out.reasons.push(`The face reaches ${pct(overshoot)} of the frame ${dimension} outside the central ${QC_LIMITS.centralShare * 100}% of the frame (${side} edge)`)
    out.recapture.push('centre your face in the frame by moving the phone, not your head')
  }
}

function expressionGate(diag: ScanDiagnostics, groups: readonly ExpressionGroup[], out: GateResult): void {
  const relevant = diag.expression.filter((r) => groups.includes(r.group))
  if (relevant.length > 0 && relevant.every((r) => r.level === null)) {
    out.reasons.push('The expression could not be read from the face model, so a neutral face cannot be confirmed')
    out.recapture.push('face the lens with your whole face in view so the expression can be read')
    return
  }
  for (const { rule, level } of relevant) {
    if (level !== null && level > rule.limit) {
      out.reasons.push(`Expression is not neutral: ${ruleLabel(rule)} signal ${f2(level)} (limit ${f2(rule.limit)})`)
      out.recapture.push(lowerFirst(rule.hint))
    }
  }
}

function extraGates(diag: ScanDiagnostics, extra: readonly ExtraGate[], out: GateResult): void {
  const { conditions } = diag
  for (const gate of extra) {
    if (gate === 'lighting') {
      const check = diag.lighting
      if (check && !check.ok) {
        out.reasons.push(
          check.value === null
            ? 'The light could not be judged because the face is too dark'
            : `Uneven light: the two halves of the face differ by ${pct(check.value)} in brightness (limit ${QC_LIMITS.maxLightImbalance * 100}%)`,
        )
        out.recapture.push('face the window squarely, or add a second diffused light on the darker side, so both sides of the face are lit equally')
      }
    } else if (gate === 'jawHidden' && conditions.facialHair === 'beard') {
      out.reasons.push('A beard was declared for this scan, so the jaw edge and the jaw corners cannot be located')
      out.recapture.push('scan clean-shaven so the jaw outline is visible')
    } else if (gate === 'chinHidden' && conditions.facialHair === 'beard') {
      out.reasons.push('A beard was declared for this scan, so the chin tip cannot be located')
      out.recapture.push('scan clean-shaven so the chin outline is visible')
    } else if (gate === 'lipEdgeHidden' && (conditions.facialHair === 'beard' || conditions.facialHair === 'stubble')) {
      out.reasons.push(`${conditions.facialHair === 'beard' ? 'A beard' : 'Stubble'} was declared for this scan, and a moustache or stubble hides the upper-lip edge`)
      out.recapture.push('scan with the upper lip clean-shaven so the lip edge is visible')
    } else if (gate === 'illness' && (conditions.illness === true || conditions.alcoholLastNight === true)) {
      out.reasons.push(`${conditions.illness === true ? 'Illness' : 'Alcohol the night before'} was declared for this scan, and swelling changes how full the face looks`)
      out.recapture.push('scan on a day without illness or alcohol the night before, at the same time of day as your other scans')
    } else if (gate === 'bothIrises') {
      const { irises } = diag
      if (irises) {
        const mean = (irises.left + irises.right) / 2
        const mismatch = Math.abs(irises.left - irises.right) / mean
        if (mismatch > IRIS_PAIR_MAX_MISMATCH) {
          out.reasons.push(
            `The two irises disagree: left ${f1(irises.left)} px, right ${f1(irises.right)} px, a ${pct(mismatch)} difference (limit ${IRIS_PAIR_MAX_MISMATCH * 100}%). An iris is misread, hidden or tinted`,
          )
          out.recapture.push('open both eyes fully and look at the lens, with glasses and tinted contact lenses off')
        }
      }
    }
  }
}

/** Every reason this metric must be refused for, with what to re-capture. Both lists empty = the gates pass. */
export function evaluateGates(profile: GateProfile, diag: ScanDiagnostics): GateResult {
  const frames = frameGate(diag)
  if (frames.reasons.length > 0) return frames
  const out: GateResult = { reasons: [], recapture: [] }
  if (profile.pose) poseGate(diag, out)
  if (profile.minDistanceM !== null) distanceGate(diag, profile.minDistanceM, out)
  if (profile.centred) centreGate(diag, out)
  if (profile.expression.length > 0) expressionGate(diag, profile.expression, out)
  extraGates(diag, profile.extra, out)
  return { reasons: [...new Set(out.reasons)], recapture: [...new Set(out.recapture)] }
}

// ───────────────────────────── quality factor ─────────────────────────────

/** The distance factor: 1 between the protocol distance and 1.9 m, falling to `atEnds` at the metric's minimum and at the far QC limit. */
export function distanceFactor(distanceM: number, minM: number): number {
  const c = QC_FACTOR.distance
  if (!Number.isFinite(distanceM)) return Number.NaN
  if (distanceM < c.fullFromM) {
    // Below the protocol distance: a straight line down to the metric's own minimum. A minimum at or above the protocol distance has no such stretch.
    return minM >= c.fullFromM ? 1 : softLimitFactor(c.fullFromM - distanceM, 0, c.fullFromM - minM, c.atEnds)
  }
  return softLimitFactor(distanceM, c.fullToM, QC_LIMITS.maxDistanceM, c.atEnds)
}

/** Worst neutral-expression signal ÷ its limit over the rules of the given groups (0 when none could be read). */
export function worstExpressionRatio(diag: ScanDiagnostics, groups: readonly ExpressionGroup[]): number {
  let worst = 0
  for (const r of diag.expression) {
    if (groups.includes(r.group) && r.level !== null) worst = Math.max(worst, r.level / r.rule.limit)
  }
  return worst
}

/**
 * Product of the quality factors that apply to a metric that passed its gates: the yaw, roll and pitch residuals, the
 * camera distance, the centring and the expression (src/domain/types.ts Measurement.qcFactor). Rounded to 4 decimals.
 */
export function qcFactorFor(profile: GateProfile, diag: ScanDiagnostics): number {
  const factors: number[] = []
  if (profile.pose) {
    factors.push(
      softLimitFactor(diag.yaw.meanAbs, QC_FACTOR.yaw.clean, QC_LIMITS.maxYawDeg, QC_FACTOR.yaw.atLimit),
      softLimitFactor(diag.roll.meanAbs, QC_FACTOR.roll.clean, QC_LIMITS.maxRollDeg, QC_FACTOR.roll.atLimit),
      softLimitFactor(diag.pitch.meanAbs, QC_FACTOR.pitch.clean, QC_LIMITS.maxPitchDeg, QC_FACTOR.pitch.atLimit),
    )
  }
  if (profile.minDistanceM !== null && diag.distanceM !== null) factors.push(distanceFactor(diag.distanceM, profile.minDistanceM))
  if (profile.centred) {
    factors.push(softLimitFactor(diag.centre.offset, QC_FACTOR.centre.clean, QC_FACTOR.centre.limit, QC_FACTOR.centre.atLimit))
  }
  if (profile.expression.length > 0) {
    factors.push(softLimitFactor(worstExpressionRatio(diag, profile.expression), QC_FACTOR.expression.clean, QC_FACTOR.expression.limit, QC_FACTOR.expression.atLimit))
  }
  // A factor that could not be computed (NaN) is a quality nobody measured: it counts as the worst one allowed, not as perfect.
  return round(product(factors.map((f) => (Number.isFinite(f) ? f : 0.5))), 4)
}
