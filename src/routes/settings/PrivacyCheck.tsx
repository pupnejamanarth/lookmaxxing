import { useEffect, useState } from 'react'
import { NET_BLOCKED_EVENT, getNetGuardStats, getOriginAudit } from '../../privacy'
import { Badge, Banner, Card, Icon, plural } from '../../ui'
import { judgeOrigins } from './helpers'

function readCsp(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy" i]')
  const content = meta?.content.trim()
  return content ? content : null
}

function snapshot() {
  return { stats: getNetGuardStats(), audit: getOriginAudit(), csp: readCsp() }
}

export default function PrivacyCheck() {
  const [state, setState] = useState(snapshot)

  useEffect(() => {
    const refresh = () =>
      setState((prev) => {
        const next = snapshot()
        const same =
          prev.stats.blockedCount === next.stats.blockedCount &&
          prev.stats.installed === next.stats.installed &&
          prev.audit.origins.length === next.audit.origins.length &&
          prev.audit.external.length === next.audit.external.length &&
          prev.audit.cspBlocked.length === next.audit.cspBlocked.length &&
          prev.csp === next.csp
        return same ? prev : next
      })
    window.addEventListener(NET_BLOCKED_EVENT, refresh)
    const timer = window.setInterval(refresh, 3000)
    return () => {
      window.removeEventListener(NET_BLOCKED_EVENT, refresh)
      window.clearInterval(timer)
    }
  }, [])

  const { stats, audit, csp } = state
  const verdict = judgeOrigins(audit.origins.length, audit.external)
  const recentOrigins = [...new Set([...stats.recent].reverse().map((r) => r.origin))].slice(0, 8)

  return (
    <Card title="Privacy check" icon="shield" headingLevel={2} tone={verdict.ok && stats.blockedCount === 0 ? 'default' : 'warn'}>
      <p>This is a live check of this page. Nothing here is sent anywhere.</p>

      <div className="u-stack u-stack--sm">
        <h3 className="u-small u-dim">Network guard</h3>
        <dl className="st-kv">
          <dt>Guard installed</dt>
          <dd className={stats.installed ? 'st-ok' : 'st-bad'}>{stats.installed ? 'Yes' : 'No'}</dd>
          <dt>Requests blocked</dt>
          <dd>{stats.blockedCount}</dd>
        </dl>
        {recentOrigins.length > 0 ? (
          <div>
            <p className="u-small u-dim">Recent blocked origins</p>
            <ul className="st-list u-mono u-small">
              {recentOrigins.map((origin) => (
                <li key={origin}>{origin}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="u-small u-dim">No request has been blocked.</p>
        )}
      </div>

      <div className="u-stack u-stack--sm">
        <h3 className="u-small u-dim">Origin audit</h3>
        <p>
          {verdict.ok ? (
            <Badge tone="green">
              <Icon name="check-circle" size={14} /> 1 origin
            </Badge>
          ) : (
            <Badge tone="red">
              <Icon name="alert" size={14} /> {audit.origins.length} {plural(audit.origins.length, 'origin')}
            </Badge>
          )}
        </p>
        <ul className="st-list u-mono u-small">
          {audit.origins.map((o) => {
            const external = audit.external.includes(o.origin)
            return (
              <li key={o.origin} className={external ? 'st-bad' : undefined}>
                <span>
                  {o.origin}
                  {external ? ' (not this app)' : ' (this app)'}
                </span>
                <span>{o.count}</span>
              </li>
            )
          })}
        </ul>
        {verdict.ok ? (
          <p className="u-small u-dim">Everything on this page loaded from its own origin. Production must show exactly 1.</p>
        ) : (
          <Banner tone="danger" title="Unexpected origins" live>
            {verdict.reason} Production must load from this app only. Do not enter data until this is explained.
          </Banner>
        )}
        {audit.truncated ? (
          <p className="u-small u-dim">The browser timing buffer overflowed. This list may be incomplete.</p>
        ) : null}
        {audit.cspBlocked.length > 0 ? (
          <p className="u-small u-dim">CSP blocked loads from: {audit.cspBlocked.map((c) => `${c.origin} (${c.count})`).join(', ')}.</p>
        ) : null}
      </div>

      <div className="u-stack u-stack--sm">
        <h3 className="u-small u-dim">Content Security Policy</h3>
        {csp ? (
          <pre className="st-csp" tabIndex={0} aria-label="Active content security policy">
            {csp.split(/;\s*/).join(';\n')}
          </pre>
        ) : (
          <Banner tone="danger" title="No Content Security Policy found">
            The page has no CSP meta tag. This is expected in development. In a production build it is a failure.
          </Banner>
        )}
      </div>

      <div className="u-stack u-stack--sm">
        <h3 className="u-small u-dim">What is enforced</h3>
        <ul className="u-small">
          <li>The CSP only allows loads from this origin.</li>
          <li>A script guard refuses fetch, XHR, WebSocket, beacon and WebRTC to any other origin.</li>
          <li>No analytics, no third-party scripts, fonts or images.</li>
          <li>Photos and data stay in this browser. Only a backup file you export leaves the app, and only by your action.</li>
          <li>The app stores no name, email, date of birth or location.</li>
        </ul>
      </div>
    </Card>
  )
}
