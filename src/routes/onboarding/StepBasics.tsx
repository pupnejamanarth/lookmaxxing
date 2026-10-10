import { useState } from 'react'
import { Card, Field, NumberInput, Select } from '../../ui'
import { WEEKDAYS } from '../../ui'
import type { Units } from '../../types'
import { cmToFtIn, imperialToCm, validateHeightCm } from './helpers'
import { Segmented, StepNav, useAction, type StepProps } from './Parts'

type Minutes = 15 | 30 | 60

const WEEKDAY_OPTIONS = WEEKDAYS.map((label, value) => ({ value, label }))
const DAY_OPTIONS = Array.from({ length: 8 }, (_, n) => ({ value: n, label: n === 0 ? '0 days (no training)' : n === 1 ? '1 day' : `${n} days` }))

export default function StepBasics({ profile, save, next, back }: StepProps) {
  const { busy, error, run } = useAction()
  const [units, setUnits] = useState<Units>(profile.units)
  const initial = profile.heightCm !== null ? cmToFtIn(profile.heightCm) : null
  const [cm, setCm] = useState<number | null>(profile.heightCm)
  const [ft, setFt] = useState<number | null>(initial ? initial.ft : null)
  const [inches, setInches] = useState<number | null>(initial ? initial.inches : null)
  const [minutes, setMinutes] = useState<Minutes>(profile.dailyMinutes)
  const [days, setDays] = useState(profile.trainingDaysPerWeek)
  const [weekday, setWeekday] = useState(profile.scanWeekday)
  const [tried, setTried] = useState(false)

  const heightCm = units === 'metric' ? cm : imperialToCm(ft, inches)
  const heightError = validateHeightCm(heightCm)
  const imperialPartError =
    units === 'imperial' && inches !== null && (inches < 0 || inches >= 12) ? 'Inches must be from 0 to 11.9.' : null
  const shownError = tried ? (imperialPartError ?? heightError) : null

  const changeUnits = (to: Units) => {
    if (to === units) return
    // Carry the current height across so switching units never loses what was typed.
    if (heightCm !== null && validateHeightCm(heightCm) === null) {
      if (to === 'imperial') {
        const v = cmToFtIn(heightCm)
        setFt(v.ft)
        setInches(v.inches)
      } else {
        setCm(Math.round(heightCm * 10) / 10)
      }
    }
    setUnits(to)
  }

  const submit = () => {
    setTried(true)
    if (heightError || imperialPartError || heightCm === null) return
    void run(async () => {
      await save({ heightCm, units, dailyMinutes: minutes, trainingDaysPerWeek: days, scanWeekday: weekday })
      next()
    })
  }

  return (
    <div className="u-stack">
      <Card title="Height" headingLevel={2}>
        <Segmented
          label="Units"
          value={units}
          onChange={changeUnits}
          options={[
            { value: 'metric', label: 'Metric (cm)' },
            { value: 'imperial', label: 'Feet and inches' },
          ]}
        />
        {units === 'metric' ? (
          <Field label="Height" hint="Between 120 and 230 cm." error={shownError ?? undefined} required>
            <NumberInput value={cm} onChange={setCm} min={120} max={230} step={1} unit="cm" inputMode="decimal" />
          </Field>
        ) : (
          <div className="u-grid-2">
            <Field label="Feet" required>
              <NumberInput value={ft} onChange={setFt} min={0} max={7} step={1} unit="ft" inputMode="numeric" />
            </Field>
            <Field label="Inches" error={imperialPartError ?? undefined} required>
              <NumberInput value={inches} onChange={setInches} min={0} max={11.9} step={1} unit="in" inputMode="decimal" />
            </Field>
          </div>
        )}
        {units === 'imperial' && shownError && !imperialPartError ? (
          <p className="ui-field__error" role="alert">
            {shownError}
          </p>
        ) : null}
        <p className="u-dim u-small">Stored in centimetres on this device. Height is fixed, so it is not scored as something you can change.</p>
      </Card>

      <Card title="Time and training" headingLevel={2}>
        <div className="onb-group">
          <p className="ui-field__label" id="onb-minutes-label">
            Minutes per day for routines
          </p>
          <Segmented
            labelledBy="onb-minutes-label"
            value={minutes}
            onChange={setMinutes}
            options={[
              { value: 15, label: '15 min' },
              { value: 30, label: '30 min' },
              { value: 60, label: '60 min' },
            ]}
          />
          <p className="u-dim u-small">Be realistic. Plans are ranked by gain per minute, and they will not ask for more than this.</p>
        </div>
        <Field label="Training days per week" hint="Lifting or other hard training.">
          <Select value={days} options={DAY_OPTIONS} onChange={setDays} />
        </Field>
      </Card>

      <Card title="Weekly scan" headingLevel={2}>
        <Field label="Scan day" hint="One full scan a week, on the same day, at the same time of day.">
          <Select value={weekday} options={WEEKDAY_OPTIONS} onChange={setWeekday} />
        </Field>
      </Card>

      <StepNav onBack={back} onNext={submit} busy={busy} error={error} />
    </div>
  )
}
