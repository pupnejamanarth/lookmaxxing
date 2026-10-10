import { describe, expect, it } from 'vitest'
import { METRICS } from '../../src/catalog'
import { METHODS, type Method } from '../../src/catalog/schema'
import type { ConfidenceBand, Measurement, OverallScore, ScoreFacts } from '../../src/domain/types'
import { scoreMetric } from '../../src/scoring'
import {
  BAND_NAMES,
  CHANGEABILITY_LABELS,
  EVIDENCE_GLOSS,
  GROUP_LABELS,
  METHOD_LABELS,
  SHOT_LABELS,
  UNSCORED_REASON_TEXT,
} from '../../src/scoring/phrasebank'
import { renderOverallSummary, renderReason, renderRefusal, lowConfidenceRefusal, missingValueRefusal, type ReasonConfidence } from '../../src/scoring/reasons'
import { BANNED_PHRASES, HYPE_WORDS, lintTone } from '../../src/scoring/toneLint'

// ───────────────────────────── the linter itself ─────────────────────────────

describe('lintTone: every banned word is caught', () => {
  const all = Object.entries(BANNED_PHRASES).flatMap(([category, phrases]) => phrases.map((phrase) => ({ category, phrase })))

  it('has the words the plan names', () => {
    const planned = [
      'great', 'good start', 'not bad', 'decent', 'nice', 'pretty good', 'solid', 'impressive', 'just', 'a bit', 'a little',
      'unfortunately', "don't worry", 'keep it up', 'well done', 'ugly', 'subhuman', 'cel', "it's over", 'cooked', 'mogged',
    ]
    const present = new Set(all.map((a) => a.phrase))
    for (const word of planned) expect(present.has(word), word).toBe(true)
  })

  for (const { category, phrase } of all) {
    it(`flags "${phrase}" (${category})`, () => {
      expect(lintTone(`The measurement is ${phrase} for this metric.`)).toContain(`${category}: "${phrase}"`)
      expect(lintTone(phrase.toUpperCase())).toContain(`${category}: "${phrase}"`)
      expect(lintTone(`Result: ${phrase}.`)).toContain(`${category}: "${phrase}"`)
    })
  }

  for (const word of HYPE_WORDS) {
    it(`flags the hype word "${word}"`, () => {
      expect(lintTone(`This is ${word} work.`)).toContain(`hype: "${word}"`)
    })
  }

  it('flags exclamation marks', () => {
    expect(lintTone('Score 38!')).toEqual(['hype: "!"'])
    expect(lintTone('Re-capture now!!')).toEqual(['hype: "!"'])
  })

  it('treats curly apostrophes like straight ones', () => {
    expect(lintTone('Don’t worry about it.')).toContain('softener: "don\'t worry"')
    expect(lintTone('It’s over.')).toContain('slang: "it\'s over"')
  })

  it('allows "slightly" only next to a number in the same sentence', () => {
    expect(lintTone('Slightly above range.')).toEqual(['softener: "slightly" without a number'])
    expect(lintTone('The jaw is slightly wider. Score 38.')).toEqual(['softener: "slightly" without a number'])
    expect(lintTone('Slightly above 12° of range.')).toEqual([])
    expect(lintTone('0.4 ratio, slightly above range.')).toEqual([])
  })

  it('lists each distinct violation once, in order of appearance', () => {
    expect(lintTone('Great, just great. Nice!')).toEqual(['compliment: "great"', 'softener: "just"', 'compliment: "nice"', 'hype: "!"'])
  })

  it('does not flag words that merely contain a banned word', () => {
    for (const ok of [
      'greater than the limit',
      'the greatest gap',
      'adjust the camera',
      'justify the cut',
      'cancel the scan',
      'excel',
      'a cellular model',
      'descent angle',
      'nicety',
      'chadwick',
      'brother',
      'familiar',
      'mogul',
      'copeland',
      'Ideal 105–120° [Ellenbogen & Karlin 1980]. 11° above range → score 38.',
    ]) {
      expect(lintTone(ok), ok).toEqual([])
    }
  })

  it('passes a plain, blunt sentence', () => {
    expect(lintTone('11° above range → score 38. Head pitch +6.1° (limit ±4°). Re-capture frontal.')).toEqual([])
  })
})

// ───────────────────────────── every template ─────────────────────────────

const conf = (band: ConfidenceBand, value: number, capped = false): ReasonConfidence => ({
  band,
  value,
  parts: { method: 0.85, photo: 0.9, repeatability: 0.85, product: value, cappedAtMedium: capped },
})

/** Violations collected across a whole grid, asserted once: thousands of per-call expects are slow. */
const problems: string[] = []

function expectClean(text: string, label: string): void {
  if (text.trim().length === 0) problems.push(`${label}: empty reason`)
  const hits = lintTone(text)
  if (hits.length > 0) problems.push(`${label}: ${hits.join(', ')}\n${text}`)
}

function flush(): void {
  const found = problems.splice(0)
  expect(found.slice(0, 5)).toEqual([])
}

describe('static vocabulary is clean', () => {
  it('every phrasebank entry passes the linter', () => {
    const entries: string[] = [
      ...Object.values(METHOD_LABELS),
      ...Object.values(SHOT_LABELS),
      ...Object.values(CHANGEABILITY_LABELS),
      ...Object.values(EVIDENCE_GLOSS),
      ...Object.values(UNSCORED_REASON_TEXT),
      ...Object.values(BAND_NAMES),
      ...Object.values(GROUP_LABELS),
    ]
    for (const e of entries) expectClean(e || 'blank gloss', e)
    flush()
  })
})

describe('every template, across a grid of facts, passes the linter', () => {
  const units = ['°', '% of pupil distance', 'ratio', 'mm', 'index', 'grade', 'n/a', '% body fat']
  const evidences = ['STRONG', 'MODERATE', 'WEAK', 'CONVENTION', 'PSEUDOSCIENCE', 'MYTH']
  const changeabilities = ['FIXED', 'CHANGEABLE', 'SURGICAL_ONLY', 'PROFESSIONAL_ONLY', 'FIXED_BUT_VISIBILITY_CHANGEABLE']
  const bands: [ConfidenceBand, number][] = [['HIGH', 0.9], ['MEDIUM', 0.7], ['LOW', 0.5]]
  const sourceSets = [[], ['face:ellenbogen1980'], ['face:coetzee2009', 'face:coetzee2010', 'face:rerule2016'], ['face:unknown_id']]

  it('scored reasons (range / table rules)', () => {
    let rendered = 0
    const gaps = [[11, 105, 120, 131], [0, 105, 120, 110], [6, 105, 120, 99], [4, null, 2, 6], [2, 1.5, null, -0.5], [null, null, null, 3]] as const
    const build = (unit: string, evidence: string, changeability: string, g: (typeof gaps)[number], sourceIds: string[]): ScoreFacts => ({
      value: g[3], unit, uncertainty: g[0] === 0 ? null : 0.5, idealSummary: 'summary', idealLo: g[1], idealHi: g[2], gap: g[0], ruleKind: 'range',
      shotLabel: 'frontal neutral', sourceIds, weight: 2.5, evidence, changeability, pointsLost: g[0] === 0 ? 0 : 1.55,
    })
    // Full product over the facts a sentence is built from; band, sources and method rotate with the index.
    for (const unit of units)
      for (const evidence of evidences)
        for (const changeability of changeabilities)
          for (const g of gaps) {
            const [band, value] = bands[rendered % bands.length]!
            const method = METHODS[rendered % METHODS.length]!
            const base = { metricName: 'Facial symmetry (left-right mismatch)', method, nFrames: 3, confidence: conf(band, value, method === 'SELF_GRADE_REFERENCE') }
            expectClean(renderReason({ ...base, kind: 'scored', facts: build(unit, evidence, changeability, g, sourceSets[rendered % sourceSets.length]!), score: 38 }), 'range')
            rendered++
          }
    // Full product over the header: methods × bands × sources.
    for (const method of METHODS as readonly Method[])
      for (const [band, value] of bands)
        for (const sourceIds of sourceSets) {
          const base = { metricName: 'Eye spacing (pupil distance ÷ face width)', method, nFrames: 5, confidence: conf(band, value, method === 'SELF_GRADE_REFERENCE') }
          expectClean(renderReason({ ...base, kind: 'scored', facts: build('% of face width', 'WEAK', 'FIXED', gaps[0], sourceIds), score: 63 }), 'header')
          rendered++
        }
    expect(rendered).toBeGreaterThan(1500)
    flush()
  })

  it('baseline, checklist and percentile variants', () => {
    for (const unit of units)
      for (const direction of ['lower_better', 'higher_better', 'target_range'] as const)
        for (const anchored of [false, true])
          for (const gap of [0, 12]) {
            const facts: ScoreFacts = {
              value: 62, unit, uncertainty: 2, idealSummary: 's', idealLo: direction === 'lower_better' ? null : 50, idealHi: direction === 'higher_better' ? null : 50,
              gap, ruleKind: 'personal_baseline', shotLabel: 'frontal neutral', sourceIds: ['face:coetzee2009'], weight: 8, evidence: 'MODERATE', changeability: 'CHANGEABLE', pointsLost: 2.3,
            }
            const base = { metricName: 'Facial adiposity (fat in cheeks, jaw and neck)', method: 'AUTO_FRONTAL_PHOTO' as const, nFrames: 5, confidence: conf('HIGH', 0.9) }
            expectClean(renderReason({ ...base, kind: 'scored', facts, score: 72, baseline: { value: 50, direction, anchored } }), `baseline ${direction}`)
          }

    const cfacts: ScoreFacts = {
      value: 83, unit: '% of checks passed', uncertainty: 0, idealSummary: 's', idealLo: 90, idealHi: 100, gap: 7, ruleKind: 'checklist', shotLabel: 'frontal neutral',
      sourceIds: ['presence:bryan2012'], weight: 3, evidence: 'MODERATE', changeability: 'CHANGEABLE', pointsLost: 1.2,
    }
    const cbase = { metricName: 'Photo technique on imported photos', method: 'AUTO_FRONTAL_PHOTO' as const, nFrames: 5, confidence: conf('HIGH', 0.9) }
    for (const checklist of [
      { passed: 5, total: 6, share: 83, cap: 60, itemsKnown: true, failed: [{ label: 'Camera at least 1.5 m from the face (app design choice)', critical: true }] },
      { passed: 5, total: 6, share: 83, cap: null, itemsKnown: true, failed: [{ label: 'Even light with no hard shadow', critical: false }] },
      { passed: 6, total: 6, share: 100, cap: null, itemsKnown: true, failed: [] },
      { passed: 0, total: 6, share: 90, cap: 60, itemsKnown: false, failed: [] },
      { passed: 0, total: 6, share: 100, cap: null, itemsKnown: false, failed: [] },
    ]) {
      expectClean(renderReason({ ...cbase, kind: 'scored', facts: cfacts, score: 60, checklist }), 'checklist')
    }

    const pfacts: ScoreFacts = { ...cfacts, unit: 'cm', ruleKind: 'percentile', idealLo: null, idealHi: null, gap: null }
    for (const direction of ['higher_better', 'lower_better'] as const) {
      expectClean(
        renderReason({ ...cbase, kind: 'scored', facts: pfacts, score: 80, percentile: { value: 80, population: 'Adult men of the population the user selects at setup', direction } }),
        'percentile',
      )
    }
    flush()
  })

  it('baseline-set, unscored and refusal variants', () => {
    const allBands: [ConfidenceBand, number][] = [...bands, ['REFUSED', 0.2]]
    let i = 0
    for (const unit of units)
      for (const evidence of evidences)
        for (const changeability of changeabilities) {
          const [band, value] = allBands[i % allBands.length]!
          const sourceIds = sourceSets[i % sourceSets.length]!
          i++
          const basis = { value: 1.92, unit, uncertainty: null as number | null, shotLabel: 'frontal neutral', sourceIds, weight: 0.5, evidence, changeability }
          const base = { metricName: 'Facial width-to-height ratio (FWHR)', method: 'AUTO_FRONTAL_PHOTO' as const, nFrames: 5, confidence: conf(band, value) }
          expectClean(renderReason({ ...base, kind: 'baseline_set', basis, stored: true }), 'baseline set')
          expectClean(renderReason({ ...base, kind: 'baseline_set', basis, stored: false }), 'baseline skipped')
          for (const cause of [...Object.keys(UNSCORED_REASON_TEXT), 'not_in_table']) {
            expectClean(renderReason({ ...base, kind: 'unscored', basis: { ...basis, weight: 0 }, cause }), `unscored ${cause}`)
            expectClean(renderReason({ ...base, kind: 'unscored', basis, cause }), `unscored ${cause} weighted`)
          }
        }

    expectClean(renderRefusal({ metricName: 'Facial width-to-height ratio (FWHR)', shotLabel: 'frontal neutral', reasons: ['Head pitch +6.1° (limit ±4°)', 'Pitch error exceeds any real change in this metric.'], recapture: ['ear canal level with lower eyelid', 'use the on-screen level line'] }), 'refusal')
    expectClean(renderRefusal({ metricName: 'Height', shotLabel: 'self-report', reasons: ['No value.'], recapture: [] }), 'refusal without recapture')
    const floor = lowConfidenceRefusal(conf('REFUSED', 0.35))
    expectClean(renderRefusal({ metricName: 'Eye spacing (pupil distance ÷ face width)', shotLabel: 'frontal neutral', ...floor }), 'refusal below the floor')
    const missing = missingValueRefusal()
    expectClean(renderRefusal({ metricName: 'Eye spacing (pupil distance ÷ face width)', shotLabel: 'frontal neutral', ...missing }), 'refusal without a value')
    flush()
  })

  it('overall summaries', () => {
    const drag = [{ metricId: 'F05', name: 'Facial symmetry (left-right mismatch)', pointsLost: 2.1, changeability: 'FIXED', group: 'FIXED' as const }]
    for (const status of ['FINAL', 'PROVISIONAL', 'NOT_AVAILABLE'] as const)
      for (const cai of [null, 0, 61, 100])
        for (const band of [null, 0, 3.2]) {
          const overall: OverallScore = {
            scanId: 's', appearance: status === 'NOT_AVAILABLE' ? null : 64, band: status === 'NOT_AVAILABLE' ? null : band, coverage: status === 'FINAL' ? 0.8 : status === 'PROVISIONAL' ? 0.6 : 0.1,
            status, pointsLost: { FIXED: 2.1, SURGICAL_OR_PROFESSIONAL: 0, CHANGEABLE: 1.2 }, drag, cai, weightsVersion: 'weights-1.0.0', rulesetVersion: 'rules-1.0.0',
          }
          for (const line of renderOverallSummary(overall)) expectClean(line, `overall ${status}`)
        }
    flush()
  })
})

describe('every real catalog metric renders clean through the engine', () => {
  /** Values that touch the interesting parts of a metric's rule. */
  function candidates(metric: (typeof METRICS)[number]): number[] {
    const out = new Set<number>([1, 5, 50])
    const { min, max } = metric.scale
    if (min !== null) out.add(min)
    if (max !== null) out.add(max)
    if (min !== null && max !== null) out.add((min + max) / 2)
    const rule = metric.scoring
    if (rule.kind === 'range') [rule.lo - 3 * rule.tau, rule.lo, (rule.lo + rule.hi) / 2, rule.hi, rule.hi + rule.tau, rule.hi + 3 * rule.tau].forEach((x) => out.add(x))
    if (rule.kind === 'one_sided') rule.points.forEach((p) => (out.add(p.x), out.add(p.x + 0.5)))
    if (rule.kind === 'personal_baseline' && rule.normAnchor) rule.normAnchor.forEach((p) => out.add(p.x))
    return [...out]
  }

  it('renders a non-empty, clean reason for every metric × value × confidence × baseline case', () => {
    const seen = new Set<ConfidenceBand>()
    let count = 0
    for (const metric of METRICS) {
      const rule = metric.scoring
      for (const value of candidates(metric)) {
        for (const [qcFactor, uncertainty, nFrames] of [[1, 0, 5], [0.7, 0.5, 5], [0.5, 0.5, 5], [0.2, 2, 5], [1, null, 1]] as const) {
          const baselineCases: (Record<string, number>)[] = rule.kind === 'personal_baseline' ? [{}, { [metric.id]: value * 0.9 }, { [metric.id]: value * 1.1 + 1 }] : [{}]
          for (const baselines of baselineCases) {
            const inputs: Record<string, number> | undefined =
              rule.kind === 'checklist' ? Object.fromEntries(rule.items.map((item, i) => [item.id, (i + count) % 3 === 0 ? 0 : 1])) : undefined
            const m: Measurement = {
              id: 'm', scanId: 's', metricId: metric.id, value, unit: metric.scale.unit, uncertainty, nFrames,
              method: metric.methods[0]!, qcFactor, algoVersion: 'a', ...(inputs ? { inputs } : {}),
              ...(rule.kind === 'percentile' ? { inputs: { percentile: 70 } } : {}),
            }
            const { score } = scoreMetric(m, { baselines, uuid: () => 'id' })
            seen.add(score.confidence.band)
            expectClean(score.reason, `${metric.id} value ${value} baselines ${JSON.stringify(baselines)}`)
            count++
          }
        }
      }
      // A refusal in the measurement's own words.
      const refused: Measurement = {
        id: 'm', scanId: 's', metricId: metric.id, value: null, unit: metric.scale.unit, uncertainty: null, nFrames: 5, method: metric.methods[0]!, qcFactor: 0,
        algoVersion: 'a', refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['level the camera with the on-screen line'] },
      }
      expectClean(scoreMetric(refused, { baselines: {} }).score.reason, `${metric.id} refusal`)
    }
    expect(count).toBeGreaterThan(2000)
    flush()
    expect([...seen].sort()).toEqual(['HIGH', 'LOW', 'MEDIUM', 'REFUSED'])
  })
})
