import { useState } from 'react'
import { Banner, Button, Card, WEEKDAYS, plural, useLive } from '../../ui'
import { navigate } from '../../router'
import { db, store } from '../../store'
import { DEFAULT_EQUIPMENT_CHECKLIST_KEYS, DEFAULT_PRIVACY_CHECKLIST_KEYS, type Profile } from '../../types'
import { formatHeight, STEP_KEY } from './helpers'
import { errorText, type StepProps } from './Parts'

function count(keys: readonly string[], record: Record<string, boolean>): number {
  return keys.filter((k) => record[k] === true).length
}

export default function StepDone({ profile, back }: StepProps) {
  const [final, setFinal] = useState<Profile | null>(profile.onboardedAt !== null ? profile : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { value: stack } = useLive(() => store.listWhitelist())

  const finish = async () => {
    setError(null)
    setBusy(true)
    try {
      setFinal(await store.completeOnboarding())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const leave = () => {
    // The resume marker stays until the user leaves, so a reload after finishing lands here.
    db.kv.delete(STEP_KEY).catch(() => {})
    navigate('/')
  }

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
    ['Home Screen', p.installedToHomeScreen === true ? 'Installed' : p.installedToHomeScreen === false ? 'Not installed' : 'Not answered'],
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
        >
          {error}
        </Banner>
      ) : null}

      <div className="onb-nav">
        {final ? (
          <Banner tone="info" live>
            Setup is complete.
          </Banner>
        ) : null}
        <div className="onb-nav__row">
          <Button variant="secondary" icon="chevron-left" onClick={back}>
            Back
          </Button>
          {final ? (
            <Button variant="primary" className="u-grow" onClick={leave}>
              Go to Home
            </Button>
          ) : (
            <Button variant="primary" className="u-grow" onClick={finish} loading={busy}>
              Finish setup
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
