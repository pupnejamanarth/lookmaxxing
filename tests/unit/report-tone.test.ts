import { describe, expect, it } from 'vitest'
import type { OverallScore } from '../../src/domain/types'
import { COPY } from '../../src/routes/report/copy'
import {
  KIND_LABEL,
  buildCards,
  buildDragModel,
  buildOverallView,
  buildRecapture,
  describePhoto,
  leftOutText,
  planNote,
  summariseScan,
  tallyCards,
  tallyText,
} from '../../src/routes/report/helpers'
import { lintTone } from '../../src/scoring'

// docs/PLAN.md section 2, rule 6: tone is enforced by tests. Every fixed sentence the report prints goes through the
// same linter as the score reasons: no compliments, softeners, insults, slang or hype.

const overall = (over: Partial<OverallScore> = {}): OverallScore => ({
  scanId: 's',
  appearance: null,
  band: null,
  coverage: 0.17,
  status: 'NOT_AVAILABLE',
  pointsLost: { FIXED: 3, SURGICAL_OR_PROFESSIONAL: 0.1, CHANGEABLE: 1 },
  drag: [{ metricId: 'F05', name: 'Facial symmetry (left-right mismatch)', pointsLost: 3, changeability: 'FIXED', group: 'FIXED' }],
  cai: null,
  weightsVersion: 'w',
  rulesetVersion: 'r',
  ...over,
})

function violations(text: string): string[] {
  return lintTone(text)
}

describe('report copy passes the tone linter', () => {
  it.each(Object.entries(COPY))('COPY.%s', (_key, text) => {
    expect(violations(text)).toEqual([])
  })

  it('has no exclamation marks, emojis or softeners in the fixed copy', () => {
    for (const text of Object.values(COPY)) {
      expect(text).not.toMatch(/!/)
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })

  it('labels and notes', () => {
    for (const text of [...Object.values(KIND_LABEL), planNote('FIXED')!, planNote('SURGICAL_ONLY')!, planNote('PROFESSIONAL_ONLY')!]) {
      expect(violations(text), text).toEqual([])
    }
  })

  it('every sentence the overall view can print', () => {
    const views = [
      buildOverallView(overall(), { attempted: 0.18 }),
      buildOverallView(overall(), { attempted: 0.8 }),
      buildOverallView(overall({ status: 'PROVISIONAL', appearance: 61, band: 3.4, coverage: 0.62, cai: 47 })),
      buildOverallView(overall({ status: 'FINAL', appearance: 72, coverage: 0.8 })),
    ]
    for (const view of views) {
      for (const text of [view.headline, view.coverageText, view.caiText, view.weightsText, ...view.explanation]) {
        expect(violations(text), text).toEqual([])
      }
    }
    const left = leftOutText({ total: 9, scored: 2, counted: 1, low: 1, refused: 3, baselineSet: 1, unscored: 2 })!
    expect(violations(left)).toEqual([])
  })

  it('tallies, flags, refusals, drags and photo verdicts', () => {
    const cards = buildCards({
      measurements: [
        { id: 'a', scanId: 's', metricId: 'F10', value: 1.9, unit: 'ratio', uncertainty: 0.1, nFrames: 5, method: 'AUTO_FRONTAL_PHOTO', qcFactor: 1, algoVersion: 'x' },
        { id: 'b', scanId: 's', metricId: 'F21', value: 0.6, unit: 'n/a', uncertainty: 0.1, nFrames: 5, method: 'AUTO_FRONTAL_PHOTO', qcFactor: 1, algoVersion: 'x' },
        {
          id: 'c',
          scanId: 's',
          metricId: 'F14',
          value: null,
          unit: 'ratio',
          uncertainty: null,
          nFrames: 0,
          method: 'AUTO_FRONTAL_PHOTO',
          qcFactor: 0,
          algoVersion: 'x',
          refusal: { reasons: ['Head pitch +6.1° (limit ±4°)'], recapture: ['ear canal level with lower eyelid'] },
        },
      ],
      scores: [],
      baselinesToStore: [],
    })
    const texts: string[] = [tallyText(tallyCards(cards))]
    for (const card of cards) texts.push(card.flag ?? '', card.reason, card.integrityNote ?? '')
    for (const group of buildRecapture(cards)) texts.push(group.label, ...group.steps.map((step) => step.text))
    texts.push(buildDragModel(overall(), cards).description)
    for (const verdict of ['pass', 'issues', 'fail'] as const) {
      const framesKept = verdict === 'fail' ? 0 : 4
      const ok = verdict !== 'issues'
      const view = describePhoto({
        id: 'p',
        shot: 'frontal_neutral',
        width: 10,
        height: 10,
        qc: {
          shot: 'frontal_neutral',
          framesTried: 5,
          framesKept,
          checks: [{ id: 'pitch', ok, value: 6, limit: 'within 4°', hint: 'Tilt your chin down' }],
          burstSpread: 0.01,
          estimatedDistanceM: 1.5,
          irisPx: 38,
          greyCard: false,
        },
      })
      texts.push(view.verdictText, ...view.facts)
    }
    texts.push(summariseScan({ id: 's', takenAt: 0, kind: 'quick', conditions: {}, algoVersion: 'a' }, overall(), []).statusText)
    for (const text of texts.filter((t) => t !== '')) expect(violations(text), text).toEqual([])
  })
})
