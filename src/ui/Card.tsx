import { createElement, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export type CardTone = 'default' | 'warn' | 'danger' | 'accent'

export interface CardProps {
  /** Heading shown at the top. Omit for a bare surface. */
  title?: ReactNode
  /** Decorative icon before the title. */
  icon?: IconName
  /** Element for the heading. Default 2. */
  headingLevel?: 2 | 3 | 4
  /** Content aligned to the right of the title (a Badge, for example). */
  headerEnd?: ReactNode
  /** Border tone. "warn" and "danger" must be backed by text that says why. */
  tone?: CardTone
  /** Wrapper element. Default "section" when there is a title, else "div". */
  as?: 'div' | 'section' | 'article' | 'li' | 'aside'
  className?: string
  children?: ReactNode
}

/** Surface container with an optional heading row. */
export function Card({ title, icon, headingLevel = 2, headerEnd, tone = 'default', as, className, children }: CardProps) {
  const element = as ?? (title ? 'section' : 'div')
  const head = title ? (
    <div className="ui-card__head">
      {icon ? <Icon name={icon} size={20} className="ui-card__icon" /> : null}
      {createElement(`h${headingLevel}`, { className: 'ui-card__title' }, title)}
      {headerEnd ? <div className="ui-card__head-end">{headerEnd}</div> : null}
    </div>
  ) : null
  return createElement(element, { className: cx('ui-card', tone !== 'default' && `ui-card--${tone}`, className) }, head, children)
}

export interface SectionTitleProps {
  children: ReactNode
  /** Heading level. Default 2. */
  level?: 2 | 3
  /** Right-aligned control, e.g. a small Button. */
  action?: ReactNode
  className?: string
}

/** Heading that opens a section of a page. */
export function SectionTitle({ children, level = 2, action, className }: SectionTitleProps) {
  return (
    <div className={cx('ui-section-title', className)}>
      {createElement(`h${level}`, { className: 'ui-section-title__text' }, children)}
      {action ? <div className="ui-section-title__action">{action}</div> : null}
    </div>
  )
}

export type StatTone = 'default' | 'good' | 'warn' | 'danger'

export interface StatProps {
  /** The number or short value. Read first by screen readers: "0 blocked requests". */
  value: ReactNode
  label: ReactNode
  hint?: ReactNode
  tone?: StatTone
  className?: string
}

/** A big value over a small label. */
export function Stat({ value, label, hint, tone = 'default', className }: StatProps) {
  return (
    <div className={cx('ui-stat', tone !== 'default' && `ui-stat--${tone}`, className)}>
      <div className="ui-stat__value">{value}</div>
      <div className="ui-stat__label">{label}</div>
      {hint ? <div className="ui-stat__hint">{hint}</div> : null}
    </div>
  )
}

export interface EmptyStateProps {
  title: ReactNode
  icon?: IconName
  /** One or two plain sentences. */
  children?: ReactNode
  /** A Button or LinkButton. */
  action?: ReactNode
  className?: string
}

/** Honest "nothing here" block. Say why it is empty and what, if anything, to do. */
export function EmptyState({ title, icon, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)}>
      {icon ? <Icon name={icon} size={28} className="ui-empty__icon" /> : null}
      <p className="ui-empty__title">{title}</p>
      {children ? <div className="ui-empty__text">{children}</div> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  )
}
