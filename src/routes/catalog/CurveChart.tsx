import type { Curve } from './helpers'

const W = 320
const H = 150
const PAD = { l: 34, r: 10, t: 10, b: 28 }

function tick(n: number): string {
  const a = Math.abs(n)
  if (a >= 100) return String(Math.round(n))
  if (a >= 10) return n.toFixed(1).replace(/\.0$/, '')
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/** Score (0 to 100) against measured value. Inline SVG, text alternative in the caption. */
export function CurveChart({ curve, unit, description }: { curve: Curve; unit: string; description: string }) {
  const { points, xMin, xMax, band } = curve
  const sx = (x: number): number => PAD.l + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r)
  const sy = (y: number): number => PAD.t + (1 - y / 100) * (H - PAD.t - PAD.b)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ')
  return (
    <figure style={{ margin: 0 }}>
      <svg className="mx-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
        {[0, 50, 100].map((y) => (
          <g key={y}>
            <line className="mx-curve__grid" x1={PAD.l} x2={W - PAD.r} y1={sy(y)} y2={sy(y)} strokeDasharray={y === 50 ? '3 4' : undefined} />
            <text x={PAD.l - 6} y={sy(y) + 4} textAnchor="end">
              {y}
            </text>
          </g>
        ))}
        {band ? (
          <rect className="mx-curve__band" x={sx(band.lo)} y={PAD.t} width={Math.max(sx(band.hi) - sx(band.lo), 2)} height={H - PAD.t - PAD.b} />
        ) : null}
        <path className="mx-curve__line" d={d} />
        <text x={PAD.l} y={H - 8} textAnchor="start">
          {tick(xMin)}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end">
          {tick(xMax)}
        </text>
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 8} textAnchor="middle">
          {unit}
        </text>
      </svg>
      <figcaption className="u-small u-dim" style={{ marginTop: 6 }}>
        Score (0 to 100) against the measured value in {unit}.{band ? ' Shaded: the full-score band.' : ''}
      </figcaption>
    </figure>
  )
}
