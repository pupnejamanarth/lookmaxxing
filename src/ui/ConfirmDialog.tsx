import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Banner } from './Banner'
import { Button } from './Button'
import { Field, TextInput } from './Field'
import { Sheet } from './Sheet'

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  /** What will happen, in plain words. Say what cannot be undone. */
  children?: ReactNode
  /** Default "Confirm". Name the action: "Delete all data". */
  confirmLabel?: string
  cancelLabel?: string
  /** "danger" makes the confirm button red. */
  tone?: 'default' | 'danger'
  /** When set, the confirm button stays disabled until the person types this word (case-insensitive). */
  confirmWord?: string
  /** May be async. While it runs both buttons are locked. If it throws, the message shows in the dialog. The caller closes the dialog by setting `open` false. */
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

function ConfirmBody({
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  confirmWord,
  onConfirm,
  onCancel,
}: Omit<ConfirmDialogProps, 'open'>) {
  const formId = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = confirmWord === undefined || typed.trim().toLowerCase() === confirmWord.trim().toLowerCase()

  const run = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      title={title}
      dismissible={!busy}
      onClose={onCancel}
      footer={
        <div className="ui-confirm__actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={!matches}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <form id={formId} className="ui-confirm" onSubmit={run}>
        {children ? <div className="ui-confirm__message">{children}</div> : null}
        {confirmWord !== undefined ? (
          <Field label={`Type ${confirmWord} to confirm`}>
            <TextInput value={typed} onChange={setTyped} data-autofocus autoCapitalize="characters" />
          </Field>
        ) : null}
        {error ? (
          <Banner tone="danger" live>
            {error}
          </Banner>
        ) : null}
      </form>
    </Sheet>
  )
}

/** Confirmation sheet with Cancel and a named confirm action; optional type-to-confirm word for irreversible steps. */
export function ConfirmDialog({ open, ...rest }: ConfirmDialogProps) {
  return open ? <ConfirmBody {...rest} /> : null
}
