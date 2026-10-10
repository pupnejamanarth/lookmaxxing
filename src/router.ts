/**
 * Tiny hash router. GitHub Pages cannot rewrite URLs, so the route lives after the "#":
 *   https://host/lookmaxxing/#/metrics/F01  ->  path "/metrics/F01", segments ["metrics", "F01"].
 * The hash IS the route, so never use fragment links ("#section") in this app.
 *
 * Back/forward work because every navigation is a normal hash change.
 */
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement,
} from 'react'

export interface RouteInfo {
  /** Normalised: always starts with "/", no trailing slash, no query. Home is "/". */
  path: string
  /** Decoded path parts. Home is []. */
  segments: string[]
}

const APP_NAME = 'Lookmaxing'

/** Turns a raw location.hash (or a link target) into a normalised path. */
export function normalizePath(raw: string): string {
  let p = raw.startsWith('#') ? raw.slice(1) : raw
  const cut = p.search(/[?]/)
  if (cut >= 0) p = p.slice(0, cut)
  p = `/${p}`.replace(/\/{2,}/g, '/')
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function parseRoute(raw: string): RouteInfo {
  const path = normalizePath(raw)
  const segments = path.split('/').filter(Boolean).map(decodeSegment)
  return { path, segments }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getHash = (): string => window.location.hash
const getServerHash = (): string => ''

/** Current route; re-renders on every hash change (including back/forward). */
export function useRoute(): RouteInfo {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash)
  return useMemo(() => parseRoute(hash), [hash])
}

/** Go to a path such as "/metrics/F01". `replace` swaps the current history entry instead of adding one. */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const target = `#${normalizePath(path)}`
  if (window.location.hash === target) return
  if (options.replace) window.location.replace(target)
  else window.location.hash = target
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  /** Path, e.g. "/metrics". Not a URL: external links do not exist in this app. */
  to: string
  replace?: boolean
}

/** Anchor that routes without a page load. Sets aria-current="page" when it points at the current route. */
export function Link({ to, replace, onClick, children, ...rest }: LinkProps): ReactElement {
  const { path } = useRoute()
  const target = normalizePath(to)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event)
    if (!replace || event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(target, { replace: true })
  }
  return createElement(
    'a',
    { ...rest, href: `#${target}`, onClick: handleClick, 'aria-current': rest['aria-current'] ?? (path === target ? 'page' : undefined) },
    children,
  )
}

/** Resolves once `read()` returns something, polling via MutationObserver for up to `timeoutMs`. */
function whenFound<T>(read: () => T | null, timeoutMs: number, done: (found: T) => void): () => void {
  const first = read()
  if (first) {
    done(first)
    return () => undefined
  }
  const observer = new MutationObserver(() => {
    const found = read()
    if (!found) return
    observer.disconnect()
    window.clearTimeout(timer)
    done(found)
  })
  const timer = window.setTimeout(() => observer.disconnect(), timeoutMs)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    window.clearTimeout(timer)
  }
}

const findHeading = (): HTMLElement | null => document.querySelector<HTMLElement>('main h1')

/**
 * Call once, inside the app shell. On every route change: scroll to the top, move focus to the
 * page <h1> (so a screen reader announces the new page) and set document.title from it.
 * The first render only sets the title; it never steals focus.
 */
export function useRouteEffects(): void {
  const { path } = useRoute()
  const isFirst = useRef(true)

  useEffect(() => {
    const initial = isFirst.current
    isFirst.current = false
    if (!initial) window.scrollTo(0, 0)

    return whenFound(findHeading, 3000, (heading) => {
      const text = heading.textContent?.trim() ?? ''
      document.title = text && text !== APP_NAME ? `${text} - ${APP_NAME}` : APP_NAME
      if (initial) return
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: true })
    })
  }, [path])
}
