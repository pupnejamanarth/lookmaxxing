import type { ReactNode } from 'react'
import { METRICS, getMetric, getSource, isPlannable } from '../catalog'
import type { Metric, Source } from '../catalog/schema'
import { Link } from '../router'
import { Badge, Banner, Card, ChangeabilityBadge, EmptyState, EvidenceBadge, LinkButton, PageHeader } from '../ui'
import { CurveChart } from './catalog/CurveChart'
import {
  CATEGORY_LABEL,
  describeRule,
  formatWeight,
  neighbours,
  phaseLabel,
  ruleKindLabel,
  sampleCurve,
} from './catalog/helpers'
import './catalog/mx.css'

const METHOD_LABEL: Record<string, string> = {
  AUTO_FRONTAL_PHOTO: 'Automatic, from the front photo',
  AUTO_PROFILE_PHOTO: 'Automatic, from the side photo',
  MANUAL_LANDMARKS: 'Landmarks you place by hand',
  COLOR_CALIBRATED_PHOTO: 'Colour-calibrated photo',
  TAP_COUNT_ON_PHOTO: 'Tap-and-count on a photo',
  POSE_MODEL_PHOTO: 'Body-pose model on a photo',
  SEGMENTATION_PHOTO: 'Segmentation of a photo',
  TAPE_MEASURE: 'Tape measure',
  SCALE: 'Scale',
  SELF_GRADE_REFERENCE: 'Self-grade against reference images',
  CHECKLIST: 'Checklist',
  COMPUTED_FROM_OTHER_METRICS: 'Computed from other metrics',
  AUDIO_ANALYSIS: 'Audio analysis',
  VIDEO_ANALYSIS: 'Video analysis',
  MANUAL_INPUT: 'Typed in by hand',
  HABIT_LOG: 'Habit log',
}

const SHOT_LABEL = (s: string): string => s.replace(/_/g, ' ')

const SOURCE_KIND_LABEL: Record<Source['kind'], string> = {
  peer_reviewed: 'Peer-reviewed',
  clinical_guideline: 'Clinical guideline',
  textbook: 'Textbook',
  government_or_standards: 'Government or standards body',
  convention: 'Convention',
  community_claim: 'Community claim',
}

const HIGHER_IS: Record<Metric['scale']['higherIs'], string> = {
  better: 'Higher is better',
  worse: 'Lower is better',
  target_range: 'Best inside a target range',
  not_applicable: 'Not ranked',
}

const CONFIDENCE: Record<Metric['ideal']['confidenceInIdeal'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function fmtRange(r: { lo: number | null; hi: number | null } | null, unit: string): string {
  if (!r) return 'No fixed numeric band'
  if (r.lo !== null && r.hi !== null) return `${r.lo} to ${r.hi} ${unit}`
  if (r.lo !== null) return `${r.lo} ${unit} or more`
  if (r.hi !== null) return `${r.hi} ${unit} or less`
  return 'No fixed numeric band'
}

function SourceItem({ id }: { id: string }) {
  const s = getSource(id)
  if (!s) {
    return (
      <li className="mx-source">
        <p className="mx-source__cite u-mono">{id}</p>
        <p className="mx-source__note">This source record is missing from the catalog.</p>
      </li>
    )
  }
  return (
    <li className="mx-source">
      <div className="mx-meta">
        {s.verified ? <Badge tone="green">VERIFIED</Badge> : <Badge tone="amber">unverified</Badge>}
        <span className="mx-tag">{SOURCE_KIND_LABEL[s.kind]}</span>
      </div>
      <p className="mx-source__cite">{s.citation}</p>
      <p className="mx-source__note">Cited for: {s.supports}</p>
      <p className="mx-source__note">{s.verified ? 'Checked: ' : 'Why unverified: '}{s.verificationNote}</p>
      {s.url ? (
        <a href={s.url} rel="noopener noreferrer" target="_blank">
          Open the source (leaves the app)
        </a>
      ) : null}
    </li>
  )
}

function Pager({ prev, next }: { prev: Metric | null; next: Metric | null }) {
  return (
    <nav className="mx-pager" aria-label="Other metrics">
      {prev ? (
        <Link to={`/metrics/${prev.id}`} className="mx-pager__link">
          <span className="mx-pager__dir">Previous</span>
          <span className="mx-pager__name">
            {prev.id} {prev.name}
          </span>
        </Link>
      ) : null}
      {next ? (
        <Link to={`/metrics/${next.id}`} className="mx-pager__link mx-pager__link--next">
          <span className="mx-pager__dir">Next</span>
          <span className="mx-pager__name">
            {next.id} {next.name}
          </span>
        </Link>
      ) : null}
    </nav>
  )
}

function List({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="mx-list-plain">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  )
}

export default function MetricDetail({ id }: { id: string }) {
  const m = getMetric(id)
  if (!m) {
    return (
      <div className="u-stack u-stack--lg">
        <PageHeader title="Metric not found" back={{ to: '/metrics', label: 'All metrics' }} />
        <EmptyState title={`No metric with id ${id}`} icon="search" action={<LinkButton to="/metrics">Back to metrics</LinkButton>}>
          The id may be wrong, or this build does not include it.
        </EmptyState>
      </div>
    )
  }

  const { prev, next } = neighbours(METRICS, m.id)
  const curve = sampleCurve(m.scoring)
  const planned = isPlannable(m)
  const unit = m.scale.unit
  const curveText = curve
    ? `Score against ${unit}. ${describeRule(m.scoring, unit)}`
    : ''

  return (
    <div className="u-stack u-stack--lg">
      <PageHeader
        title={m.name}
        subtitle={`${m.id} · ${CATEGORY_LABEL[m.category]}`}
        back={{ to: '/metrics', label: 'All metrics' }}
      />

      <div className="mx-meta">
        <EvidenceBadge evidence={m.evidence} />
        <ChangeabilityBadge changeability={m.changeability} />
        <span className="mx-tag">{m.weight > 0 ? `${formatWeight(m.weight)} pts` : 'Not scored'}</span>
        <span className="mx-tag">{phaseLabel(m.phase)}</span>
      </div>

      {m.evidence === 'PSEUDOSCIENCE' || m.evidence === 'MYTH' ? (
        <Banner tone="danger" title={m.evidence === 'PSEUDOSCIENCE' ? 'Flagged as pseudoscience' : 'Flagged as a myth'}>
          {m.evidence === 'PSEUDOSCIENCE'
            ? 'It is popular online but has no sound evidence behind it. Its weight is tiny.'
            : 'The evidence does not support it. It is not scored.'}
        </Banner>
      ) : null}

      {m.medicalFlag ? (
        <Banner tone="warn" title="Medical flag">
          {m.medicalFlag} The app never diagnoses or treats. If this applies to you, see a doctor.
        </Banner>
      ) : null}

      <Card title="What it measures" headingLevel={2}>
        <p className="mx-p">{m.measures}</p>
      </Card>

      <Card title="How it is measured" headingLevel={2}>
        <p className="mx-p">{m.howMeasured}</p>
        <List items={m.methods.map((x) => METHOD_LABEL[x] ?? x)} />
      </Card>

      <Card title="Scale" headingLevel={2}>
        <dl className="mx-dl">
          <dt>Unit</dt>
          <dd>{unit}</dd>
          <dt>Range</dt>
          <dd>
            {m.scale.min == null && m.scale.max == null
              ? 'No fixed limits'
              : m.scale.min == null
                ? `Up to ${m.scale.max}`
                : m.scale.max == null
                  ? `From ${m.scale.min}`
                  : `${m.scale.min} to ${m.scale.max}`}
          </dd>
          <dt>Direction</dt>
          <dd>{HIGHER_IS[m.scale.higherIs]}</dd>
        </dl>
        <p className="mx-p">{m.scale.description}</p>
      </Card>

      <Card title="Ideal for the male profile" headingLevel={2} headerEnd={<Badge tone={m.ideal.confidenceInIdeal === 'low' ? 'amber' : m.ideal.confidenceInIdeal === 'medium' ? 'blue' : 'green'}>{CONFIDENCE[m.ideal.confidenceInIdeal]} confidence</Badge>}>
        <p className="mx-p">{m.ideal.summary}</p>
        <dl className="mx-dl">
          <dt>Target band</dt>
          <dd>{fmtRange(m.ideal.male, unit)}</dd>
          <dt>Why</dt>
          <dd>{m.ideal.rationale}</dd>
          {m.ideal.populationCaveat ? (
            <>
              <dt>Caveat</dt>
              <dd>{m.ideal.populationCaveat}</dd>
            </>
          ) : null}
        </dl>
        <p className="u-small u-dim mx-p">This is an estimate of what suits the typical man. It may not suit you.</p>
      </Card>

      <Card title="How it is scored" headingLevel={2} headerEnd={<Badge tone="neutral">{ruleKindLabel(m.scoring)}</Badge>}>
        <p className="mx-p">{describeRule(m.scoring, unit)}</p>
        {curve ? <CurveChart curve={curve} unit={unit} description={curveText} /> : null}
        {m.scoring.kind === 'checklist' ? (
          <ul className="mx-list-plain">
            {m.scoring.items.map((it) => (
              <li key={it.id}>
                {it.label}
                {it.critical ? ' (critical)' : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {m.scoring.kind === 'none' ? <p className="mx-p"><strong>This metric is not scored.</strong></p> : null}
      </Card>

      <Card title="Weight" headingLevel={2} headerEnd={<span className="u-num">{formatWeight(m.weight)} of 100</span>}>
        <p className="mx-p">{m.weightRationale}</p>
      </Card>

      <Card title="Evidence" headingLevel={2} headerEnd={<EvidenceBadge evidence={m.evidence} />}>
        <p className="mx-p">{m.evidenceNote || 'Strong evidence. No caveat needed.'}</p>
        {m.communityClaim ? (
          <div className="mx-claim">
            <p className="mx-claim__label">Community claim</p>
            <p className="mx-p">{m.communityClaim}</p>
          </div>
        ) : null}
      </Card>

      <Card title="Can it be changed" headingLevel={2} headerEnd={<ChangeabilityBadge changeability={m.changeability} />}>
        <p className="mx-p">{m.changeabilityNote ?? 'No further note.'}</p>
        {!planned ? (
          <p className="mx-p">
            <strong>Not in the action plan.</strong> The app does not plan around things you cannot change with habits.
          </p>
        ) : null}
      </Card>

      <Card title="When the app will refuse to score this" headingLevel={2}>
        {m.refusalConditions.length > 0 ? (
          <>
            <p className="mx-p">The app will refuse to score this when:</p>
            <List items={m.refusalConditions} />
          </>
        ) : (
          <p className="mx-p">No refusal conditions are set.</p>
        )}
      </Card>

      <Card title="What you need to capture" headingLevel={2}>
        <div className="mx-meta">
          {m.captureRequirements.map((s) => (
            <span key={s} className="mx-tag">
              {SHOT_LABEL(s)}
            </span>
          ))}
        </div>
      </Card>

      <Card title="Sources" headingLevel={2}>
        {m.sourceIds.length > 0 ? (
          <ul className="mx-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {m.sourceIds.map((sid) => (
              <SourceItem key={sid} id={sid} />
            ))}
          </ul>
        ) : (
          <p className="mx-p">No sources are cited for this metric.</p>
        )}
      </Card>

      <Pager prev={prev} next={next} />
    </div>
  )
}
