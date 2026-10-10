import { describe, expect, it } from 'vitest'
import type { Measurement, MetricScore, OverallScore, ScanRecord, ScoreFacts, ShotQc } from '../../src/domain/types'
import {
  actionableRefusals,
  attemptedShare,
  buildCards,
  buildDragModel,
  buildOverallView,
  buildRecapture,
  describeConditions,
  describePhoto,
  formatPoints,
  formatQuantity,
  formatScore,
  formatShare,
  groupCards,
  ignorableRefusals,
  leftOutText,
  parseRefusalText,
  plainName,
  planNote,
  summariseScan,
  tallyCards,
  tallyText,
  type MetricCard,
} from '../../src/routes/report/helpers'

// Synthetic records only. Metric ids are real catalog ids so names, weights and links resolve.

function measurement(metricId: string, over: Partial<Measurement> = {}): Measurement {
  return {
    id: `m-${metricId}`,
    scanId: 's1',
    metricId,
    value: 1.2,
    unit: 'ratio',
    uncertainty: 0.05,
    nFrames: 5,
    method: 'AUTO_FRONTAL_PHOTO',
    qcFactor: 0.9,
    algoVersion: 'algo-test',
    ...over,
  }
}

function facts(over: Partial<ScoreFacts> = {}): ScoreFacts {
  return {
    value: 6.1,
    unit: '% of pupil distance',
    uncertainty: 0.5,
    idealSummary: 'Ideal 0–3%',
    idealLo: 0,
    idealHi: 3,
    gap: 3.1,
    ruleKind: 'range',
    shotLabel: 'frontal neutral',
    sourceIds: [],
    weight: 5.75,
    evidence: 'MODERATE',
    changeability: 'FIXED',
    pointsLost: 3.105,
    ...over,
  }
}

function score(metricId: string, over: Partial<MetricScore> = {}): MetricScore {
  return {
    id: `s-${metricId}`,
    scanId: 's1',
    metricId,
    score: 46,
    confidence: { band: 'HIGH', value: 0.85 },
    facts: facts(),
    reason: 'FACIAL SYMMETRY · 6.1% ±0.5%\nIdeal 0–3%. 3.1% above range → score 46.\nFIXED · weight 5.75 → costs 3.2 overall points.',
    rulesetVersion: 'rules-test',
    ...over,
  }
}

const REFUSED_REASON = 'NOSE · NOT SCORED\nHead pitch +6.1° (limit ±4°).\nRe-capture frontal neutral: ear canal level with lower eyelid; use the on-screen level line.'

function overall(over: Partial<OverallScore> = {}): OverallScore {
  return {
    scanId: 's1',
    appearance: null,
    band: null,
    coverage: 0.178,
    status: 'NOT_AVAILABLE',
    pointsLost: { FIXED: 3.105, SURGICAL_OR_PROFESSIONAL: 0.05, CHANGEABLE: 0 },
    drag: [
      { metricId: 'F05', name: 'Facial symmetry (left-right mismatch)', pointsLost: 3.105, changeability: 'FIXED', group: 'FIXED' },
      { metricId: 'F15', name: 'Lip proportion (upper : lower lip height)', pointsLost: 0.05, changeability: 'SURGICAL_ONLY', group: 'SURGICAL_OR_PROFESSIONAL' },
    ],
    cai: null,
    weightsVersion: 'weights-test',
    rulesetVersion: 'rules-test',
    ...over,
  }
}

/** A scan with every card kind: scored HIGH, scored LOW, baseline set, refused (structured and parsed), pseudoscience, myth. */
function sampleCards(): MetricCard[] {
  return buildCards({
    measurements: [
      measurement('F05', { value: 6.1, unit: '% of pupil distance', uncertainty: 0.5 }),
      measurement('F08', { value: 46, unit: '% of face width', uncertainty: 0.4 }),
      measurement('F01', { value: 9.2, unit: 'index', uncertainty: 0.4 }),
      measurement('F14', {
        value: null,
        refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['ear canal level with lower eyelid', 'use the on-screen level line'] },
      }),
      measurement('F15', { value: null, refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['Ear canal level with lower eyelid.'] } }),
      measurement('F16'),
      measurement('F10', { value: 1.9 }),
      measurement('F21', { value: 0.6, unit: 'n/a' }),
    ],
    scores: [
      score('F05'),
      score('F08', {
        score: 100,
        confidence: { band: 'LOW', value: 0.53 },
        facts: facts({ value: 46, unit: '% of face width', weight: 0.25, evidence: 'WEAK', pointsLost: 0 }),
        reason: 'EYE SPACING · 46% ±0.4%\nWARNING · LOW confidence.',
      }),
      score('F01', {
        score: null,
        facts: null,
        reason: 'FACIAL ADIPOSITY · 9.2 ±0.4 index\nBASELINE SET · NOT SCORED. This first measurement becomes your personal baseline.',
      }),
      score('F14', { score: null, facts: null, confidence: { band: 'REFUSED', value: 0 }, reason: REFUSED_REASON }),
      score('F15', { score: null, facts: null, confidence: { band: 'REFUSED', value: 0 }, reason: 'LIP · NOT SCORED\nHead pitch +6.1° (limit ±4°).\nRe-capture frontal neutral: Ear canal level with lower eyelid.' }),
      score('F16', {
        score: null,
        facts: null,
        confidence: { band: 'REFUSED', value: 0.28 },
        reason: 'LOWER-THIRD · NOT SCORED\nConfidence 0.28 is under the 0.40 floor (method 1.00 × photo 0.70 = 0.28). A number at this confidence would be noise.\nRe-capture frontal neutral: follow the capture protocol: 1.5 m distance, grey card in frame.',
      }),
      score('F10', { score: null, facts: null, confidence: { band: 'LOW', value: 0.51 }, reason: 'FWHR · 1.9 ratio\nNOT SCORED · no evidence-based ideal exists.' }),
      score('F21', { score: null, facts: null, reason: 'PHI · NOT SCORED' }),
    ],
    baselinesToStore: [{ metricId: 'F01' }],
  })
}

const byId = (cards: MetricCard[], id: string): MetricCard => cards.find((c) => c.metricId === id)!

describe('number formatting', () => {
  it('truncates scores and shares, never rounds them up', () => {
    expect(formatScore(46.99)).toBe('46')
    expect(formatScore(99.999)).toBe('99')
    expect(formatScore(100)).toBe('100')
    expect(formatScore(-3)).toBe('0')
    expect(formatShare(0.178)).toBe('17%')
    expect(formatShare(0.4999)).toBe('49%')
    expect(formatShare(0.5)).toBe('50%')
    expect(formatShare(0.1525)).toBe('15%')
  })

  it('rounds points lost UP to 0.1 so a cost is never understated', () => {
    expect(formatPoints(3.105)).toBe('3.2')
    expect(formatPoints(0.0001)).toBe('0.1')
    expect(formatPoints(1)).toBe('1')
    expect(formatPoints(0)).toBe('0')
  })

  it('writes value, uncertainty and unit, and says when the uncertainty is unknown', () => {
    expect(formatQuantity(131, 3, '°')).toBe('131° ± 3°')
    expect(formatQuantity(4.1, 0.6, '% of pupil distance')).toBe('4.1% ± 0.6% of pupil distance')
    expect(formatQuantity(1.92, 0.04, 'ratio')).toBe('1.92 ± 0.04 ratio')
    expect(formatQuantity(1.92, null, 'ratio')).toBe('1.92 ratio (uncertainty unknown)')
    expect(formatQuantity(0.5, 0.1, 'n/a')).toBe('0.5 ± 0.1')
  })

  it('strips the explanatory parenthetical from a metric name', () => {
    expect(plainName('Facial symmetry (left-right mismatch)')).toBe('Facial symmetry')
    expect(plainName('Height')).toBe('Height')
    expect(plainName('(odd)')).toBe('(odd)')
  })
})

describe('metric cards', () => {
  const cards = sampleCards()

  it('classifies each stored record', () => {
    expect(byId(cards, 'F05').kind).toBe('scored')
    expect(byId(cards, 'F08').kind).toBe('scored')
    expect(byId(cards, 'F01').kind).toBe('baseline_set')
    expect(byId(cards, 'F14').kind).toBe('refused')
    expect(byId(cards, 'F16').kind).toBe('refused')
    expect(byId(cards, 'F10').kind).toBe('unscored')
    expect(byId(cards, 'F21').kind).toBe('unscored')
  })

  it('shows the stored reason exactly as stored', () => {
    expect(byId(cards, 'F05').reason).toBe(score('F05').reason)
    expect(byId(cards, 'F01').reason).toContain('BASELINE SET')
  })

  it('formats a scored card from its stored facts', () => {
    const c = byId(cards, 'F05')
    expect(c.scoreText).toBe('46')
    expect(c.valueText).toBe('6.1% ± 0.5% of pupil distance')
    expect(c.band).toBe('HIGH')
    expect(c.confidenceValueText).toBe('0.85')
    expect(c.countsInOverall).toBe(true)
    expect(c.weightText).toBe('5.75')
    expect(c.pointsLostText).toBe('3.2')
    expect(c.planNote).toBe('Fixed – not in the action plan')
    expect(c.linkTo).toBe('/metrics/F05')
    expect(c.secondary).toBe(false)
  })

  it('marks a LOW confidence score as excluded from the overall', () => {
    const c = byId(cards, 'F08')
    expect(c.lowConfidence).toBe(true)
    expect(c.countsInOverall).toBe(false)
    expect(c.scoreText).toBe('100')
  })

  it('explains a baseline-set card and shows no score for it', () => {
    const c = byId(cards, 'F01')
    expect(c.scoreText).toBeNull()
    expect(c.baselineNote).toBe('This scan sets your baseline; it is scored from your next scan.')
    expect(c.valueText).toBe('9.2 ± 0.4 index')
    expect(c.planNote).toBeNull()
  })

  it('never shows a number for a refused metric', () => {
    for (const id of ['F14', 'F15', 'F16']) {
      const c = byId(cards, id)
      expect(c.scoreText, id).toBeNull()
      expect(c.valueText, id).toBeNull()
      expect(c.pointsLostText, id).toBeNull()
    }
  })

  it('takes refusal reasons and steps from the measurement, or parses the stored text when the measurement has none', () => {
    const structured = byId(cards, 'F14')
    expect(structured.refusalReasons).toEqual(['Head pitch +6.1° (limit ±4°).'])
    expect(structured.recapture).toEqual(['Ear canal level with lower eyelid.', 'Use the on-screen level line.'])
    const parsed = byId(cards, 'F16')
    expect(parsed.refusalReasons).toHaveLength(1)
    expect(parsed.refusalReasons[0]).toContain('under the 0.40 floor')
    expect(parsed.recapture).toEqual(['Follow the capture protocol: 1.5 m distance, grey card in frame.'])
  })

  it('treats weight 0, pseudoscience and myth metrics as secondary with a plain flag', () => {
    const fwhr = byId(cards, 'F10')
    expect(fwhr.secondary).toBe(true)
    expect(fwhr.flagShort).toBe('Pseudoscience')
    expect(fwhr.flag).toMatch(/no research support/)
    const phi = byId(cards, 'F21')
    expect(phi.secondary).toBe(true)
    expect(phi.flagShort).toBe('Myth')
    expect(phi.flag).toMatch(/contradicted by research/)
  })

  it('never shows a bare number: a score without facts or reason is hidden and flagged', () => {
    const [bad] = buildCards({
      measurements: [measurement('F05')],
      scores: [score('F05', { reason: '   ' })],
      baselinesToStore: [],
    })
    expect(bad!.scoreText).toBeNull()
    expect(bad!.kind).toBe('unscored')
    expect(bad!.integrityNote).toMatch(/without its reason/)
    const [noFacts] = buildCards({ measurements: [], scores: [score('F05', { facts: null })], baselinesToStore: [] })
    expect(noFacts!.scoreText).toBeNull()
    expect(noFacts!.integrityNote).not.toBeNull()
  })

  it('keeps a metric the catalog does not know, by id, without a link', () => {
    const [c] = buildCards({ measurements: [measurement('Z99')], scores: [], baselinesToStore: [] })
    expect(c!.name).toBe('Z99')
    expect(c!.inCatalog).toBe(false)
    expect(c!.linkTo).toBeNull()
    expect(c!.reason).toMatch(/No score record/)
  })

  it('maps fixed, surgical-only and professional-only metrics to the not-in-plan label', () => {
    expect(planNote('FIXED')).toBe('Fixed – not in the action plan')
    expect(planNote('SURGICAL_ONLY')).toBe('Surgical only – not in the action plan')
    expect(planNote('PROFESSIONAL_ONLY')).toBe('Professional only – not in the action plan')
    expect(planNote('CHANGEABLE')).toBeNull()
    expect(planNote('FIXED_BUT_VISIBILITY_CHANGEABLE')).toBeNull()
    expect(planNote(null)).toBeNull()
  })

  it('groups by catalog category in catalog order, with secondary cards last in each group', () => {
    const groups = groupCards(cards)
    expect(groups.map((g) => g.label)).toEqual(['Face'])
    const ids = groups[0]!.cards.map((c) => c.metricId)
    expect(ids.slice(0, 5)).toEqual(['F01', 'F05', 'F08', 'F14', 'F15'])
    expect(ids.indexOf('F10')).toBeGreaterThan(ids.indexOf('F16'))
    expect(ids.indexOf('F21')).toBeGreaterThan(ids.indexOf('F16'))
  })

  it('puts categories in catalog order', () => {
    const mixed = buildCards({ measurements: [measurement('V06'), measurement('F05'), measurement('Z99')], scores: [], baselinesToStore: [] })
    expect(groupCards(mixed).map((g) => g.label)).toEqual(['Face', 'Presence', 'Not in this catalog'])
  })

  it('tallies the cards and says it in words', () => {
    const t = tallyCards(cards)
    expect(t).toEqual({ total: 8, scored: 2, counted: 1, low: 1, refused: 3, baselineSet: 1, unscored: 2 })
    expect(tallyText(t)).toBe('8 metrics in this scan: 2 scored (1 counted in the overall, 1 LOW confidence and left out), 3 refused, 1 baseline set, 2 not scored.')
    expect(tallyText(tallyCards([]))).toBe('This scan holds no metric records.')
  })
})

describe('parseRefusalText', () => {
  it('splits the stored refusal into reasons and steps', () => {
    const parsed = parseRefusalText(REFUSED_REASON)
    expect(parsed.reasons).toEqual(['Head pitch +6.1° (limit ±4°).'])
    expect(parsed.recapture).toEqual(['Ear canal level with lower eyelid.', 'Use the on-screen level line.'])
  })
  it('copes with text that has no re-capture line', () => {
    expect(parseRefusalText('X · NOT SCORED\nNo value was measured.')).toEqual({ reasons: ['No value was measured.'], recapture: [] })
  })
})

describe('re-capture summary', () => {
  it('lists each instruction once, with every metric it unblocks', () => {
    const groups = buildRecapture(sampleCards())
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('Frontal neutral')
    const steps = groups[0]!.steps
    const eyelid = steps.find((s) => /ear canal/i.test(s.text))!
    expect(eyelid.metricIds).toEqual(['F14', 'F15'])
    expect(eyelid.metricNames).toEqual(['Nose width vs eye spacing', 'Lip proportion'])
    // First appearance, in report order (F14, F15, then F16).
    expect(steps.map((s) => s.text)).toEqual([
      'Ear canal level with lower eyelid.',
      'Use the on-screen level line.',
      'Follow the capture protocol: 1.5 m distance, grey card in frame.',
    ])
  })

  it('leaves out refused metrics that carry no weight and reports them separately', () => {
    const cards = buildCards({
      measurements: [measurement('F10', { value: null, refusal: { reasons: ['Too dark'], recapture: ['Face the window'] } })],
      scores: [score('F10', { score: null, facts: null, confidence: { band: 'REFUSED', value: 0 }, reason: 'FWHR · NOT SCORED\nToo dark.' })],
      baselinesToStore: [],
    })
    expect(actionableRefusals(cards)).toHaveLength(0)
    expect(ignorableRefusals(cards).map((c) => c.metricId)).toEqual(['F10'])
    expect(buildRecapture(cards)).toEqual([])
  })

  it('is empty when nothing was refused', () => {
    expect(buildRecapture(buildCards({ measurements: [measurement('F05')], scores: [score('F05')], baselinesToStore: [] }))).toEqual([])
  })
})

describe('overall view', () => {
  it('says "not available" with the coverage and prints no overall number', () => {
    const v = buildOverallView(overall({ coverage: 0.178 }), { attempted: 0.1825 })
    expect(v.available).toBe(false)
    expect(v.headline).toBe('Overall score: not available')
    expect(v.numberText).toBeNull()
    expect(v.bandText).toBeNull()
    expect(v.tag).toBeNull()
    expect(v.coveragePct).toBe(17)
    expect(v.coverageText).toBe('17% of the score is measurable from this scan, 50% is needed.')
    expect(v.explanation.join(' ')).toMatch(/only frontal-photo metrics/)
    expect(v.explanation.join(' ')).toMatch(/18% of the total weight at most/)
  })

  it('does not blame the build when the measured weight could have reached 50%', () => {
    const v = buildOverallView(overall({ coverage: 0.3 }), { attempted: 0.8 })
    expect(v.explanation.join(' ')).not.toMatch(/only frontal-photo/)
    expect(v.explanation.join(' ')).toMatch(/refused metrics and LOW confidence/)
  })

  it('treats a stored number with a NOT_AVAILABLE status as not available', () => {
    expect(buildOverallView(overall({ appearance: 70 })).available).toBe(false)
  })

  it('treats a FINAL status with no number as not available', () => {
    expect(buildOverallView(overall({ status: 'FINAL', appearance: null, coverage: 0.8 })).available).toBe(false)
  })

  it('tags a PROVISIONAL number and shows its band', () => {
    const v = buildOverallView(overall({ status: 'PROVISIONAL', appearance: 61.9, band: 3.4, coverage: 0.62 }))
    expect(v.available).toBe(true)
    expect(v.numberText).toBe('61')
    expect(v.bandText).toBe('± 3.4')
    expect(v.tag).toBe('PROVISIONAL')
    expect(v.explanation[0]).toMatch(/Provisional/)
  })

  it('shows a FINAL number without a provisional note', () => {
    const v = buildOverallView(overall({ status: 'FINAL', appearance: 72, band: null, coverage: 0.8 }))
    expect(v.numberText).toBe('72')
    expect(v.bandText).toBeNull()
    expect(v.tag).toBe('FINAL')
    expect(v.explanation.join(' ')).not.toMatch(/Provisional/)
  })

  it('shows CAI as provisional, and says plainly when it is not available', () => {
    expect(buildOverallView(overall({ cai: 47.8 })).caiText).toBe('CAI: 47% – provisional – ceilings are not personalised yet.')
    expect(buildOverallView(overall({ cai: null })).caiText).toMatch(/^CAI: not available/)
  })

  it('names what was left out of the coverage', () => {
    expect(leftOutText({ total: 5, scored: 1, counted: 1, low: 0, refused: 0, baselineSet: 0, unscored: 4 })).toBeNull()
    expect(leftOutText({ total: 8, scored: 3, counted: 2, low: 1, refused: 2, baselineSet: 1, unscored: 0 })).toBe(
      'Left out of the coverage: 2 refused, 1 LOW confidence, 1 baseline set (scored from the next scan).',
    )
  })

  it('computes the weight share this build can measure from the metric ids in the scan', () => {
    const share = attemptedShare([{ metricId: 'F01' }, { metricId: 'F05' }, { metricId: 'V06' }, { metricId: 'Z99' }])
    expect(share).toBeCloseTo((8 + 5.75 + 3) / 100, 6)
    expect(attemptedShare([])).toBe(0)
  })
})

describe('drag model', () => {
  it('charts nothing when no metric was scored with HIGH or MEDIUM confidence', () => {
    const cards = buildCards({ measurements: [measurement('F08')], scores: [score('F08', { confidence: { band: 'LOW', value: 0.5 } })], baselinesToStore: [] })
    expect(buildDragModel(overall(), cards).show).toBe(false)
    expect(buildDragModel(overall(), []).show).toBe(false)
  })

  it('lists the three groups, scales bars to the largest and keeps zero bars empty', () => {
    const model = buildDragModel(overall(), sampleCards())
    expect(model.show).toBe(true)
    expect(model.bars.map((b) => [b.group, b.pointsText])).toEqual([
      ['FIXED', '3.2'],
      ['SURGICAL_OR_PROFESSIONAL', '0.1'],
      ['CHANGEABLE', '0'],
    ])
    expect(model.bars[0]!.widthPct).toBe(100)
    expect(model.bars[1]!.widthPct).toBeGreaterThanOrEqual(2)
    expect(model.bars[2]!.widthPct).toBe(0)
    expect(model.totalText).toBe('3.2 points lost in total')
  })

  it('lists the top drags with plain names and the group each belongs to', () => {
    const model = buildDragModel(overall(), sampleCards())
    expect(model.top.map((t) => [t.name, t.pointsText, t.groupLabel])).toEqual([
      ['Facial symmetry', '3.2', 'Fixed'],
      ['Lip proportion', '0.1', 'Surgical or professional'],
    ])
    expect(model.top[0]!.hasCard).toBe(true)
  })

  it('carries every number in the text alternative', () => {
    const { description } = buildDragModel(overall(), sampleCards())
    expect(description).toContain('Fixed: 3.2')
    expect(description).toContain('Surgical or professional: 0.1')
    expect(description).toContain('Changeable: 0')
    expect(description).toContain('Facial symmetry, 3.2 points, fixed')
  })
})

function qc(over: Partial<ShotQc> = {}): ShotQc {
  return {
    shot: 'frontal_neutral',
    framesTried: 5,
    framesKept: 4,
    checks: [
      { id: 'yaw', ok: true, value: 1, limit: 'within 3°', hint: 'Turn to face the lens' },
      { id: 'pitch', ok: true, value: 1, limit: 'within 4°', hint: 'Tilt your chin down' },
    ],
    burstSpread: 0.012,
    estimatedDistanceM: 1.43,
    irisPx: 38,
    greyCard: false,
    ...over,
  }
}

describe('photo QC verdict', () => {
  const base = { id: 'p1', shot: 'frontal_neutral' as const, width: 1080, height: 1440 }

  it('passes when every check passed', () => {
    const v = describePhoto({ ...base, qc: qc() })
    expect(v.verdict).toBe('pass')
    expect(v.verdictText).toBe('QC passed (4 of 5 frames kept).')
    expect(v.issues).toEqual([])
    expect(v.sizeText).toBe('1080 × 1440 px')
    expect(v.facts).toEqual(['Camera about 1.4 m away (estimate from iris size, about ±15%)', 'Burst spread 1.2% of pupil distance', 'No grey card in frame'])
  })

  it('lists failed checks with their instruction', () => {
    const v = describePhoto({
      ...base,
      qc: qc({ greyCard: true, checks: [{ id: 'pitch', ok: false, value: 6.1, limit: 'within 4°', hint: 'Tilt your chin down' }] }),
    })
    expect(v.verdict).toBe('issues')
    expect(v.verdictText).toBe('QC found 1 problem (4 of 5 frames kept): head pitch.')
    expect(v.issues).toEqual([{ id: 'pitch', label: 'Head pitch', ok: false, limit: 'within 4°', hint: 'Tilt your chin down' }])
    expect(v.facts).toContain('Grey card in frame')
  })

  it('fails when no frame was kept', () => {
    const v = describePhoto({ ...base, qc: qc({ framesKept: 0 }) })
    expect(v.verdict).toBe('fail')
    expect(v.verdictText).toMatch(/no frame passed/)
  })

  it('omits the facts that were not measured', () => {
    const v = describePhoto({ ...base, qc: qc({ burstSpread: null, estimatedDistanceM: null }) })
    expect(v.facts).toEqual(['No grey card in frame'])
  })
})

describe('history rows', () => {
  const scan: ScanRecord = { id: 's1', takenAt: new Date(2026, 9, 10, 9, 5).getTime(), kind: 'quick', conditions: {}, algoVersion: 'a' }
  const scores = [
    { score: 46, confidence: { band: 'HIGH' as const, value: 0.9 } },
    { score: null, confidence: { band: 'REFUSED' as const, value: 0 } },
    { score: null, confidence: { band: 'REFUSED' as const, value: 0 } },
    { score: null, confidence: { band: 'LOW' as const, value: 0.5 } },
  ]

  it('summarises a scan with no overall number', () => {
    const row = summariseScan(scan, overall({ coverage: 0.1525 }), scores)
    expect(row.id).toBe('s1')
    expect(row.kindLabel).toBe('Quick scan')
    expect(row.status).toBe('NOT_AVAILABLE')
    expect(row.statusText).toBe('Overall not available')
    expect(row.coverageText).toBe('15% of the score measured')
    expect(row.countsText).toBe('1 scored, 2 refused')
    expect(row.dateText).toMatch(/2026/)
  })

  it('shows a provisional number as provisional', () => {
    expect(summariseScan(scan, overall({ status: 'PROVISIONAL', appearance: 61.9, coverage: 0.6 }), scores).statusText).toBe('Overall 61, provisional')
    expect(summariseScan(scan, overall({ status: 'FINAL', appearance: 70, coverage: 0.8 }), scores).statusText).toBe('Overall 70')
  })

  it('says so when the overall record is missing', () => {
    const row = summariseScan(scan, undefined, [])
    expect(row.status).toBeNull()
    expect(row.statusText).toBe('Overall record missing')
    expect(row.coverageText).toBe('Coverage unknown')
  })
})

describe('conditions', () => {
  it('describes only what was logged', () => {
    expect(describeConditions({})).toEqual([])
    expect(describeConditions({ hoursSlept: 7.5, alcoholLastNight: false, illness: true, facialHair: 'stubble', setup: 'phone_stand' })).toEqual([
      '7.5 h of sleep',
      'no alcohol the night before',
      'ill',
      'stubble',
      'phone on a stand',
    ])
  })
})
