/**
 * Quick-scan orchestration: capture result -> frontal metrics -> scoring -> one atomic save.
 *
 * Everything with a side effect is injected (store, clock, ids, the metric and scoring functions) so the pipeline is
 * tested with synthetic frames and no camera. Nothing here is allowed to hide a refusal: every metric the metrics module
 * returns reaches the store, refused or not.
 */
import type { BurstResult } from '../capture'
import type { ShotType } from '../catalog/schema'
import type { Measurement, PhotoRecord, ScanRecord, ShotQc } from '../domain/types'
import { ALGO_VERSION, computeFrontalMetrics } from '../metrics'
import { scoreScan } from '../scoring'
import type { ScanBundle, ScansStore } from '../store/scans'
import type { FaceFrame } from '../vision/types'

export const QUICK_SHOT: ShotType = 'frontal_neutral'

export type CaptureSource = 'camera' | 'import'

/** What the capture step hands to the pipeline, whether it came from a live burst or an imported photo. */
export interface CaptureInput {
  source: CaptureSource
  /** The frames the metrics are computed from: the frames that passed QC, or all frames with a face when none did. */
  frames: FaceFrame[]
  shotQc: ShotQc
  /** Metadata-free JPEG. */
  jpeg: Blob
  width: number
  height: number
  conditions?: ScanRecord['conditions']
}

export interface QuickScanDeps {
  store: Pick<ScansStore, 'saveScan' | 'getBaselines' | 'canQuickScan'>
  now: () => number
  uuid: () => string
  computeFrontalMetrics: typeof computeFrontalMetrics
  scoreScan: typeof scoreScan
  algoVersion: string
}

export function defaultDeps(store: QuickScanDeps['store']): QuickScanDeps {
  return {
    store,
    now: () => Date.now(),
    uuid: () => globalThis.crypto.randomUUID(),
    computeFrontalMetrics,
    scoreScan,
    algoVersion: ALGO_VERSION,
  }
}

export function inputFromBurst(burst: BurstResult, conditions?: ScanRecord['conditions']): CaptureInput {
  const kept = burst.keptIndexes.map((i) => burst.frames[i]).filter((f): f is NonNullable<typeof f> => f !== undefined)
  const used = kept.length > 0 ? kept : burst.frames
  return {
    source: 'camera',
    frames: used.map((f) => f.frame),
    shotQc: burst.shotQc,
    jpeg: burst.jpeg,
    width: burst.width,
    height: burst.height,
    conditions,
  }
}

/** An imported photo goes through the same QC as one burst frame: one frame, so the measurements carry nFrames 1. */
export function inputFromStill(
  photo: { blob: Blob; width: number; height: number },
  inspection: { frame: FaceFrame | null; shotQc: ShotQc },
  conditions?: ScanRecord['conditions'],
): CaptureInput {
  return {
    source: 'import',
    frames: inspection.frame ? [inspection.frame] : [],
    shotQc: inspection.shotQc,
    jpeg: photo.blob,
    width: photo.width,
    height: photo.height,
    conditions,
  }
}

export interface QuickScanDraft {
  bundle: ScanBundle
  measuredCount: number
  refusedCount: number
  /** True when no metric produced a value: such a scan is only stored if the user chooses to. */
  allRefused: boolean
}

export type QuickScanOutcome = { status: 'saved'; scanId: string; draft: QuickScanDraft } | { status: 'all_refused'; draft: QuickScanDraft }

export class QuickScanBlockedError extends Error {
  readonly nextAllowedAt: number | null
  constructor(nextAllowedAt: number | null) {
    super('One quick scan per day is allowed. The next one opens at the start of tomorrow.')
    this.name = 'QuickScanBlockedError'
    this.nextAllowedAt = nextAllowedAt
  }
}

/** Throws QuickScanBlockedError when today's quick scan is already taken. */
export async function assertQuickScanAllowed(deps: Pick<QuickScanDeps, 'store' | 'now'>): Promise<void> {
  const status = await deps.store.canQuickScan(deps.now())
  if (!status.allowed) throw new QuickScanBlockedError(status.nextAllowedAt)
}

/** Measures and scores without saving. */
export async function buildDraft(input: CaptureInput, deps: QuickScanDeps): Promise<QuickScanDraft> {
  const takenAt = deps.now()
  const scanId = deps.uuid()
  const scan: ScanRecord = {
    id: scanId,
    takenAt,
    kind: 'quick',
    conditions: input.conditions ?? {},
    algoVersion: deps.algoVersion,
  }
  const photo: PhotoRecord = {
    id: deps.uuid(),
    scanId,
    shot: QUICK_SHOT,
    blob: input.jpeg,
    width: input.width,
    height: input.height,
    qc: input.shotQc,
    createdAt: takenAt,
  }
  const measurements: Measurement[] = deps.computeFrontalMetrics({
    scanId,
    frames: input.frames,
    shotQc: input.shotQc,
    uuid: deps.uuid,
    conditions: input.conditions,
  })
  const baselines = await deps.store.getBaselines()
  const { scores, overall, baselinesToStore } = deps.scoreScan({ scanId, measurements, baselines, uuid: deps.uuid })
  const refusedCount = measurements.filter((m) => m.refusal !== undefined || m.value === null).length
  return {
    bundle: { scan, photos: [photo], measurements, scores, overall, baselinesToStore },
    measuredCount: measurements.length - refusedCount,
    refusedCount,
    allRefused: measurements.length === 0 || refusedCount === measurements.length,
  }
}

export async function saveDraft(draft: QuickScanDraft, deps: Pick<QuickScanDeps, 'store'>): Promise<string> {
  await deps.store.saveScan(draft.bundle)
  return draft.bundle.scan.id
}

/**
 * The whole pipeline. A scan in which every metric was refused is NOT saved here: the caller gets 'all_refused' and the
 * draft, and decides between "Save anyway" (saveDraft) and "Retake".
 */
export async function runQuickScan(
  input: CaptureInput,
  deps: QuickScanDeps,
  options: { saveIfAllRefused?: boolean } = {},
): Promise<QuickScanOutcome> {
  await assertQuickScanAllowed(deps)
  const draft = await buildDraft(input, deps)
  if (draft.allRefused && !options.saveIfAllRefused) return { status: 'all_refused', draft }
  const scanId = await saveDraft(draft, deps)
  return { status: 'saved', scanId, draft }
}

/** The iris size (px) of the newest stored scan: the distance baseline for the next capture. null when there is none. */
export async function latestIrisPx(
  listScans: () => Promise<{ id: string }[]>,
  photoFor: (scanId: string) => Promise<{ qc: ShotQc } | undefined>,
): Promise<number | null> {
  const newest = (await listScans())[0]
  if (!newest) return null
  const iris = (await photoFor(newest.id))?.qc.irisPx
  return typeof iris === 'number' && Number.isFinite(iris) && iris > 0 ? iris : null
}
