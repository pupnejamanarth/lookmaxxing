import { useState } from 'react'
import { store } from '../../store'
import type { PatchTestResult, WhitelistItem } from '../../types'
import { Button, ConfirmDialog, Field, Select, TextInput, formatDateTime, plural } from '../../ui'
import { PATCH_TEST_DAYS, RESULT_LABEL, canMarkPassed, describeError, hasReaction, patchDaysRemaining, patchSite } from './helpers'

const RESULT_OPTIONS: { value: PatchTestResult; label: string }[] = [
  { value: 'no_reaction', label: RESULT_LABEL.no_reaction },
  { value: 'mild_irritation', label: RESULT_LABEL.mild_irritation },
  { value: 'reaction', label: 'Reaction (redness, itching, swelling or burning)' },
]

function Protocol({ site }: { site: string }) {
  return (
    <>
      <p>
        Put a pea-sized amount on the {site}. Do it twice a day for {PATCH_TEST_DAYS} days.
      </p>
      <ul>
        <li>Stop at any redness, itching, swelling or burning.</li>
        <li>Never on broken skin.</li>
        <li>This is a precaution. It is not medical advice. See a doctor for a strong or lasting reaction.</li>
      </ul>
    </>
  )
}

export function PatchTestPanel({ item, now }: { item: WhitelistItem; now: number }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)
  const [result, setResult] = useState<PatchTestResult>('no_reaction')
  const [note, setNote] = useState('')
  const [confirmReaction, setConfirmReaction] = useState(false)

  const { status, entries } = item.patchTest
  if (status === 'not_needed' || status === 'passed') return null

  const site = patchSite(item.category)

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (e) {
      setError(describeError(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const ok = await run(() => store.logPatchTest(item.id, result, note))
    if (ok) {
      setLogging(false)
      setNote('')
      setResult('no_reaction')
    }
  }

  if (status === 'failed' || hasReaction(item)) {
    return (
      <section className="wl-patch wl-patch--failed" aria-label="Patch test">
        <h4 className="wl-patch__title">Excluded for good</h4>
        <p>A reaction was logged. The app will never use or mention this product again. This cannot be undone.</p>
        {entries.length > 0 ? <LogList entries={entries} /> : null}
      </section>
    )
  }

  if (status === 'not_started') {
    return (
      <section className="wl-patch" aria-label="Patch test">
        <h4 className="wl-patch__title">Patch test required</h4>
        <p>This product stays inactive until the test passes.</p>
        <Protocol site={site} />
        <div className="wl-patch__buttons">
          <Button variant="primary" loading={busy} onClick={() => run(() => store.startPatchTest(item.id))}>
            Start patch test
          </Button>
        </div>
        {error ? (
          <p className="wl-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    )
  }

  const left = patchDaysRemaining(item, now)
  const canPass = canMarkPassed(item, now)
  return (
    <section className="wl-patch" aria-label="Patch test">
      <h4 className="wl-patch__title">Patch test running</h4>
      <p>
        {item.patchTest.startedAt !== null ? `Started ${formatDateTime(item.patchTest.startedAt)}. ` : ''}
        {left === 0 ? 'The 7 days are done.' : `${left} ${plural(left, 'day')} remaining.`}
      </p>
      <Protocol site={site} />
      {entries.length > 0 ? <LogList entries={entries} /> : null}

      {logging ? (
        <div className="u-stack u-stack--sm">
          <Field label="Today's result">
            <Select value={result} options={RESULT_OPTIONS} onChange={setResult} />
          </Field>
          <Field label="Note (optional)">
            <TextInput value={note} onChange={setNote} maxLength={500} placeholder="Note" />
          </Field>
          <div className="wl-patch__buttons">
            <Button
              variant={result === 'reaction' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => (result === 'reaction' ? setConfirmReaction(true) : save())}
            >
              Save result
            </Button>
            <Button variant="ghost" onClick={() => setLogging(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="wl-patch__buttons">
          <Button onClick={() => setLogging(true)}>Log today&apos;s result</Button>
          <Button variant="primary" disabled={!canPass} loading={busy} onClick={() => run(() => store.passPatchTest(item.id))}>
            Mark passed
          </Button>
        </div>
      )}
      {!canPass && !logging ? (
        <p className="u-dim u-small">Mark passed unlocks after {PATCH_TEST_DAYS} days with no reaction.</p>
      ) : null}
      {error ? (
        <p className="wl-error" role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmReaction}
        title="Log a reaction?"
        tone="danger"
        confirmLabel="Log reaction"
        onCancel={() => setConfirmReaction(false)}
        onConfirm={async () => {
          await store.logPatchTest(item.id, 'reaction', note)
          setConfirmReaction(false)
          setLogging(false)
        }}
      >
        <p>This product will be excluded for good. It will be deactivated and cannot be tested or activated again.</p>
      </ConfirmDialog>
    </section>
  )
}

function LogList({ entries }: { entries: WhitelistItem['patchTest']['entries'] }) {
  return (
    <ul className="wl-patch__log" aria-label="Logged results">
      {entries.map((e, i) => (
        <li key={`${e.ts}-${i}`}>
          {formatDateTime(e.ts)}: {RESULT_LABEL[e.result]}
          {e.note ? ` – ${e.note}` : ''}
        </li>
      ))}
    </ul>
  )
}
