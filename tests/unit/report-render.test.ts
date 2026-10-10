import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { Measurement, PhotoRecord, ShotQc } from '../../src/domain/types'
import { DragChart } from '../../src/routes/report/DragChart'
import { MetricCardView } from '../../src/routes/report/MetricCardView'
import { OverallBlock } from '../../src/routes/report/OverallBlock'
import { PhotoSection } from '../../src/routes/report/PhotoSection'
import { RecaptureSummary } from '../../src/routes/report/RecaptureSummary'
import { attemptedShare, buildCards, tallyCards } from '../../src/routes/report/helpers'
import { scoreScan } from '../../src/scoring'
import { LookmaxxingDB } from '../../src/store'
import { createScansStore } from '../../src/store/scans'

// Synthetic data only. The report is built from a bundle that really went through the scoring engine and the store, so
// these tests also pin the contract between those modules and the report.

const SCAN = 'scan-report-1'
const T0 = new Date(2026, 9, 10, 9, 0, 0).getTime()

let seq = 0
const opened: LookmaxxingDB[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.delete()))
})

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))
const segment = (marker: number, payload: number[]): number[] => {
  const length = payload.length + 2
  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}
const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8,
  ...segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ...segment(0xdb, [0, ...new Array<number>(64).fill(16)]),
  ...segment(0xc0, [8, 0, 2, 0, 2, 1, 1, 0x11, 0]),
  ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
  0x12, 0x34,
  0xff, 0xd9,
])

const qc = (shot: ShotQc['shot']): ShotQc => ({
  shot,
  framesTried: 5,
  framesKept: 4,
  checks: [
    { id: 'yaw', ok: true, value: 1, limit: 'within 3°', hint: 'Turn to face the lens' },
    { id: 'pitch', ok: false, value: 6.1, limit: 'within 4°', hint: 'Tilt your chin down: ear canal level with the lower eyelid' },
  ],
  burstSpread: 0.01,
  estimatedDistanceM: 1.5,
  irisPx: 38,
  greyCard: false,
})

let uuidN = 0
const uuid = () => `id-${++uuidN}`

function m(metricId: string, value: number | null, unit: string, over: Partial<Measurement> = {}): Measurement {
  return {
    id: uuid(),
    scanId: SCAN,
    metricId,
    value,
    unit,
    uncertainty: 0.4,
    nFrames: 5,
    method: 'AUTO_FRONTAL_PHOTO',
    qcFactor: 0.9,
    algoVersion: 'algo-test',
    ...over,
  }
}

const MEASUREMENTS: Measurement[] = [
  m('F01', 9.2, 'index'), // personal baseline, first scan: baseline set, not scored
  m('F05', 6.1, '% of pupil distance', { uncertainty: 0.5 }), // scored HIGH
  m('F07', 1.3, 'ratio', { qcFactor: 0.7 }), // refused: confidence under the floor
  m('F08', 46, '% of face width', { qcFactor: 0.55 }), // scored but LOW
  m('F10', 1.92, 'ratio', { qcFactor: 0.9 }), // pseudoscience, weight 0
  m('F14', null, 'ratio', {
    refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['ear canal level with lower eyelid', 'use the on-screen level line'] },
  }),
  m('F15', null, 'ratio', { refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['Ear canal level with lower eyelid'] } }),
  m('F16', 1.08, 'ratio', { uncertainty: 0.05 }),
  m('F21', 0.62, 'n/a'),
]

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function savedBundle() {
  const database = new LookmaxxingDB(`lmx-report-test-${++seq}`)
  opened.push(database)
  const store = createScansStore(database, { now: () => T0 })
  const result = scoreScan({ scanId: SCAN, measurements: MEASUREMENTS, baselines: {}, uuid })
  const photo: PhotoRecord = {
    id: uuid(),
    scanId: SCAN,
    shot: 'frontal_neutral',
    blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }),
    width: 540,
    height: 720,
    qc: qc('frontal_neutral'),
    createdAt: T0,
  }
  await store.saveScan({
    scan: { id: SCAN, takenAt: T0, kind: 'quick', conditions: { hoursSlept: 7 }, algoVersion: 'algo-test' },
    photos: [photo],
    measurements: MEASUREMENTS,
    scores: result.scores,
    overall: result.overall,
    baselinesToStore: result.baselinesToStore,
  })
  const bundle = await store.getScanBundle(SCAN)
  if (!bundle) throw new Error('bundle was not saved')
  return bundle
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('report built from a stored bundle', () => {
  it('shows "not available" and the coverage for a NOT_AVAILABLE overall, with no overall number', async () => {
    const bundle = await savedBundle()
    expect(bundle.overall.status).toBe('NOT_AVAILABLE')
    const cards = buildCards(bundle)
    const out = html(createElement(OverallBlock, { overall: bundle.overall, attempted: attemptedShare(bundle.measurements), tally: tallyCards(cards) }))
    expect(out).toContain('Overall score: not available')
    expect(out).toContain('of the score is measurable from this scan, 50% is needed.')
    expect(out).toContain('only frontal-photo metrics')
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('CAI: not available')
    expect(out).not.toContain('rp-overall__value')
    expect(out).not.toContain('PROVISIONAL')
  })

  it('prints every stored reason exactly as stored, in a fixed-width block', async () => {
    const bundle = await savedBundle()
    const cards = buildCards(bundle)
    const withNumber = cards.filter((c) => c.kind === 'scored' || c.kind === 'baseline_set' || c.kind === 'unscored')
    expect(withNumber.length).toBeGreaterThan(3)
    for (const card of withNumber) {
      const out = html(createElement(MetricCardView, { card }))
      const stored = bundle.scores.find((s) => s.metricId === card.metricId)!.reason
      expect(out, card.metricId).toContain(`<pre class="rp-reason">${escapeHtml(stored)}</pre>`)
    }
  })

  it('renders a scored card with its score, confidence, evidence, changeability, weight, points lost and link', async () => {
    const card = buildCards(await savedBundle()).find((c) => c.metricId === 'F05')!
    const out = html(createElement(MetricCardView, { card }))
    expect(out).toContain('aria-label="Score 46 out of 100"')
    expect(out).toMatch(/HIGH 0\.\d\d/)
    expect(out).toContain('MODERATE')
    expect(out).toContain('FIXED')
    expect(out).toContain('Weight 5.75 of 100 · costs 3.2 overall points')
    expect(out).toContain('Fixed – not in the action plan')
    expect(out).toContain('href="#/metrics/F05"')
  })

  it('warns on a LOW confidence card and says it is left out of the overall', async () => {
    const card = buildCards(await savedBundle()).find((c) => c.metricId === 'F08')!
    expect(card.lowConfidence).toBe(true)
    const out = html(createElement(MetricCardView, { card }))
    expect(out).toContain('LOW confidence.')
    expect(out).toContain('left out of the overall score')
    expect(out).toContain('Not counted')
    expect(out).toContain('rp-metric--low')
  })

  it('renders a refused card with the reason and the re-capture steps and no score', async () => {
    const card = buildCards(await savedBundle()).find((c) => c.metricId === 'F14')!
    const out = html(createElement(MetricCardView, { card }))
    expect(out).toContain('Why it was refused')
    expect(out).toContain('Head pitch +6.1° (limit ±4°).')
    expect(out).toContain('Re-capture')
    expect(out).toContain('Ear canal level with lower eyelid.')
    expect(out).toContain('Not scored')
    expect(out).not.toContain('rp-score__num')
    expect(out).not.toContain('Measured')
  })

  it('explains a baseline-set card', async () => {
    const card = buildCards(await savedBundle()).find((c) => c.metricId === 'F01')!
    expect(card.kind).toBe('baseline_set')
    const out = html(createElement(MetricCardView, { card }))
    expect(out).toContain('This scan sets your baseline; it is scored from your next scan.')
    expect(out).toContain('Baseline set')
    expect(out).not.toContain('rp-score__num')
  })

  it('renders pseudoscience and myth cards as collapsed secondary cards with the flag visible', async () => {
    const cards = buildCards(await savedBundle())
    const fwhr = html(createElement(MetricCardView, { card: cards.find((c) => c.metricId === 'F10')! }))
    expect(fwhr).toContain('<details')
    expect(fwhr).toContain('rp-metric--secondary')
    expect(fwhr).toContain('Pseudoscience')
    expect(fwhr).toContain('no research support')
    const phi = html(createElement(MetricCardView, { card: cards.find((c) => c.metricId === 'F21')! }))
    expect(phi).toContain('Myth')
    expect(phi).toContain('contradicted by research')
  })

  it('summarises what to re-capture, once per instruction, for metrics that carry weight', async () => {
    const cards = buildCards(await savedBundle())
    const out = html(createElement(RecaptureSummary, { cards }))
    expect(out).toContain('What to re-capture')
    expect(out).toContain('Frontal neutral')
    expect(out.match(/Ear canal level with lower eyelid\./g)).toHaveLength(1)
    expect(out).toContain('F14 Nose width vs eye spacing; F15 Lip proportion')
  })

  it('draws the drag chart from the stored overall, with a text alternative', async () => {
    const bundle = await savedBundle()
    const cards = buildCards(bundle)
    const out = html(createElement(DragChart, { overall: bundle.overall, cards }))
    expect(out).toContain('Points lost')
    expect(out).toContain('Biggest drags')
    expect(out).toContain('Facial symmetry')
    expect(out).toContain('u-sr-only')
    expect(out).toContain('Fixed: ')
  })

  it('draws no drag chart when nothing was scored with HIGH or MEDIUM confidence', async () => {
    const bundle = await savedBundle()
    const lowOnly = buildCards({ measurements: [], scores: bundle.scores.filter((s) => s.metricId === 'F08'), baselinesToStore: [] })
    expect(html(createElement(DragChart, { overall: bundle.overall, cards: lowOnly }))).toBe('')
  })

  it('shows the QC verdict next to every photo', async () => {
    const bundle = await savedBundle()
    const out = html(createElement(PhotoSection, { photos: bundle.photos }))
    expect(out).toContain('Frontal neutral')
    expect(out).toContain('QC problems')
    expect(out).toContain('Head pitch')
    expect(out).toContain('Tilt your chin down')
    expect(out).toContain('No grey card in frame')
  })

  it('says so when a scan has no photos', () => {
    expect(html(createElement(PhotoSection, { photos: [] }))).toContain('No photos were stored with this scan.')
  })

  it('shows a number only when the stored overall allows one', async () => {
    const bundle = await savedBundle()
    const provisional = { ...bundle.overall, status: 'PROVISIONAL' as const, appearance: 61, band: 3.4, coverage: 0.62, cai: 47 }
    const out = html(createElement(OverallBlock, { overall: provisional, attempted: null }))
    expect(out).toContain('PROVISIONAL')
    expect(out).toContain('>61<')
    expect(out).toContain('± 3.4')
    expect(out).toContain('CAI: 47% – provisional – ceilings are not personalised yet.')
    expect(out).not.toContain('not available')
  })
})
