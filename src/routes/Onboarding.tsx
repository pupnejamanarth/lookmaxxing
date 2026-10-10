import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { Banner, Button, PageHeader, ProgressSteps, Spinner } from '../ui'
import { db, store } from '../store'
import type { Profile } from '../types'
import { STEP_KEY, STEP_NAMES, clampStep } from './onboarding/helpers'
import type { ProfilePatch, StepProps } from './onboarding/Parts'
import StepPromise from './onboarding/StepPromise'
import StepInstall from './onboarding/StepInstall'
import StepBasics from './onboarding/StepBasics'
import StepChecklists from './onboarding/StepChecklists'
import StepStack from './onboarding/StepStack'
import StepStorage from './onboarding/StepStorage'
import StepDone from './onboarding/StepDone'
import './onboarding/onboarding.css'

const STEPS: { title: string; Component: ComponentType<StepProps> }[] = [
  { title: 'Before you start', Component: StepPromise },
  { title: 'Install the app', Component: StepInstall },
  { title: 'The basics', Component: StepBasics },
  { title: 'Checklists', Component: StepChecklists },
  { title: 'My current stack', Component: StepStack },
  { title: 'Storage', Component: StepStorage },
  { title: 'Setup complete', Component: StepDone },
]

interface Loaded {
  profile: Profile
  step: number
}

export default function Onboarding() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([store.getProfile(), db.kv.get(STEP_KEY)])
      .then(([profile, row]) => {
        if (alive) setLoaded({ profile, step: clampStep(row?.value) })
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Unknown error')
      })
    return () => {
      alive = false
    }
  }, [attempt])

  if (loadError) {
    return (
      <>
        <PageHeader title="Setup" />
        <Banner
          tone="danger"
          title="Setup could not load"
          action={
            <Button
              size="sm"
              onClick={() => {
                setLoadError(null)
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </Button>
          }
        >
          The local database did not open. {loadError}
        </Banner>
      </>
    )
  }

  if (!loaded) {
    return (
      <>
        <PageHeader title="Setup" />
        <Spinner label="Loading setup" />
      </>
    )
  }

  return <Flow initial={loaded} />
}

function Flow({ initial }: { initial: Loaded }) {
  const [profile, setProfile] = useState(initial.profile)
  const [step, setStep] = useState(initial.step)
  const moved = useRef(false)

  const goTo = useCallback((n: number) => {
    const to = clampStep(n)
    moved.current = true
    setStep(to)
    // Resume point. A failed write only means a reload restarts at the last saved step.
    db.kv.put({ key: STEP_KEY, value: to }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!moved.current) return
    window.scrollTo(0, 0)
    document.querySelector<HTMLElement>('main h1, h1')?.focus({ preventScroll: true })
  }, [step])

  const save = useCallback(async (patch: ProfilePatch) => {
    const next = await store.updateProfile(patch)
    setProfile(next)
    return next
  }, [])

  const { title, Component } = STEPS[step]

  return (
    <div className="onb">
      <PageHeader title={title} back={profile.onboardedAt !== null ? { to: '/', label: 'Home' } : undefined} />
      <ProgressSteps steps={STEP_NAMES} current={step} label="Setup progress" />
      <Component key={step} profile={profile} save={save} next={() => goTo(step + 1)} back={() => goTo(step - 1)} />
    </div>
  )
}
