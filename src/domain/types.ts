/**
 * Domain contracts for scans, measurements and scores. Shared by capture, metrics, scoring, store and UI.
 * Persisted shapes (IndexedDB rows) – changing a field means a Dexie version bump + migration.
 */
import type { Method, ShotType } from '../catalog/schema'

export type ScanKind = 'quick' | 'weekly' | 'calibration' | 'monthly'
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW' | 'REFUSED'

/** One QC check evaluated on a single frame. `hint` is shown live ("Tilt your chin down a little"). */
export interface QcCheck {
  id: 'face' | 'yaw' | 'roll' | 'pitch' | 'distance' | 'centered' | 'sharpness' | 'exposure' | 'expression' | 'lighting' | 'steady'
  ok: boolean
  /** Measured value (degrees, ratio, 0–1 …) or null when not computable. */
  value: number | null
  /** Plain-language limit, e.g. "within 3°". */
  limit: string
  /** Plain-language instruction when not ok. */
  hint: string
}

export interface FrameQc {
  allOk: boolean
  checks: QcCheck[]
}

/** Summary of QC for the kept frame(s) of one shot, stored with the photo. */
export interface ShotQc {
  shot: ShotType
  framesTried: number
  framesKept: number
  /** Worst-case value per check across kept frames. */
  checks: QcCheck[]
  /** Spread (max−min) of the key landmark scale across the burst, as a fraction of IPD. */
  burstSpread: number | null
  /** Estimated camera distance in metres from iris size (assumed field of view) – null if unknown. */
  estimatedDistanceM: number | null
  /** Iris diameter in pixels (distance proxy; compare week to week). */
  irisPx: number | null
  greyCard: boolean
}

export interface ScanRecord {
  id: string
  takenAt: number
  kind: ScanKind
  /** Free-text-free conditions the user declared (all optional, all coarse). */
  conditions: {
    hoursSlept?: number
    alcoholLastNight?: boolean
    illness?: boolean
    facialHair?: 'clean' | 'stubble' | 'beard'
    setup?: 'phone_stand' | 'handheld' | 'laptop'
  }
  /** Version of the measurement algorithms used – lets old scans be recomputed. */
  algoVersion: string
}

export interface PhotoRecord {
  id: string
  scanId: string
  shot: ShotType
  /** Re-encoded JPEG – metadata stripped by construction. */
  blob: Blob
  width: number
  height: number
  qc: ShotQc
  createdAt: number
}

/** What a metric computed. `refusal` set ⇒ the app must NOT score it and says what to re-capture. */
export interface Measurement {
  id: string
  scanId: string
  metricId: string
  value: number | null
  unit: string
  /** ± one standard deviation across burst frames plus method error, in `unit`. null if unknowable. */
  uncertainty: number | null
  nFrames: number
  method: Method
  /** 0–1 product of photo-quality factors. */
  qcFactor: number
  algoVersion: string
  /** Named raw inputs used (for transparency / recompute), e.g. { widthPx: 412, irisPx: 38 }. */
  inputs?: Record<string, number>
  refusal?: { reasons: string[]; recapture: string[] }
}

/** Facts a reason sentence may cite. Reasons are assembled ONLY from these – no free generation. */
export interface ScoreFacts {
  value: number
  unit: string
  uncertainty: number | null
  /** Plain description of the ideal, from the catalog. */
  idealSummary: string
  idealLo: number | null
  idealHi: number | null
  /** Distance outside the ideal band in `unit` (0 inside); null if no band. */
  gap: number | null
  ruleKind: string
  shotLabel: string
  sourceIds: string[]
  weight: number
  evidence: string
  changeability: string
  pointsLost: number
}

export interface MetricScore {
  id: string
  scanId: string
  metricId: string
  /** 0–100, truncated (never rounded up). null when refused / not scored. */
  score: number | null
  confidence: { band: ConfidenceBand; value: number }
  /** Required whenever score != null (the store rejects a score without facts). */
  facts: ScoreFacts | null
  /** Required, non-empty – either the scoring reason or the plain refusal reason. */
  reason: string
  rulesetVersion: string
}

export type OverallStatus = 'FINAL' | 'PROVISIONAL' | 'NOT_AVAILABLE'

export interface DragItem {
  metricId: string
  name: string
  pointsLost: number
  changeability: string
  group: 'FIXED' | 'SURGICAL_OR_PROFESSIONAL' | 'CHANGEABLE'
}

export interface OverallScore {
  scanId: string
  /** null when status is NOT_AVAILABLE (coverage < 50%). Truncated. */
  appearance: number | null
  /** ± band from combined metric uncertainty; null when not available. */
  band: number | null
  /** Scored weight ÷ total weight, 0–1. */
  coverage: number
  status: OverallStatus
  /** Share of scored weight; points lost by group. */
  pointsLost: { FIXED: number; SURGICAL_OR_PROFESSIONAL: number; CHANGEABLE: number }
  drag: DragItem[]
  /** Ceiling Attainment Index 0–100 over scored changeable metrics (provisional until ceilings are personalised). */
  cai: number | null
  weightsVersion: string
  rulesetVersion: string
}
