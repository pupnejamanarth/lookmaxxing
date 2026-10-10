import type { ReactNode } from 'react'
import type { Changeability, Evidence } from '../catalog/schema'
import { cx } from './cx'

export type BadgeTone = 'neutral' | 'green' | 'blue' | 'amber' | 'magenta' | 'red' | 'grey' | 'purple' | 'orange' | 'teal'

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}

/** Small uppercase label. The tone is decoration; the text always carries the meaning. */
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return <span className={cx('ui-badge', `ui-badge--${tone}`, className)}>{children}</span>
}

export const EVIDENCE_TONE: Record<Evidence, BadgeTone> = {
  STRONG: 'green',
  MODERATE: 'blue',
  WEAK: 'amber',
  PSEUDOSCIENCE: 'magenta',
  MYTH: 'red',
  CONVENTION: 'grey',
}

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  STRONG: 'STRONG',
  MODERATE: 'MODERATE',
  WEAK: 'WEAK',
  PSEUDOSCIENCE: 'PSEUDOSCIENCE',
  MYTH: 'MYTH',
  CONVENTION: 'CONVENTION',
}

/** Evidence grade of a metric or method: STRONG green, MODERATE blue, WEAK amber, PSEUDOSCIENCE magenta, MYTH red, CONVENTION grey. */
export function EvidenceBadge({ evidence, className }: { evidence: Evidence; className?: string }) {
  return (
    <Badge tone={EVIDENCE_TONE[evidence]} className={className}>
      {EVIDENCE_LABEL[evidence]}
    </Badge>
  )
}

export const CHANGEABILITY_TONE: Record<Changeability, BadgeTone> = {
  CHANGEABLE: 'green',
  FIXED: 'grey',
  SURGICAL_ONLY: 'purple',
  PROFESSIONAL_ONLY: 'orange',
  FIXED_BUT_VISIBILITY_CHANGEABLE: 'teal',
}

export const CHANGEABILITY_LABEL: Record<Changeability, string> = {
  CHANGEABLE: 'CHANGEABLE',
  FIXED: 'FIXED',
  SURGICAL_ONLY: 'SURGICAL-ONLY',
  PROFESSIONAL_ONLY: 'PROFESSIONAL-ONLY',
  FIXED_BUT_VISIBILITY_CHANGEABLE: 'FIXED BUT VISIBILITY CHANGEABLE',
}

/** Whether a metric can be changed: CHANGEABLE green, FIXED grey, SURGICAL-ONLY purple, PROFESSIONAL-ONLY orange, FIXED BUT VISIBILITY CHANGEABLE teal. */
export function ChangeabilityBadge({ changeability, className }: { changeability: Changeability; className?: string }) {
  return (
    <Badge tone={CHANGEABILITY_TONE[changeability]} className={className}>
      {CHANGEABILITY_LABEL[changeability]}
    </Badge>
  )
}
