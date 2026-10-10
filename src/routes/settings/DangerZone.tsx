import { useState } from 'react'
import { store } from '../../store'
import { Button, Card, ConfirmDialog } from '../../ui'

async function clearOfflineCopies(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // Data is already gone; a stale offline copy holds no user data.
  }
}

export default function DangerZone() {
  const [open, setOpen] = useState(false)

  const wipe = async () => {
    await store.deleteAllData()
    await clearOfflineCopies()
    window.location.hash = '#/'
    window.location.reload()
  }

  return (
    <Card title="Danger zone" icon="trash" headingLevel={2} tone="danger">
      <p>
        Deletes every profile value, whitelist item, photo, measurement and log row on this device, and removes the offline copy of the
        app. A backup file you already exported is not touched.
      </p>
      <Button variant="danger" icon="trash" onClick={() => setOpen(true)} fullWidth>
        Delete all data on this device
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete all data on this device?"
        confirmLabel="Delete everything"
        tone="danger"
        confirmWord="DELETE"
        onConfirm={wipe}
        onCancel={() => setOpen(false)}
      >
        <p>This cannot be undone. Export a backup first if you want to keep anything.</p>
      </ConfirmDialog>
    </Card>
  )
}
