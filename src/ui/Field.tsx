import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

interface FieldContextValue {
  id: string
  describedBy: string | undefined
  invalid: boolean
  required: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

export interface FieldProps {
  label: ReactNode
  /** Help text under the label. Linked to the control with aria-describedby. */
  hint?: ReactNode
  /** Error text under the control. Marks the control invalid and is announced. */
  error?: ReactNode
  required?: boolean
  className?: string
  /** Exactly one control: TextInput, TextArea, NumberInput or Select. */
  children: ReactNode
}

/** Label + hint + error around one control. Wires htmlFor, aria-describedby, aria-invalid and aria-required. */
export function Field({ label, hint, error, required = false, className, children }: FieldProps) {
  const uid = useId()
  const id = `${uid}-control`
  const hintId = `${uid}-hint`
  const errorId = `${uid}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cx('ui-field', className)}>
        <label className="ui-field__label" htmlFor={id}>
          {label}
          {required ? <span className="u-sr-only"> (required)</span> : null}
        </label>
        {hint ? (
          <p className="ui-field__hint" id={hintId}>
            {hint}
          </p>
        ) : null}
        {children}
        {error ? (
          <p className="ui-field__error" id={errorId} role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

interface ControlAria {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: ComponentProps<'input'>['aria-invalid']
  required?: boolean
}

/** Merges a control's own id/aria props with the surrounding Field. Exported for custom controls. */
export function useFieldControl(own: ControlAria = {}) {
  const field = useContext(FieldContext)
  return {
    id: own.id ?? field?.id,
    'aria-describedby': [own['aria-describedby'], field?.describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': own['aria-invalid'] ?? (field?.invalid ? true : undefined),
    'aria-required': own.required || field?.required ? true : undefined,
  }
}

// ───────────────────────────── TextInput ─────────────────────────────

export interface TextInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'className'> {
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'search'
  className?: string
}

/** Single-line text input (16 px, so iOS does not zoom). Put it inside a Field, or pass aria-label. */
export function TextInput({ value, onChange, type = 'text', className, ...rest }: TextInputProps) {
  const control = useFieldControl(rest)
  return (
    <input
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      {...rest}
      {...control}
      type={type}
      className={cx('ui-input', className)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

// ───────────────────────────── TextArea ─────────────────────────────

export interface TextAreaProps extends Omit<ComponentProps<'textarea'>, 'value' | 'onChange' | 'className'> {
  value: string
  onChange: (value: string) => void
  /** Shows "12/500" under the box when `maxLength` is set. */
  showCount?: boolean
  className?: string
}

/** Multi-line text input. Set `maxLength` and `showCount` for a limited field. */
export function TextArea({ value, onChange, showCount = false, className, rows = 3, ...rest }: TextAreaProps) {
  const control = useFieldControl(rest)
  return (
    <div className="ui-textarea">
      <textarea
        {...rest}
        {...control}
        rows={rows}
        className={cx('ui-input', 'ui-input--area', className)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {showCount && rest.maxLength ? (
        <p className="ui-textarea__count" aria-hidden="true">
          {value.length}/{rest.maxLength}
        </p>
      ) : null}
    </div>
  )
}

// ───────────────────────────── NumberInput ─────────────────────────────

/** undefined = not a number (empty is null). */
function parseNumber(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export interface NumberInputProps
  extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'className'> {
  /** null = empty. */
  value: number | null
  /** Called with a number, or null when the box is empty or not a number. Never clamps what the user types. */
  onChange: (value: number | null) => void
  /** Used for the arrow keys only. Validate typed values yourself and show the error in the Field. */
  min?: number
  max?: number
  step?: number
  /** Suffix shown inside the box, e.g. "cm". */
  unit?: string
  className?: string
}

/** Numeric text input with a decimal keypad on phones. Accepts "." or "," as the decimal mark. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  className,
  onBlur,
  onKeyDown,
  ...rest
}: NumberInputProps) {
  const control = useFieldControl(rest)
  const [text, setText] = useState(() => (value === null ? '' : String(value)))

  // The parent changed the value to something the text no longer shows (a reset, a loaded profile).
  useEffect(() => {
    setText((current) => {
      const parsed = parseNumber(current) ?? null
      return parsed === value ? current : value === null ? '' : String(value)
    })
  }, [value])

  const commit = (raw: string) => {
    setText(raw)
    onChange(parseNumber(raw) ?? null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const base = parseNumber(text) ?? min ?? 0
    let next = base + (event.key === 'ArrowUp' ? step : -step)
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    commit(String(Math.round(next * 1e6) / 1e6))
  }

  const input = (
    <input
      autoComplete="off"
      {...rest}
      {...control}
      type="text"
      inputMode={Number.isInteger(step) ? 'numeric' : 'decimal'}
      className={cx('ui-input', unit && 'ui-input--has-unit', className)}
      value={text}
      onChange={(event) => commit(event.target.value)}
      onBlur={(event) => {
        onBlur?.(event)
        const parsed = parseNumber(text)
        if (parsed !== undefined) setText(parsed === null ? '' : String(parsed))
      }}
      onKeyDown={handleKeyDown}
    />
  )
  if (!unit) return input
  return (
    <div className="ui-input-wrap">
      {input}
      <span className="ui-input-wrap__unit" aria-hidden="true">
        {unit}
      </span>
    </div>
  )
}

// ───────────────────────────── Select ─────────────────────────────

export interface SelectOption<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectProps<T extends string | number>
  extends Omit<ComponentProps<'select'>, 'value' | 'onChange' | 'children' | 'className'> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  className?: string
}

/** Native select (best picker on phones) with a custom arrow. Values may be strings or numbers. */
export function Select<T extends string | number>({ value, options, onChange, className, ...rest }: SelectProps<T>) {
  const control = useFieldControl(rest)
  return (
    <div className="ui-select">
      <select
        {...rest}
        {...control}
        className={cx('ui-input', 'ui-input--select', className)}
        value={String(value)}
        onChange={(event) => {
          const picked = options.find((option) => String(option.value) === event.target.value)
          if (picked) onChange(picked.value)
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={18} className="ui-select__icon" />
    </div>
  )
}
