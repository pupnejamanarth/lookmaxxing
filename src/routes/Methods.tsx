import { BANNED, NATURAL_METHODS, REFERRAL_FLAGS, getMetric, getSource } from '../catalog'
import type { BannedItem, NaturalMethod, ReferralFlag } from '../catalog/schema'
import { Link, useRoute } from '../router'
import { Badge, Banner, Card, EmptyState, EvidenceBadge, PageHeader, type BadgeTone } from '../ui'
import {
  METHODS_TABS,
  STATUS_LABEL,
  URGENCY_LABEL,
  groupBanned,
  isStruckOff,
  parseTab,
  sortFlags,
  sortMethods,
  type MethodsTab,
  type NaturalStatus,
} from './catalog/helpers'
import './catalog/mx.css'

const TAB_LABEL: Record<MethodsTab, string> = { natural: 'Natural', banned: 'Banned', doctor: 'See a doctor' }

const STATUS_TONE: Record<NaturalStatus, BadgeTone> = {
  RECOMMENDED: 'green',
  OPTIONAL_LOW_PRIORITY: 'blue',
  EXCLUDED_MYTH: 'red',
  EXCLUDED_NO_LASTING_EFFECT: 'grey',
  BANNED_HARMFUL: 'red',
  WHITELIST_REQUIRED: 'orange',
}

function MetricLinks({ ids }: { ids: readonly string[] }) {
  const known = ids.filter((id) => getMetric(id))
  if (known.length === 0) return null
  return (
    <div className="mx-related">
      <p className="u-small u-dim mx-p" id={`mx-rel-${known[0]}`}>
        Related metrics
      </p>
      <ul className="mx-related__list" aria-labelledby={`mx-rel-${known[0]}`}>
        {known.map((id) => (
          <li key={id}>
            <Link to={`/metrics/${id}`} className="mx-related__link">
              {id}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SourceNote({ ids }: { ids: readonly string[] }) {
  const unverified = ids.filter((id) => getSource(id) && !getSource(id)!.verified).length
  if (ids.length === 0) return null
  return (
    <p className="u-small u-dim mx-p">
      {ids.length} {ids.length === 1 ? 'source' : 'sources'}
      {unverified > 0 ? `, ${unverified} not verified` : ', all verified'}.
    </p>
  )
}

function MethodCard({ m }: { m: NaturalMethod }) {
  const struck = isStruckOff(m)
  return (
    <li>
      <article className={`ui-card${struck ? ' mx-method--excluded' : ''}`} aria-labelledby={`mx-m-${m.id}`}>
        <div className="mx-meta">
          <EvidenceBadge evidence={m.evidence} />
          <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
          {m.foodLevelOnly ? <Badge tone="amber">Food-level only</Badge> : null}
        </div>
        <h3 className="mx-method__name" id={`mx-m-${m.id}`}>
          {m.name}
        </h3>
        {struck ? (
          <div className="mx-excluded">
            <h4>Excluded and why</h4>
            <p className="mx-p">{m.evidenceNote}</p>
          </div>
        ) : null}
        <p className="mx-p">{m.whatItDoes}</p>
        <dl className="mx-dl">
          <dt>Realistic effect</dt>
          <dd>{m.realisticEffect}</dd>
          <dt>Time to results</dt>
          <dd>{m.timeToResults}</dd>
          <dt>Risks</dt>
          <dd>{m.risks}</dd>
          {!struck ? (
            <>
              <dt>Evidence</dt>
              <dd>{m.evidenceNote}</dd>
            </>
          ) : null}
          {m.status === 'WHITELIST_REQUIRED' ? (
            <>
              <dt>Needs</dt>
              <dd>An item on your whitelist ({m.requiredProductCategories.map((c) => c.replace(/_/g, ' ')).join(', ')}).</dd>
            </>
          ) : null}
        </dl>
        {m.patchTest.required && m.patchTest.instructions ? (
          <Banner tone="warn" title="Patch test first">
            {m.patchTest.instructions}
          </Banner>
        ) : null}
        <MetricLinks ids={m.targetsMetricIds} />
        <SourceNote ids={m.sourceIds} />
      </article>
    </li>
  )
}

function Natural() {
  const groups: { label: string; items: NaturalMethod[] }[] = []
  for (const m of sortMethods(NATURAL_METHODS)) {
    const label = STATUS_LABEL[m.status]
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(m)
    else groups.push({ label, items: [m] })
  }
  if (NATURAL_METHODS.length === 0) {
    return (
      <EmptyState title="No methods are bundled in this build" icon="methods">
        The natural-methods catalog is empty, so there is nothing to show.
      </EmptyState>
    )
  }
  return (
    <div className="u-stack">
      <p className="mx-p u-dim">
        Habits and home measures only. Evidence is graded plainly. Myths and methods with no lasting effect are listed so you can see why they are out.{' '}
        {groups.map((g) => `${g.items.length} ${g.label.toLowerCase()}`).join(', ')}.
      </p>
      {groups.map((g) => (
        <section key={g.label} className="mx-group" aria-labelledby={`mx-s-${g.label}`}>
          <h2 className="mx-group__head" id={`mx-s-${g.label}`}>
            <span>{g.label}</span>
            <span className="mx-group__total">{g.items.length}</span>
          </h2>
          <ul className="mx-list">
            {g.items.map((m) => (
              <MethodCard key={m.id} m={m} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function BannedView({ list }: { list: readonly BannedItem[] }) {
  if (list.length === 0) {
    return (
      <EmptyState title="No banned items are bundled in this build" icon="shield">
        The banned list is empty, so there is nothing to show.
      </EmptyState>
    )
  }
  return (
    <div className="u-stack u-stack--lg">
      <p className="mx-p u-dim">The app will never suggest these. Several are common online advice. They can hurt you.</p>
      {groupBanned(list).map((g) => (
        <section key={g.group} className="mx-group" aria-labelledby={`mx-b-${g.group}`}>
          <h2 className="mx-group__head" id={`mx-b-${g.group}`}>
            {g.label}
          </h2>
          <ul className="mx-list">
            {g.items.map((b) => (
              <li key={b.id}>
                <article className="ui-card mx-method--excluded">
                  <div className="mx-meta">
                    <Badge tone="red">BANNED</Badge>
                    <Badge tone="neutral" className="mx-group-tag">
                      {g.label}
                    </Badge>
                  </div>
                  <h3 className="mx-method__name">{b.name}</h3>
                  <p className="mx-p">{b.why}</p>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const URGENCY_TONE: Record<ReferralFlag['urgency'], BadgeTone> = { urgent: 'red', soon: 'amber', routine: 'blue' }

function Doctor({ flags }: { flags: readonly ReferralFlag[] }) {
  return (
    <div className="u-stack">
      <Banner tone="info" title="The app never diagnoses or treats.">
        These are signs worth showing a doctor. A photo app cannot tell you what they mean.
      </Banner>
      {flags.length === 0 ? (
        <EmptyState title="No referral flags are bundled in this build" icon="info">
          The list is empty, so there is nothing to show.
        </EmptyState>
      ) : (
        <ul className="mx-list">
          {sortFlags(flags).map((f) => (
            <li key={f.id}>
              <article className="ui-card" aria-labelledby={`mx-r-${f.id}`}>
                <div className="mx-meta">
                  <Badge tone={URGENCY_TONE[f.urgency]}>{URGENCY_LABEL[f.urgency]}</Badge>
                </div>
                <h3 className="mx-method__name" id={`mx-r-${f.id}`}>
                  {f.trigger}
                </h3>
                <p className="mx-p">{f.message}</p>
                <MetricLinks ids={f.metricIds} />
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Methods() {
  const { segments } = useRoute()
  const tab = parseTab(segments[1])
  return (
    <div className="u-stack u-stack--lg">
      <PageHeader
        title="Methods"
        subtitle="What helps, what does not, what is banned, and when to see a doctor. This is not medical advice."
      />
      <nav className="mx-tabs" aria-label="Methods sections">
        {METHODS_TABS.map((t) => (
          <Link key={t} to={`/methods/${t}`} className="mx-tab" aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>
      {tab === 'natural' ? <Natural /> : tab === 'banned' ? <BannedView list={BANNED} /> : <Doctor flags={REFERRAL_FLAGS} />}
      <Card tone="default" as="aside">
        <p className="u-small u-dim mx-p">
          None of this replaces a doctor or dermatologist. The app does not recommend products or supplements.
        </p>
      </Card>
    </div>
  )
}
