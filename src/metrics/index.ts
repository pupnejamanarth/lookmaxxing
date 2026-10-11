/**
 * Metrics – the frontal-photo measurements of milestone M1.
 *
 *   computeFrontalMetrics({ scanId, frames, shotQc })  →  one Measurement per metric, in a fixed order:
 *   F01 F05 F07 F08 F10 F11 F12 F14 F15 F16 F17 F21 F22 F23, then V06 (photo technique).
 *
 * A metric that cannot be trusted comes back with `refusal` ({ reasons, recapture }) and `value: null`. There is never
 * a made-up number: scoring turns a refusal into "NOT SCORED" plus what to re-capture.
 *
 * Burst frames are combined by the MEDIAN of the per-frame values. The uncertainty is the larger of the frames' sample
 * standard deviation and a landmark-error floor (see frontal.ts). Which checks refuse which metric is in refusals.ts and
 * mirrors the catalog's `refusalConditions`.
 */
import { QC_LIMITS, faceBox } from '../capture/qc'
import { getMetric } from '../catalog'
import type { Measurement, ScanRecord, ShotQc } from '../domain/types'
import type { FaceFrame } from '../vision/types'
import { FRONTAL_DEFS, FRONTAL_METRIC_IDS, combineFrames } from './frontal'
import type { FrontalMetricId } from './frontal'
import {
  MIN_USABLE_FRAMES,
  analyseScan,
  evaluateGates,
  frameGate,
  gateProfileFor,
  qcFactorFor,
  worstExpressionRatio,
} from './refusals'
import type { GateResult, ScanDiagnostics } from './refusals'
import { median, round } from './stats'

export { FRONTAL_DEFS, FRONTAL_METRIC_IDS, landmarkFloor, combineFrames } from './frontal'
export type { FrontalMetricId } from './frontal'
export { GATE_PROFILES, analyseScan, evaluateGates, qcFactorFor } from './refusals'
export { median, sampleStd } from './stats'

/** Version of the measurement algorithms; stored on every scan so old scans can be recomputed when a formula changes. */
export const ALGO_VERSION = 'm1.0'

export const PHOTO_TECHNIQUE_ID = 'V06'

export interface ComputeFrontalInput {
  scanId: string
  /** The burst frames to combine: those the capture step kept. */
  frames: FaceFrame[]
  shotQc: ShotQc
  uuid?: () => string
  /**
   * What the user declared for this scan. Optional: with it, a declared beard, stubble, illness or alcohol refuses the
   * metrics the catalog says they spoil (F01 F16 F17 F22). Without it those conditions cannot be known and are not checked.
   */
  conditions?: ScanRecord['conditions']
}

const defaultUuid = (): string => globalThis.crypto.randomUUID()

/** Keeps only finite numbers, rounded: a stored input must be a plain number. */
function cleanInputs(inputs: Record<string, number | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = round(value)
  }
  return out
}

/** The capture facts every measurement records, for transparency and for recomputing. */
function captureInputs(diag: ScanDiagnostics): Record<string, number> {
  return cleanInputs({
    framesUsable: diag.usable.length,
    framesTotal: diag.framesTotal,
    yawMeanAbsDeg: diag.yaw.meanAbs,
    rollMeanAbsDeg: diag.roll.meanAbs,
    pitchMeanAbsDeg: diag.pitch.meanAbs,
    distanceM: diag.distanceM,
    irisDiameterPx: diag.irisPx,
  })
}

interface Base {
  id: string
  scanId: string
  metricId: string
  unit: string
  method: Measurement['method']
  algoVersion: string
}

function refused(base: Base, diag: ScanDiagnostics, gate: GateResult): Measurement {
  return {
    ...base,
    value: null,
    uncertainty: null,
    nFrames: diag.usable.length,
    qcFactor: 0,
    inputs: captureInputs(diag),
    refusal: { reasons: gate.reasons, recapture: gate.recapture },
  }
}

const CAPTURE_AGAIN = 'keep your whole face in view, relaxed and neutral, in front-on light, and hold still for the whole burst'

// ───────────────────────────── the frontal metrics ─────────────────────────────

/** F21 is computed from the points of these metrics and is refused whenever one of them was. */
const F21_DEPENDS_ON: readonly FrontalMetricId[] = ['F14', 'F16']

function measureFrontal(id: FrontalMetricId, diag: ScanDiagnostics, base: Base, done: ReadonlyMap<string, Measurement>): Measurement {
  const def = FRONTAL_DEFS[id]
  const profile = gateProfileFor(id)
  const gate = evaluateGates(profile, diag)
  if (gate.reasons.length > 0) return refused(base, diag, gate)

  if (id === 'F21') {
    const blocked = F21_DEPENDS_ON.filter((dep) => done.get(dep)?.refusal !== undefined)
    if (blocked.length > 0) {
      return refused(base, diag, {
        reasons: [`This value is computed from ${F21_DEPENDS_ON.join(' and ')}, and ${blocked.join(' and ')} could not be measured on this capture`],
        recapture: [CAPTURE_AGAIN],
      })
    }
  }

  const combined = combineFrames(def, diag.usable.map((u) => u.geo))
  if (!combined || combined.nFrames < MIN_USABLE_FRAMES) {
    const got = combined?.nFrames ?? 0
    return refused(base, diag, {
      reasons: [`Only ${got} of ${diag.usable.length} usable frames gave a plausible reading (minimum ${MIN_USABLE_FRAMES}): ${def.implausible}`],
      recapture: [CAPTURE_AGAIN],
    })
  }

  return {
    ...base,
    value: combined.value,
    uncertainty: combined.uncertainty,
    nFrames: combined.nFrames,
    qcFactor: qcFactorFor(profile, diag),
    inputs: cleanInputs({
      ...captureInputs(diag),
      ...combined.inputs,
      valueSpread: combined.spread,
      landmarkFloor: combined.floor,
      // F23 only: the published error of scaling pixels to millimetres by the iris, included in the floor above.
      scaleRelativeError: def.methodRelError > 0 ? def.methodRelError : null,
    }),
  }
}

// ───────────────────────────── V06 photo technique ─────────────────────────────

/**
 * Catalog V06 refuses "a face smaller than 15% of the frame". No literal reading survives the capture protocol: a head
 * photographed from the protocol 1.5 m with a phone's 1x lens fills about 1-2% of the frame's AREA and 9-10% of its longer
 * side, and even its height over the SHORTER side is only about 17% in a 9:16 frame and 13% in a 3:4 frame, so a 15% limit
 * would refuse every correct capture. The protocol already puts the face inside the central 50% of the frame, so the limit
 * is applied to that window: the face outline's height must be at least 15% of the window's shorter side, which is 7.5% of
 * the frame's shorter side. Across the whole distance range capture QC accepts (up to 2.2 m) a real face stays above it
 * (about 8.6% of the shorter side in a 3:4 frame at 2.2 m); it refuses a face that is too small for the mesh to be placed
 * on, which is the point of the catalog's condition.
 */
export const MIN_FACE_SHARE_OF_CENTRAL_WINDOW = 0.15
/** Catalog V06 checklist item `distance`: at least 1.5 m (an app design choice, estimated from landmarks). */
export const TECHNIQUE_MIN_DISTANCE_M = QC_LIMITS.targetDistanceM

/**
 * V06 – photo technique. The share of the catalog's six checklist items this capture passes, judged from the capture
 * record and the frames: distance (≥ 1.5 m, from iris size), sharpness, even light, camera height (head pitch within the
 * QC limit), head level (yaw and roll within the QC limits) and a neutral expression. The scoring checklist rule reads
 * the per-item results from `inputs` (1 passed, 0 failed).
 *
 * Refused (no value) when an item cannot be judged, or for the catalog's refusal conditions that can be read from a
 * frame: no landmark scale for the distance, a face under 15% of the frame, a face cropped at the edge. "Of the frame" is
 * read as in MIN_FACE_SHARE_OF_CENTRAL_WINDOW. A screenshot or a beauty filter cannot be detected from the mesh and is
 * not checked.
 *
 * Uncertainty is one checklist item (100 ÷ items) when the distance sits within the ±15% error of the iris-based estimate
 * of the 1.5 m threshold, since the estimate alone could flip that item; otherwise 0.
 */
function photoTechnique(diag: ScanDiagnostics, base: Base): Measurement {
  const metric = getMetric(PHOTO_TECHNIQUE_ID)
  const itemIds = metric?.scoring.kind === 'checklist' ? metric.scoring.items.map((i) => i.id) : []

  const frames = frameGate(diag)
  if (frames.reasons.length > 0) return refused(base, diag, frames)

  const gate: GateResult = { reasons: [], recapture: [] }
  const fail = (reason: string, recapture: string): void => {
    gate.reasons.push(reason)
    gate.recapture.push(recapture)
  }
  const sharp = diag.shotQc.checks.find((c) => c.id === 'sharpness')
  const light = diag.lighting
  const readable = diag.expression.some((r) => r.level !== null)
  const d = diag.distanceM

  if (d === null) fail('No landmark scale is available to estimate the camera distance, because no iris size was read', 'open both eyes fully, look at the lens and take glasses off so the irises can be read')
  if (!sharp) fail('The capture record has no sharpness reading, so sharpness cannot be judged', 'repeat the capture with the in-app camera so every quality check is recorded')
  if (!light) fail('The capture record has no lighting reading, so even light cannot be judged', 'repeat the capture with the in-app camera so every quality check is recorded')
  if (!readable) fail('The expression could not be read from the face model, so it cannot be judged', 'face the lens with your whole face in view so the expression can be read')

  const boxes = diag.usable.map((u) => ({ box: faceBox(u.frame.named), w: u.frame.landmarks.width, h: u.frame.landmarks.height }))
  const shares = boxes.flatMap((b) => (b.box ? [b.box.height / (QC_LIMITS.centralShare * Math.min(b.w, b.h))] : []))
  const faceShare = shares.length > 0 ? median(shares) : Number.NaN
  if (Number.isFinite(faceShare) && faceShare < MIN_FACE_SHARE_OF_CENTRAL_WINDOW) {
    fail(
      `The face is ${round(faceShare * 100, 1)}% of the central ${QC_LIMITS.centralShare * 100}% window of the frame (minimum ${MIN_FACE_SHARE_OF_CENTRAL_WINDOW * 100}%), too small to judge the photo technique`,
      `bring the camera to about ${QC_LIMITS.targetDistanceM} m from your face, or use the rear 2x or 3x lens at that distance, so the head fills more of the frame`,
    )
  }
  const cropped = boxes.filter((b) => b.box && (b.box.x <= 0 || b.box.y <= 0 || b.box.x + b.box.width >= b.w || b.box.y + b.box.height >= b.h)).length
  if (cropped * 2 > boxes.length) {
    fail('The face outline touches the edge of the frame, so the head is cropped', 'step back or re-aim so the whole head is inside the frame with space on every side')
  }
  if (gate.reasons.length > 0 || d === null || !sharp || !light) return refused(base, diag, gate)

  const results: Record<string, boolean> = {
    distance: d >= TECHNIQUE_MIN_DISTANCE_M,
    sharp: sharp.ok,
    light: light.ok,
    height: diag.pitch.meanAbs <= QC_LIMITS.maxPitchDeg,
    pose: diag.yaw.meanAbs <= QC_LIMITS.maxYawDeg && diag.roll.meanAbs <= QC_LIMITS.maxRollDeg,
    expression: worstExpressionRatio(diag, ['mouth', 'brow', 'eye']) <= 1,
  }
  const total = itemIds.length > 0 ? itemIds.length : Object.keys(results).length
  const passed = Object.values(results).filter(Boolean).length
  const ambiguousDistance = Math.abs(d - TECHNIQUE_MIN_DISTANCE_M) / TECHNIQUE_MIN_DISTANCE_M <= 0.15

  return {
    ...base,
    value: round((passed / total) * 100),
    uncertainty: ambiguousDistance ? round(100 / total) : 0,
    nFrames: diag.usable.length,
    qcFactor: 1,
    inputs: cleanInputs({
      ...captureInputs(diag),
      ...Object.fromEntries(Object.entries(results).map(([k, ok]) => [k, ok ? 1 : 0])),
      sharpness: sharp.value,
      lightImbalance: light.value,
      expressionWorstRatio: worstExpressionRatio(diag, ['mouth', 'brow', 'eye']),
      faceHeightShareOfCentralWindow: faceShare,
    }),
  }
}

// ───────────────────────────── entry point ─────────────────────────────

export function computeFrontalMetrics(input: ComputeFrontalInput): Measurement[] {
  const uuid = input.uuid ?? defaultUuid
  const diag = analyseScan({ frames: input.frames, shotQc: input.shotQc, conditions: input.conditions })
  const done = new Map<string, Measurement>()
  const out: Measurement[] = []
  const keep = (m: Measurement): void => {
    done.set(m.metricId, m)
    out.push(m)
  }
  const baseFor = (metricId: string, unit: string, method: Base['method']): Base => ({
    id: uuid(),
    scanId: input.scanId,
    metricId,
    unit,
    method,
    algoVersion: ALGO_VERSION,
  })

  for (const id of FRONTAL_METRIC_IDS) {
    const def = FRONTAL_DEFS[id]
    keep(measureFrontal(id, diag, baseFor(id, def.unit, def.method), done))
  }
  keep(photoTechnique(diag, baseFor(PHOTO_TECHNIQUE_ID, getMetric(PHOTO_TECHNIQUE_ID)?.scale.unit ?? '% of checks passed', 'AUTO_FRONTAL_PHOTO')))
  return out
}
