import { version } from '../../../package.json'
import { Badge, Card } from '../../ui'
import { readInstallState } from '../onboarding/helpers'

export default function AppInfo() {
  const install = readInstallState()
  return (
    <Card title="App" icon="info" headingLevel={2}>
      <dl className="st-kv">
        <dt>Version</dt>
        <dd>{version}</dd>
        <dt>Install status</dt>
        <dd>{install.standalone ? <Badge tone="green">Installed</Badge> : <Badge>Browser tab</Badge>}</dd>
      </dl>
      {install.blocked ? (
        <p className="u-small u-dim">
          On iPhone, Safari can delete site data after 7 days without use unless the app is on the Home Screen. Add it to the Home Screen.
        </p>
      ) : null}
      <p className="u-small u-dim">This app gives estimates, not medical advice.</p>
    </Card>
  )
}
