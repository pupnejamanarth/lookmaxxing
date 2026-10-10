import { describe, expect, it } from 'vitest'
import {
  UNPARSEABLE_ORIGIN,
  getOriginAudit,
  raiseResourceTimingBuffer,
  summarizeResourceOrigins,
  type PerformanceLike,
} from '../../src/privacy'

const SELF = 'https://app.example'
const entry = (name: string) => ({ name })

describe('summarizeResourceOrigins', () => {
  it('reads exactly one origin for a clean production load', () => {
    const entries = [
      'https://app.example/lookmaxxing/',
      'https://app.example/lookmaxxing/assets/index-abc.js',
      'https://app.example/lookmaxxing/assets/index-abc.css',
      'https://app.example/lookmaxxing/models/face_landmarker.task',
      'https://app.example/lookmaxxing/manifest.webmanifest',
    ].map(entry)
    expect(summarizeResourceOrigins(entries, SELF)).toEqual({
      origins: [{ origin: SELF, count: 5 }],
      external: [],
    })
  })

  it('returns nothing for no entries', () => {
    expect(summarizeResourceOrigins([], SELF)).toEqual({ origins: [], external: [] })
  })

  it('lists foreign origins as external and counts them', () => {
    const entries = [
      'https://app.example/a.js',
      'https://app.example/b.js',
      'https://cdn.example/lib.js',
      'https://cdn.example/lib2.js',
      'https://tracker.example/pixel.gif?id=1',
    ].map(entry)
    expect(summarizeResourceOrigins(entries, SELF)).toEqual({
      origins: [
        { origin: SELF, count: 2 },
        { origin: 'https://cdn.example', count: 2 },
        { origin: 'https://tracker.example', count: 1 },
      ],
      external: ['https://cdn.example', 'https://tracker.example'],
    })
  })

  it('puts the own origin first even when foreign origins outnumber it', () => {
    const entries = ['https://app.example/a.js', ...Array.from({ length: 3 }, (_, i) => `https://z.example/${i}`)].map(entry)
    expect(summarizeResourceOrigins(entries, SELF).origins.map((o) => o.origin)).toEqual([SELF, 'https://z.example'])
  })

  it('orders ties alphabetically so the output is deterministic', () => {
    const entries = ['https://b.example/1', 'https://a.example/1', 'https://c.example/1'].map(entry)
    expect(summarizeResourceOrigins(entries, SELF).external).toEqual(['https://a.example', 'https://b.example', 'https://c.example'])
  })

  it('treats a different scheme, port or subdomain as a different origin', () => {
    const entries = [
      'https://app.example/a',
      'http://app.example/a',
      'https://app.example:8443/a',
      'https://www.app.example/a',
    ].map(entry)
    expect(summarizeResourceOrigins(entries, SELF).external).toEqual([
      'http://app.example',
      'https://app.example:8443',
      'https://www.app.example',
    ])
  })

  it('normalizes an href passed as selfOrigin and default ports', () => {
    const entries = ['https://app.example:443/a', 'https://app.example/b'].map(entry)
    expect(summarizeResourceOrigins(entries, 'https://app.example/lookmaxxing/')).toEqual({
      origins: [{ origin: SELF, count: 2 }],
      external: [],
    })
  })

  it('resolves relative names against the own origin', () => {
    const entries = ['/lookmaxxing/a.js', 'b.js'].map(entry)
    expect(summarizeResourceOrigins(entries, SELF)).toEqual({ origins: [{ origin: SELF, count: 2 }], external: [] })
  })

  it('does not count data: and blob: loads – they never leave the device', () => {
    const entries = ['data:image/png;base64,AAAA', 'blob:https://app.example/7a1b3c', 'https://app.example/a'].map(entry)
    expect(summarizeResourceOrigins(entries, SELF)).toEqual({ origins: [{ origin: SELF, count: 1 }], external: [] })
  })

  it('reports an unparseable name as external instead of hiding it', () => {
    const result = summarizeResourceOrigins([entry('https://app.example/a'), entry('http://')], SELF)
    expect(result.external).toEqual([UNPARSEABLE_ORIGIN])
  })

  it('keeps host and scheme of non-web origins (browser extensions)', () => {
    const result = summarizeResourceOrigins([entry('chrome-extension://abcdef/inject.js')], SELF)
    expect(result.external).toEqual(['chrome-extension://abcdef'])
  })

  it('treats everything as external when the own origin is unknown', () => {
    const result = summarizeResourceOrigins([entry('https://app.example/a')], '')
    expect(result.external).toEqual([SELF])
  })

  it('never records paths or queries', () => {
    const result = summarizeResourceOrigins([entry('https://tracker.example/p/secret?token=abc#x')], SELF)
    expect(JSON.stringify(result)).not.toMatch(/secret|token|abc/)
  })
})

function fakePerformance(byType: Record<string, string[]>): PerformanceLike {
  return { getEntriesByType: (type) => (byType[type] ?? []).map(entry) }
}

describe('getOriginAudit', () => {
  const location = { href: 'https://app.example/lookmaxxing/', origin: SELF }

  it('combines navigation and resource entries', () => {
    const performance = fakePerformance({
      navigation: ['https://app.example/lookmaxxing/'],
      resource: ['https://app.example/lookmaxxing/assets/a.js', 'https://app.example/lookmaxxing/assets/a.css'],
    })
    expect(getOriginAudit({ performance, location })).toEqual({
      origins: [{ origin: SELF, count: 3 }],
      external: [],
    })
  })

  it('surfaces a foreign load', () => {
    const performance = fakePerformance({
      navigation: ['https://app.example/lookmaxxing/'],
      resource: ['https://app.example/a.js', 'https://fonts.example/css'],
    })
    expect(getOriginAudit({ performance, location }).external).toEqual(['https://fonts.example'])
  })

  it('falls back to document.location when the engine exposes no navigation entry', () => {
    const performance = fakePerformance({ resource: ['https://app.example/a.js'] })
    expect(getOriginAudit({ performance, location })).toEqual({ origins: [{ origin: SELF, count: 2 }], external: [] })
  })

  it('does not count the document twice when a navigation entry exists', () => {
    const performance = fakePerformance({ navigation: ['https://app.example/lookmaxxing/'] })
    expect(getOriginAudit({ performance, location }).origins).toEqual([{ origin: SELF, count: 1 }])
  })

  it('derives the own origin from href when location.origin is missing', () => {
    const performance = fakePerformance({ resource: ['https://app.example/a.js'] })
    expect(getOriginAudit({ performance, location: { href: 'https://app.example/lookmaxxing/' } }).external).toEqual([])
  })

  it('survives a performance object that throws or is missing', () => {
    const throwing: PerformanceLike = {
      getEntriesByType: () => {
        throw new Error('unsupported')
      },
    }
    expect(getOriginAudit({ performance: throwing, location })).toEqual({ origins: [{ origin: SELF, count: 1 }], external: [] })
    expect(getOriginAudit({ location })).toEqual({ origins: [{ origin: SELF, count: 1 }], external: [] })
  })

  it('reads the live Node globals without throwing', () => {
    expect(() => getOriginAudit()).not.toThrow()
  })
})

describe('raiseResourceTimingBuffer', () => {
  it('asks the engine for a bigger buffer', () => {
    const sizes: number[] = []
    const performance: PerformanceLike = { getEntriesByType: () => [], setResourceTimingBufferSize: (n) => sizes.push(n) }
    raiseResourceTimingBuffer(1234, { performance })
    raiseResourceTimingBuffer(undefined, { performance })
    expect(sizes).toEqual([1234, 2000])
  })

  it('is a no-op when unsupported or throwing', () => {
    expect(() => raiseResourceTimingBuffer(10, { performance: { getEntriesByType: () => [] } })).not.toThrow()
    const throwing: PerformanceLike = {
      getEntriesByType: () => [],
      setResourceTimingBufferSize: () => {
        throw new Error('nope')
      },
    }
    expect(() => raiseResourceTimingBuffer(10, { performance: throwing })).not.toThrow()
  })
})
