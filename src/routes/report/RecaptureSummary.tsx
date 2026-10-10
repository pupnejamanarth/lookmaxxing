import { Banner, plural } from '../../ui'
import { COPY } from './copy'
import type { MetricCard } from './helpers'
import { actionableRefusals, buildRecapture, ignorableRefusals } from './helpers'

/** Grouped, de-duplicated instructions for every refused metric. Renders nothing when nothing was refused. */
export function RecaptureSummary({ cards }: { cards: readonly MetricCard[] }) {
  const groups = buildRecapture(cards)
  if (groups.length === 0) return null
  const refused = actionableRefusals(cards).length
  const ignored = ignorableRefusals(cards)

  return (
    <section className="rp-section" aria-labelledby="rp-recapture-h">
      <h2 className="rp-h2" id="rp-recapture-h">
        {COPY.recaptureTitle}
      </h2>
      <Banner tone="warn" title={`${refused} ${plural(refused, 'metric')} refused`}>
        <p>{COPY.recaptureIntro}</p>
        <div className="rp-recapture">
          {groups.map((group) => (
            <div key={group.key} className="rp-recapture__group">
              <h3 className="rp-recapture__shot">{group.label}</h3>
              <ol className="rp-recapture__steps">
                {group.steps.map((step) => (
                  <li key={step.text}>
                    <span>{step.text}</span>
                    <span className="rp-recapture__for u-dim u-small">
                      {' '}
                      Unblocks {step.metricNames.map((n, i) => `${step.metricIds[i]} ${n}`).join('; ')}.
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {ignored.length > 0 ? (
          <p className="rp-recapture__ignored u-dim u-small">
            {ignored.map((c) => c.metricId).join(', ')} {COPY.recaptureIgnored}
          </p>
        ) : null}
      </Banner>
    </section>
  )
}
