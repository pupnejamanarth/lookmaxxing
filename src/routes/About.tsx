import type { ReactNode } from 'react'
import { Link } from '../router'
import type { Changeability, Evidence } from '../catalog/schema'
import { Banner, ChangeabilityBadge, EvidenceBadge, PageHeader, SectionTitle } from '../ui'

/** Rules shown here come from docs/PLAN.md sections 2 to 4. Change the plan and this page together. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="about-section">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  )
}

const CONFIDENCE_ROWS: readonly { band: string; range: string; effect: string }[] = [
  { band: 'HIGH', range: '0.80 or more', effect: 'Counts in the overall score.' },
  { band: 'MEDIUM', range: '0.60 to 0.79', effect: 'Counts in the overall score.' },
  { band: 'LOW', range: '0.40 to 0.59', effect: 'Shown with a warning. Left out of the overall score.' },
  { band: 'REFUSED', range: 'Under 0.40, or any hard fail', effect: 'Not scored. The app says what to capture again.' },
]

const METHOD_BASE: readonly { method: string; base: string }[] = [
  { method: 'Automatic photo analysis', base: '1.0' },
  { method: 'Colour-calibrated photo', base: '0.9' },
  { method: 'Manual landmarks', base: '0.85' },
  { method: 'Tape measure', base: '0.85' },
  { method: 'Self-report', base: '0.6, and never HIGH' },
]

const CHANGEABILITY_ROWS: readonly { value: Changeability; text: string }[] = [
  {
    value: 'CHANGEABLE',
    text: 'Responds to what you do: training, food structure, sleep, posture, grooming, haircut, skin habits. Only these go in the action plan.',
  },
  { value: 'FIXED', text: 'Bone structure, height, genetic hairline. Rated honestly, never planned around.' },
  { value: 'SURGICAL_ONLY', text: 'Only surgery changes it. Tagged and left out of the plan.' },
  { value: 'PROFESSIONAL_ONLY', text: 'Needs a professional, such as a dentist or dermatologist. Tagged and left out of the plan.' },
  {
    value: 'FIXED_BUT_VISIBILITY_CHANGEABLE',
    text: 'The trait is fixed. How visible it is can change, for example with body fat or a haircut. Only the visibility part is planned.',
  },
]

const EVIDENCE_ROWS: readonly { value: Evidence; text: string }[] = [
  { value: 'STRONG', text: 'Consistent support in research. Full weight allowed.' },
  { value: 'MODERATE', text: 'Some support, with gaps. Full weight allowed, and the gaps are named.' },
  { value: 'WEAK', text: 'Thin or indirect support. Weight capped at 1.0 of 100.' },
  { value: 'PSEUDOSCIENCE', text: 'A popular community claim without scientific support. Flagged plainly. Weight capped at 0.25 of 100.' },
  { value: 'MYTH', text: 'Shown to be false or meaningless. Weight 0. Never scored.' },
  { value: 'CONVENTION', text: 'A style or clinical convention, not a research finding. Labelled as such.' },
]

export default function About() {
  return (
    <div className="u-stack u-stack--lg about">
      <PageHeader title="How scoring works" subtitle="The rules the app follows. Every score is an estimate, not a medical opinion." />

      <Banner tone="info" title="Scoring is not live yet">
        This page describes the rules the scoring engine is built to follow. The metric catalog is already open to browse.
      </Banner>

      <Section title="The overall score">
        <ul className="about-list">
          <li>The appearance score is a weighted average of metric scores. Each metric scores from 0 to 100.</li>
          <li>Only metrics scored with HIGH or MEDIUM confidence count.</li>
          <li>
            Coverage is the share of total weight that was scored. Below 75 percent the score is marked PROVISIONAL. Below 50 percent no score is
            given.
          </li>
          <li>A plus-or-minus band combines the uncertainty of each metric.</li>
          <li>
            Points lost per metric are its weight times (100 minus its score), divided by 100. They are grouped into fixed, surgical or
            professional, and changeable, so you can see what drags the score down.
          </li>
          <li>Habits carry no appearance weight. They are causes, not appearance. They get a separate adherence index.</li>
          <li>
            The Ceiling Attainment Index measures only changeable metrics against your realistic ceiling for each one. 100 percent means every
            changeable metric is at its ceiling.
          </li>
        </ul>
      </Section>

      <Section title="Rating rules">
        <ol className="about-list about-list--numbered">
          <li>Every score cites the measurement behind it. No reason, no score.</li>
          <li>
            No softening. No compliments wrapped around bad news. Scores are truncated, never rounded up. If something is bad, the report says
            so and says exactly why. It rates the metric, not you.
          </li>
          <li>Every score shows a confidence level. If angle, lighting or lens make a metric unreliable, the app refuses to score it.</li>
          <li>The overall score is a weighted combination, and the weights are shown.</li>
          <li>Pseudoscience is flagged plainly and capped at a tiny weight. Weak evidence is capped. Myths get none.</li>
          <li>Tone is checked by automated tests on every message template.</li>
        </ol>
      </Section>

      <Section title="Confidence">
        <p>Confidence is the method base, times photo-quality factors, times repeatability.</p>
        <div className="about-table-wrap">
          <table className="about-table">
            <caption className="u-sr-only">Confidence bands</caption>
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">Confidence</th>
                <th scope="col">What happens</th>
              </tr>
            </thead>
            <tbody>
              {CONFIDENCE_ROWS.map((row) => (
                <tr key={row.band}>
                  <th scope="row">{row.band}</th>
                  <td>{row.range}</td>
                  <td>{row.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="about-sub">Method base</h3>
        <dl className="about-dl">
          {METHOD_BASE.map((row) => (
            <div key={row.method}>
              <dt>{row.method}</dt>
              <dd>{row.base}</dd>
            </div>
          ))}
        </dl>
        <p>
          Repeatability comes from the spread of the five-frame burst and from your own minimum detectable change, measured on calibration
          day. A change smaller than that is reported as no detectable change. The app does not celebrate noise.
        </p>
      </Section>

      <Section title="When the app refuses">
        <p>A refusal is not a low score. It means the measurement cannot be trusted, so no number is given. The app says what to capture again.</p>
        <p>Hard fails include:</p>
        <ul className="about-list">
          <li>Head turned or tilted past the limit (yaw or roll over 3 degrees, pitch over 4 degrees) for symmetry and face width-to-height.</li>
          <li>Any colour metric without a grey card in the photo.</li>
          <li>A profile shot with the head turned less than 80 degrees.</li>
          <li>A smile in a shot that must be neutral.</li>
          <li>A camera closer than 1.2 m for proportions.</li>
        </ul>
      </Section>

      <Section title="Fixed and changeable">
        <p>Every metric carries one of these tags. Fixed traits are still rated honestly. They are excluded from the action plan.</p>
        <ul className="about-defs">
          {CHANGEABILITY_ROWS.map((row) => (
            <li key={row.value}>
              <ChangeabilityBadge changeability={row.value} />
              <p>{row.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Evidence grades and caps">
        <p>
          Every metric carries an evidence grade. Anything that is not STRONG also carries a plain note saying why. Caps are in percent of the
          overall score.
        </p>
        <ul className="about-defs">
          {EVIDENCE_ROWS.map((row) => (
            <li key={row.value}>
              <EvidenceBadge evidence={row.value} />
              <p>{row.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="The weights are judgement">
        <p>
          The weights are evidence-informed judgement, not a validated model. No study turns these metrics into one attractiveness number.
          They are shown openly and version-numbered, so an old score can be recalculated when the rules change.
        </p>
        <p>Use the overall score to see where points are lost. It does not measure how attractive you are.</p>
      </Section>

      <Section title="No chemicals">
        <ul className="about-list">
          <li>The app recommends no drugs, supplements, topicals, peptides, hormones or skincare actives.</li>
          <li>
            It only ever mentions products you add to your own <Link to="/whitelist">whitelist</Link>. The whitelist is empty by default and the
            app never suggests entries.
          </li>
          <li>
            If a metric would need a product you have not added, it says its progress is capped under the current whitelist. It does not name a
            product.
          </li>
          <li>
            Levers it does use: training, food-based diet structure, sleep, posture work, grooming, haircut and beard design, style, photo
            technique, sun and skin habits, oral-hygiene habits, hair handling, voice practice.
          </li>
          <li>
            Never recommended: bone smashing, jaw devices, crash diets, losing more than 1 percent of body weight a week, dehydration cuts,
            forcing the voice lower, DIY needling or peels, tanning, anything near the eyes, anything with real injury risk.
          </li>
          <li>
            Natural methods are graded too. Only STRONG-evidence ones are recommended. Weak ones are optional and rank low. Myths are listed as
            excluded, with the reason. See <Link to="/methods">Methods</Link>.
          </li>
          <li>
            Anything applied to skin or scalp needs a 7-day patch test first. Any reaction excludes it for good. Food-level use only: no
            capsules, extracts or concentrated oils.
          </li>
        </ul>
      </Section>

      <Section title="Ranking and safety caps">
        <ul className="about-list">
          <li>Actions are ranked by impact divided by effort. The top three levers show first.</li>
          <li>Fat loss is capped at 0.5 to 1 percent of body weight a week. Levers switch off at the target band and never push body fat below 8 percent.</li>
          <li>A pain report pauses the related levers.</li>
          <li>
            Medical flags (severe acne, sudden hair loss, yellow eye whites, persistent redness, an uneven spine, rapid unexplained weight
            change) say see a doctor. The app never diagnoses or treats.
          </li>
        </ul>
      </Section>

      <Section title="Limits">
        <ul className="about-list">
          <li>A 2D photo of a 3D face is approximate. Jaw angle and chin projection are labelled as soft-tissue estimates.</li>
          <li>Navy body-fat estimates are off by 3 to 4 points. They are used for trends, not for a single reading.</li>
          <li>Day-to-day noise from water, salt and sleep is why scans are weekly and weight uses a 7-day average.</li>
          <li>Norms lean toward Western populations. Each ideal carries a caveat where that matters.</li>
          <li>One full scan a week. Trends matter. A single scan does not.</li>
          <li>This app is not medical advice.</li>
        </ul>
      </Section>

      <p className="home-foot">
        Nothing you enter leaves this device. <Link to="/settings">Run the privacy check in Settings</Link>.
      </p>
    </div>
  )
}
