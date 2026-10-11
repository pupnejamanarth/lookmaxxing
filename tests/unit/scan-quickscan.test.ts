import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildShotQc, selectFrames, type BurstSample } from '../../src/capture/burst'
import { evaluateFrameQc } from '../../src/capture/qc'
import type { Measurement } from '../../src/domain/types'
import {
  QuickScanBlockedError,
  buildDraft,
  defaultDeps,
  inputFromBurst,
  inputFromStill,
  latestIrisPx,
  runQuickScan,
  saveDraft,
  type QuickScanDeps,
} from '../../src/scan/quickScan'
import { LookmaxxingDB } from '../../src/store/db'
import { createScansStore } from '../../src/store/scans'
import type { BurstResult } from '../../src/capture/burst'
import { goodPixels, makeFrame } from './capture-frames'

// Synthetic faces only: drawn from proportions in capture-frames.ts, no photo of anyone.
const W = 1080
const H = 1920
const JPEG = readFileSync(new URL('../fixtures/portrait.jpg', import.meta.url))
const jpegBlob = () => new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' })
const T0 = new Date(2026, 9, 10, 9, 0, 0).getTime()

let seq = 0
const opened: LookmaxxingDB[] = []

function setup(start = T0) {
  const database = new LookmaxxingDB(`lmx-quickscan-test-${++seq}`)
  opened.push(database)
  const clock = { t: start }
  const store = createScansStore(database, { now: () => clock.t })
  let n = 0
  const deps: QuickScanDeps = { ...defaultDeps(store), now: () => clock.t, uuid: () => `id-${++n}` }
  return { database, store, clock, deps }
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.delete()))
})

function samples(count: number): BurstSample[] {
  return Array.from({ length: count }, () => {
    const frame = makeFrame({ imageWidth: W, imageHeight: H })
    const pixels = goodPixels()
    const qc = evaluateFrameQc({ frame, pixels, shot: 'frontal_neutral', imageWidth: W, imageHeight: H })
    return { frame, qc, sharpness: pixels.sharpness }
  })
}

function burstOf(count: number): BurstResult {
  const s = samples(count)
  const { keptIndexes, bestIndex } = selectFrames(s)
  const shotQc = buildShotQc({ shot: 'frontal_neutral', framesTried: count, samples: s, keptIndexes, faceless: [] }, { width: W, height: H })
  return {
    frames: s.map(({ frame, qc }) => ({ frame, qc })),
    keptIndexes,
    bestIndex,
    shotQc,
    jpeg: jpegBlob(),
    width: W,
    height: H,
  }
}

const noFaceBurst = (): BurstResult => ({
  frames: [],
  keptIndexes: [],
  bestIndex: -1,
  shotQc: buildShotQc({ shot: 'frontal_neutral', framesTried: 5, samples: [], keptIndexes: [], faceless: [] }, { width: W, height: H }),
  jpeg: jpegBlob(),
  width: W,
  height: H,
})

describe('runQuickScan', () => {
  it('measures, scores and saves one scan with a reason on every score', async () => {
    const { deps, store } = setup()
    const out = await runQuickScan(inputFromBurst(burstOf(5)), deps)
    expect(out.status).toBe('saved')
    if (out.status !== 'saved') return

    const bundle = await store.getScanBundle(out.scanId)
    expect(bundle).not.toBeNull()
    expect(bundle?.scan.kind).toBe('quick')
    expect(bundle?.photos).toHaveLength(1)
    expect(bundle?.photos[0]?.shot).toBe('frontal_neutral')
    expect(bundle?.measurements.length).toBeGreaterThan(10)
    expect(bundle?.scores).toHaveLength(bundle?.measurements.length ?? -1)
    for (const s of bundle?.scores ?? []) expect(s.reason.length).toBeGreaterThan(10)
  })

  it('reports no overall score at M1 coverage and says so through the status', async () => {
    const { deps } = setup()
    const draft = await buildDraft(inputFromBurst(burstOf(5)), deps)
    expect(draft.bundle.overall.status).toBe('NOT_AVAILABLE')
    expect(draft.bundle.overall.appearance).toBeNull()
    expect(draft.bundle.overall.coverage).toBeLessThan(0.5)
  })

  it('stores baselines returned by scoring', async () => {
    const { deps, store } = setup()
    const draft = await buildDraft(inputFromBurst(burstOf(5)), deps)
    await saveDraft(draft, deps)
    const stored = await store.getBaselines()
    for (const b of draft.bundle.baselinesToStore) expect(stored[b.metricId]).toBe(b.value)
  })

  it('does not save a scan in which every metric was refused unless told to', async () => {
    const { deps, store } = setup()
    const out = await runQuickScan(inputFromBurst(noFaceBurst()), deps)
    expect(out.status).toBe('all_refused')
    expect(await store.listScans()).toHaveLength(0)
    if (out.status !== 'all_refused') return
    expect(out.draft.allRefused).toBe(true)
    for (const m of out.draft.bundle.measurements as Measurement[]) expect(m.value).toBeNull()
    for (const s of out.draft.bundle.scores) expect(s.reason.length).toBeGreaterThan(10)

    const saved = await runQuickScan(inputFromBurst(noFaceBurst()), deps, { saveIfAllRefused: true })
    expect(saved.status).toBe('saved')
    expect(await store.listScans()).toHaveLength(1)
  })

  it('allows only one quick scan per local day', async () => {
    const { deps, clock } = setup()
    await runQuickScan(inputFromBurst(burstOf(5)), deps)
    clock.t += 60_000
    await expect(runQuickScan(inputFromBurst(burstOf(5)), deps)).rejects.toBeInstanceOf(QuickScanBlockedError)
    clock.t += 24 * 3_600_000
    const again = await runQuickScan(inputFromBurst(burstOf(5)), deps)
    expect(again.status).toBe('saved')
  })

  it('treats an imported photo as a single frame', async () => {
    const { deps } = setup()
    const frame = makeFrame({ imageWidth: W, imageHeight: H })
    const shotQc = buildShotQc({ shot: 'frontal_neutral', framesTried: 1, samples: [], keptIndexes: [], faceless: [] }, { width: W, height: H })
    const input = inputFromStill({ blob: jpegBlob(), width: W, height: H }, { frame, shotQc })
    expect(input.source).toBe('import')
    expect(input.frames).toHaveLength(1)
    const draft = await buildDraft(input, deps)
    for (const m of draft.bundle.measurements) expect(m.nFrames).toBeLessThanOrEqual(1)
  })

  it('uses every frame with a face when none passed, so refusals cite real values', () => {
    const b = burstOf(3)
    const input = inputFromBurst({ ...b, keptIndexes: [] })
    expect(input.frames).toHaveLength(3)
  })
})

describe('latestIrisPx', () => {
  it('is null without scans and reads the newest photo otherwise', async () => {
    expect(await latestIrisPx(async () => [], async () => undefined)).toBeNull()
    const qc = burstOf(2).shotQc
    expect(await latestIrisPx(async () => [{ id: 'a' }], async () => ({ qc }))).toBe(qc.irisPx)
    expect(await latestIrisPx(async () => [{ id: 'a' }], async () => undefined)).toBeNull()
  })
})
