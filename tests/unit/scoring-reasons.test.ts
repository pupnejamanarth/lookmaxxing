import { describe, expect, it } from 'vitest'
import { SOURCES, getSource } from '../../src/catalog'
import type { OverallScore, ScoreFacts } from '../../src/domain/types'
import {
  SOURCE_NOT_VERIFIED,
  SHOT_LABELS,
  amount,
  citeSources,
  fmt,
  fmtCost,
  fmtShare,
  quantity,
  rangeText,
  sentence,
  shortName,
  sourceLabel,
} from '../../src/scoring/phrasebank'
import { CAI_CEILING_NOTE, lowConfidenceRefusal, renderOverallSummary, renderReason, renderRefusal, type ReasonConfidence } from '../../src/scoring/reasons'
import { SHOT_TYPES } from '../../src/catalog/schema'

const conf = (band: ReasonConfidence['band'], value: number): ReasonConfidence => ({
  band,
  value,
  parts: { method: 0.85, photo: 0.9, repeatability: 0.85, product: value, cappedAtMedium: false },
})

const facts = (o: Partial<ScoreFacts> = {}): ScoreFacts => ({
  value: 131,
  unit: '°',
  uncertainty: 3,
  idealSummary: '105–120° is the plastic-surgery standard for a youthful, defined neck.',
  idealLo: 105,
  idealHi: 120,
  gap: 11,
  ruleKind: 'range',
  shotLabel: 'right profile',
  sourceIds: ['face:ellenbogen1980'],
  weight: 2.5,
  evidence: 'MODERATE',
  changeability: 'CHANGEABLE',
  pointsLost: 1.55,
  ...o,
})

const NOT_VERIFIED = getSource('face:ellenbogen1980')!.verified ? '' : ` – ${SOURCE_NOT_VERIFIED}`

describe('number and unit formatting', () => {
  it('uses precision by magnitude and drops trailing zeros', () => {
    expect(fmt(131)).toBe('131')
    expect(fmt(131.4)).toBe('131')
    expect(fmt(11.5)).toBe('11.5')
    expect(fmt(11.04)).toBe('11')
    expect(fmt(1.92)).toBe('1.92')
    expect(fmt(0.043)).toBe('0.043')
    expect(fmt(0.0004)).toBe('0.0004')
    expect(fmt(-0.0001)).toBe('-0.0001')
    expect(fmt(0)).toBe('0')
    expect(fmt(Number.NaN)).toBe('n/a')
  })

  it('attaches ° and % to the number and spaces other units', () => {
    expect(amount(11, '°')).toBe('11°')
    expect(amount(1.1, '% of pupil distance')).toBe('1.1% of pupil distance')
    expect(amount(0.21, 'ratio')).toBe('0.21 ratio')
    expect(amount(3, 'n/a')).toBe('3')
    expect(quantity(131, 3, '°')).toBe('131° ±3°')
    expect(quantity(4.1, 0.6, '% of pupil distance')).toBe('4.1% ±0.6% of pupil distance')
    expect(quantity(1.92, 0.04, 'ratio')).toBe('1.92 ±0.04 ratio')
    expect(quantity(52, null, 'index')).toBe('52 ±unknown index')
    expect(quantity(131, null, '°')).toBe('131° ±unknown')
  })

  it('writes bands as words', () => {
    expect(rangeText(105, 120, '°')).toBe('105–120°')
    expect(rangeText(0, 3, '% of pupil distance')).toBe('0–3% of pupil distance')
    expect(rangeText(0.9, 1.3, 'ratio')).toBe('0.9–1.3 ratio')
    expect(rangeText(null, 2, 'mm')).toBe('at most 2 mm')
    expect(rangeText(1.5, null, 'ratio')).toBe('at least 1.5 ratio')
    expect(rangeText(52, 52, 'index')).toBe('exactly 52 index')
    expect(rangeText(null, null, 'mm')).toBe('none defined')
  })

  it('shows costs rounded UP to 0.1 and shares truncated', () => {
    expect(fmtCost(1.55)).toBe('1.6')
    expect(fmtCost(1.51)).toBe('1.6')
    expect(fmtCost(1.5)).toBe('1.5')
    expect(fmtCost(0.0625)).toBe('0.1')
    expect(fmtCost(0)).toBe('0')
    expect(fmtShare(0.0975)).toBe('9')
    expect(fmtShare(0.5)).toBe('50')
    expect(fmtShare(0.7499)).toBe('74')
  })

  it('ends a fragment with one full stop', () => {
    expect(sentence('Head pitch +6.1° (limit ±4°)')).toBe('Head pitch +6.1° (limit ±4°).')
    expect(sentence('Already ends.')).toBe('Already ends.')
  })
})

describe('names and sources', () => {
  it('shortens metric names for the header', () => {
    expect(shortName('Cervicomental angle (under-chin to neck angle)')).toBe('CERVICOMENTAL ANGLE')
    expect(shortName('Facial width-to-height ratio (FWHR)')).toBe('FWHR')
    expect(shortName('Interpupillary distance, absolute (mm)')).toBe('INTERPUPILLARY DISTANCE, ABSOLUTE')
    expect(shortName('Height')).toBe('HEIGHT')
  })

  it('labels citations as authors and year', () => {
    expect(sourceLabel({ citation: 'Ellenbogen, R., & Karlin, J. V. (1980). Visual criteria for success in restoring the youthful neck. Plastic and Reconstructive Surgery, 66, 826–837.' })).toBe(
      'Ellenbogen & Karlin 1980',
    )
    expect(sourceLabel({ citation: 'Coetzee, V., Perrett, D. I., & Stephen, I. D. (2009). Facial adiposity: A cue to health? Perception, 38(11), 1700–1711.' })).toBe('Coetzee et al. 2009')
    expect(sourceLabel({ citation: 'Valentine, K. A., et al. (2014). Judging a man by the width of his face. Psychological Science.' })).toBe('Valentine et al. 2014')
    expect(sourceLabel({ citation: 'Geniole, S. N., Denson, T. F., Dixson, B. J., Carré, J. M., & McCormick, C. M. (2015). Evidence from meta-analyses.' })).toBe('Geniole et al. 2015')
    expect(sourceLabel({ citation: 'Gonzalez-Ulloa, M. (1962). Original description of the zero meridian.' })).toBe('Gonzalez-Ulloa 1962')
  })

  it('falls back to the opening words when a citation has no author list', () => {
    expect(sourceLabel({ citation: 'NIH Elements of Morphology (NHGRI). Anatomy of the philtrum. Standard terminology reference.' })).toBe('NIH Elements of Morphology (NHGRI)')
    const long = sourceLabel({
      citation: 'Laypeople’s perception of facial profile aesthetics: a systematic review. Journal of Aligner Orthodontics (2021). Authors not confirmed in this session.',
    })
    expect(long.length).toBeLessThanOrEqual(48)
    expect(long.startsWith('Laypeople')).toBe(true)
  })

  it('labels every catalog source without throwing and never returns an empty label', () => {
    for (const source of SOURCES) expect(sourceLabel(source).trim().length).toBeGreaterThan(0)
  })

  it('cites exactly the ids given and flags an unverified source', () => {
    expect(citeSources(['face:ellenbogen1980'])).toBe(`[Ellenbogen & Karlin 1980${NOT_VERIFIED}]`)
    expect(citeSources([])).toBe('[no source cited]')
    expect(citeSources(['face:ellenbogen1980'])).toContain(SOURCE_NOT_VERIFIED)
  })

  it('treats an id the catalog does not know as unverified, and tags only the unverified ones when mixed', () => {
    expect(citeSources(['face:does_not_exist'])).toBe(`[face:does_not_exist – ${SOURCE_NOT_VERIFIED}]`)
    const verified = SOURCES.find((s) => s.verified)
    if (verified) {
      const text = citeSources([verified.id, 'face:does_not_exist'])
      expect(text).toContain(`face:does_not_exist (${SOURCE_NOT_VERIFIED})`)
      expect(text).not.toContain(`${sourceLabel(verified)} (`)
    }
  })

  it('names every shot type', () => {
    for (const shot of SHOT_TYPES) expect(SHOT_LABELS[shot].length).toBeGreaterThan(0)
  })
})

describe('scored reason (PLAN §4.3 layout)', () => {
  const common = { metricName: 'Cervicomental angle (under-chin to neck angle)', method: 'MANUAL_LANDMARKS' as const, nFrames: 2 }

  it('renders three lines: header, ideal and gap, classification and cost', () => {
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('MEDIUM', 0.72), facts: facts(), score: 38 })
    expect(text).toBe(
      [
        'CERVICOMENTAL ANGLE · 131° ±3° · MEDIUM 0.72 (manual points, right profile, 2 placements)',
        `Ideal 105–120° [Ellenbogen & Karlin 1980${NOT_VERIFIED}]. 11° above range → score 38.`,
        'CHANGEABLE · evidence MODERATE · weight 2.5 → costs 1.6 overall points.',
      ].join('\n'),
    )
  })

  it('says below range when the value is under the band', () => {
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: facts({ value: 97, gap: 8 }), score: 36 })
    expect(text).toContain('8° below range → score 36.')
  })

  it('says inside the band and costs nothing at 100', () => {
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: facts({ value: 110, gap: 0, pointsLost: 0 }), score: 100 })
    expect(text).toContain('Inside the ideal band → score 100.')
    expect(text).toContain('weight 2.5 → costs 0 overall points.')
  })

  it('states the evidence grade and what it means for convention, weak and pseudoscience grades', () => {
    const line = (evidence: string) =>
      renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: facts({ evidence }), score: 38 }).split('\n')[2]
    expect(line('CONVENTION')).toContain('evidence CONVENTION (a classical canon or custom, not a measured norm)')
    expect(line('WEAK')).toContain('evidence WEAK (few or low-quality studies)')
    expect(line('PSEUDOSCIENCE')).toContain('evidence PSEUDOSCIENCE (a community claim without research support)')
    expect(line('STRONG')).toContain('evidence STRONG ·')
  })

  it('labels changeability in words', () => {
    const line = (changeability: string) =>
      renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: facts({ changeability }), score: 38 }).split('\n')[2]
    expect(line('FIXED')).toMatch(/^FIXED · /)
    expect(line('SURGICAL_ONLY')).toMatch(/^SURGICAL ONLY · /)
    expect(line('PROFESSIONAL_ONLY')).toMatch(/^PROFESSIONAL ONLY · /)
    expect(line('FIXED_BUT_VISIBILITY_CHANGEABLE')).toMatch(/^FIXED, VISIBILITY CHANGEABLE · /)
  })

  it('LOW confidence: warns, shows the confidence parts, and says the score is left out of the overall', () => {
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('LOW', 0.49), facts: facts(), score: 38 })
    expect(text.split('\n')).toHaveLength(4)
    expect(text).toContain('WARNING · LOW confidence (method 0.85 × photo 0.90 × repeatability 0.85 = 0.49)')
    expect(text).toContain('left out of the overall score.')
    expect(text).toContain('would cost 1.6 overall points if it counted.')
    expect(text).not.toContain('costs 1.6 overall points.')
  })

  it('notes a self-report cap in the LOW warning', () => {
    const c = conf('LOW', 0.54)
    c.parts.cappedAtMedium = true
    expect(renderReason({ ...common, kind: 'scored', confidence: c, facts: facts(), score: 38 })).toContain('capped below HIGH for self-report')
  })

  it('does not show a frame count for self-report methods', () => {
    const text = renderReason({ ...common, method: 'SELF_GRADE_REFERENCE', nFrames: 1, kind: 'scored', confidence: conf('MEDIUM', 0.6), facts: facts(), score: 38 })
    expect(text.split('\n')[0]).toBe('CERVICOMENTAL ANGLE · 131° ±3° · MEDIUM 0.60 (self-grade, right profile)')
  })

  it('names frames for photo methods and readings for tape', () => {
    const photo = renderReason({ ...common, method: 'AUTO_FRONTAL_PHOTO', nFrames: 5, kind: 'scored', confidence: conf('HIGH', 0.9), facts: facts(), score: 38 })
    expect(photo.split('\n')[0]).toContain('5 frames')
    const one = renderReason({ ...common, method: 'AUTO_FRONTAL_PHOTO', nFrames: 1, kind: 'scored', confidence: conf('HIGH', 0.9), facts: facts(), score: 38 })
    expect(one.split('\n')[0]).toContain('1 frame)')
    const tape = renderReason({ ...common, method: 'TAPE_MEASURE', nFrames: 3, kind: 'scored', confidence: conf('HIGH', 0.9), facts: facts(), score: 38 })
    expect(tape.split('\n')[0]).toContain('3 readings')
  })

  it('personal baseline: cites the baseline, says there is no norm, and states the change for the worse', () => {
    const f = facts({ value: 65, unit: 'index', uncertainty: 2, idealLo: null, idealHi: 50, gap: 15, ruleKind: 'personal_baseline', sourceIds: [], changeability: 'CHANGEABLE' })
    const text = renderReason({
      ...common,
      metricName: 'Facial adiposity (fat in cheeks, jaw and neck)',
      method: 'AUTO_FRONTAL_PHOTO',
      nFrames: 5,
      kind: 'scored',
      confidence: conf('HIGH', 0.9),
      facts: f,
      score: 60,
      baseline: { value: 50, direction: 'lower_better', anchored: false },
    })
    expect(text.split('\n')[1]).toBe(
      'Reference: your own baseline 50 index (lower is better); no population norm exists for this index [no source cited]. 15 index worse than baseline → score 60.',
    )
  })

  it('personal baseline with no change for the worse', () => {
    const f = facts({ value: 45, unit: 'index', idealLo: null, idealHi: 50, gap: 0, ruleKind: 'personal_baseline', sourceIds: [], pointsLost: 0 })
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: f, score: 100, baseline: { value: 50, direction: 'lower_better', anchored: false } })
    expect(text).toContain('No change for the worse → score 100.')
  })

  it('personal baseline target range counts deviation either way', () => {
    const f = facts({ value: 38, unit: 'index', idealLo: 50, idealHi: 50, gap: 12, ruleKind: 'personal_baseline', sourceIds: [] })
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: f, score: 72, baseline: { value: 50, direction: 'target_range', anchored: false } })
    expect(text).toContain('(deviation either way counts)')
    expect(text).toContain('12 index away from baseline → score 72.')
  })

  it('personal baseline with a norm anchor says the lower of the two applies', () => {
    const f = facts({ value: 4, unit: 'ΔE', idealLo: null, idealHi: 0, gap: 4, ruleKind: 'personal_baseline' })
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: f, score: 60, baseline: { value: 5, direction: 'lower_better', anchored: true } })
    expect(text).toContain('Norm anchor: ideal at most 0 ΔE')
    expect(text).toContain('Your own baseline is 5 ΔE (lower is better); the lower of the two scores applies.')
  })

  it('checklist: counts passed items, names failed ones, and states the cap', () => {
    const f = facts({ value: 83.3, unit: '% of checks passed', uncertainty: 0, idealLo: 90, idealHi: 100, gap: 6.7, ruleKind: 'checklist', sourceIds: [], weight: 3, pointsLost: 1.2 })
    const text = renderReason({
      metricName: 'Photo technique on imported photos',
      method: 'AUTO_FRONTAL_PHOTO',
      nFrames: 5,
      kind: 'scored',
      confidence: conf('HIGH', 0.95),
      facts: f,
      score: 60,
      checklist: {
        passed: 5,
        total: 6,
        share: 83.3,
        cap: 60,
        itemsKnown: true,
        failed: [{ label: 'Camera at least 1.5 m from the face (app design choice, estimated from landmarks)', critical: true }],
      },
    })
    expect(text.split('\n')[1]).toBe(
      'Ideal 90–100% of checks passed [no source cited]. 5 of 6 checks passed; failed: Camera at least 1.5 m from the face (critical); a critical check failed, so the score is capped at 60 → score 60.',
    )
  })

  it('checklist without item results says so and states the cap', () => {
    const f = facts({ value: 90, unit: '% of checks passed', idealLo: null, idealHi: null, gap: null, ruleKind: 'checklist', sourceIds: [] })
    const text = renderReason({
      ...common,
      kind: 'scored',
      confidence: conf('HIGH', 0.9),
      facts: f,
      score: 60,
      checklist: { passed: 0, total: 6, share: 90, cap: 60, itemsKnown: false, failed: [] },
    })
    expect(text).toContain('90% of checks passed. Per-item results were not supplied and a critical failure cannot be ruled out, so the score is capped at 60 → score 60.')
    const all = renderReason({
      ...common,
      kind: 'scored',
      confidence: conf('HIGH', 0.9),
      facts: f,
      score: 100,
      checklist: { passed: 0, total: 6, share: 100, cap: null, itemsKnown: false, failed: [] },
    })
    expect(all).toContain('All checks passed (share 100%) → score 100.')
  })

  it('percentile: states the rank and the reference population', () => {
    const f = facts({ value: 180, unit: 'cm', uncertainty: 0.5, idealLo: null, idealHi: null, gap: null, ruleKind: 'percentile', sourceIds: [] })
    const text = renderReason({
      ...common,
      kind: 'scored',
      confidence: conf('MEDIUM', 0.7),
      facts: f,
      score: 80,
      percentile: { value: 80, population: 'adult men of the chosen population', direction: 'higher_better' },
    })
    expect(text).toContain('Rank: percentile 80 among adult men of the chosen population [no source cited]. Higher is better → score 80.')
  })

  it('a table with no 100-score band says the lookup table was read', () => {
    const f = facts({ idealLo: null, idealHi: null, gap: null, ruleKind: 'one_sided' })
    const text = renderReason({ ...common, kind: 'scored', confidence: conf('HIGH', 0.9), facts: f, score: 55 })
    expect(text).toContain('Ideal none defined')
    expect(text).toContain('No ideal band applies, so the lookup table is read at 131° → score 55.')
  })
})

describe('baseline-set reason', () => {
  const base = { metricName: 'Facial adiposity (fat in cheeks, jaw and neck)', method: 'AUTO_FRONTAL_PHOTO' as const, nFrames: 5 }
  const basis = { value: 52, unit: 'index', uncertainty: 2.1, shotLabel: 'frontal neutral', sourceIds: [], weight: 8, evidence: 'MODERATE', changeability: 'CHANGEABLE' }

  it('says plainly that the first measurement is not scored', () => {
    const text = renderReason({ ...base, kind: 'baseline_set', confidence: conf('HIGH', 0.92), basis, stored: true })
    expect(text).toBe(
      [
        'FACIAL ADIPOSITY · 52 ±2.1 index · HIGH 0.92 (auto frontal photo, frontal neutral, 5 frames)',
        'BASELINE SET · NOT SCORED. This first measurement becomes your personal baseline: 52 index. No population norm exists for this index, so scoring starts on the next scan. [no source cited]',
        'CHANGEABLE · evidence MODERATE · weight 8 → not counted in the overall until it is scored.',
      ].join('\n'),
    )
  })

  it('refuses to store a LOW-confidence baseline', () => {
    const text = renderReason({ ...base, kind: 'baseline_set', confidence: conf('LOW', 0.49), basis, stored: false })
    expect(text).toContain('NOT SCORED · LOW confidence (method 0.85 × photo 0.90 × repeatability 0.85 = 0.49) is too weak to set a personal baseline. Nothing was stored; re-scan under the capture protocol.')
    expect(text).not.toContain('BASELINE SET')
  })
})

describe('unscored-by-design reason', () => {
  const base = { metricName: 'Facial width-to-height ratio (FWHR)', method: 'AUTO_FRONTAL_PHOTO' as const, nFrames: 5 }
  const basis = { value: 1.92, unit: 'ratio', uncertainty: 0.04, shotLabel: 'frontal neutral', sourceIds: [], weight: 0, evidence: 'PSEUDOSCIENCE', changeability: 'FIXED' }

  it('flags pseudoscience plainly and costs nothing', () => {
    const text = renderReason({ ...base, kind: 'unscored', confidence: conf('HIGH', 0.9), basis, cause: 'context_only' })
    expect(text).toBe(
      [
        'FWHR · 1.92 ±0.04 ratio · HIGH 0.90 (auto frontal photo, frontal neutral, 5 frames)',
        'NOT SCORED · no evidence-based ideal exists, so it is shown for context only. [no source cited]',
        'FIXED · evidence PSEUDOSCIENCE (a community claim without research support) · weight 0 → costs no overall points.',
      ].join('\n'),
    )
  })

  it('has a sentence for every cause', () => {
    for (const cause of ['myth', 'process_measure', 'habit', 'deferred', 'context_only', 'zero_weight']) {
      const text = renderReason({ ...base, kind: 'unscored', confidence: conf('HIGH', 0.9), basis, cause })
      expect(text.split('\n')[1]).toMatch(/^NOT SCORED · it |^NOT SCORED · the |^NOT SCORED · no |^NOT SCORED · its /)
    }
  })

  it('says a positive weight is left out of the overall', () => {
    const text = renderReason({ ...base, kind: 'unscored', confidence: conf('HIGH', 0.9), basis: { ...basis, weight: 0.5 }, cause: 'deferred' })
    expect(text.split('\n')[2]).toContain('weight 0.5 → left out of the overall score.')
  })
})

describe('refusal reason', () => {
  it('matches the PLAN §4.3 layout', () => {
    expect(
      renderRefusal({
        metricName: 'Facial width-to-height ratio (FWHR)',
        shotLabel: 'frontal neutral',
        reasons: ['Head pitch +6.1° (limit ±4°)', 'Pitch error exceeds any real change in this metric.'],
        recapture: ['ear canal level with lower eyelid', 'use the on-screen level line'],
      }),
    ).toBe(
      [
        'FWHR · NOT SCORED',
        'Head pitch +6.1° (limit ±4°).',
        'Pitch error exceeds any real change in this metric.',
        'Re-capture frontal neutral: ear canal level with lower eyelid; use the on-screen level line.',
      ].join('\n'),
    )
  })

  it('omits the re-capture line when none is given', () => {
    expect(renderRefusal({ metricName: 'Height', shotLabel: 'self-report', reasons: ['No value.'], recapture: [] })).toBe('HEIGHT · NOT SCORED\nNo value.')
  })

  it('explains a confidence under the floor with its parts', () => {
    const r = lowConfidenceRefusal(conf('REFUSED', 0.35))
    expect(r.reasons[0]).toBe('Confidence 0.35 is under the 0.40 floor (method 0.85 × photo 0.90 × repeatability 0.85 = 0.35). A number at this confidence would be noise')
    expect(r.recapture[0]).toContain('capture protocol')
  })
})

describe('overall summary', () => {
  const overall = (o: Partial<OverallScore> = {}): OverallScore => ({
    scanId: 's1',
    appearance: null,
    band: null,
    coverage: 0.0975,
    status: 'NOT_AVAILABLE',
    pointsLost: { FIXED: 2.465, SURGICAL_OR_PROFESSIONAL: 0, CHANGEABLE: 1.2 },
    drag: [
      { metricId: 'F05', name: 'Facial symmetry (left-right mismatch)', pointsLost: 2.1275, changeability: 'FIXED', group: 'FIXED' },
      { metricId: 'V06', name: 'Photo technique on imported photos', pointsLost: 1.2, changeability: 'CHANGEABLE', group: 'CHANGEABLE' },
    ],
    cai: null,
    weightsVersion: 'weights-1.0.0',
    rulesetVersion: 'rules-1.0.0',
    ...o,
  })

  it('says plainly that no overall number exists below 50% coverage', () => {
    const lines = renderOverallSummary(overall())
    expect(lines[0]).toBe('OVERALL · NOT AVAILABLE')
    expect(lines[1]).toBe('Only 9% of the total weight was scored this scan. At least 50% is needed for an overall number, so none is shown.')
    expect(lines.join('\n')).not.toMatch(/OVERALL · \d/)
  })

  it('lists points lost by group, the top drags, and the CAI caveat', () => {
    const lines = renderOverallSummary(overall({ cai: 61 }))
    expect(lines).toContain('Points lost: changeable 1.2 · fixed 2.5 · surgical or professional 0.')
    expect(lines).toContain('Drag: FACIAL SYMMETRY costs 2.2 points (fixed).')
    expect(lines).toContain('Drag: PHOTO TECHNIQUE ON IMPORTED PHOTOS costs 1.2 points (changeable).')
    expect(lines).toContain(`CAI 61%. ${CAI_CEILING_NOTE}`)
    expect(CAI_CEILING_NOTE).toContain('not personalised yet')
  })

  it('says CAI is unavailable when it is null', () => {
    expect(renderOverallSummary(overall()).some((l) => l.startsWith('CAI not available'))).toBe(true)
  })

  it('PROVISIONAL and FINAL show the number, the band and the coverage rule', () => {
    const provisional = renderOverallSummary(overall({ appearance: 64, band: 3.2, coverage: 0.62, status: 'PROVISIONAL' }))
    expect(provisional[0]).toBe('OVERALL · 64 ±3.2 · PROVISIONAL')
    expect(provisional[1]).toBe('Coverage 62% of the total weight. Below 75% the score is provisional.')
    const final = renderOverallSummary(overall({ appearance: 64, band: null, coverage: 0.8, status: 'FINAL' }))
    expect(final[0]).toBe('OVERALL · 64 · FINAL')
    expect(final[1]).toBe('Coverage 80% of the total weight (75% or more).')
  })

  it('shows at most three drag lines', () => {
    const drag = ['A', 'B', 'C', 'D', 'E'].map((x, i) => ({ metricId: `F0${i}`, name: `Metric ${x}`, pointsLost: 5 - i, changeability: 'FIXED', group: 'FIXED' as const }))
    expect(renderOverallSummary(overall({ drag })).filter((l) => l.startsWith('Drag:'))).toHaveLength(3)
  })
})
