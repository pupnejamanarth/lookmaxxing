import { useMemo, useState } from 'react'
import { navigate, Link } from '../router'
import { scans } from '../store'
import { Banner, Button, ConfirmDialog, EmptyState, LinkButton, PageHeader, Skeleton, useLive } from '../ui'
import { DragChart } from './report/DragChart'
import { MetricCardView } from './report/MetricCardView'
import { OverallBlock } from './report/OverallBlock'
import { PhotoSection } from './report/PhotoSection'
import { RecaptureSummary } from './report/RecaptureSummary'
import { COPY } from './report/copy'
import { attemptedShare, buildCards, describeConditions, groupCards, scanSubtitle, tallyCards, tallyText } from './report/helpers'
import './report/report.css'

function ReportSkeleton() {
  return (
    <div className="u-stack u-stack--lg" aria-busy="true">
      <PageHeader title={COPY.reportTitle} back={{ to: '/scans', label: COPY.reportBack }} />
      <div className="u-stack">
        <Skeleton height={28} width="70%" />
        <Skeleton height={14} />
        <Skeleton height={14} width="85%" />
        <Skeleton height={120} />
      </div>
    </div>
  )
}

/** #/scans/:id. Everything shown comes from the stored bundle; nothing is rescored here. */
export default function Report({ id }: { id: string }) {
  const { value: bundle, loading, error } = useLive(() => scans.getScanBundle(id), [id])
  const [confirming, setConfirming] = useState(false)
  const [deleted, setDeleted] = useState(false)

  const cards = useMemo(() => (bundle ? buildCards(bundle) : []), [bundle])
  const groups = useMemo(() => groupCards(cards), [cards])

  if (deleted) return <ReportSkeleton />
  if (error) {
    return (
      <div className="u-stack u-stack--lg">
        <PageHeader title={COPY.reportTitle} back={{ to: '/scans', label: COPY.reportBack }} />
        <Banner tone="danger" title={COPY.reportLoadError} live>
          {error.message}
        </Banner>
      </div>
    )
  }
  if (loading && bundle === undefined) return <ReportSkeleton />
  if (!bundle) {
    return (
      <div className="u-stack u-stack--lg">
        <PageHeader title={COPY.reportNotFoundTitle} back={{ to: '/scans', label: COPY.reportBack }} />
        <EmptyState title={COPY.reportNotFoundTitle} icon="search" action={<LinkButton to="/scans">{COPY.reportBack}</LinkButton>}>
          {COPY.reportNotFoundText}
        </EmptyState>
      </div>
    )
  }

  const { scan, overall, photos, measurements } = bundle
  const conditions = describeConditions(scan.conditions)
  const tally = tallyCards(cards)

  const remove = async () => {
    await scans.deleteScan(scan.id)
    setDeleted(true)
    setConfirming(false)
    navigate('/scans', { replace: true })
  }

  return (
    <div className="u-stack u-stack--lg rp">
      <PageHeader
        title={COPY.reportTitle}
        subtitle={scanSubtitle(scan)}
        back={{ to: '/scans', label: COPY.reportBack }}
      />
      {conditions.length > 0 ? <p className="u-dim u-small rp-conditions">Logged for this scan: {conditions.join(', ')}.</p> : null}

      <OverallBlock overall={overall} attempted={attemptedShare(measurements)} tally={tally} />
      <RecaptureSummary cards={cards} />
      <DragChart overall={overall} cards={cards} />

      <section className="rp-section" aria-labelledby="rp-metrics-h">
        <h2 className="rp-h2" id="rp-metrics-h">
          {COPY.metricsTitle}
        </h2>
        <p className="u-dim u-small">{COPY.metricsIntro}</p>
        <p className="rp-tally">{tallyText(tally)}</p>
        {groups.map((group) => (
          <div key={group.category ?? 'other'} className="rp-group">
            <h3 className="rp-h3 rp-group__title">{group.label}</h3>
            <div className="rp-cards">
              {group.cards.map((card) => (
                <MetricCardView key={card.metricId} card={card} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <PhotoSection photos={photos} />

      <section className="rp-section" aria-labelledby="rp-delete-h">
        <h2 className="rp-h2" id="rp-delete-h">
          {COPY.deleteTitle}
        </h2>
        <p className="u-dim u-small">{COPY.deleteText}</p>
        <div>
          <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
            {COPY.deleteButton}
          </Button>
        </div>
      </section>

      <footer className="rp-footer">
        <h2 className="rp-h2" id="rp-footer-h">
          {COPY.footerTitle}
        </h2>
        <p>
          <strong>{COPY.footerWeights}</strong> {COPY.footerWhy}
        </p>
        <p className="u-dim u-small u-num">
          Algorithm {scan.algoVersion} · ruleset {overall.rulesetVersion} · weights {overall.weightsVersion}
        </p>
        <p>
          <Link to="/about">{COPY.footerLink}</Link>
        </p>
      </footer>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={COPY.historyDeleteTitle}
        confirmLabel={COPY.deleteConfirm}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      >
        <p>{COPY.deleteBody}</p>
      </ConfirmDialog>
    </div>
  )
}
