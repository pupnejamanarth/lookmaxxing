import { useEffect, useState } from 'react'
import { Banner, Button, Card, LinkButton, Spinner, WEEKDAYS, plural, useLive } from '../../ui'
import { db, store } from '../../store'
import { DEFAULT_EQUIPMENT_CHECKLIST_KEYS, DEFAULT_PRIVACY_CHECKLIST_KEYS, type Profile } from '../../types'
import { formatHeight, readInstallState, STEP_KEY } from './helpers'
import { errorText, type StepProps } from './Parts'

function count(keys: readonly string[], record: Record<string, boolean>): number {
  return keys.filter((k) => record[k] === true).length
}

export default function StepDone({ profile, back }: StepProps) {
  const [final, setFinal] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { value: stack } = useLive(() => store.listWhitelist())

  useEffect(() => {
    let alive = true
    store
      .completeOnboarding()
      .then(async (p) => {
        try {
          await db.kv.delete(STEP_KEY)
        } catch {
          // Losing the resume marker is harmless once setup is complete.
        }
        if (alive) setFinal(p)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const p = final ?? profile
  const privacyDone = count(DEFAULT_PRIVACY_CHECKLIST_KEYS, p.privacyChecklist)
  const equipmentDone = count(DEFAULT_EQUIPMENT_CHECKLIST_KEYS, p.equipmentChecklist)
  const open =
    DEFAULT_PRIVACY_CHECKLIST_KEYS.length - privacyDone + (DEFAULT_EQUIPMENT_CHECKLIST_KEYS.length - equipmentDone)
  const stackCount = stack?.length ?? 0

  const rows: [string, string][] = [
    ['Height', p.heightCm === null ? 'Not set' : formatHeight(p.heightCm, p.units)],
    ['Units', p.units === 'metric' ? 'Metric' : 'Feet and inches'],
    ['Time per day', `${p.dailyMinutes} minutes`],
    ['Training', `${p.trainingDaysPerWeek} ${plural(p.trainingDaysPerWeek, 'day')} per week`],
    ['Weekly scan', WEEKDAYS[p.scanWeekday]],
    ['Home Screen', p.installedToHomeScreen === true ? 'Installed' : p.installedToHomeScreen === false ? (readInstallState().ios ? 'Not installed' : 'Browser tab') : 'Not answered'],
    ['Privacy checklist', `${privacyDone} of ${DEFAULT_PRIVACY_CHECKLIST_KEYS.length} done`],
    ['Equipment checklist', `${equipmentDone} of ${DEFAULT_EQUIPMENT_CHECKLIST_KEYS.length} done`],
    ['My current stack', stackCount === 0 ? 'Empty' : `${stackCount} ${plural(stackCount, 'item')}`],
    ['Persistent storage', p.storagePersisted === true ? 'Granted' : p.storagePersisted === false ? 'Not granted' : 'Not asked'],
  ]

  return (
    <div className="u-stack">
      <Card title="Your choices" headingLevel={2}>
        <dl className="onb-summary">
          {rows.map(([k, v]) => (
            <div key={k} className="onb-summary__row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="u-dim u-small">Change any of this later in Settings.</p>
      </Card>

      {open > 0 ? (
        <Banner tone="warn" title={`${open} open ${open === 1 ? 'risk' : 'risks'}`}>
          Unchecked items show on Home until you deal with them.
        </Banner>
      ) : null}
      {p.storagePersisted !== true ? (
        <Banner tone="info">Make a backup every week. It is the real protection for your data.</Banner>
      ) : null}

      {error ? (
        <Banner
          tone="danger"
          title="Setup could not be finished"
          action={
            <Button size="sm" onClick={() => { setError(null); setAttempt((n) => n + 1) }}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      ) : null}

      <div className="onb-nav">
        {final ? (
          <Banner tone="info" live>
            Setup is complete.
          </Banner>
        ) : error ? null : (
          <p className="u-dim u-small">
            <Spinner size={14} label="Saving" /> Saving.
          </p>
        )}
        <div className="onb-nav__row">
          <Button variant="secondary" icon="chevron-left" onClick={back}>
            Back
          </Button>
          {final ? (
            <LinkButton to="/" variant="primary" className="u-grow">
              Go to Home
            </LinkButton>
          ) : null}
        </div>
      </div>
    </div>
  )
}
