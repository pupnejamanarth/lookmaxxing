import { Button, Card, Skeleton, plural, useLive } from '../../ui'
import { navigate } from '../../router'
import { store } from '../../store'
import { StepNav, type StepProps } from './Parts'

export default function StepStack({ next, back }: StepProps) {
  const { value: items, loading } = useLive(() => store.listWhitelist())
  const count = items?.length ?? 0

  return (
    <div className="u-stack">
      <Card title="My current stack" icon="list" headingLevel={2}>
        <p>This is the list of products you already use. It is empty by default.</p>
        <p>The app never suggests entries and never recommends a product. It only talks about products you add here.</p>
        <p>
          With an empty list, advice that depends on products stays off. You still get measurements, habits and natural methods. You
          can add or remove items later.
        </p>
        <p className="u-dim u-small" aria-live="polite">
          {loading ? <Skeleton width="10rem" height="1em" /> : count === 0 ? 'Nothing in your stack yet.' : `${count} ${plural(count, 'item')} in your stack.`}
        </p>
      </Card>

      <div className="onb-nav">
        <Button variant="secondary" icon="list" fullWidth onClick={() => navigate('/whitelist')}>
          Open my current stack
        </Button>
        <p className="u-dim u-small">Your setup progress is saved. Come back from Home to finish.</p>
      </div>

      <StepNav onBack={back} onNext={next} nextLabel="Skip for now" />
    </div>
  )
}
