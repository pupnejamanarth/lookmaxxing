import { useState } from 'react'
import { store } from '../../store'
import { Badge, Banner, Button, Card, Skeleton, useLive } from '../../ui'
import { formatBytes, formatPercent } from './helpers'

export default function StorageCard() {
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const est = useLive(() => store.getStorageEstimate(), [tick])

  const request = async () => {
    setBusy(true)
    setNote(null)
    try {
      const granted = await store.requestPersistentStorage()
      setNote(
        granted
          ? 'Persistent storage granted.'
          : 'Not granted. The browser decided. On iPhone, adding the app to the Home Screen is what protects the data.',
      )
      setTick((n) => n + 1)
    } catch {
      setNote('The request failed.')
    } finally {
      setBusy(false)
    }
  }

  const v = est.value
  return (
    <Card title="Storage" icon="shield" headingLevel={2}>
      {!v ? (
        <Skeleton height="4rem" />
      ) : (
        <dl className="st-kv">
          <dt>Used</dt>
          <dd>{formatBytes(v.usage)}</dd>
          <dt>Available to the app</dt>
          <dd>{formatBytes(v.quota)}</dd>
          <dt>Share used</dt>
          <dd>{formatPercent(v.usage, v.quota)}</dd>
          <dt>Persistent</dt>
          <dd>
            {v.persisted === null ? (
              <Badge>Unknown</Badge>
            ) : v.persisted ? (
              <Badge tone="green">Yes</Badge>
            ) : (
              <Badge tone="amber">No</Badge>
            )}
          </dd>
        </dl>
      )}
      <p className="u-small u-dim">
        Persistent storage asks the browser not to clear your data when space runs low. The usage figure is an estimate from the browser.
      </p>
      {note ? (
        <Banner tone="info" live>
          {note}
        </Banner>
      ) : null}
      {v?.persisted === true ? null : (
        <Button onClick={() => void request()} loading={busy} fullWidth>
          Request persistent storage
        </Button>
      )}
    </Card>
  )
}
