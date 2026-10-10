import type { ComponentProps, ReactNode } from 'react'
import { Link } from '../router'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface LookProps {
  /** Default "secondary". Use one "primary" per screen area. */
  variant?: ButtonVariant
  /** "md" is 44 px tall. "sm" is 36 px with a 44 px hit area. */
  size?: ButtonSize
  fullWidth?: boolean
  /** Decorative icon before the label. */
  icon?: IconName
}

export function buttonClass({ variant = 'secondary', size = 'md', fullWidth }: LookProps, extra?: string): string {
  return cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, fullWidth && 'ui-btn--full', extra)
}

export interface ButtonProps extends LookProps, Omit<ComponentProps<'button'>, 'className'> {
  /** Shows a spinner and ignores clicks. The button keeps focus (it is aria-disabled, not disabled). */
  loading?: boolean
  className?: string
}

/** Button. Variants primary | secondary | ghost | danger, sizes sm | md, optional loading state. */
export function Button({
  variant,
  size,
  fullWidth,
  icon,
  loading = false,
  disabled,
  className,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass({ variant, size, fullWidth }, className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
    >
      {loading ? <Spinner size={16} label={null} className="ui-btn__spinner" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'className' | 'children' | 'aria-label'> {
  icon: IconName
  /** Accessible name. Required: an icon alone says nothing to a screen reader. */
  label: string
  variant?: ButtonVariant
  className?: string
}

/** Square 44 px button with only an icon (close, edit, delete). */
export function IconButton({ icon, label, variant = 'ghost', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-label={label} className={cx('ui-btn', `ui-btn--${variant}`, 'ui-btn--icon', className)}>
      <Icon name={icon} size={20} />
    </button>
  )
}

export interface LinkButtonProps extends LookProps {
  /** Route path, e.g. "/onboarding". */
  to: string
  children?: ReactNode
  className?: string
  replace?: boolean
}

/** A link (<a>) that looks like a Button. Use for navigation; use Button for actions. */
export function LinkButton({ to, variant, size, fullWidth, icon, className, replace, children }: LinkButtonProps) {
  return (
    <Link to={to} replace={replace} className={buttonClass({ variant, size, fullWidth }, className)}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </Link>
  )
}
