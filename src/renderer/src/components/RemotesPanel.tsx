import { useState } from 'react'
import { toHttpsUrl, toSshUrl } from '../../../shared/remoteUrl'
import type { RemoteInfo } from '../../../shared/types'
import { Icon } from './Icon'
import { RemoteDialog } from './RemoteDialog'

interface Props {
  remotes: RemoteInfo[]
  busy: boolean
  onAdd(name: string, url: string): void
  onSetUrl(name: string, url: string): void
  onRemove(name: string): void
  onConnectAccount(): void
}

function authLine(remote: RemoteInfo): { ok: boolean; text: string } {
  if (remote.protocol === 'ssh') return { ok: true, text: 'Uses your SSH key' }
  if (remote.accountLogin) return { ok: true, text: `Signed in as ${remote.accountLogin}` }
  if (remote.protocol === 'file') return { ok: true, text: 'Folder on this computer' }
  return { ok: false, text: 'Git will ask for a password' }
}

export function RemotesPanel({ remotes, busy, onAdd, onSetUrl, onRemove, onConnectAccount }: Props) {
  const [dialog, setDialog] = useState<{ mode: 'add' } | { mode: 'edit'; remote: RemoteInfo } | null>(null)

  return (
    <div className="remotes-panel">
      {remotes.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">No remotes yet</p>
          <p>Add one to push this repository to GitHub, GitLab, Bitbucket, Azure DevOps or your own server.</p>
        </div>
      )}
      {remotes.map((remote) => {
        const auth = authLine(remote)
        const switched = remote.protocol === 'ssh' ? toHttpsUrl(remote.fetchUrl) : toSshUrl(remote.fetchUrl)
        return (
          <article key={remote.name} className="remote-card">
            <div className="remote-head">
              <h3>{remote.name}</h3>
              <span className="chip">{remote.service}</span>
              <span className={`chip ${remote.protocol === 'ssh' ? 'chip-ok' : 'chip-info'}`}>{remote.protocol.toUpperCase()}</span>
            </div>
            <span className="remote-url selectable" title={remote.fetchUrl}>
              {remote.fetchUrl}
            </span>
            {remote.pushUrl !== remote.fetchUrl && (
              <span className="remote-url selectable" title={remote.pushUrl}>
                push: {remote.pushUrl}
              </span>
            )}
            <span className="remote-auth">
              <span className={`dot ${auth.ok ? 'ok' : 'muted'}`} />
              {auth.text}
              {!auth.ok && (
                <button className="link" onClick={onConnectAccount}>
                  Connect account
                </button>
              )}
            </span>
            <div className="remote-actions">
              {switched && (
                <button disabled={busy} onClick={() => onSetUrl(remote.name, switched)} title={switched}>
                  Use {remote.protocol === 'ssh' ? 'HTTPS' : 'SSH'} instead
                </button>
              )}
              <button disabled={busy} onClick={() => setDialog({ mode: 'edit', remote })}>
                Edit
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove the remote "${remote.name}"? Its remote-tracking branches go too.`)) onRemove(remote.name)
                }}
              >
                Remove
              </button>
            </div>
          </article>
        )
      })}
      <button className="add-remote" disabled={busy} onClick={() => setDialog({ mode: 'add' })}>
        <Icon name="plus" size={15} /> Add remote
      </button>

      {dialog && (
        <RemoteDialog
          {...(dialog.mode === 'edit' ? { remote: dialog.remote } : {})}
          suggestedName={remotes.some((r) => r.name === 'origin') ? 'upstream' : 'origin'}
          onCancel={() => setDialog(null)}
          onSubmit={(name, url) => {
            setDialog(null)
            if (dialog.mode === 'edit') onSetUrl(dialog.remote.name, url)
            else onAdd(name, url)
          }}
        />
      )}
    </div>
  )
}
