import { useEffect, useState } from 'react'
import { NET_BLOCKED_EVENT, getNetGuardStats, getOriginAudit } from '../privacy'
import { Link } from '../router'
import { db, store } from '../store'
import { DEFAULT_PRIVACY_CHECKLIST_KEYS, type Profile } from '../types'
import {
  Badge,
  Banner,
  Button,
  Card,
  LinkButton,
  PageHeader,
  Skeleton,
  Stat,
  WEEKDAYS,
  daysSince,
  daysUntilWeekday,
  formatAgo,
  formatDateTime,
  formatInDays,
  plural,
  useLive,
} from '../ui'

const BACKUP_WARN_DAYS = 7

// ───────────────────────────── setup ─────────────────────────────

interface SetupStep {
  label: string
  done: boolean
}

/** Rough progress of the first-run setup, read from what the profile already holds. */
function setupSteps(profile: Profile): SetupStep[] {
  return [
    { label: 'height', done: profile.heightCm !== null },
    { label: 'Home Screen install', done: profile.installedToHomeScreen !== null },
    { label: 'privacy checklist', done: DEFAULT_PRIVACY_CHECKLIST_KEYS.every((key) => profile.privacyChecklist[key] === true) },
    { label: 'equipment checklist', done: Object.keys(profile.equipmentChecklist).length > 0 },
    { label: 'persistent storage', done: profile.storagePersisted !== null },
  ]
}

function SetupCard({ profile }: { profile: Profile | undefined }) {
  if (!profile) {
    return (
      <Card title="Setup" icon="list">
        <Skeleton width="55%" />
        <Skeleton width="80%" />
      </Card>
    )
  }

  if (profile.onboardedAt !== null) {
    const weekday = WEEKDAYS[profile.scanWeekday] ?? WEEKDAYS[0]
    return (
      <Card title="Setup" icon="check-circle" headerEnd={<Badge tone="green">Complete</Badge>}>
        <p className="home-line">
          <strong>Setup complete.</strong> Next scan: {weekday}, {formatInDays(daysUntilWeekday(profile.scanWeekday))}.
        </p>
        <p className="u-dim">Scanning is not available yet. The weekday is saved for when it is.</p>
        <div>
          <LinkButton to="/onboarding" variant="secondary">
            Review setup
          </LinkButton>
        </div>
      </Card>
    )
  }

  const steps = setupSteps(profile)
  const done = steps.filter((step) => step.done).length
  const open = steps.filter((step) => !step.done).map((step) => step.label)
  return (
    <Card title="Setup" icon="list" headerEnd={<Badge tone="amber">Not finished</Badge>}>
      <p className="home-line">
        <strong>
          {done} of {steps.length} steps done.
        </strong>
      </p>
      <div
        className="ui-meter"
        role="progressbar"
        aria-label="Setup steps done"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
      >
        <div className="ui-meter__fill" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      {open.length > 0 ? <p className="u-dim">Still open: {open.join(', ')}.</p> : null}
      <div>
        <LinkButton to="/onboarding" variant="primary">
          {done === 0 ? 'Start setup' : 'Continue setup'}
        </LinkButton>
      </div>
    </Card>
  )
}

// ───────────────────────────── privacy ─────────────────────────────

function readPrivacy() {
  return { stats: getNetGuardStats(), audit: getOriginAudit() }
}

/** Live view of the network guard and of the origins this page has loaded anything from. */
function usePrivacyStatus() {
  const [status, setStatus] = useState(readPrivacy)
  useEffect(() => {
    const refresh = () => setStatus(readPrivacy())
    refresh()
    window.addEventListener(NET_BLOCKED_EVENT, refresh)
    return () => window.removeEventListener(NET_BLOCKED_EVENT, refresh)
  }, [])
  return status
}

function PrivacyCard() {
  const { stats, audit } = usePrivacyStatus()
  const blocked = stats.blockedCount
  const origins = audit.origins.length
  const external = audit.external

  const guardOff = !stats.installed
  const leaked = external.length > 0
  const tone = guardOff || leaked ? 'danger' : blocked > 0 ? 'warn' : 'default'

  let message: string
  if (guardOff) message = 'The network guard is not running. Close and reopen the app.'
  else if (leaked) message = `This page loaded something from outside its own address: ${external.join(', ')}. This should never happen.`
  else if (blocked > 0) message = `The guard refused ${blocked} ${plural(blocked, 'request')} to other addresses this session. The audit log in Settings lists the origins.`
  else message = 'The network guard is on. Any request to another address is refused.'

  return (
    <Card title="Privacy" icon="shield" tone={tone}>
      <div className="u-grid-2" aria-live="polite">
        <Stat value={blocked} label={plural(blocked, 'blocked request')} tone={blocked > 0 ? 'warn' : 'good'} />
        <Stat value={origins} label={`${plural(origins, 'origin')} loaded`} tone={leaked ? 'danger' : 'good'} />
      </div>
      <p className="home-line">{message}</p>
      <div>
        <LinkButton to="/settings" variant="secondary">
          Open privacy check
        </LinkButton>
      </div>
    </Card>
  )
}

// ───────────────────────────── quick scan ─────────────────────────────

function QuickScanCard() {
  return (
    <Card title="Quick scan" icon="camera" headerEnd={<Badge tone="grey">Not available</Badge>}>
      <p className="home-line">
        Scanning arrives in the next build. Until then you can browse every metric, how it is scored and how good its evidence is.
      </p>
      <div className="u-row">
        <Button variant="primary" icon="camera" disabled>
          Start quick scan
        </Button>
        <LinkButton to="/metrics" variant="ghost">
          Browse metrics
        </LinkButton>
      </div>
    </Card>
  )
}

// ───────────────────────────── whitelist ─────────────────────────────

function WhitelistCard() {
  const { value: items } = useLive(() => store.listWhitelist(), [])
  const count = items?.length
  const active = items?.filter((item) => item.active).length ?? 0
  return (
    <Card title="Whitelist" icon="list">
      <div className="u-row u-row--center">
        {count === undefined ? (
          <Skeleton width={96} height={28} />
        ) : (
          <Stat value={count} label={plural(count, 'product')} hint={count > 0 ? `${active} active` : undefined} />
        )}
      </div>
      <p className="home-line">
        {count === 0 ? 'Empty by design. The app only ever mentions products you add.' : 'The app only ever mentions products you add.'}
      </p>
      <div>
        <LinkButton to="/whitelist" variant="secondary">
          Manage whitelist
        </LinkButton>
      </div>
    </Card>
  )
}

// ───────────────────────────── backup ─────────────────────────────

function BackupCard({ profile }: { profile: Profile | undefined }) {
  const { value: lastBackupAt, loading } = useLive(async () => {
    const row = await db.kv.get('lastBackupAt')
    return typeof row?.value === 'number' ? row.value : null
  }, [])

  if (loading || !profile) {
    return (
      <Card title="Backup" icon="backup">
        <Skeleton width="45%" />
        <Skeleton width="85%" />
      </Card>
    )
  }

  const overdue =
    lastBackupAt === null && profile.onboardedAt !== null && daysSince(profile.onboardedAt) > BACKUP_WARN_DAYS
  return (
    <Card title="Backup" icon="backup" tone={overdue ? 'warn' : 'default'}>
      {lastBackupAt ? (
        <p className="home-line">
          <strong>Last backup:</strong> {formatDateTime(lastBackupAt)} ({formatAgo(lastBackupAt)})
        </p>
      ) : (
        <p className="home-line">
          <strong>No backup yet.</strong>
          {overdue && profile.onboardedAt !== null
            ? ` You finished setup ${daysSince(profile.onboardedAt)} days ago. Make a backup now.`
            : null}
        </p>
      )}
      <p className="u-dim">Your data exists only on this device. A backup file is the only other copy.</p>
      <div>
        <LinkButton to="/settings" variant={overdue ? 'primary' : 'secondary'}>
          Open backup in Settings
        </LinkButton>
      </div>
    </Card>
  )
}

// ───────────────────────────── page ─────────────────────────────

export default function Home() {
  const { value: profile, error } = useLive(() => store.getProfile(), [])
  const unfinished = profile !== undefined && profile.onboardedAt === null

  return (
    <div className="u-stack u-stack--lg">
      <PageHeader title="Unmoggable" subtitle="Status of this device and your setup." />

      {error ? (
        <Banner tone="danger" title="Local storage is not available" live>
          This browser blocked storage for this app, so nothing can be saved. Private browsing is the usual cause. Open the app in a normal
          tab or from the Home Screen.
        </Banner>
      ) : null}

      {unfinished ? (
        <Banner
          tone="warn"
          title="Setup is not finished"
          action={
            <LinkButton to="/onboarding" size="sm" variant="secondary">
              Finish setup
            </LinkButton>
          }
        >
          Scans need your height and the privacy checks first.
        </Banner>
      ) : null}

      <div className="u-stack">
        <SetupCard profile={profile} />
        <PrivacyCard />
        <QuickScanCard />
        <WhitelistCard />
        <BackupCard profile={profile} />
      </div>

      <p className="home-foot">
        <Link to="/about">How scoring works</Link>
      </p>
    </div>
  )
}
