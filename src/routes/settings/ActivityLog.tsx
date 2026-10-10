import { store } from '../../store'
import { Card, Skeleton, formatDateTime, useLive } from '../../ui'

export default function ActivityLog() {
  const log = useLive(() => store.listAudit(50))
  return (
    <Card title="Activity log" icon="list" headingLevel={2}>
      <p className="u-small u-dim">The last 50 actions the app recorded on this device. Newest first.</p>
      {log.loading && !log.value ? (
        <Skeleton height="6rem" />
      ) : log.error ? (
        <p className="st-bad">The log could not be read.</p>
      ) : log.value && log.value.length > 0 ? (
        <ul className="st-log" tabIndex={0} aria-label="Activity log">
          {log.value.map((row) => (
            <li key={row.id ?? `${row.ts}-${row.event}`}>
              <span className="st-log__time">{formatDateTime(row.ts)}</span>
              <span className="st-log__event">{row.event.replaceAll('_', ' ')}</span>
              {row.detail ? <span className="st-log__detail">{row.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nothing recorded yet.</p>
      )}
    </Card>
  )
}
