import { useState } from 'react'
import { Banner, Card, Checkbox } from '../../ui'
import { DEFAULT_EQUIPMENT_CHECKLIST_KEYS, DEFAULT_PRIVACY_CHECKLIST_KEYS } from '../../types'
import { EQUIPMENT_COPY, PRIVACY_COPY } from './helpers'
import { StepNav, useAction, type StepProps } from './Parts'

function build(keys: readonly string[], saved: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(keys.map((k) => [k, saved[k] === true]))
}

export default function StepChecklists({ profile, save, next, back }: StepProps) {
  const { busy, error, run } = useAction()
  const [privacy, setPrivacy] = useState(() => build(DEFAULT_PRIVACY_CHECKLIST_KEYS, profile.privacyChecklist))
  const [equipment, setEquipment] = useState(() => build(DEFAULT_EQUIPMENT_CHECKLIST_KEYS, profile.equipmentChecklist))

  const open = Object.values(privacy).filter((v) => !v).length + Object.values(equipment).filter((v) => !v).length

  const submit = () =>
    run(async () => {
      await save({ privacyChecklist: privacy, equipmentChecklist: equipment })
      next()
    })

  return (
    <div className="u-stack">
      <Banner tone="info">
        Unchecked items are allowed. They show on Home as open risks until you check them.
      </Banner>

      <Card title="Privacy" icon="lock" headingLevel={2}>
        <div className="onb-checks">
          {DEFAULT_PRIVACY_CHECKLIST_KEYS.map((key) => (
            <Checkbox
              key={key}
              checked={privacy[key]}
              onChange={(v) => setPrivacy((p) => ({ ...p, [key]: v }))}
              label={PRIVACY_COPY[key]?.label ?? key}
              hint={PRIVACY_COPY[key]?.hint}
            />
          ))}
        </div>
      </Card>

      <Card title="Equipment" icon="camera" headingLevel={2}>
        <div className="onb-checks">
          {DEFAULT_EQUIPMENT_CHECKLIST_KEYS.map((key) => (
            <Checkbox
              key={key}
              checked={equipment[key]}
              onChange={(v) => setEquipment((p) => ({ ...p, [key]: v }))}
              label={EQUIPMENT_COPY[key]?.label ?? key}
              hint={EQUIPMENT_COPY[key]?.hint}
            />
          ))}
        </div>
      </Card>

      <p className="u-dim u-small" aria-live="polite">
        {open === 0 ? 'No open items.' : `${open} open ${open === 1 ? 'item' : 'items'}.`}
      </p>

      <StepNav onBack={back} onNext={submit} busy={busy} error={error} />
    </div>
  )
}
