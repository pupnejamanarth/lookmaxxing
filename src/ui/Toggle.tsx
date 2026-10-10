import { useId, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible label. The whole row is the tap target. */
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
}

/** On/off switch (role="switch"). Use for settings that apply at once; use Checkbox for lists you confirm. */
export function Toggle({ checked, onChange, label, hint, disabled = false, id, className }: ToggleProps) {
  const uid = useId()
  const labelId = `${uid}-label`
  const hintId = `${uid}-hint`
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      disabled={disabled}
      className={cx('ui-toggle', className)}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-toggle__text">
        <span className="ui-toggle__label" id={labelId}>
          {label}
        </span>
        {hint ? (
          <span className="ui-toggle__hint" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
      <span className="ui-toggle__track" aria-hidden="true">
        <span className="ui-toggle__thumb" />
      </span>
    </button>
  )
}

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
}

/** Checkbox row (native input, custom box). The whole row is the tap target. */
export function Checkbox({ checked, onChange, label, hint, disabled = false, id, className }: CheckboxProps) {
  const uid = useId()
  const hintId = `${uid}-hint`
  return (
    <label className={cx('ui-check', disabled && 'is-disabled', className)}>
      <input
        id={id}
        type="checkbox"
        className="ui-check__input"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-check__box" aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
      <span className="ui-check__text">
        <span className="ui-check__label">{label}</span>
        {hint ? (
          <span className="ui-check__hint" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  )
}
