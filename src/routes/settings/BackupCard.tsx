import { useState } from 'react'
import { db, store } from '../../store'
import { type BackupSummary, BackupError, exportBackup, validatePassphrase } from '../../store/backup'
import { Banner, Button, Card, Checkbox, Field, formatDateTime, useLive } from '../../ui'
import { backupErrorMessage, isShareCancel } from './helpers'
import PassphraseField from './PassphraseField'

function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] })
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Returns false when the log entries could not be written. The file itself is already delivered. */
async function bookkeep(filename: string, summary: BackupSummary): Promise<boolean> {
  try {
    await db.kv.put({ key: 'lastBackupAt', value: Date.now() })
    const rows = Object.values(summary.tables).reduce((a, b) => a + b, 0)
    await store.appendAudit('backup_exported', `Backup ${filename}: ${rows} records, ${summary.blobCount} files`)
    return true
  } catch {
    return false
  }
}

interface Pending {
  file: File
  summary: BackupSummary
}

export default function BackupCard() {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [sharing, setSharing] = useState(false)
  const last = useLive(async () => {
    const row = await db.kv.get('lastBackupAt')
    return typeof row?.value === 'number' ? row.value : null
  })

  const check = validatePassphrase(pass)
  const mismatch = confirm.length > 0 && confirm !== pass
  const ready = check.ok && confirm === pass && !busy

  const finish = async (filename: string, summary: BackupSummary, message: string) => {
    const logged = await bookkeep(filename, summary)
    setDone(logged ? message : 'Backup saved, but the log entry could not be written.')
    setPending(null)
    setPass('')
    setConfirm('')
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    setPending(null)
    try {
      const { blob, filename, summary } = await exportBackup(pass)
      const file = new File([blob], filename, { type: 'application/octet-stream' })
      if (canShareFile(file)) {
        // The slow key derivation used up the tap, so sharing needs a fresh one.
        setPending({ file, summary })
        setPass('')
        setConfirm('')
      } else {
        download(blob, filename)
        await finish(filename, summary, 'Backup downloaded. Check your Downloads folder.')
      }
    } catch (e) {
      setError(e instanceof BackupError ? backupErrorMessage(e) : 'The backup could not be made. Nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    if (!pending) return
    setSharing(true)
    setError(null)
    try {
      await navigator.share({ files: [pending.file], title: pending.file.name })
    } catch (e) {
      setSharing(false)
      setError(
        isShareCancel(e)
          ? 'Sharing was cancelled. The backup is still ready to share.'
          : 'Sharing failed. The backup is still ready to share.',
      )
      return
    }
    setSharing(false)
    await finish(pending.file.name, pending.summary, 'Backup handed to the share sheet.')
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
        {pending ? (
          <Banner tone="info" title="Backup is ready">
            The file is encrypted. Share it to save it. Choose Save to Files, in a folder that is not synced.
          </Banner>
        ) : null}
        {done ? (
          <Banner tone="info" live>
            {done}
          </Banner>
        ) : null}
        {pending ? (
          <Button variant="primary" icon="upload" loading={sharing} onClick={() => void share()} fullWidth>
            Share backup file
          </Button>
        ) : null}
        <Button type="submit" variant={pending ? 'secondary' : 'primary'} icon="download" loading={busy} disabled={!ready && !busy} fullWidth>
          {busy ? 'Encrypting' : pending ? 'Make another backup' : 'Export encrypted backup'}
        </Button>
        {!ready && !busy ? (
          <p className="u-small u-dim">Enter and repeat a passphrase of at least 12 characters to enable export.</p>
        ) : null}
      </form>
    </Card>
  )
}
