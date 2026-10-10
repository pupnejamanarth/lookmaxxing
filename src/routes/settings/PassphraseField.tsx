import { useFieldControl } from '../../ui'

interface Props {
  value: string
  onChange: (value: string) => void
  visible: boolean
  autoComplete: 'new-password' | 'current-password'
}

/** Password box that works inside a Field. The passphrase is never stored anywhere but this state. */
export default function PassphraseField({ value, onChange, visible, autoComplete }: Props) {
  const control = useFieldControl()
  return (
    <input
      {...control}
      className="ui-input"
      type={visible ? 'text' : 'password'}
      autoComplete={autoComplete}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
