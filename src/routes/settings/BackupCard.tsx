import { useState } from 'react'
import { db, store } from '../../store'
import { BackupError, exportBackup, validatePassphrase } from '../../store/backup'
import { Banner, Button, Card, Checkbox, Field, formatDateTime, useLive } from '../../ui'
import { backupErrorMessage, isShareCancel } from './helpers'
import PassphraseField from './PassphraseField'

async function deliver(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'application/octet-stream' })
  if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return 'shared'
    } catch (error) {
      if (isShareCancel(error)) return 'cancelled'
      // Share failed for another reason: fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'downloaded'
}

export default function BackupCard() {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const last = useLive(async () => {
    const row = await db.kv.get('lastBackupAt')
    return typeof row?.value === 'number' ? row.value : null
  })

  const check = validatePassphrase(pass)
  const mismatch = confirm.length > 0 && confirm !== pass
  const ready = check.ok && confirm === pass && !busy

  const run = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const { blob, filename, summary } = await exportBackup(pass)
      const how = await deliver(blob, filename)
      if (how === 'cancelled') {
        setError('Sharing was cancelled. No backup was saved.')
        return
      }
      const now = Date.now()
      await db.kv.put({ key: 'lastBackupAt', value: now })
      const rows = Object.values(summary.tables).reduce((a, b) => a + b, 0)
      await store.appendAudit('backup_exported', `Backup ${filename}: ${rows} records, ${summary.blobCount} files`)
      setDone(how === 'shared' ? 'Backup handed to the share sheet.' : 'Backup downloaded. Check your Downloads folder.')
      setPass('')
      setConfirm('')
    } catch (e) {
      setError(e instanceof BackupError ? backupErrorMessage(e) : 'The backup could not be made. Nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Backup" icon="backup" headingLevel={2}>
      <p>
        A backup is one encrypted file with all your data and photos. It is the only way to move data to another device or recover
        after a reset.
      </p>
      <p className="u-small u-dim">{last.value ? `Last backup: ${formatDateTime(last.value)}.` : 'No backup has been made yet.'}</p>
      <Banner tone="warn" title="Where you save it matters">
        Do not save the file in iCloud Drive, Google Photos or any synced folder. Keep it on a drive you control, offline if you can.
      </Banner>
      <Banner tone="danger" title="A lost passphrase cannot be recovered">
        The file is encrypted on this device. There is no reset, no hint and no copy of the passphrase anywhere. If you lose it, the
        backup is unreadable.
      </Banner>

      <form
        className="st-pass"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) void run()
        }}
      >
        <Field
          label="Passphrase"
          hint="At least 12 characters. A few unrelated words work well."
          error={pass.length > 0 && !check.ok ? check.reason : undefined}
        >
          <PassphraseField value={pass} onChange={setPass} visible={show} autoComplete="new-password" />
        </Field>
        <Field label="Repeat passphrase" error={mismatch ? 'The passphrases do not match.' : undefined}>
          <PassphraseField value={confirm} onChange={setConfirm} visible={show} autoComplete="new-password" />
        </Field>
        <p className="u-small" aria-live="polite">
          {pass.length === 0 ? '' : check.ok ? <span className="st-ok">Passphrase accepted.</span> : null}
        </p>
        <Checkbox checked={show} onChange={setShow} label="Show passphrase" />
        {error ? (
          <Banner tone="danger" live>
            {error}
          </Banner>
        ) : null}
        {done ? (
          <Banner tone="info" live>
            {done}
          </Banner>
        ) : null}
        <Button type="submit" variant="primary" icon="download" loading={busy} disabled={!ready && !busy} fullWidth>
          {busy ? 'Encrypting' : 'Export encrypted backup'}
        </Button>
      </form>
    </Card>
  )
}
