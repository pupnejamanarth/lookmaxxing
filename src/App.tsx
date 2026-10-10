import { lazy, Suspense, type ReactElement } from 'react'
import { Link, useRoute, useRouteEffects } from './router'
import Home from './routes/Home'
import NotFound from './routes/NotFound'
import { ErrorBoundary, Icon, Spinner, cx, type IconName } from './ui'

const Onboarding = lazy(() => import('./routes/Onboarding'))
const Metrics = lazy(() => import('./routes/Metrics'))
const Methods = lazy(() => import('./routes/Methods'))
const Whitelist = lazy(() => import('./routes/Whitelist'))
const Settings = lazy(() => import('./routes/Settings'))
const About = lazy(() => import('./routes/About'))
const QuickScan = lazy(() => import('./routes/QuickScan'))
const Scans = lazy(() => import('./routes/Scans'))
const Report = lazy(() => import('./routes/Report'))

interface Resolved {
  element: ReactElement
  /** Onboarding is full screen. */
  tabs: boolean
}

/** Known first segments and how deep they may go. Anything else is NotFound. */
function resolve(segments: readonly string[]): Resolved {
  const [head, second] = segments
  const depth = segments.length
  const page = (element: ReactElement, tabs = true): Resolved => ({ element, tabs })

  if (depth === 0) return page(<Home />)
  switch (head) {
    case 'onboarding':
      if (depth === 1) return page(<Onboarding />, false)
      break
    case 'metrics':
      if (depth <= 2 && second !== '') return page(<Metrics />)
      break
    case 'methods':
      if (depth <= 2) return page(<Methods />)
      break
    case 'whitelist':
      if (depth === 1) return page(<Whitelist />)
      break
    case 'settings':
      if (depth === 1) return page(<Settings />)
      break
    case 'about':
      if (depth === 1) return page(<About />)
      break
    case 'scan':
      if (depth === 1) return page(<QuickScan />, false)
      break
    case 'scans':
      if (depth === 1) return page(<Scans />)
      if (depth === 2 && second !== '') return page(<Report id={second!} />)
      break
  }
  return page(<NotFound />)
}

interface Tab {
  to: string
  label: string
  icon: IconName
  /** Paths (and their children) that light up this tab. */
  owns: readonly string[]
}

const TABS: readonly Tab[] = [
  { to: '/', label: 'Home', icon: 'home', owns: ['/'] },
  { to: '/metrics', label: 'Metrics', icon: 'metrics', owns: ['/metrics'] },
  { to: '/methods', label: 'Methods', icon: 'methods', owns: ['/methods'] },
  { to: '/settings', label: 'Settings', icon: 'settings', owns: ['/settings', '/whitelist', '/about'] },
]

function owns(tab: Tab, path: string): boolean {
  if (tab.to === '/') return path === '/'
  return tab.owns.some((root) => path === root || path.startsWith(`${root}/`))
}

function TabBar({ path }: { path: string }) {
  return (
    <nav className="tabbar" aria-label="Main">
      <ul className="tabbar__list">
        {TABS.map((tab) => {
          const active = owns(tab, path)
          return (
            <li key={tab.to}>
              <Link to={tab.to} className={cx('tabbar__link', active && 'is-active')} aria-current={active ? 'page' : undefined}>
                <Icon name={tab.icon} size={22} />
                <span>{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function RouteFallback() {
  return (
    <div className="route-fallback">
      <Spinner size={28} />
    </div>
  )
}

export function App() {
  const { path, segments } = useRoute()
  useRouteEffects()
  const { element, tabs } = resolve(segments)

  return (
    <div className="app" data-tabs={tabs}>
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          const main = document.getElementById('main')
          main?.focus()
          main?.scrollIntoView()
        }}
      >
        Skip to content
      </button>
      <main id="main" className="app-main" tabIndex={-1}>
        <ErrorBoundary resetKey={path}>
          {/* Keyed by path: the old page unmounts at once, so focus never lands on a hidden heading. */}
          <Suspense key={path} fallback={<RouteFallback />}>
            {element}
          </Suspense>
        </ErrorBoundary>
      </main>
      {tabs ? <TabBar path={path} /> : null}
    </div>
  )
}
