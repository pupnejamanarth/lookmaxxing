import { useEffect, useState } from 'react'
import { store } from '../store'
import type { WhitelistItem } from '../types'
import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, IconButton, PageHeader, Skeleton, Toggle, useLive } from '../ui'
import './whitelist/whitelist.css'
import { ItemSheet } from './whitelist/ItemSheet'
import { PatchTestPanel } from './whitelist/PatchTestPanel'
import { CATEGORY_LABEL, canToggleActive, describeError, patchBadge } from './whitelist/helpers'

type SheetState = { item: WhitelistItem | null } | null

export default function Whitelist() {
  const { value: items, loading, error } = useLive(() => store.listWhitelist(), [])
  const [sheet, setSheet] = useState<SheetState>(null)
  const [removing, setRemoving] = useState<WhitelistItem | null>(null)
  const [lastRemoving, setLastRemoving] = useState<WhitelistItem | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const add = (
    <Button variant="primary" icon="plus" onClick={() => setSheet({ item: null })}>
      Add
    </Button>
  )

  return (
    <div className="u-stack wl-page">
      <PageHeader title="My current stack" back={{ to: '/settings', label: 'Settings' }} actions={add} />
      <Banner tone="info">
        This list is the only set of products the app may ever mention. It starts empty. The app never suggests entries.
      </Banner>

      {error ? (
        <Banner tone="danger" live>
          The list could not be read from this device. Reload the page.
        </Banner>
      ) : loading && !items ? (
        <div className="u-stack u-stack--sm">
          <Skeleton height={96} />
          <Skeleton height={96} />
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState
          title="No products yet"
          icon="list"
          action={
            <Button variant="primary" icon="plus" onClick={() => setSheet({ item: null })}>
              Add a product
            </Button>
          }
        >
          Add only what you already use or want to trial. Until you do, the app mentions no products.
        </EmptyState>
      ) : (
        <ul className="wl-list">
          {items?.map((item) => (
            <li key={item.id}>
              <ItemCard item={item} now={now} onEdit={() => setSheet({ item })} onRemove={() => {
                  setLastRemoving(item)
                  setRemoving(item)
                }} />
            </li>
          ))}
        </ul>
      )}

      <ItemSheet open={sheet !== null} item={sheet?.item ?? null} onClose={() => setSheet(null)} />

      <ConfirmDialog
        open={removing !== null}
        title="Remove this product?"
        tone="danger"
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await store.removeWhitelistItem(removing.id)
          } catch (e) {
            throw new Error(describeError(e), { cause: e })
          }
          setRemoving(null)
        }}
      >
        <p>
          {lastRemoving?.name} will be removed from your list.
          {lastRemoving?.patchTest.status === 'failed'
            ? ' This also deletes the record of your reaction, so the product would no longer be excluded.'
            : ''}
        </p>
      </ConfirmDialog>
    </div>
  )
}

function ItemCard({ item, now, onEdit, onRemove }: { item: WhitelistItem; now: number; onEdit: () => void; onRemove: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const badge = patchBadge(item, now)
  const locked = !canToggleActive(item)

  async function toggle(active: boolean) {
    setError(null)
    try {
      await store.setWhitelistActive(item.id, active)
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <Card as="article" tone={item.patchTest.status === 'failed' ? 'danger' : 'default'}>
      <div className="wl-item__top">
        <div>
          <h3 className="wl-item__name">{item.name}</h3>
          <p className="wl-item__cat">{CATEGORY_LABEL[item.category]}</p>
        </div>
        <div className="wl-item__actions">
          <IconButton icon="edit" label={`Edit ${item.name}`} onClick={onEdit} />
          <IconButton icon="trash" label={`Remove ${item.name}`} onClick={onRemove} />
        </div>
      </div>
      {badge ? (
        <div className="wl-item__badges">
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
      ) : null}
      {item.notes ? <p className="wl-item__notes">{item.notes}</p> : null}
      <Toggle
        checked={item.active}
        onChange={toggle}
        disabled={locked}
        label="Active"
        hint={
          item.patchTest.status === 'failed'
            ? 'Excluded for good.'
            : locked
              ? 'Inactive until the patch test passes.'
              : item.active
                ? 'The app may mention this product.'
                : 'The app will not mention this product.'
        }
      />
      {error ? (
        <p className="wl-error" role="alert">
          {error}
        </p>
      ) : null}
      <PatchTestPanel item={item} now={now} />
    </Card>
  )
}
