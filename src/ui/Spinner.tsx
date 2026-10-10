import { cx } from './cx'

export interface SpinnerProps {
  /** Pixel size. Default 20. */
  size?: number
  /** Spoken label. Default "Loading". Pass `null` when the spinner sits inside text that already says it. */
  label?: string | null
  className?: string
}

/** Rotating ring. Announces itself as a status unless `label` is null. */
export function Spinner({ size = 20, label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      className={cx('ui-spinner', className)}
      role={label === null ? undefined : 'status'}
      aria-label={label ?? undefined}
      aria-hidden={label === null ? true : undefined}
      style={{ width: size, height: size }}
    />
  )
}

export interface SkeletonProps {
  /** CSS width, e.g. "60%" or 120. Default 100%. */
  width?: string | number
  /** CSS height. Default 1em. */
  height?: string | number
  className?: string
}

/** Placeholder bar that holds the space of text that is still loading (no layout shift). */
export function Skeleton({ width = '100%', height = '1em', className }: SkeletonProps) {
  return <span className={cx('ui-skeleton', className)} style={{ width, height }} aria-hidden="true" />
}
