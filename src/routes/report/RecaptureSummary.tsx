import type { PhotoRecord } from '../../domain/types'
import { Banner, plural } from '../../ui'
import { COPY } from './copy'
import type { MetricCard } from './helpers'
import { actionableRefusals, buildRecapture, ignorableRefusals } from './helpers'

/**
 * Grouped, de-duplicated instructions for every refused metric, led by the capture checks that failed on the photo of the
 * same shot. Renders nothing when nothing was refused.
 */
export function RecaptureSummary({ cards, photos = [] }: { cards: readonly MetricCard[]; photos?: readonly PhotoRecord[] }) {
  const groups = buildRecapture(cards, photos)
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
              {group.failedChecks.length > 0 ? (
                <>
                  <p className="rp-recapture__sub">{COPY.recaptureFailedChecks}</p>
                  <ul className="rp-recapture__steps">
                    {group.failedChecks.map((check) => (
                      <li key={check.id}>
                        <strong>{check.label}</strong> (limit {check.limit}). {check.hint}
                      </li>
                    ))}
                  </ul>
                  <p className="rp-recapture__sub">{COPY.recaptureSteps}</p>
                </>
              ) : null}
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
