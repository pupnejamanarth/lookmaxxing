/** Inline illustrations for the Home Screen steps. Decorative; the step text carries the meaning. */

const common = {
  width: 56,
  height: 56,
  viewBox: '0 0 56 56',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

/** The iOS Share icon: a box open at the top with an arrow leaving it. */
export function ShareIllustration() {
  return (
    <svg {...common}>
      <path d="M20 24h-4a3 3 0 0 0-3 3v19a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V27a3 3 0 0 0-3-3h-4" />
      <path d="M28 35V8" />
      <path d="m20 15 8-8 8 8" />
    </svg>
  )
}

/** The Add to Home Screen row: a rounded square with a plus. */
export function AddIllustration() {
  return (
    <svg {...common}>
      <rect x="10" y="10" width="36" height="36" rx="9" />
      <path d="M28 20v16" />
      <path d="M20 28h16" />
    </svg>
  )
}

/** A phone Home Screen with the app icon in the grid. */
export function OpenIllustration() {
  return (
    <svg {...common}>
      <rect x="14" y="5" width="28" height="46" rx="6" />
      <rect x="19" y="12" width="7" height="7" rx="2" />
      <rect x="30" y="12" width="7" height="7" rx="2" />
      <rect x="19" y="23" width="7" height="7" rx="2" />
      <rect x="30" y="23" width="7" height="7" rx="2" fill="currentColor" />
      <path d="M24 45h8" />
    </svg>
  )
}
