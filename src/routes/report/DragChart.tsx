import type { OverallScore } from '../../domain/types'
import { COPY } from './copy'
import type { MetricCard } from './helpers'
import { buildDragModel } from './helpers'

const SEG_CLASS = {
  FIXED: 'rp-seg--fixed',
  SURGICAL_OR_PROFESSIONAL: 'rp-seg--surgical',
  CHANGEABLE: 'rp-seg--changeable',
} as const

/** Moves to a metric card, opens it if it is collapsed and puts focus on it for screen readers. */
export function jumpToCard(metricId: string): void {
  const el = document.getElementById(`rp-metric-${metricId}`)
  if (!el) return
  if (el instanceof HTMLDetailsElement) el.open = true
  el.scrollIntoView({ block: 'start' })
  el.focus({ preventScroll: true })
}

/**
 * Points lost by group, and the biggest single drags. The bars are drawn aria-hidden; the text alternative below them
 * (and the list of drags) carries every number, so nothing depends on seeing the bars.
 */
export function DragChart({ overall, cards }: { overall: OverallScore; cards: readonly MetricCard[] }) {
  const model = buildDragModel(overall, cards)
  if (!model.show) return null

  return (
    <section className="rp-section" aria-labelledby="rp-drag-h">
      <h2 className="rp-h2" id="rp-drag-h">
        {COPY.dragTitle}
      </h2>
      <div className="rp-drag">
        <p className="u-dim u-small">{COPY.dragIntro}</p>
        <p className="u-sr-only">{model.description}</p>
        <div className="rp-bars" aria-hidden="true">
          {model.bars.map((bar) => (
            <div key={bar.group} className="rp-bar">
              <span className="rp-bar__label">{bar.label}</span>
              <span className="rp-bar__track">
                <span className={`rp-bar__fill ${SEG_CLASS[bar.group]}`} style={{ width: `${bar.widthPct}%` }} />
              </span>
              <span className="rp-bar__value u-num">{bar.pointsText}</span>
            </div>
          ))}
        </div>
        <p className="u-dim u-small">{model.totalText}. Fixed traits are rated, never planned around.</p>

        {model.top.length > 0 ? (
          <>
            <h3 className="rp-h3">{COPY.dragTopTitle}</h3>
            <ol className="rp-drags">
              {model.top.map((row) => (
                <li key={row.metricId} className="rp-drags__item">
                  <span className="rp-drags__main">
                    {row.hasCard ? (
                      <button type="button" className="rp-linkbtn" onClick={() => jumpToCard(row.metricId)} aria-label={`${COPY.dragJump}: ${row.name}`}>
                        {row.name}
                      </button>
                    ) : (
                      <span>{row.name}</span>
                    )}
                    <span className="u-dim u-small">
                      {row.groupLabel}
                      {row.groupLabel.toLowerCase() === row.changeabilityLabel.toLowerCase() ? '' : ` · ${row.changeabilityLabel}`}
                    </span>
                  </span>
                  <span className="rp-drags__points u-num">{row.pointsText}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="u-small">{COPY.dragNone}</p>
        )}
      </div>
    </section>
  )
}
