import { useState, type FormEvent } from 'react'
import { store } from '../../store'
import type { ProductCategory, WhitelistItem } from '../../types'
import { Banner, Button, Field, Select, Sheet, TextArea, TextInput, Toggle } from '../../ui'
import { CATEGORY_OPTIONS, describeError, needsPatchTest } from './helpers'

const NAME_MAX = 80
const NOTES_MAX = 500

interface Props {
  open: boolean
  /** null = add a new product. */
  item: WhitelistItem | null
  onClose: () => void
}

export function ItemSheet({ open, item, onClose }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Edit product' : 'Add product'}>
      {/* Remount per open so the form starts from the item being edited. */}
      <ItemForm key={item?.id ?? 'new'} item={item} onClose={onClose} />
    </Sheet>
  )
}

function ItemForm({ item, onClose }: { item: WhitelistItem | null; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState<ProductCategory>(item?.category ?? 'cleanser')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [alreadyUsing, setAlreadyUsing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const nameError = trimmed.length === 0 ? 'Enter a name.' : trimmed.length > NAME_MAX ? `At most ${NAME_MAX} characters.` : null
  const notesError = notes.trim().length > NOTES_MAX ? `At most ${NOTES_MAX} characters.` : null
  const [touched, setTouched] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (nameError || notesError) return
    setBusy(true)
    setError(null)
    try {
      if (item) await store.updateWhitelistItem(item.id, { name: trimmed, category, notes })
      else await store.addWhitelistItem({ name: trimmed, category, notes, alreadyUsing })
      onClose()
    } catch (err) {
      setError(describeError(err))
      setBusy(false)
    }
  }

  const locked = item?.patchTest.status === 'failed'
  const trial = !item && !alreadyUsing && needsPatchTest(category)

  return (
    <form className="u-stack" onSubmit={submit} noValidate>
      {locked ? <Banner tone="info">A reaction was logged. The name and category are locked.</Banner> : null}
      <Field label="Name" required error={touched ? nameError : null}>
        <TextInput disabled={locked} value={name} onChange={setName} maxLength={NAME_MAX} placeholder="Name" autoComplete="off" data-autofocus />
      </Field>
      <Field label="Category">
        <Select disabled={locked} value={category} options={CATEGORY_OPTIONS} onChange={setCategory} />
      </Field>
      <Field label="Notes (optional)" error={touched ? notesError : null}>
        <TextArea value={notes} onChange={setNotes} rows={3} showCount maxLength={NOTES_MAX} placeholder="Notes" />
      </Field>
      {item ? null : (
        <>
          <Toggle
            checked={alreadyUsing}
            onChange={setAlreadyUsing}
            label="I already use this"
            hint={
              alreadyUsing
                ? 'Part of my current stack. Active now.'
                : 'A new product I want to trial.'
            }
          />
          {!alreadyUsing ? (
            <Banner tone="info">
              {needsPatchTest(category)
                ? 'It stays inactive until a 7 day patch test passes.'
                : 'No patch test applies to this category. It is active immediately.'}
            </Banner>
          ) : null}
        </>
      )}
      {error ? (
        <Banner tone="danger" live>
          {error}
        </Banner>
      ) : null}
      <div className="u-row">
        <Button type="submit" variant="primary" loading={busy}>
          {item ? 'Save changes' : trial ? 'Add as trial' : 'Add product'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
