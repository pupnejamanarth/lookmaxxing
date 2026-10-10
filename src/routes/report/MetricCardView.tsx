import type { ReactNode } from 'react'
import type { ConfidenceBand } from '../../domain/types'
import { Link } from '../../router'
import { Badge, ChangeabilityBadge, EvidenceBadge, type BadgeTone } from '../../ui'
import { COPY } from './copy'
import type { MetricCard } from './helpers'

const BAND_TONE: Record<ConfidenceBand, BadgeTone> = { HIGH: 'green', MEDIUM: 'blue', LOW: 'amber', REFUSED: 'red' }

function Badges({ card }: { card: MetricCard }) {
  return (
    <div className="rp-metric__badges">
      {card.band && card.kind === 'scored' ? (
        <Badge tone={BAND_TONE[card.band]}>
          {card.band} {card.confidenceValueText}
        </Badge>
      ) : null}
      {card.kind === 'refused' ? <Badge tone="red">Refused</Badge> : null}
      {card.kind === 'baseline_set' ? <Badge tone="teal">{COPY.baselineBadge}</Badge> : null}
      {card.kind === 'unscored' ? <Badge tone="grey">{COPY.unscoredBadge}</Badge> : null}
      {card.evidence ? <EvidenceBadge evidence={card.evidence} /> : null}
      {card.changeability ? <ChangeabilityBadge changeability={card.changeability} /> : null}
    </div>
  )
}

function ScoreFigure({ card }: { card: MetricCard }) {
  if (card.scoreText === null || card.score === null) {
    return (
      <p className="rp-score rp-score--none">
        <span className="rp-score__none">{COPY.notScored}</span>
      </p>
    )
  }
  return (
    <p className="rp-score" aria-label={`Score ${card.scoreText} out of 100`}>
      <span className="rp-score__num" aria-hidden="true">
        {card.scoreText}
      </span>
      <span className="rp-score__of" aria-hidden="true">
        /100
      </span>
      <span className="rp-score__meter" aria-hidden="true">
        <span className="rp-score__fill" style={{ width: `${card.score}%` }} />
      </span>
      {card.lowConfidence ? <span className="rp-score__flag">{COPY.notCounted}</span> : null}
    </p>
  )
}

function Reason({ text, label = COPY.reasonLabel }: { text: string; label?: string }) {
  return (
    <div className="rp-reasonbox">
      <p className="rp-reasonbox__label">{label}</p>
      <pre className="rp-reason">{text}</pre>
    </div>
  )
}

function Cost({ card }: { card: MetricCard }) {
  if (card.weightText === null) return null
  const lost =
    card.pointsLostText === null
      ? null
      : card.lowConfidence
        ? `would cost ${card.pointsLostText} overall points if it counted`
        : `costs ${card.pointsLostText} overall points`
  return (
    <p className="rp-metric__line u-num">
      Weight {card.weightText} of 100{lost ? ` · ${lost}` : ''}
    </p>
  )
}

/** Everything inside a card except its heading row. */
function Body({ card }: { card: MetricCard }) {
  const parts: ReactNode[] = []

  if (card.integrityNote) {
    parts.push(
      <p key="integrity" className="rp-note rp-note--danger" role="note">
        {card.integrityNote}
      </p>,
    )
  }

  if (card.lowConfidence) {
    parts.push(
      <p key="low" className="rp-note rp-note--warn" role="note">
        <strong>{COPY.lowWarningTitle}.</strong> {COPY.lowWarning}
      </p>,
    )
  }

  if (card.kind === 'refused') {
    parts.push(
      <div key="refused" className="rp-refusal">
        {card.refusalReasons.length > 0 ? (
          <>
            <p className="rp-refusal__title">{COPY.refusedWhy}</p>
            <ul className="rp-refusal__list">
              {card.refusalReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : null}
        {card.recapture.length > 0 ? (
          <>
            <p className="rp-refusal__title">{COPY.refusedFix}</p>
            <ol className="rp-refusal__list">
              {card.recapture.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </>
        ) : null}
        <details className="rp-stored">
          <summary>{COPY.storedRecordLabel}</summary>
          <pre className="rp-reason">{card.reason}</pre>
        </details>
      </div>,
    )
  } else {
    if (card.baselineNote) {
      parts.push(
        <p key="baseline" className="rp-note rp-note--info" role="note">
          {card.baselineNote}
        </p>,
      )
    }
    parts.push(<Reason key="reason" text={card.reason} />)
  }

  if (card.kind !== 'refused') parts.push(<Cost key="cost" card={card} />)
  if (card.planNote) {
    parts.push(
      <p key="plan" className="rp-metric__plan">
        {card.planNote}
      </p>,
    )
  }
  if (card.linkTo) {
    parts.push(
      <p key="link" className="rp-metric__link">
        <Link to={card.linkTo}>
          {COPY.moreOnMetric}
          <span className="u-sr-only"> for {card.name}</span>
        </Link>
      </p>,
    )
  }
  return <>{parts}</>
}

/**
 * One metric. Normal cards show the number large. Weight-0, pseudoscience and myth cards are collapsed, quieter and
 * start with the plain flag, so they cannot be mistaken for something that moves the overall score.
 */
export function MetricCardView({ card }: { card: MetricCard }) {
  const id = `rp-metric-${card.metricId}`
  const headingId = `${id}-h`

  if (card.secondary) {
    return (
      <details id={id} tabIndex={-1} className={`rp-metric rp-metric--secondary rp-metric--${card.kind}`}>
        <summary className="rp-metric__summary">
          <span className="rp-metric__summary-main">
            <span className="rp-metric__name rp-metric__name--small" id={headingId}>
              {card.name}
            </span>
            <span className="rp-metric__id u-mono">
              {card.metricId} · {card.statusShort}
            </span>
          </span>
          {card.flagShort ? <Badge tone={card.evidence === 'MYTH' ? 'red' : card.evidence === 'PSEUDOSCIENCE' ? 'magenta' : 'grey'}>{card.flagShort}</Badge> : null}
        </summary>
        <div className="rp-metric__inner">
          {card.flag ? (
            <p className="rp-flag" role="note">
              {card.flag}
            </p>
          ) : null}
          {card.valueText ? <p className="rp-metric__value u-num">Measured {card.valueText}</p> : null}
          <Badges card={card} />
          <Body card={card} />
        </div>
      </details>
    )
  }

  return (
    <article id={id} tabIndex={-1} aria-labelledby={headingId} className={`rp-metric rp-metric--${card.kind}${card.lowConfidence ? ' rp-metric--low' : ''}`}>
      <header className="rp-metric__head">
        <div className="rp-metric__title">
          <h4 className="rp-metric__name" id={headingId}>
            {card.name}
          </h4>
          <p className="rp-metric__id u-mono">
            {card.metricId}
            {card.shotText ? ` · ${card.shotText}` : ''}
          </p>
        </div>
        <ScoreFigure card={card} />
      </header>
      {card.valueText ? <p className="rp-metric__value u-num">{card.kind === 'scored' ? card.valueText : `Measured ${card.valueText}`}</p> : null}
      <Badges card={card} />
      <Body card={card} />
    </article>
  )
}
