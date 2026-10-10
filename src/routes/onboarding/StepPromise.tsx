import { Banner, Card } from '../../ui'
import { StepNav, type StepProps } from './Parts'

export default function StepPromise({ next }: StepProps) {
  return (
    <div className="u-stack">
      <p className="onb-lead">Setup takes about 3 minutes. You can leave and come back. Your answers are saved after each step.</p>

      <Card title="What this is" icon="metrics">
        <p>
          Unmoggable measures your face, skin, hair, body and posture from photos and tape measurements you take
          yourself. It rates the results against published ranges for men.
        </p>
        <p>Brutal means accurate. The app tells you the numbers. It does not flatter you.</p>
        <p>Every number is an estimate with a margin. When a measurement is not reliable, the app says so and gives no score.</p>
      </Card>

      <Card title="What never leaves this device" icon="shield">
        <p>Photos and results stay on this device. Here is how that is enforced, not just promised.</p>
        <ul className="onb-list">
          <li>
            <strong>Strict content security policy.</strong> The browser refuses to load anything from another site.
          </li>
          <li>
            <strong>Network guard.</strong> Any request to another origin is blocked and written to a local log you can read.
          </li>
          <li>
            <strong>No accounts.</strong> No sign-up, no name, no email, no date of birth, no location.
          </li>
          <li>
            <strong>No third parties.</strong> No analytics, no ads, no outside fonts or scripts.
          </li>
        </ul>
        <p className="u-dim u-small">
          The app code is downloaded from its web host like any website. Your data is never sent back.
        </p>
      </Card>

      <Card title="What it will and will not do" icon="info">
        <ul className="onb-list">
          <li>It measures and rates. It shows its evidence level for every claim.</li>
          <li>It is not medical advice. It does not diagnose anything. See a doctor for health or skin problems.</li>
          <li>It never suggests products or supplements. It only mentions what you add yourself.</li>
        </ul>
      </Card>

      <Card title="Look after yourself" icon="alert" tone="warn">
        <ul className="onb-list">
          <li>Scan once a week. No more.</li>
          <li>Watch trends over weeks, not a single number.</li>
          <li>If checking the mirror or the app starts to feel distressing, stop and talk to someone you trust or a professional.</li>
        </ul>
      </Card>

      <Banner tone="info">Everything you enter during setup also stays on this device.</Banner>

      <StepNav onNext={next} nextLabel="I understand. Start" />
    </div>
  )
}
