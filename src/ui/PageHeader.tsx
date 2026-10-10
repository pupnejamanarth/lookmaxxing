import type { ReactNode } from 'react'
import { Link } from '../router'
import { cx } from './cx'
import { Icon } from './Icon'

export interface PageHeaderProps {
  /** The page <h1>. Focus moves here on navigation, so keep it short and unique. */
  title: ReactNode
  subtitle?: ReactNode
  /** Shows a back link above the title. */
  back?: { to: string; label?: string }
  /** Controls on the right of the title row. */
  actions?: ReactNode
  className?: string
}

/** Page title block: optional back link, the one <h1> of the page, optional subtitle and actions. */
export function PageHeader({ title, subtitle, back, actions, className }: PageHeaderProps) {
  return (
    <header className={cx('ui-page-header', className)}>
      {back ? (
        <Link to={back.to} className="ui-back">
          <Icon name="chevron-left" size={18} />
          {back.label ?? 'Back'}
        </Link>
      ) : null}
      <div className="ui-page-header__row">
        <div className="ui-page-header__text">
          <h1 className="ui-page-title" tabIndex={-1}>
            {title}
          </h1>
          {subtitle ? <p className="ui-page-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  )
}

export interface ProgressStepsProps {
  /** Step names, in order. */
  steps: readonly string[]
  /** Zero-based index of the current step. */
  current: number
  /** Accessible name of the list. Default "Progress". */
  label?: string
  className?: string
}

/** "Step 2 of 6: Height" with a segmented bar. The text carries the state; the bar is a visual aid. */
export function ProgressSteps({ steps, current, label = 'Progress', className }: ProgressStepsProps) {
  const index = Math.min(Math.max(current, 0), Math.max(steps.length - 1, 0))
  return (
    <div className={cx('ui-steps', className)}>
      <p className="ui-steps__text">
        <span className="ui-steps__count">
          Step {index + 1} of {steps.length}
        </span>
        <span className="ui-steps__name">{steps[index]}</span>
      </p>
      <ol className="ui-steps__bar" aria-label={label}>
        {steps.map((step, i) => (
          <li
            key={i}
            className={cx('ui-steps__seg', i < index && 'is-done', i === index && 'is-current')}
            aria-current={i === index ? 'step' : undefined}
          >
            <span className="u-sr-only">
              {step}
              {i < index ? ', done' : i === index ? ', current' : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
