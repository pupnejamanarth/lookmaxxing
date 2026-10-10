import type { Segment } from './helpers'
import { formatWeight } from './helpers'

interface Props {
  title: string
  segments: readonly Segment[]
  /** Prefix of the colour classes: category keys or change bucket keys both map to mx-seg--<key>. */
  total: number
}

/** Stacked bar of the overall score weight. The legend below carries every number as text. */
export function WeightBar({ title, segments, total }: Props) {
  const summary = segments.map((s) => `${s.label} ${formatWeight(s.weight)}`).join(', ')
  return (
    <div className="mx-bar-block">
      <p className="mx-bar-title">{title}</p>
      <div className="mx-bar" role="img" aria-label={`${title}. Total ${formatWeight(total)} points. ${summary}.`}>
        {segments.map((s) => (
          <span key={s.key} className={`mx-bar__seg mx-seg--${s.key}`} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      <ul className="mx-legend" aria-hidden="true">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`mx-swatch mx-seg--${s.key}`} />
            <span>
              {s.label} <span className="u-num u-dim">{formatWeight(s.weight)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
