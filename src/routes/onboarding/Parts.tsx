import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Banner, Button, cx } from '../../ui'
import type { Profile } from '../../types'

export type ProfilePatch = Partial<Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'sexProfile'>>

export interface StepProps {
  profile: Profile
  /** Saves to the store and updates the screen's copy of the profile. Throws on a store error. */
  save: (patch: ProfilePatch) => Promise<Profile>
  next: () => void
  back: () => void
}

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.'
}

/** Runs an async action once at a time and keeps its error for display. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  return { busy, error, run }
}

export interface StepNavProps {
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
  busy?: boolean
  children?: ReactNode
  error?: string | null
}

/** Back / Next row at the bottom of a step. */
export function StepNav({ onBack, onNext, nextLabel = 'Next', busy, children, error }: StepNavProps) {
  return (
    <div className="onb-nav">
      {error ? (
        <Banner tone="danger" live>
          {error}
        </Banner>
      ) : null}
      {children}
      <div className="onb-nav__row">
        {onBack ? (
          <Button variant="secondary" icon="chevron-left" onClick={onBack} disabled={busy}>
            Back
          </Button>
        ) : null}
        {onNext ? (
          <Button variant="primary" className="u-grow" onClick={onNext} loading={busy}>
            {nextLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export interface SegmentedProps<T extends string | number> {
  label?: string
  labelledBy?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}

/** Radio group drawn as a segmented control. Arrow keys move and select. */
export function Segmented<T extends string | number>({ label, labelledBy, value, options, onChange }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = options.findIndex((o) => o.value === value)
  const move = (to: number) => {
    const i = (to + options.length) % options.length
    onChange(options[i].value)
    refs.current[i]?.focus()
  }
  return (
    <div className="onb-seg" role="radiogroup" aria-label={label} aria-labelledby={labelledBy}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value || (index < 0 && i === 0) ? 0 : -1}
          className={cx('onb-seg__opt', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              move(i + 1)
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              move(i - 1)
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
