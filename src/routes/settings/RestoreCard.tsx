import { Fragment, useEffect, useRef, useState } from 'react'
import { db } from '../../store'
import { type BackupSummary, inspectBackup, restoreBackup } from '../../store/backup'
import { Banner, Button, Card, Checkbox, ConfirmDialog, Field, formatDateTime, plural, useFieldControl } from '../../ui'
import { backupErrorMessage, formatBytes, tableLabel } from './helpers'
import PassphraseField from './PassphraseField'

function FileField({ onPick }: { onPick: (file: File | null) => void }) {
  const control = useFieldControl()
  return <input {...control} className="st-file" type="file" accept=".lmxbackup" onChange={(event) => onPick(event.target.files?.[0] ?? null)} />
}

export default function RestoreCard() {
  const [file, setFile] = useState<File | null>(null)
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [confirming, setConfirming] = useState(false)

  const feedbackRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (summary) summaryRef.current?.focus()
    else if (error) feedbackRef.current?.focus()
  }, [summary, error])

  const reset = () => {
    setSummary(null)
    setError(null)
  }

  const inspect = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      setSummary(await inspectBackup(file, pass))
    } catch (e) {
      setError(backupErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    if (!file) return
    try {
      await restoreBackup(file, pass)
    } catch (e) {
      throw new Error(backupErrorMessage(e), { cause: e })
    }
    // Data is already replaced here: a bookkeeping failure must not stop the reload.
    try {
      await db.kv.put({ key: 'lastRestoreAt', value: Date.now() })
    } catch {
      // ignored on purpose
    }
    window.location.reload()
  }

  const rows = summary ? Object.entries(summary.tables) : []

  return (
    <Card title="Restore" icon="upload" headingLevel={2}>
      <p>Restoring replaces everything on this device with the contents of the backup file. Current data is not merged.</p>
      <form
        className="st-pass"
        onSubmit={(event) => {
          event.preventDefault()
          if (file && pass && !busy) void inspect()
        }}
      >
        <Field label="Backup file" hint="A .lmxbackup file made by this app.">
          <FileField
            onPick={(f) => {
              setFile(f)
              reset()
            }}
          />
        </Field>
        {file ? (
          <p className="u-small u-dim st-fileinfo">
            Selected: {file.name} ({formatBytes(file.size)})
          </p>
        ) : null}
        <Field label="Passphrase">
          <PassphraseField
            value={pass}
            onChange={(v) => {
              setPass(v)
              reset()
            }}
            visible={show}
            autoComplete="current-password"
          />
        </Field>
        <Checkbox checked={show} onChange={setShow} label="Show passphrase" />
        <div ref={feedbackRef} tabIndex={-1} className="st-focus">
          {error ? (
            <Banner tone="danger" live>
              {error}
            </Banner>
          ) : null}
        </div>
        <Button type="submit" icon="search" loading={busy} disabled={(!file || !pass) && !busy} fullWidth>
          {busy ? 'Decrypting' : 'Check backup'}
        </Button>
      </form>

      {summary ? (
        <div className="u-stack st-focus" ref={summaryRef} tabIndex={-1}>
          <h3>This backup</h3>
          <dl className="st-kv">
            <dt>Created</dt>
            <dd>{formatDateTime(summary.createdAt)}</dd>
            <dt>App version</dt>
            <dd>{summary.appVersion}</dd>
            {rows.map(([name, count]) => (
              <Fragment key={name}>
                <dt>{tableLabel(name)}</dt>
                <dd>{count}</dd>
              </Fragment>
            ))}
            <dt>Photos and files</dt>
            <dd>
              {summary.blobCount} ({formatBytes(summary.blobBytes)})
            </dd>
          </dl>
          {summary.ignoredTables && summary.ignoredTables.length > 0 ? (
            <p className="u-small u-dim">
              {summary.ignoredTables.length} {plural(summary.ignoredTables.length, 'table')} in the file are unknown to this version and
              will be skipped.
            </p>
          ) : null}
          <Banner tone="warn" title="This cannot be undone">
            All data now on this device will be deleted and replaced. Export a backup first if you want to keep it.
          </Banner>
          <Button variant="danger" onClick={() => setConfirming(true)} fullWidth>
            Replace everything on this device
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Replace everything on this device?"
        confirmLabel="Replace everything on this device"
        tone="danger"
        onConfirm={restore}
        onCancel={() => setConfirming(false)}
      >
        <p>
          The backup from {summary ? formatDateTime(summary.createdAt) : 'the selected file'} will replace all data here. The app reloads
          when it is done. If the restore fails, nothing is changed.
        </p>
      </ConfirmDialog>
    </Card>
  )
}
