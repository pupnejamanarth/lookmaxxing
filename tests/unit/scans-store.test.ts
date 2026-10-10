import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShotType } from '../../src/catalog/schema'
import type { Measurement, MetricScore, OverallScore, PhotoRecord, ScanKind, ScoreFacts, ShotQc } from '../../src/domain/types'
import * as storeModule from '../../src/store'
import { LookmaxxingDB, StoreError, createStore, watch } from '../../src/store'
import { exportBackup, restoreBackup } from '../../src/store/backup'
import { createScansStore, findJpegMetadata, type BaselineToStore, type ScanBundle, type ScansStore } from '../../src/store/scans'

// Synthetic data only: the "photos" below are hand-built JPEG segment structures, not images of anyone.
const PASS = 'correct horse battery staple'
const T0 = new Date(2026, 9, 10, 9, 0, 0).getTime()
/** A local-time instant on 2026-10-`day`. Local constructors keep these tests independent of the machine's time zone. */
const local = (day: number, hour = 0, minute = 0, ms = 0) => new Date(2026, 9, day, hour, minute, 0, ms).getTime()

let seq = 0
const opened: LookmaxxingDB[] = []

function setup(start = T0) {
  const database = new LookmaxxingDB(`lmx-scans-test-${++seq}`)
  opened.push(database)
  const clock = { t: start }
  const s = createScansStore(database, { now: () => clock.t })
  return { database, s, clock }
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.delete()))
})

// ───────────────────────────── JPEG fixtures ─────────────────────────────

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))
const segment = (marker: number, payload: number[]): number[] => {
  const length = payload.length + 2
  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}
const JFIF = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0])
const ICC = segment(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 9, 9, 9, 9])
const ADOBE = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1])
const DQT = segment(0xdb, [0, ...new Array<number>(64).fill(16)])
const SOF0 = segment(0xc0, [8, 0, 2, 0, 2, 1, 1, 0x11, 0])
const SOS = segment(0xda, [1, 1, 0, 0, 0x3f, 0])
/** Image data full of look-alikes: a stuffed 0xFF followed by 0xE1, the text "Exif", a restart marker, another stuffed 0xFF. */
const IMAGE_DATA = [0x12, 0xff, 0x00, 0xe1, ...ascii('Exif\0\0'), 0xff, 0xd0, 0x56, 0xff, 0x00, 0xfe]
const EOI = [0xff, 0xd9]

const EXIF = segment(0xe1, [...ascii('Exif\0\0'), 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0])
const XMP = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'))
const IPTC = segment(0xed, [...ascii('Photoshop 3.0\0'), ...ascii('8BIM'), 4, 4, 0, 0])
const COMMENT = segment(0xfe, ascii('taken at home'))
const JFXX = segment(0xe0, [...ascii('JFXX\0'), 0x10, 1, 2, 3])
const MPF = segment(0xe2, [...ascii('MPF\0'), 1, 2, 3, 4])
const APP5 = segment(0xe5, [1, 2, 3])
const JPG5 = segment(0xf5, [1, 2, 3])

function jpegBytes(headers: number[][] = [], tail: number[] = []): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([0xff, 0xd8, ...JFIF, ...headers.flat(), ...DQT, ...SOF0, ...SOS, ...IMAGE_DATA, ...EOI, ...tail])
}

const jpegBlob = (bytes: Uint8Array<ArrayBuffer> = jpegBytes()) => new Blob([bytes], { type: 'image/jpeg' })

// ───────────────────────────── record fixtures ─────────────────────────────

function facts(over: Partial<ScoreFacts> = {}): ScoreFacts {
  return {
    value: 1.62,
    unit: 'ratio',
    uncertainty: 0.03,
    idealSummary: 'Face height to width 1.45 to 1.65',
    idealLo: 1.45,
    idealHi: 1.65,
    gap: 0,
    ruleKind: 'band',
    shotLabel: 'Frontal, neutral',
    sourceIds: ['src-1'],
    weight: 0.02,
    evidence: 'MODERATE',
    changeability: 'FIXED',
    pointsLost: 0,
    ...over,
  }
}

function shotQc(shot: ShotType = 'frontal_neutral'): ShotQc {
  return {
    shot,
    framesTried: 5,
    framesKept: 4,
    checks: [{ id: 'yaw', ok: true, value: 1.2, limit: 'within 3°', hint: '' }],
    burstSpread: 0.01,
    estimatedDistanceM: 1.5,
    irisPx: 38,
    greyCard: false,
  }
}

function photo(scanId: string, over: Partial<PhotoRecord> = {}): PhotoRecord {
  const shot = over.shot ?? 'frontal_neutral'
  return { id: `${scanId}-photo-${shot}`, scanId, shot, blob: jpegBlob(), width: 1080, height: 1440, qc: shotQc(shot), createdAt: T0, ...over }
}

function measurement(scanId: string, metricId: string, over: Partial<Measurement> = {}): Measurement {
  return {
    id: `${scanId}-m-${metricId}`,
    scanId,
    metricId,
    value: 1.62,
    unit: 'ratio',
    uncertainty: 0.03,
    nFrames: 4,
    method: 'AUTO_FRONTAL_PHOTO',
    qcFactor: 0.9,
    algoVersion: 'algo-1',
    inputs: { widthPx: 412, heightPx: 667 },
    ...over,
  }
}

function score(scanId: string, metricId: string, over: Partial<MetricScore> = {}): MetricScore {
  return {
    id: `${scanId}-s-${metricId}`,
    scanId,
    metricId,
    score: 73,
    confidence: { band: 'MEDIUM', value: 0.6 },
    facts: facts(),
    reason: `${metricId} measured 1.62 ratio, inside the ideal 1.45 to 1.65. Nothing lost.`,
    rulesetVersion: 'ruleset-1',
    ...over,
  }
}

function overall(scanId: string, over: Partial<OverallScore> = {}): OverallScore {
  return {
    scanId,
    appearance: null,
    band: null,
    coverage: 0.16,
    status: 'NOT_AVAILABLE',
    pointsLost: { FIXED: 0, SURGICAL_OR_PROFESSIONAL: 0, CHANGEABLE: 0 },
    drag: [],
    cai: null,
    weightsVersion: 'weights-1',
    rulesetVersion: 'ruleset-1',
    ...over,
  }
}

interface BundleOptions {
  id?: string
  takenAt?: number
  kind?: ScanKind
  baselines?: BaselineToStore[]
  photoId?: string
}

/** F05 scored, F01 a first-scan baseline metric (not scored), F10 refused. */
function makeBundle(o: BundleOptions = {}): ScanBundle {
  const id = o.id ?? 'scan-1'
  return {
    scan: {
      id,
      takenAt: o.takenAt ?? T0,
      kind: o.kind ?? 'quick',
      conditions: { hoursSlept: 7.5, alcoholLastNight: false, illness: false, facialHair: 'clean', setup: 'phone_stand' },
      algoVersion: 'algo-1',
    },
    photos: [photo(id, { id: o.photoId ?? `${id}-photo`, createdAt: o.takenAt ?? T0 })],
    measurements: [
      measurement(id, 'F05'),
      measurement(id, 'F01', { value: 0.42, unit: 'ratio' }),
      measurement(id, 'F10', {
        value: null,
        uncertainty: null,
        nFrames: 0,
        qcFactor: 0.2,
        refusal: { reasons: ['The head was turned 6.1 degrees.'], recapture: ['Face the lens straight on and retake the frontal photo.'] },
      }),
    ],
    scores: [
      score(id, 'F05'),
      score(id, 'F01', {
        score: null,
        facts: null,
        confidence: { band: 'LOW', value: 0.3 },
        reason: 'F01 has no norm anchor. This first measurement of 0.42 ratio is saved as your baseline and is not scored.',
      }),
      score(id, 'F10', {
        score: null,
        facts: null,
        confidence: { band: 'REFUSED', value: 0 },
        reason: 'Not scored: the head was turned 6.1 degrees. Re-capture facing the lens.',
      }),
    ],
    overall: overall(id),
    baselinesToStore: o.baselines ?? [{ metricId: 'F01', value: 0.42 }],
  }
}

// ───────────────────────────── helpers ─────────────────────────────

const SCAN_TABLES = ['scans', 'photos', 'measurements', 'scores', 'overall', 'baselines'] as const

async function counts(database: LookmaxxingDB): Promise<Record<string, number>> {
  return Object.fromEntries(await Promise.all(database.tables.map(async (table) => [table.name, await table.count()])))
}

async function expectNothingWritten(database: LookmaxxingDB): Promise<void> {
  const all = await counts(database)
  for (const name of SCAN_TABLES) expect(all[name], name).toBe(0)
  expect(all.audit).toBe(0)
}

/** Rows of every table, with binary values replaced by their bytes so toEqual can compare them. */
async function plain(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return { $blob: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) }
  if (Array.isArray(value)) return Promise.all(value.map(plain))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await plain(item)])))
  }
  return value
}

async function dump(database: LookmaxxingDB): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const table of database.tables) out[table.name] = await plain(await table.toArray())
  return out
}

/** Saves must fail with a StoreError of `code`, and must leave the database exactly as empty as it was. */
async function expectRejected(database: LookmaxxingDB, s: ScansStore, bundle: ScanBundle, code: string, message: RegExp): Promise<void> {
  const error = await s.saveScan(bundle).then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(StoreError)
  expect((error as StoreError).code).toBe(code)
  expect((error as StoreError).message).toMatch(message)
  await expectNothingWritten(database)
}

const scoreOf = (b: ScanBundle, metricId: string): MetricScore => b.scores.find((x) => x.metricId === metricId)!
const measurementOf = (b: ScanBundle, metricId: string): Measurement => b.measurements.find((x) => x.metricId === metricId)!

// ───────────────────────────── tests ─────────────────────────────

describe('public surface and schema', () => {
  it('exposes the contract methods on the singleton and the store index', () => {
    expect(storeModule).toHaveProperty('createScansStore')
    expect(Object.keys(storeModule.scans).sort()).toEqual(
      ['canQuickScan', 'deleteScan', 'getBaselines', 'getScanBundle', 'listScans', 'saveScan'].sort(),
    )
  })

  it('declares schema v2 additively: the v1 stores are unchanged and the six new tables are indexed per contract', () => {
    const { database } = setup()
    expect(database.verno).toBe(2)
    const keyPaths = Object.fromEntries(database.tables.map((t) => [t.name, t.schema.primKey.keyPath]))
    expect(keyPaths).toEqual({
      profile: 'id',
      whitelist: 'id',
      audit: 'id',
      kv: 'key',
      scans: 'id',
      photos: 'id',
      measurements: 'id',
      scores: 'id',
      overall: 'scanId',
      baselines: 'metricId',
    })
    const indexes = (name: string) =>
      database
        .table(name)
        .schema.indexes.map((i) => i.name)
        .sort()
    expect(indexes('whitelist')).toEqual(['active', 'addedAt', 'category'])
    expect(indexes('audit')).toEqual(['event', 'ts'])
    expect(database.table('audit').schema.primKey.auto).toBe(true)
    expect(indexes('scans')).toEqual(['kind', 'takenAt'])
    expect(indexes('photos')).toEqual(['scanId', 'shot'])
    expect(indexes('measurements')).toEqual(['metricId', 'scanId'])
    expect(indexes('scores')).toEqual(['metricId', 'scanId'])
    expect(indexes('overall')).toEqual([])
    expect(indexes('baselines')).toEqual([])
  })

  it('upgrades a v1 database to v2 keeping the profile, whitelist, audit and kv rows untouched', async () => {
    const name = `lmx-scans-test-${++seq}`
    const old = new Dexie(name)
    old.version(1).stores({ profile: 'id', whitelist: 'id, category, active, addedAt', audit: '++id, ts, event', kv: 'key' })
    const profile = {
      id: 'me',
      sexProfile: 'male',
      heightCm: 181,
      units: 'metric',
      dailyMinutes: 30,
      trainingDaysPerWeek: 3,
      scanWeekday: 0,
      installedToHomeScreen: true,
      storagePersisted: true,
      privacyChecklist: { disk_encryption_on: true },
      equipmentChecklist: {},
      onboardedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    }
    const item = {
      id: 'w1',
      name: 'Synthetic cleanser',
      category: 'cleanser',
      notes: '',
      active: true,
      addedAt: T0,
      updatedAt: T0,
      patchTest: { status: 'not_needed', startedAt: null, entries: [] },
    }
    const auditRow = { ts: T0, event: 'onboarding_completed', detail: 'Onboarding completed' }
    await old.table('profile').add(profile)
    await old.table('whitelist').add(item)
    await old.table('audit').add(auditRow)
    await old.table('kv').add({ key: 'plain', value: { n: 1 } })
    old.close()

    const upgraded = new LookmaxxingDB(name)
    opened.push(upgraded)
    await upgraded.open()
    expect(upgraded.verno).toBe(2)
    expect(await upgraded.profile.toArray()).toEqual([profile])
    expect(await upgraded.whitelist.toArray()).toEqual([item])
    expect(await upgraded.audit.toArray()).toEqual([{ id: 1, ...auditRow }])
    expect(await upgraded.kv.toArray()).toEqual([{ key: 'plain', value: { n: 1 } }])
    for (const table of SCAN_TABLES) expect(await upgraded.table(table).count(), table).toBe(0)

    // And the upgraded database is fully usable by both stores.
    expect((await createStore(upgraded).getProfile()).heightCm).toBe(181)
    const s = createScansStore(upgraded, { now: () => T0 })
    await s.saveScan(makeBundle())
    expect((await s.listScans()).map((x) => x.id)).toEqual(['scan-1'])
  })
})

describe('saveScan and getScanBundle', () => {
  it('saves everything in one go and reads it back identical, with one audit row', async () => {
    const { database, s, clock } = setup()
    clock.t = T0 + 5_000
    const bundle = makeBundle()
    await s.saveScan(bundle)

    const loaded = await s.getScanBundle('scan-1')
    expect(loaded).not.toBeNull()
    const expected = { ...bundle, measurements: [...bundle.measurements].sort((a, b) => a.metricId.localeCompare(b.metricId)) }
    expected.scores = [...bundle.scores].sort((a, b) => a.metricId.localeCompare(b.metricId))
    expect(await plain(loaded)).toEqual(await plain(expected))

    expect(await counts(database)).toMatchObject({ scans: 1, photos: 1, measurements: 3, scores: 3, overall: 1, baselines: 1, audit: 1 })
    expect(await database.audit.toArray()).toEqual([
      {
        id: 1,
        ts: T0 + 5_000,
        event: 'scan_saved',
        detail: 'Saved quick scan scan-1: 1 photo, 3 measurements, 3 scores, 1 new baseline',
      },
    ])
  })

  it('keeps the photo bytes exactly, as a JPEG Blob', async () => {
    const { s } = setup()
    const bytes = jpegBytes([ICC, ADOBE])
    const bundle = makeBundle()
    bundle.photos[0]!.blob = jpegBlob(bytes)
    await s.saveScan(bundle)
    const stored = (await s.getScanBundle('scan-1'))!.photos[0]!.blob
    expect(stored.type).toBe('image/jpeg')
    expect(Array.from(new Uint8Array(await stored.arrayBuffer()))).toEqual(Array.from(bytes))
  })

  it('stores the refusal and the unscored rows as they are: no number appears for a refused metric', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle())
    const loaded = (await s.getScanBundle('scan-1'))!
    expect(measurementOf(loaded, 'F10')).toMatchObject({ value: null, refusal: { reasons: ['The head was turned 6.1 degrees.'] } })
    expect(scoreOf(loaded, 'F10')).toMatchObject({ score: null, facts: null, confidence: { band: 'REFUSED' } })
    expect(scoreOf(loaded, 'F01').score).toBeNull()
    expect(scoreOf(loaded, 'F01').reason).toMatch(/baseline/)
  })

  it('returns null for an unknown scan and rejects a missing id', async () => {
    const { s } = setup()
    expect(await s.getScanBundle('nope')).toBeNull()
    await expect(s.getScanBundle('')).rejects.toBeInstanceOf(StoreError)
  })

  it('accepts a scan with no photos, measurements or scores (an empty report is still honest)', async () => {
    const { s, database } = setup()
    const bundle = makeBundle()
    bundle.photos = []
    bundle.measurements = []
    bundle.scores = []
    bundle.baselinesToStore = []
    await s.saveScan(bundle)
    expect(await counts(database)).toMatchObject({ scans: 1, photos: 0, measurements: 0, scores: 0, overall: 1, baselines: 0, audit: 1 })
  })

  it('accepts an overall score at exactly 50 % coverage and a numeric one above it', async () => {
    const { s } = setup()
    const bundle = makeBundle()
    bundle.overall = overall('scan-1', { coverage: 0.5, status: 'PROVISIONAL', appearance: 61, band: 4 })
    await s.saveScan(bundle)
    expect((await s.getScanBundle('scan-1'))!.overall).toMatchObject({ appearance: 61, status: 'PROVISIONAL' })
  })

  it('refuses to save the same scan twice (duplicate) and leaves the first untouched', async () => {
    const { s, database } = setup()
    await s.saveScan(makeBundle())
    const before = await dump(database)
    const second = makeBundle()
    second.photos[0]!.id = 'another-photo-id'
    await expect(s.saveScan(second)).rejects.toMatchObject({ code: 'duplicate' })
    expect(await dump(database)).toEqual(before)
  })

  it('maps a reused photo / measurement / score id across scans to a duplicate error and rolls the second scan back', async () => {
    const { s, database } = setup()
    await s.saveScan(makeBundle({ id: 'scan-1', takenAt: local(8), kind: 'weekly' }))
    const before = await dump(database)
    const clash = makeBundle({ id: 'scan-2', takenAt: local(9), kind: 'weekly', photoId: 'scan-1-photo' })
    await expect(s.saveScan(clash)).rejects.toMatchObject({ code: 'duplicate' })
    expect(await dump(database)).toEqual(before)
  })
})

describe('saveScan is atomic', () => {
  const failPoints: [string, (d: LookmaxxingDB) => unknown][] = [
    ['scans.add', (d) => vi.spyOn(d.scans, 'add')],
    ['photos.bulkAdd', (d) => vi.spyOn(d.photos, 'bulkAdd')],
    ['measurements.bulkAdd', (d) => vi.spyOn(d.measurements, 'bulkAdd')],
    ['scores.bulkAdd', (d) => vi.spyOn(d.scores, 'bulkAdd')],
    ['overall.add', (d) => vi.spyOn(d.overall, 'add')],
    ['baselines.add', (d) => vi.spyOn(d.baselines, 'add')],
    ['audit.add', (d) => vi.spyOn(d.audit, 'add')],
  ]

  it.each(failPoints)('a failure at %s writes nothing at all, not even the audit row', async (_name, inject) => {
    const { database, s } = setup()
    const spy = inject(database) as { mockRejectedValue(e: unknown): unknown }
    spy.mockRejectedValue(new Error('disk full'))
    await expect(s.saveScan(makeBundle())).rejects.toThrow('disk full')
    vi.restoreAllMocks()
    await expectNothingWritten(database)
    // The store is still usable afterwards.
    await s.saveScan(makeBundle())
    expect((await s.listScans()).map((x) => x.id)).toEqual(['scan-1'])
  })

  it('a failed second save does not disturb the first scan or its baselines', async () => {
    const { database, s } = setup()
    await s.saveScan(makeBundle({ id: 'scan-1', takenAt: local(8), kind: 'weekly' }))
    const before = await dump(database)
    vi.spyOn(database.audit, 'add').mockRejectedValue(new Error('disk full'))
    await expect(
      s.saveScan(makeBundle({ id: 'scan-2', takenAt: local(9), kind: 'weekly', baselines: [{ metricId: 'F07', value: 3.1 }] })),
    ).rejects.toThrow('disk full')
    vi.restoreAllMocks()
    expect(await dump(database)).toEqual(before)
    expect(await s.getBaselines()).toEqual({ F01: 0.42 })
  })
})

describe('the data layer enforces the honesty invariants', () => {
  const cases: [string, (b: ScanBundle) => void, string, RegExp][] = [
    ['a score with a number but no facts', (b) => (scoreOf(b, 'F05').facts = null), 'invalid', /Score F05: has a score but no facts/],
    [
      'a score with a number and facts left out entirely',
      (b) => delete (scoreOf(b, 'F05') as unknown as Record<string, unknown>).facts,
      'invalid',
      /has a score but no facts/,
    ],
    ['a score with a number and an empty reason', (b) => (scoreOf(b, 'F05').reason = ''), 'invalid', /Score F05: has an empty reason/],
    ['a score with a number and a whitespace-only reason', (b) => (scoreOf(b, 'F05').reason = ' \n\t '), 'invalid', /empty reason/],
    ['an unscored metric with an empty reason', (b) => (scoreOf(b, 'F10').reason = ''), 'invalid', /Score F10: has an empty reason/],
    ['a reason that is not text', (b) => ((scoreOf(b, 'F05') as unknown as Record<string, unknown>).reason = 42), 'invalid', /empty reason/],
    [
      'a score with malformed facts',
      (b) => ((scoreOf(b, 'F05').facts as unknown as Record<string, unknown>).value = 'high'),
      'invalid',
      /facts need numeric value/,
    ],
    ['a score outside 0-100', (b) => (scoreOf(b, 'F05').score = 101), 'invalid', /between 0 and 100/],
    [
      'a number with the REFUSED confidence band',
      (b) => (scoreOf(b, 'F05').confidence = { band: 'REFUSED', value: 0 }),
      'invalid',
      /refused metric cannot have a score/,
    ],
    [
      'a refused measurement that is still scored',
      (b) => {
        const s = scoreOf(b, 'F10')
        s.score = 40
        s.facts = facts()
        s.confidence = { band: 'LOW', value: 0.2 }
      },
      'invalid',
      /Score F10: the measurement was refused, so it cannot be scored/,
    ],
    ['a refusal that still has a value', (b) => (measurementOf(b, 'F10').value = 1.2), 'invalid', /has a refusal and a value/],
    ['a refusal without reasons', (b) => (measurementOf(b, 'F10').refusal!.reasons = []), 'invalid', /a refusal must say why/],
    ['a refusal without re-capture advice', (b) => (measurementOf(b, 'F10').refusal!.recapture = []), 'invalid', /what to re-capture/],
    ['a refusal with a blank reason', (b) => (measurementOf(b, 'F10').refusal!.reasons = ['  ']), 'invalid', /must say why/],
    [
      'no value and no refusal',
      (b) => delete (measurementOf(b, 'F10') as unknown as Record<string, unknown>).refusal,
      'invalid',
      /no value and no refusal/,
    ],
    ['a measurement value that is NaN', (b) => (measurementOf(b, 'F05').value = NaN), 'invalid', /value must be a number/],
    ['a measurement with an unknown method', (b) => ((measurementOf(b, 'F05') as unknown as Record<string, unknown>).method = 'GUESS'), 'invalid', /unknown method/],
    ['a negative uncertainty', (b) => (measurementOf(b, 'F05').uncertainty = -0.1), 'invalid', /uncertainty must be 0 or more/],
    ['a qcFactor above 1', (b) => (measurementOf(b, 'F05').qcFactor = 1.5), 'invalid', /qcFactor/],
    ['a non-numeric input', (b) => ((measurementOf(b, 'F05').inputs as unknown as Record<string, unknown>).label = 'x'), 'invalid', /input "label" must be a number/],
    ['a measurement for another scan', (b) => (measurementOf(b, 'F05').scanId = 'scan-9'), 'invalid', /belongs to a different scan/],
    ['a score for another scan', (b) => (scoreOf(b, 'F05').scanId = 'scan-9'), 'invalid', /belongs to a different scan/],
    ['a photo for another scan', (b) => (b.photos[0]!.scanId = 'scan-9'), 'invalid', /belongs to a different scan/],
    ['an overall score for another scan', (b) => (b.overall.scanId = 'scan-9'), 'invalid', /belongs to a different scan/],
    ['a metric measured twice', (b) => b.measurements.push(measurement('scan-1', 'F05', { id: 'dup-m' })), 'invalid', /Measurement for metric "F05" appears more than once/],
    ['a metric scored twice', (b) => b.scores.push(score('scan-1', 'F05', { id: 'dup-s' })), 'invalid', /Score for metric "F05" appears more than once/],
    ['two measurements sharing an id', (b) => (measurementOf(b, 'F01').id = measurementOf(b, 'F05').id), 'invalid', /Measurement id .* appears more than once/],
    ['an invalid metric id', (b) => (measurementOf(b, 'F05').metricId = '__proto__'), 'invalid', /invalid metric id/],
    [
      'an overall score below 50 % coverage that claims a number',
      (b) => (b.overall = overall('scan-1', { coverage: 0.49, status: 'FINAL', appearance: 70, band: 3 })),
      'invalid',
      /below 50 %, so there is no overall score/,
    ],
    [
      'a NOT_AVAILABLE overall that carries a number',
      (b) => (b.overall = overall('scan-1', { appearance: 60 })),
      'invalid',
      /NOT_AVAILABLE cannot carry/,
    ],
    [
      'a FINAL overall with no number',
      (b) => (b.overall = overall('scan-1', { coverage: 0.9, status: 'FINAL', appearance: null })),
      'invalid',
      /FINAL needs an appearance score/,
    ],
    ['an overall score above 100', (b) => (b.overall = overall('scan-1', { coverage: 0.9, status: 'FINAL', appearance: 101, band: 1 })), 'invalid', /appearance must be between/],
    ['an unknown overall status', (b) => ((b.overall as unknown as Record<string, unknown>).status = 'GREAT'), 'invalid', /unknown status/],
    ['a baseline that is not finite', (b) => (b.baselinesToStore = [{ metricId: 'F01', value: Infinity }]), 'invalid', /value must be a number/],
    [
      'the same baseline twice',
      (b) =>
        (b.baselinesToStore = [
          { metricId: 'F01', value: 1 },
          { metricId: 'F01', value: 2 },
        ]),
      'invalid',
      /Baseline "F01" appears more than once/,
    ],
    ['a scan with an unknown kind', (b) => ((b.scan as unknown as Record<string, unknown>).kind = 'daily'), 'invalid', /unknown kind/],
    ['a scan with no id', (b) => (b.scan.id = ''), 'invalid', /Scan needs an id/],
    ['a scan with a bad timestamp', (b) => (b.scan.takenAt = NaN), 'invalid', /takenAt/],
    ['a scan with free text in its conditions', (b) => ((b.scan.conditions as Record<string, unknown>).notes = 'felt great'), 'invalid', /does not store: "notes"/],
    ['a scan carrying a name', (b) => ((b.scan as unknown as Record<string, unknown>).name = 'someone'), 'invalid', /does not store: "name"/],
    ['an impossible sleep value', (b) => (b.scan.conditions.hoursSlept = 30), 'invalid', /hoursSlept/],
    ['an unknown facial hair state', (b) => ((b.scan.conditions as Record<string, unknown>).facialHair = 'goatee'), 'invalid', /facialHair/],
    ['an unexpected bundle field', (b) => ((b as unknown as Record<string, unknown>).extra = 1), 'invalid', /does not store: "extra"/],
  ]

  it.each(cases)('rejects %s and writes nothing', async (_name, mutate, code, message) => {
    const { database, s } = setup()
    const bundle = makeBundle()
    mutate(bundle)
    await expectRejected(database, s, bundle, code, message)
  })

  it('rejects garbage that is not a bundle', async () => {
    const { database, s } = setup()
    for (const junk of [null, undefined, 'scan', 7, [], { scan: null }]) {
      await expect(s.saveScan(junk as unknown as ScanBundle)).rejects.toMatchObject({ code: 'invalid' })
    }
    await expectNothingWritten(database)
  })

  it('names every offence in plain words a UI can show', async () => {
    const { s } = setup()
    const bundle = makeBundle()
    scoreOf(bundle, 'F05').reason = ''
    await expect(s.saveScan(bundle)).rejects.toThrow('Score F05: has an empty reason. Every score needs a reason.')
  })
})

describe('photos must be metadata-free re-encoded JPEGs', () => {
  const bad: [string, () => Blob | unknown, RegExp][] = [
    ['a PNG-typed blob', () => new Blob([jpegBytes()], { type: 'image/png' }), /only re-encoded JPEG photos are stored \(got "image\/png"\)/],
    ['a blob without a type', () => new Blob([jpegBytes()]), /got "no type"/],
    ['an empty blob', () => new Blob([], { type: 'image/jpeg' }), /image is empty/],
    ['something that is not a Blob', () => ({ size: 10, type: 'image/jpeg' }), /must be a Blob/],
    ['PNG bytes labelled as JPEG', () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])], { type: 'image/jpeg' }), /not a complete JPEG/],
    ['a truncated JPEG', () => jpegBlob(jpegBytes().slice(0, -2)), /not a complete JPEG/],
    ['a JPEG cut inside a segment', () => jpegBlob(jpegBytes().slice(0, 30)), /not a complete JPEG/],
    ['an Exif block (camera, time, GPS)', () => jpegBlob(jpegBytes([EXIF])), /APP1 Exif/],
    ['an XMP packet', () => jpegBlob(jpegBytes([XMP])), /APP1 XMP/],
    ['an IPTC block', () => jpegBlob(jpegBytes([IPTC])), /APP13 IPTC/],
    ['a comment', () => jpegBlob(jpegBytes([COMMENT])), /COM comment/],
    ['a JFXX thumbnail', () => jpegBlob(jpegBytes([JFXX])), /APP0 JFXX thumbnail/],
    ['multi-picture data', () => jpegBlob(jpegBytes([MPF])), /APP2 multi-picture data/],
    ['an unknown application segment', () => jpegBlob(jpegBytes([APP5])), /APP5 metadata/],
    ['a reserved extension segment', () => jpegBlob(jpegBytes([JPG5])), /reserved extension segment/],
    ['bytes appended after the end of the image', () => jpegBlob(jpegBytes([], [1, 2, 3, 4])), /data after the end of the image/],
  ]

  it.each(bad)('rejects %s and writes nothing', async (_name, makeBlob, message) => {
    const { database, s } = setup()
    const bundle = makeBundle()
    bundle.photos[0]!.blob = makeBlob() as Blob
    await expectRejected(database, s, bundle, 'invalid', message)
  })

  it('lists every offence at once', async () => {
    const { s } = setup()
    const bundle = makeBundle()
    bundle.photos[0]!.blob = jpegBlob(jpegBytes([EXIF, XMP, COMMENT]))
    await expect(s.saveScan(bundle)).rejects.toThrow(/APP1 Exif.*APP1 XMP.*COM comment/)
  })

  it('rejects a photo that carries a file name or any other field the app does not store', async () => {
    const { database, s } = setup()
    const bundle = makeBundle()
    ;(bundle.photos[0] as unknown as Record<string, unknown>).fileName = 'me-at-home.jpg'
    await expectRejected(database, s, bundle, 'invalid', /does not store: "fileName"/)
  })

  it('rejects an unknown shot, bad dimensions and a quality record for another shot', async () => {
    const { database, s } = setup()
    const unknownShot = makeBundle()
    ;(unknownShot.photos[0] as unknown as Record<string, unknown>).shot = 'selfie'
    await expectRejected(database, s, unknownShot, 'invalid', /unknown shot type/)

    const zero = makeBundle()
    zero.photos[0]!.width = 0
    await expectRejected(database, s, zero, 'invalid', /positive whole numbers/)

    const wrongQc = makeBundle()
    wrongQc.photos[0]!.qc = shotQc('profile_left')
    await expectRejected(database, s, wrongQc, 'invalid', /quality record is for a different shot/)
  })

  it('accepts what a browser encoder produces: JFIF, an ICC profile, Adobe colour data, fill bytes and look-alike image data', async () => {
    const { s } = setup()
    const bundle = makeBundle()
    bundle.photos[0]!.blob = jpegBlob(jpegBytes([ICC, ADOBE, [0xff]]))
    await s.saveScan(bundle)
    expect((await s.getScanBundle('scan-1'))!.photos).toHaveLength(1)
  })

  it('findJpegMetadata walks segments instead of searching bytes', () => {
    expect(findJpegMetadata(jpegBytes())).toEqual({ wellFormed: true, findings: [] })
    expect(findJpegMetadata(jpegBytes([ICC, ADOBE]))).toEqual({ wellFormed: true, findings: [] })
    expect(findJpegMetadata(jpegBytes([EXIF, EXIF]))).toEqual({ wellFormed: true, findings: ['APP1 Exif (camera, time, GPS)'] })
    expect(findJpegMetadata(jpegBytes([APP5, COMMENT])).findings).toEqual(['APP5 metadata', 'COM comment'])
    expect(findJpegMetadata(jpegBytes([], [0])).findings).toEqual(['data after the end of the image'])
    expect(findJpegMetadata(Uint8Array.from([])).wellFormed).toBe(false)
    expect(findJpegMetadata(Uint8Array.from([0xff, 0xd8])).wellFormed).toBe(false)
    expect(findJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])).wellFormed).toBe(false) // no scan
    // a segment whose length runs past the end of the file
    expect(findJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 1, 2])).wellFormed).toBe(false)
  })
})

describe('listing and ordering', () => {
  it('lists scans newest first, whatever order they were saved in', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ id: 'b', takenAt: local(5), kind: 'weekly' }))
    await s.saveScan(makeBundle({ id: 'c', takenAt: local(7), kind: 'weekly' }))
    await s.saveScan(makeBundle({ id: 'a', takenAt: local(2), kind: 'weekly' }))
    expect((await s.listScans()).map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('breaks ties on the same instant deterministically', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ id: 'a', takenAt: local(5), kind: 'weekly' }))
    await s.saveScan(makeBundle({ id: 'b', takenAt: local(5), kind: 'weekly' }))
    const first = (await s.listScans()).map((x) => x.id)
    expect(first).toEqual(['b', 'a'])
    expect((await s.listScans()).map((x) => x.id)).toEqual(first)
  })

  it('returns an empty list before anything is saved', async () => {
    const { s } = setup()
    expect(await s.listScans()).toEqual([])
  })

  it('returns measurements and scores by metric id and photos oldest first', async () => {
    const { s } = setup()
    const bundle = makeBundle()
    bundle.measurements.reverse()
    bundle.scores.reverse()
    bundle.photos = [
      photo('scan-1', { shot: 'frontal_smile', createdAt: T0 + 20, id: 'p-late' }),
      photo('scan-1', { shot: 'frontal_neutral', createdAt: T0 + 10, id: 'p-early' }),
    ]
    await s.saveScan(bundle)
    const loaded = (await s.getScanBundle('scan-1'))!
    expect(loaded.measurements.map((m) => m.metricId)).toEqual(['F01', 'F05', 'F10'])
    expect(loaded.scores.map((x) => x.metricId)).toEqual(['F01', 'F05', 'F10'])
    expect(loaded.photos.map((p) => p.id)).toEqual(['p-early', 'p-late'])
  })
})

describe('one quick scan per local calendar day', () => {
  it('allows the first quick scan of the day', async () => {
    const { s } = setup()
    expect(await s.canQuickScan(T0)).toEqual({ allowed: true, nextAllowedAt: null })
  })

  it('blocks a second one until local midnight, then allows it at exactly midnight', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ takenAt: local(10, 9) }))
    const midnight = local(11)
    expect(await s.canQuickScan(local(10, 9, 1))).toEqual({ allowed: false, nextAllowedAt: midnight })
    expect(await s.canQuickScan(local(10, 23, 59, 999))).toEqual({ allowed: false, nextAllowedAt: midnight })
    expect(await s.canQuickScan(midnight)).toEqual({ allowed: true, nextAllowedAt: null })
    expect(await s.canQuickScan(local(11, 0, 1))).toEqual({ allowed: true, nextAllowedAt: null })
  })

  it('is about the calendar day, not 24 hours: a scan at 23:59 does not block 00:01 the next day', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ takenAt: local(10, 23, 59) }))
    expect((await s.canQuickScan(local(10, 23, 59, 500))).allowed).toBe(false)
    expect((await s.canQuickScan(local(11, 0, 1))).allowed).toBe(true)
  })

  it('does not block the day before a scan either', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ takenAt: local(10, 0, 0) }))
    expect((await s.canQuickScan(local(9, 23, 59))).allowed).toBe(true)
    expect((await s.canQuickScan(local(10, 0, 0))).allowed).toBe(false)
  })

  it('uses the store clock when no time is passed', async () => {
    const { s, clock } = setup()
    await s.saveScan(makeBundle({ takenAt: local(10, 9) }))
    clock.t = local(10, 18)
    expect((await s.canQuickScan()).allowed).toBe(false)
    clock.t = local(11, 8)
    expect((await s.canQuickScan()).allowed).toBe(true)
  })

  it('only quick scans count: weekly, calibration and monthly scans do not use up the day', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ id: 'w', takenAt: local(10, 8), kind: 'weekly' }))
    await s.saveScan(makeBundle({ id: 'c', takenAt: local(10, 9), kind: 'calibration' }))
    await s.saveScan(makeBundle({ id: 'm', takenAt: local(10, 10), kind: 'monthly' }))
    expect((await s.canQuickScan(local(10, 12))).allowed).toBe(true)
    await s.saveScan(makeBundle({ id: 'q', takenAt: local(10, 11) }))
    expect((await s.canQuickScan(local(10, 12))).allowed).toBe(false)
  })

  it('saveScan itself refuses a second quick scan on the same day (forbidden) and writes nothing for it', async () => {
    const { database, s } = setup()
    await s.saveScan(makeBundle({ id: 'first', takenAt: local(10, 9) }))
    const before = await dump(database)
    const second = makeBundle({ id: 'second', takenAt: local(10, 20), photoId: 'second-photo', baselines: [{ metricId: 'F07', value: 2 }] })
    await expect(s.saveScan(second)).rejects.toMatchObject({ code: 'forbidden', message: expect.stringMatching(/Only one quick scan per day/) })
    expect(await dump(database)).toEqual(before)
    // The next local day is fine.
    await s.saveScan(makeBundle({ id: 'third', takenAt: local(11, 0, 0), photoId: 'third-photo' }))
    expect((await s.listScans()).map((x) => x.id)).toEqual(['third', 'first'])
  })

  it('deleting today\'s quick scan frees the slot', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ id: 'first', takenAt: local(10, 9) }))
    expect((await s.canQuickScan(local(10, 10))).allowed).toBe(false)
    await s.deleteScan('first')
    expect((await s.canQuickScan(local(10, 10))).allowed).toBe(true)
  })

  it('rejects a time that is not a number', async () => {
    const { s } = setup()
    await expect(s.canQuickScan(NaN)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('baselines are write-once per metric', () => {
  it('sets a baseline on the first scan and returns it as a record', async () => {
    const { database, s } = setup()
    expect(await s.getBaselines()).toEqual({})
    await s.saveScan(makeBundle())
    expect(await s.getBaselines()).toEqual({ F01: 0.42 })
    expect(await database.baselines.toArray()).toEqual([{ metricId: 'F01', value: 0.42, setAt: T0, scanId: 'scan-1' }])
  })

  it('never overwrites an existing baseline, but adds new metrics from later scans', async () => {
    const { database, s, clock } = setup()
    await s.saveScan(makeBundle({ id: 'scan-1', takenAt: local(8), kind: 'weekly' }))
    clock.t = local(9)
    await s.saveScan(
      makeBundle({
        id: 'scan-2',
        takenAt: local(9),
        kind: 'weekly',
        baselines: [
          { metricId: 'F01', value: 0.5 },
          { metricId: 'F07', value: 3.1 },
        ],
      }),
    )
    expect(await s.getBaselines()).toEqual({ F01: 0.42, F07: 3.1 })
    const rows = await database.baselines.orderBy('metricId').toArray()
    expect(rows).toEqual([
      { metricId: 'F01', value: 0.42, setAt: local(8), scanId: 'scan-1' },
      { metricId: 'F07', value: 3.1, setAt: local(9), scanId: 'scan-2' },
    ])
    expect((await database.audit.orderBy('id').toArray()).map((a) => a.detail)).toEqual([
      'Saved weekly scan scan-1: 1 photo, 3 measurements, 3 scores, 1 new baseline',
      'Saved weekly scan scan-2: 1 photo, 3 measurements, 3 scores, 1 new baseline',
    ])
    // A loaded bundle reports only the baselines that scan established.
    expect((await s.getScanBundle('scan-1'))!.baselinesToStore).toEqual([{ metricId: 'F01', value: 0.42 }])
    expect((await s.getScanBundle('scan-2'))!.baselinesToStore).toEqual([{ metricId: 'F07', value: 3.1 }])
  })

  it('does not keep a baseline from a bundle that was rejected', async () => {
    const { s } = setup()
    const bundle = makeBundle()
    scoreOf(bundle, 'F05').reason = ''
    await expect(s.saveScan(bundle)).rejects.toBeInstanceOf(StoreError)
    expect(await s.getBaselines()).toEqual({})
  })

  it('a bundle without baselines leaves them alone', async () => {
    const { s } = setup()
    await s.saveScan(makeBundle({ id: 'scan-1', takenAt: local(8), kind: 'weekly' }))
    await s.saveScan(makeBundle({ id: 'scan-2', takenAt: local(9), kind: 'weekly', baselines: [] }))
    expect(await s.getBaselines()).toEqual({ F01: 0.42 })
  })
})

describe('deleteScan', () => {
  it('removes the scan and everything hanging off it in one go, keeps other scans and all baselines, and audits it', async () => {
    const { database, s, clock } = setup()
    await s.saveScan(makeBundle({ id: 'scan-1', takenAt: local(8), kind: 'weekly' }))
    await s.saveScan(makeBundle({ id: 'scan-2', takenAt: local(9), kind: 'weekly', baselines: [{ metricId: 'F07', value: 3.1 }] }))
    const keep = await plain(await s.getScanBundle('scan-2'))
    clock.t = T0 + 999

    await s.deleteScan('scan-1')

    expect(await s.getScanBundle('scan-1')).toBeNull()
    expect((await s.listScans()).map((x) => x.id)).toEqual(['scan-2'])
    expect(await plain(await s.getScanBundle('scan-2'))).toEqual(keep)
    expect(await counts(database)).toMatchObject({ scans: 1, photos: 1, measurements: 3, scores: 3, overall: 1, baselines: 2 })
    for (const name of ['photos', 'measurements', 'scores', 'overall'] as const) {
      const rows = (await database.table(name).toArray()) as { scanId: string }[]
      expect(rows.every((row) => row.scanId === 'scan-2'), name).toBe(true)
    }
    expect(await s.getBaselines()).toEqual({ F01: 0.42, F07: 3.1 })
    const last = (await database.audit.orderBy('id').toArray()).at(-1)
    expect(last).toMatchObject({ ts: T0 + 999, event: 'scan_deleted', detail: 'Deleted weekly scan scan-1: 1 photo, 3 measurements, 3 scores' })
  })

  it('throws not_found for an unknown scan and writes nothing', async () => {
    const { database, s } = setup()
    await expect(s.deleteScan('missing')).rejects.toMatchObject({ code: 'not_found' })
    await expect(s.deleteScan('')).rejects.toMatchObject({ code: 'invalid' })
    expect(await database.audit.count()).toBe(0)
  })

  it.each([
    ['overall.delete', (d: LookmaxxingDB) => vi.spyOn(d.overall, 'delete')],
    ['scans.delete', (d: LookmaxxingDB) => vi.spyOn(d.scans, 'delete')],
    ['audit.add', (d: LookmaxxingDB) => vi.spyOn(d.audit, 'add')],
  ])('a failure at %s leaves the whole scan in place', async (_name, inject) => {
    const { database, s } = setup()
    await s.saveScan(makeBundle())
    const before = await dump(database)
    inject(database).mockRejectedValue(new Error('disk full'))
    await expect(s.deleteScan('scan-1')).rejects.toThrow('disk full')
    vi.restoreAllMocks()
    expect(await dump(database)).toEqual(before)
    await s.deleteScan('scan-1')
    expect(await s.getScanBundle('scan-1')).toBeNull()
  })
})

describe('backup, delete-all and live queries cover the scan tables', () => {
  it('a scan with a Blob photo survives export then restore bit-exact, replacing what was there', async () => {
    const a = setup()
    const bytes = jpegBytes([ICC])
    const bundle = makeBundle()
    bundle.photos[0]!.blob = jpegBlob(bytes)
    await a.s.saveScan(bundle)
    await createStore(a.database, { now: () => T0, uuid: () => 'id-1' }).updateProfile({ heightCm: 181 })

    const { blob, summary } = await exportBackup(PASS, a.database, { now: () => T0 })
    expect(summary.tables).toMatchObject({ scans: 1, photos: 1, measurements: 3, scores: 3, overall: 1, baselines: 1 })
    expect(summary.blobCount).toBe(1)
    expect(summary.blobBytes).toBe(bytes.length)

    const b = setup()
    await b.s.saveScan(makeBundle({ id: 'old-scan', takenAt: local(1), kind: 'weekly', photoId: 'old-photo', baselines: [{ metricId: 'F99', value: 9 }] }))
    const restored = await restoreBackup(blob, PASS, b.database, { now: () => T0 + 1 })
    expect(restored.tables).toMatchObject({ scans: 1, photos: 1, measurements: 3, scores: 3, overall: 1, baselines: 1 })

    const { audit: auditA, ...rowsA } = await dump(a.database)
    const { audit: auditB, ...rowsB } = await dump(b.database)
    expect(rowsB).toEqual(rowsA)
    // The audit log is part of the backup too: restore brings it back and appends its own row.
    expect(auditA).toHaveLength(2)
    expect(auditB).toEqual([...(auditA as unknown[]), expect.objectContaining({ event: 'backup_restored' })])

    expect((await b.s.listScans()).map((x) => x.id)).toEqual(['scan-1'])
    expect(await b.s.getBaselines()).toEqual({ F01: 0.42 })
    const photoBack = (await b.s.getScanBundle('scan-1'))!.photos[0]!.blob
    expect(photoBack.type).toBe('image/jpeg')
    expect(Array.from(new Uint8Array(await photoBack.arrayBuffer()))).toEqual(Array.from(bytes))
    expect(await plain(await b.s.getScanBundle('scan-1'))).toEqual(await plain(await a.s.getScanBundle('scan-1')))
  }, 60_000)

  it('deleteAllData empties every scan table, baselines included, then writes a single data_deleted row', async () => {
    const { database, s } = setup()
    await s.saveScan(makeBundle())
    await createStore(database, { now: () => T0 + 7 }).deleteAllData()
    const all = await counts(database)
    for (const name of SCAN_TABLES) expect(all[name], name).toBe(0)
    expect(await database.audit.toArray()).toEqual([expect.objectContaining({ event: 'data_deleted', ts: T0 + 7 })])
    expect(await s.listScans()).toEqual([])
    expect(await s.getBaselines()).toEqual({})
    // A fresh scan can be saved again afterwards, quick-scan slot included.
    expect((await s.canQuickScan(T0)).allowed).toBe(true)
    await s.saveScan(makeBundle())
  })

  it('works inside watch(): lists and bundles re-emit when a scan is saved or deleted', async () => {
    const { s } = setup()
    const lists: string[][] = []
    const bundles: (string | null)[] = []
    const waiters: (() => void)[] = []
    const tick = () => new Promise<void>((resolve) => waiters.push(resolve))
    const wake = () => waiters.splice(0).forEach((resolve) => resolve())
    const stopList = watch(() => s.listScans()).subscribe((list) => {
      lists.push(list.map((x) => x.id))
      wake()
    })
    const stopBundle = watch(() => s.getScanBundle('scan-1')).subscribe((bundle) => {
      bundles.push(bundle ? bundle.scan.id : null)
      wake()
    })
    const settle = async (done: () => boolean) => {
      while (!done()) await tick()
    }

    await settle(() => lists.length > 0 && bundles.length > 0)
    expect(lists.at(-1)).toEqual([])
    expect(bundles.at(-1)).toBeNull()

    await s.saveScan(makeBundle())
    await settle(() => lists.at(-1)?.length === 1 && bundles.at(-1) === 'scan-1')

    await s.deleteScan('scan-1')
    await settle(() => lists.at(-1)?.length === 0 && bundles.at(-1) === null)

    stopList()
    stopBundle()
  })
})
