import type { UpdateState } from '../../../shared/types'

interface Props {
  update: UpdateState
  busy: boolean
  onLater(): void
  onInstall(): void
}

/** A newer GitLantern: ready to install on restart (Windows), or to download from its release page (macOS). */
export function UpdateBanner({ update, busy, onLater, onInstall }: Props) {
  const ready = update.kind === 'ready'
  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <strong>
          GitLantern {update.version} is {ready ? 'ready to install' : 'available'}
        </strong>
        <span>
          {ready
            ? 'It installs the next time you quit GitLantern. Restart now to start using it.'
            : 'Download it from the release page, then drag it into Applications to replace this copy.'}
        </span>
      </div>
      <button className="link" onClick={onLater}>
        Later
      </button>
      <button className="primary" onClick={onInstall} disabled={ready && busy} title={ready && busy ? 'Wait for the current action to finish' : undefined}>
        {ready ? 'Restart now' : 'Download'}
      </button>
    </div>
  )
}
