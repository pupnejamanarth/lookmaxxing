import { useMemo } from 'react'
import { Badge, Banner, Button, Card, Icon } from '../../ui'
import { AddIllustration, OpenIllustration, ShareIllustration } from './Illustrations'
import { readInstallState } from './helpers'
import { StepNav, useAction, type StepProps } from './Parts'

export default function StepInstall({ save, next, back }: StepProps) {
  const state = useMemo(readInstallState, [])
  const { busy, error, run } = useAction()

  const continueHere = () =>
    run(async () => {
      await save({ installedToHomeScreen: state.standalone })
      next()
    })

  const notIphone = () =>
    run(async () => {
      await save({ installedToHomeScreen: false })
      next()
    })

  if (!state.blocked) {
    return (
      <div className="u-stack">
        <Card>
          <div className="u-row u-row--center">
            {state.standalone ? (
              <Badge tone="green">
                <Icon name="check-circle" size={14} /> Installed
              </Badge>
            ) : (
              <Badge tone="neutral">Running in a browser tab (fine on a computer)</Badge>
            )}
          </div>
          {state.standalone ? (
            <p>The app is running from your Home Screen. Its storage is not cleared for being idle.</p>
          ) : (
            <p>
              On a computer, a browser tab is fine. Your data lives in this browser only. If you also use another browser or device, it
              has its own separate data. Move data between them with a backup file.
            </p>
          )}
        </Card>
        <StepNav onBack={back} onNext={continueHere} busy={busy} error={error} />
      </div>
    )
  }

  return (
    <div className="u-stack">
      <Banner tone="warn" title="Install this app before you continue">
        You are on an iPhone, in a Safari tab. Safari deletes site data after 7 days without use for sites that are not on the Home
        Screen. That would delete your scans.
      </Banner>

      <Card title="Add it to your Home Screen" headingLevel={2}>
        <ol className="onb-howto">
          <li>
            <span className="onb-howto__art">
              <ShareIllustration />
            </span>
            <span>
              <strong>1. Tap Share.</strong> It is the square with an arrow, in the Safari toolbar.
            </span>
          </li>
          <li>
            <span className="onb-howto__art">
              <AddIllustration />
            </span>
            <span>
              <strong>2. Tap Add to Home Screen.</strong> Scroll the list if you do not see it. Then tap Add.
            </span>
          </li>
          <li>
            <span className="onb-howto__art">
              <OpenIllustration />
            </span>
            <span>
              <strong>3. Open the app from the new icon.</strong> Close this tab. Continue setup there.
            </span>
          </li>
        </ol>
        <p className="u-dim u-small">
          The installed app and Safari tabs keep separate storage. Anything you enter in this tab will not be in the installed app. That
          is why you continue there, from the start.
        </p>
      </Card>

      <div className="onb-nav">
        {error ? (
          <Banner tone="danger" live>
            {error}
          </Banner>
        ) : null}
        <div className="onb-nav__row">
          <Button variant="secondary" icon="chevron-left" onClick={back} disabled={busy}>
            Back
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={notIphone} loading={busy} className="onb-quiet">
          I am not on an iPhone
        </Button>
      </div>
    </div>
  )
}
