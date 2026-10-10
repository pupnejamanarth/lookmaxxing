import type { OverallScore } from '../../domain/types'
import { Badge, Card } from '../../ui'
import type { Tally } from './helpers'
import { FINAL_COVERAGE, MIN_OVERALL_COVERAGE, buildOverallView, formatShare } from './helpers'

interface Props {
  overall: OverallScore
  /** Share of the total weight this scan tried to measure (see attemptedShare). */
  attempted: number | null
  tally?: Tally
}

/**
 * The overall block. When the bundle says NOT_AVAILABLE this prints that, with the coverage bar and the reason, and no
 * number of any kind for the overall score. A number only appears when the stored status allows one.
 */
export function OverallBlock({ overall, attempted, tally }: Props) {
  const view = buildOverallView(overall, { attempted, tally })
  const tone = view.available ? (view.tag === 'PROVISIONAL' ? 'warn' : 'accent') : 'default'
  const minPct = MIN_OVERALL_COVERAGE * 100
  const finalPct = FINAL_COVERAGE * 100

  return (
    <Card as="section" tone={tone} className="rp-overall">
      <div className="rp-overall__top">
        <h2 className={view.available ? 'rp-overall__label' : 'rp-overall__headline'}>{view.available ? 'Overall score' : view.headline}</h2>
        {view.tag ? <Badge tone={view.tag === 'PROVISIONAL' ? 'amber' : 'green'}>{view.tag}</Badge> : null}
      </div>

      {view.available && view.numberText ? (
        <p className="rp-overall__number" aria-label={`${view.headline}${view.bandText ? `, ${view.bandText}` : ''}`}>
          <span className="rp-overall__value" aria-hidden="true">
            {view.numberText}
          </span>
          {view.bandText ? (
            <span className="rp-overall__band" aria-hidden="true">
              {view.bandText}
            </span>
          ) : null}
        </p>
      ) : null}

      <div>
        <div
          className="rp-cov"
          role="progressbar"
          aria-label="Share of the total weight that was scored"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.coveragePct}
          aria-valuetext={view.coverageText}
        >
          <div className="rp-cov__fill" style={{ width: `${view.coveragePct}%` }} />
          <span className="rp-cov__tick" style={{ left: `${minPct}%` }} />
          <span className="rp-cov__tick" style={{ left: `${finalPct}%` }} />
        </div>
        <div className="rp-cov__scale" aria-hidden="true">
          <span style={{ left: `${minPct}%` }}>{formatShare(MIN_OVERALL_COVERAGE)} needed</span>
          <span style={{ left: `${finalPct}%` }}>{formatShare(FINAL_COVERAGE)} final</span>
        </div>
      </div>
      <p className="rp-overall__coverage">{view.coverageText}</p>

      {view.explanation.map((paragraph) => (
        <p key={paragraph} className="rp-overall__text">
          {paragraph}
        </p>
      ))}

      <p className="rp-overall__text u-dim">{view.caiText}</p>
      <p className="rp-overall__text u-dim u-small">{view.weightsText}</p>
    </Card>
  )
}
