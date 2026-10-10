import { useMemo, useState } from 'react'
import { METRICS } from '../../catalog'
import { CATEGORY_IDS, CHANGEABILITY, EVIDENCE } from '../../catalog/schema'
import type { Metric } from '../../catalog/schema'
import { Link } from '../../router'
import {
  Button,
  ChangeabilityBadge,
  CHANGEABILITY_LABEL,
  EmptyState,
  EVIDENCE_LABEL,
  EvidenceBadge,
  Icon,
  PageHeader,
  Stat,
  TextInput,
  Toggle,
  Field,
  plural,
} from '../../ui'
import { WeightBar } from './WeightBar'
import {
  CATEGORY_LABEL,
  EMPTY_FILTERS,
  catalogStats,
  filterMetrics,
  formatPct,
  formatWeight,
  groupByCategory,
  hasActiveFilters,
  phaseLabel,
  segmentsByCategory,
  segmentsByChangeability,
  toggleIn,
  type MetricFilters,
} from './helpers'
import './mx.css'

function Chips<T extends string>({
  legend,
  values,
  selected,
  label,
  onToggle,
}: {
  legend: string
  values: readonly T[]
  selected: readonly T[]
  label: (v: T) => string
  onToggle: (v: T) => void
}) {
  return (
    <fieldset className="mx-fieldset">
      <legend>{legend}</legend>
      <div className="mx-chips">
        {values.map((v) => (
          <button key={v} type="button" className="mx-chip" aria-pressed={selected.includes(v)} onClick={() => onToggle(v)}>
            {label(v)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

// Survives navigating to a detail page and back within the session. Memory only, nothing is stored.
let savedFilters: MetricFilters = EMPTY_FILTERS
const collapsed = new Set<string>()

function MetricRow({ m }: { m: Metric }) {
  const flagged = m.evidence === 'PSEUDOSCIENCE' || m.evidence === 'MYTH'
  return (
    <li>
      <Link to={`/metrics/${m.id}`} className="mx-row">
        <span className="mx-row__top">
          <span className="mx-row__name">
            <span className="mx-id">{m.id}</span>
            {m.name}
          </span>
          <span className="mx-row__weight">{m.weight > 0 ? `${formatWeight(m.weight)} pts` : 'Not scored'}</span>
        </span>
        <span className="mx-row__badges">
          <EvidenceBadge evidence={m.evidence} />
          <ChangeabilityBadge changeability={m.changeability} />
          <span className="mx-tag">{phaseLabel(m.phase)}</span>
        </span>
        {flagged ? (
          <span className="mx-flag">
            {m.evidence === 'PSEUDOSCIENCE'
              ? 'Flagged as pseudoscience. It is popular online but has no sound evidence behind it. Its weight is tiny.'
              : 'Flagged as a myth. The evidence does not support it. It is not scored.'}
          </span>
        ) : null}
      </Link>
    </li>
  )
}

export default function MetricList() {
  const [filters, setFilters] = useState<MetricFilters>(savedFilters)
  const [, bump] = useState(0)
  const stats = useMemo(() => catalogStats(METRICS), [])
  const byCategory = useMemo(() => segmentsByCategory(METRICS), [])
  const byChange = useMemo(() => segmentsByChangeability(METRICS), [])
  const shown = useMemo(() => filterMetrics(METRICS, filters), [filters])
  const groups = useMemo(() => groupByCategory(shown), [shown])
  const active = hasActiveFilters(filters)
  const activeCount =
    filters.categories.length + filters.changeability.length + filters.evidence.length + (filters.hideZeroWeight ? 1 : 0)

  if (METRICS.length === 0) {
    return (
      <div className="u-stack u-stack--lg">
        <PageHeader title="Metrics" subtitle="What is measured, how, and how good the evidence is." />
        <EmptyState title="The metric catalog is empty" icon="metrics">
          No metrics are bundled in this build, so there is nothing to list.
        </EmptyState>
      </div>
    )
  }

  const set = (patch: Partial<MetricFilters>): void => setFilters((f) => (savedFilters = { ...f, ...patch }))

  return (
    <div className="u-stack u-stack--lg">
      <PageHeader
        title="Metrics"
        subtitle="What is measured, how, and how good the evidence is. The overall score is an estimate, not a verdict."
      />

      <section className="u-stack" aria-label="Catalog summary">
        <div className="mx-stats">
          <div className="mx-stat">
            <Stat value={stats.count} label="metrics" hint={`${stats.scoredCount} scored`} />
          </div>
          <div className="mx-stat">
            <Stat value={formatPct(stats.changeablePct)} label="of weight is changeable" />
          </div>
          <div className="mx-stat">
            <Stat value={formatPct(stats.fixedPct)} label="of weight is fixed" />
          </div>
          <div className="mx-stat">
            <Stat value={formatPct(stats.surgicalProfessionalPct)} label="surgical or professional only" />
          </div>
          <div className="mx-stat">
            <Stat value={stats.pseudoscienceCount} label="pseudoscience" tone={stats.pseudoscienceCount > 0 ? 'warn' : 'default'} />
          </div>
          <div className="mx-stat">
            <Stat value={stats.weakCount} label="weak evidence" tone={stats.weakCount > 0 ? 'warn' : 'default'} />
          </div>
        </div>
        <WeightBar title={`Where the ${formatWeight(stats.totalWeight)} points sit, by category`} segments={byCategory} total={stats.totalWeight} />
        <WeightBar title="The same points, by changeability" segments={byChange} total={stats.totalWeight} />
        <p className="u-small u-dim mx-p">
          Changeable includes metrics that are fixed but whose visibility you can change. Weights are for the male profile.
        </p>
      </section>

      <section className="u-stack" aria-label="Find metrics">
        <Field label="Search">
          <TextInput type="search" value={filters.query} onChange={(query) => set({ query })} placeholder="Name, id or what it measures" />
        </Field>
        <details className="mx-filters">
          <summary>
            <span>Filters{activeCount > 0 ? ` (${activeCount} on)` : ''}</span>
          </summary>
          <div className="mx-filters__body">
            <Chips legend="Category" values={CATEGORY_IDS} selected={filters.categories} label={(v) => CATEGORY_LABEL[v]} onToggle={(v) => set({ categories: toggleIn(filters.categories, v) })} />
            <Chips legend="Changeability" values={CHANGEABILITY} selected={filters.changeability} label={(v) => CHANGEABILITY_LABEL[v]} onToggle={(v) => set({ changeability: toggleIn(filters.changeability, v) })} />
            <Chips legend="Evidence" values={EVIDENCE} selected={filters.evidence} label={(v) => EVIDENCE_LABEL[v]} onToggle={(v) => set({ evidence: toggleIn(filters.evidence, v) })} />
            <Toggle checked={filters.hideZeroWeight} onChange={(hideZeroWeight) => set({ hideZeroWeight })} label="Hide zero-weight metrics" hint="Habits, myths and process measures carry no points." />
          </div>
        </details>
        <div className="u-row u-row--between u-row--center">
          <p className="u-small u-dim mx-p" role="status">
            Showing {shown.length} of {METRICS.length} {plural(METRICS.length, 'metric')}.
          </p>
          {active ? (
            <Button size="sm" variant="ghost" onClick={() => setFilters((savedFilters = EMPTY_FILTERS))}>
              Clear all
            </Button>
          ) : null}
        </div>
      </section>

      {groups.length === 0 ? (
        <EmptyState
          title="No metric matches"
          icon="search"
          action={
            <Button variant="secondary" onClick={() => setFilters((savedFilters = EMPTY_FILTERS))}>
              Clear filters
            </Button>
          }
        >
          Loosen the search or remove a filter.
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.category} className="mx-group" aria-labelledby={`mx-g-${g.category}`}>
            <h2 className="mx-group__head" id={`mx-g-${g.category}`}>
              <button
                type="button"
                className="mx-group__toggle"
                aria-expanded={!collapsed.has(g.category)}
                onClick={() => {
                  if (!collapsed.delete(g.category)) collapsed.add(g.category)
                  bump((n) => n + 1)
                }}
              >
                <span>{g.label}</span>
                <span className="mx-group__total">
                  {g.metrics.length} {plural(g.metrics.length, 'metric')} · {formatWeight(g.weight)} pts
                </span>
                <Icon name="chevron-down" size={16} />
              </button>
            </h2>
            {collapsed.has(g.category) ? null : (
              <ul className="mx-list">
                {g.metrics.map((m) => (
                  <MetricRow key={m.id} m={m} />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  )
}
