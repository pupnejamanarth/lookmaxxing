import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export type BannerTone = 'info' | 'warn' | 'danger'

export interface BannerProps {
  tone?: BannerTone
  /** Short bold first line. */
  title?: ReactNode
  /** Optional control (usually a small LinkButton or Button) shown under the text. */
  action?: ReactNode
  /** Announce to screen readers when it appears (role alert for danger, status otherwise). Default false. */
  live?: boolean
  children?: ReactNode
  className?: string
}

const ICON: Record<BannerTone, IconName> = { info: 'info', warn: 'warn', danger: 'alert' }

/** In-page notice. info (blue), warn (amber), danger (red). Meaning is carried by icon and text, not colour alone. */
export function Banner({ tone = 'info', title, action, live = false, children, className }: BannerProps) {
  return (
    <div
      className={cx('ui-banner', `ui-banner--${tone}`, className)}
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <Icon name={ICON[tone]} size={20} className="ui-banner__icon" />
      <div className="ui-banner__body">
        {title ? <p className="ui-banner__title">{title}</p> : null}
        {children ? <div className="ui-banner__text">{children}</div> : null}
        {action ? <div className="ui-banner__action">{action}</div> : null}
      </div>
    </div>
  )
}
