/**
 * Contract check between the scoring engine and the scan store: what scoreScan returns is accepted by saveScan,
 * the first-scan baseline flow works across two stored scans, and the store's honesty rules agree with the engine's.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Measurement, ScanRecord } from '../../src/domain/types'
import { scoreScan } from '../../src/scoring'
import { LookmaxxingDB } from '../../src/store'
import { createScansStore } from '../../src/store/scans'

let seq = 0
const opened: LookmaxxingDB[] = []
const T0 = new Date(2026, 9, 10, 9, 0, 0).getTime()

function setup() {
  const database = new LookmaxxingDB(`lmx-scoring-store-${++seq}`)
  opened.push(database)
  return createScansStore(database, { now: () => T0 })
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.delete()))
})

let n = 0
const meas = (scanId: string, o: Partial<Measurement> & { metricId: string }): Measurement => ({
  id: `m-${++n}`,
  scanId,
  value: 0,
  unit: '',
  uncertainty: 0,
  nFrames: 5,
  method: 'AUTO_FRONTAL_PHOTO',
  qcFactor: 1,
  algoVersion: 'a1',
  ...o,
})

const scan = (id: string, takenAt: number): ScanRecord => ({ id, takenAt, kind: 'weekly', conditions: {}, algoVersion: 'a1' })

const scanMeasurements = (scanId: string, f01: number): Measurement[] => [
  meas(scanId, { metricId: 'F01', value: f01, unit: 'index', uncertainty: 2 }),
  meas(scanId, { metricId: 'F05', value: 5.4, unit: '% of pupil distance', uncertainty: 0.6 }),
  meas(scanId, { metricId: 'F10', value: 1.92, unit: 'ratio', uncertainty: 0.04 }),
  meas(scanId, { metricId: 'F21', value: 0.5, unit: 'n/a' }),
  meas(scanId, {
    metricId: 'F14',
    value: null,
    refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['ear canal level with lower eyelid'] },
  }),
  meas(scanId, { metricId: 'V06', value: 83.3, unit: '% of checks passed', uncertainty: 0, inputs: { distance: 0, sharp: 1, light: 1, height: 1, pose: 1, expression: 1 } }),
]

describe('scoring output is storable', () => {
  it('saves the first scan, keeps its baseline, and scores the next scan against it', async () => {
    const store = setup()

    const first = scoreScan({ scanId: 's1', measurements: scanMeasurements('s1', 52), baselines: await store.getBaselines() })
    expect(first.baselinesToStore).toEqual([{ metricId: 'F01', value: 52 }])
    await store.saveScan({
      scan: scan('s1', T0),
      photos: [],
      measurements: scanMeasurements('s1', 52).map((m, i) => ({ ...m, id: `s1-m${i}` })),
      scores: first.scores,
      overall: first.overall,
      baselinesToStore: first.baselinesToStore,
    })
    expect(await store.getBaselines()).toEqual({ F01: 52 })

    const stored = await store.getScanBundle('s1')
    expect(stored!.scores.find((s) => s.metricId === 'F01')).toMatchObject({ score: null, facts: null })
    expect(stored!.overall).toMatchObject({ status: 'NOT_AVAILABLE', appearance: null })

    const second = scoreScan({ scanId: 's2', measurements: scanMeasurements('s2', 67), baselines: await store.getBaselines() })
    expect(second.baselinesToStore).toEqual([])
    expect(second.scores.find((s) => s.metricId === 'F01')!.score).toBe(60)
    await store.saveScan({
      scan: scan('s2', T0 + 7 * 86_400_000),
      photos: [],
      measurements: scanMeasurements('s2', 67).map((m, i) => ({ ...m, id: `s2-m${i}` })),
      scores: second.scores,
      overall: second.overall,
      baselinesToStore: second.baselinesToStore,
    })
    expect(await store.getBaselines()).toEqual({ F01: 52 })
    expect((await store.listScans()).map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it('the store rejects what the engine promises never to produce', async () => {
    const store = setup()
    const r = scoreScan({ scanId: 's1', measurements: scanMeasurements('s1', 52), baselines: {} })
    const f05 = r.scores.find((s) => s.metricId === 'F05')!
    const base = {
      scan: scan('s1', T0),
      photos: [],
      measurements: scanMeasurements('s1', 52).map((m, i) => ({ ...m, id: `m${i}` })),
      overall: r.overall,
      baselinesToStore: [],
    }
    await expect(store.saveScan({ ...base, scores: r.scores.map((s) => (s === f05 ? { ...s, facts: null } : s)) })).rejects.toThrow(/no facts/)
    await expect(store.saveScan({ ...base, scores: r.scores.map((s) => (s === f05 ? { ...s, reason: ' ' } : s)) })).rejects.toThrow(/empty reason/)
    await store.saveScan({ ...base, scores: r.scores })
  })
})
