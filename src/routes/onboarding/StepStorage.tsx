import { Banner, Button, Card, useLive } from '../../ui'
import { store } from '../../store'
import { StepNav, useAction, type StepProps } from './Parts'

export default function StepStorage({ profile, next, back }: StepProps) {
  const { busy, error, run } = useAction()
  // The store records the answer itself, so read it back instead of writing it.
  const { value: live } = useLive(() => store.getProfile())
  const persisted = (live ?? profile).storagePersisted

  const ask = () =>
    run(async () => {
      await store.requestPersistentStorage()
    })

  return (
    <div className="u-stack">
      <Card title="Keep your data" icon="backup" headingLevel={2}>
        <p>
          Browsers may delete stored data when a device runs low on space. Persistent storage asks the browser not to. The browser
          decides. It can refuse.
        </p>
        <Button variant="primary" icon="shield" onClick={ask} loading={busy} fullWidth>
          {persisted === null ? 'Ask for persistent storage' : 'Ask again'}
        </Button>
        {error ? (
          <Banner tone="danger" live>
            {error}
          </Banner>
        ) : null}
        <div aria-live="polite">
          {persisted === true ? (
            <Banner tone="info" title="Granted">
              The browser will keep your data unless you clear it yourself. A backup is still the safe copy.
            </Banner>
          ) : persisted === false ? (
            <Banner tone="warn" title="Not granted">
              The browser may delete your data if space runs low. A regular backup is the real protection. Export one from Settings every
              week.
            </Banner>
          ) : null}
        </div>
      </Card>

      <StepNav onBack={back} onNext={next} nextLabel={persisted === null ? 'Skip for now' : 'Next'} />
    </div>
  )
}
