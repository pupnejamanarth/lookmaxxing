import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Button'
import { cx } from './cx'

// ───────────────────────────── scroll lock + inert background ─────────────────────────────

let lockCount = 0
let savedHtmlOverflow = ''
let savedBodyOverflow = ''

function lockPage(): void {
  if (lockCount++ > 0) return
  savedHtmlOverflow = document.documentElement.style.overflow
  savedBodyOverflow = document.body.style.overflow
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  // Everything behind the sheet becomes unreachable for keyboard, touch exploration and screen readers.
  document.getElementById('root')?.setAttribute('inert', '')
}

function unlockPage(): void {
  if (--lockCount > 0) return
  lockCount = 0
  document.documentElement.style.overflow = savedHtmlOverflow
  document.body.style.overflow = savedBodyOverflow
  document.getElementById('root')?.removeAttribute('inert')
}

/** Escape closes only the sheet on top. */
const stack: symbol[] = []

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface SheetProps {
  open: boolean
  /** Called for Escape, the close button and a tap on the backdrop (unless `dismissible` is false). */
  onClose: () => void
  title: ReactNode
  /** One sentence under the title. Linked with aria-describedby. */
  description?: ReactNode
  children?: ReactNode
  /** Sticky area under the content, for the action buttons. */
  footer?: ReactNode
  /** false removes Escape, backdrop tap and the close button (use while saving). Default true. */
  dismissible?: boolean
  className?: string
}

interface PanelProps extends Omit<SheetProps, 'open'> {
  dismissible: boolean
}

function SheetPanel({ onClose, title, description, children, footer, dismissible, className }: PanelProps) {
  const uid = useId()
  const titleId = `${uid}-title`
  const descriptionId = `${uid}-description`
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  closeRef.current = onClose
  dismissibleRef.current = dismissible

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const token = Symbol('sheet')
    stack.push(token)
    lockPage()

    const panel = panelRef.current
    const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel
    target?.focus({ preventScroll: true })

    const onDocumentKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || stack[stack.length - 1] !== token || !dismissibleRef.current) return
      event.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onDocumentKey)

    return () => {
      document.removeEventListener('keydown', onDocumentKey)
      const at = stack.indexOf(token)
      if (at >= 0) stack.splice(at, 1)
      unlockPage()
      // Back to where the person was, once the page is no longer inert.
      previous?.focus({ preventScroll: true })
    }
  }, [])

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.getClientRects().length > 0)
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (!first || !last) {
      event.preventDefault()
      panel.focus()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissible && event.target === event.currentTarget) onClose()
  }

  return (
    <div className="ui-sheet-root" onClick={onBackdrop}>
      <div
        ref={panelRef}
        className={cx('ui-sheet', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="ui-sheet__head">
          <h2 className="ui-sheet__title" id={titleId}>
            {title}
          </h2>
          {dismissible ? <IconButton icon="close" label="Close" variant="ghost" onClick={onClose} /> : null}
        </div>
        <div className="ui-sheet__body">
          {description ? (
            <p className="ui-sheet__description" id={descriptionId}>
              {description}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? <div className="ui-sheet__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

/**
 * Bottom-sheet modal (centred card on wide screens). Traps focus, closes on Escape, locks page scroll,
 * makes the page behind it inert and returns focus to the trigger on close. Content is mounted only while open.
 * Give one element `data-autofocus` to choose where focus starts; otherwise it starts on the dialog itself.
 */
export function Sheet({ open, dismissible = true, ...panel }: SheetProps) {
  if (!open) return null
  return createPortal(<SheetPanel {...panel} dismissible={dismissible} />, document.body)
}
