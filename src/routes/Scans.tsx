import { useState } from 'react'
import { Link } from '../router'
import { db, scans } from '../store'
import type { MetricScore } from '../domain/types'
import { Badge, Banner, ConfirmDialog, EmptyState, IconButton, LinkButton, PageHeader, Skeleton, useLive, type BadgeTone } from '../ui'
import { COPY } from './report/copy'
import { summariseScan, type HistoryRow } from './report/helpers'
import './report/report.css'

const STATUS_TONE: Record<NonNullable<HistoryRow['status']>, BadgeTone> = {
  FINAL: 'green',
  PROVISIONAL: 'amber',
  NOT_AVAILABLE: 'grey',
}

/** One row per scan. Reads the score and overall rows only: the photos are not loaded for a list. */
async function loadHistory(): Promise<HistoryRow[]> {
  const list = await scans.listScans()
  if (list.length === 0) return []
  const ids = list.map((s) => s.id)
  const [overalls, scoreRows] = await Promise.all([db.overall.bulkGet(ids), db.scores.where('scanId').anyOf(ids).toArray()])
  const byScan = new Map<string, MetricScore[]>()
  for (const row of scoreRows) {
    const bucket = byScan.get(row.scanId)
    if (bucket) bucket.push(row)
    else byScan.set(row.scanId, [row])
  }
  return list.map((scan, i) => summariseScan(scan, overalls[i], byScan.get(scan.id) ?? []))
}

function ScanItem({ row, onDelete }: { row: HistoryRow; onDelete: (row: HistoryRow) => void }) {
  return (
    <li className="rp-row">
      <Link to={`/scans/${row.id}`} className="rp-row__link">
        <span className="rp-row__date u-num">{row.dateText}</span>
        <span className="rp-row__kind">
          {row.kindLabel}
          {row.status && row.status !== 'NOT_AVAILABLE' ? <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge> : null}
        </span>
        <span className="rp-row__status">{row.statusText}</span>
        <span className="rp-row__meta u-dim u-small u-num">
          {row.coverageText} · {row.countsText}
        </span>
      </Link>
      <IconButton icon="trash" label={`Delete the scan from ${row.dateText}`} onClick={() => onDelete(row)} />
    </li>
  )
}

/** #/scans: the scans stored on this device, newest first. */
export default function Scans() {
  const { value: rows, loading, error } = useLive(loadHistory, [])
  const [pending, setPending] = useState<HistoryRow | null>(null)

  const header = (
    <PageHeader
      title={COPY.historyTitle}
      subtitle={COPY.historySubtitle}
      actions={
        rows && rows.length > 0 ? (
          <LinkButton to="/scan" variant="primary" size="sm" icon="camera">
            {COPY.historyNewScan}
          </LinkButton>
        ) : null
      }
    />
  )

  if (error) {
    return (
      <div className="u-stack u-stack--lg">
        {header}
        <Banner tone="danger" title={COPY.historyLoadError} live>
          {error.message}
        </Banner>
      </div>
    )
  }

  if (loading && rows === undefined) {
    return (
      <div className="u-stack u-stack--lg" aria-busy="true">
        {header}
        <div className="u-stack">
          <Skeleton height={96} />
          <Skeleton height={96} />
        </div>
      </div>
    )
  }

  return (
    <div className="u-stack u-stack--lg rp">
      {header}
      {!rows || rows.length === 0 ? (
        <EmptyState
          title={COPY.historyEmptyTitle}
          icon="camera"
          action={
            <LinkButton to="/scan" variant="primary">
              {COPY.historyEmptyAction}
            </LinkButton>
          }
        >
          {COPY.historyEmptyText}
        </EmptyState>
      ) : (
        <ul className="rp-rows" aria-label="Stored scans">
          {rows.map((row) => (
            <ScanItem key={row.id} row={row} onDelete={setPending} />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        tone="danger"
        title={pending ? `Delete the scan from ${pending.dateText}?` : COPY.historyDeleteTitle}
        confirmLabel={COPY.deleteConfirm}
        onConfirm={async () => {
          if (!pending) return
          await scans.deleteScan(pending.id)
          setPending(null)
        }}
        onCancel={() => setPending(null)}
      >
        <p>{COPY.deleteBody}</p>
      </ConfirmDialog>
    </div>
  )
}
