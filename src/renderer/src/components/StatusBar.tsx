import { useEffect, useState } from 'react'
import type { RemoteInfo, RepoStatus } from '../../../shared/types'
import { formatRelative } from '../format'

interface Props {
  status: RepoStatus | null
  remotes: RemoteInfo[]
  busy: string | null
  message: string | null
  /** When the last fetch/pull/push finished, in ms. */
  lastSync: number | null
}

export function StatusBar({ status, remotes, busy, message, lastSync }: Props) {
  // Re-render every half minute so "x minutes ago" stays current.
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  const branch = status?.branch
  const changed = status?.entries.length ?? 0
  const upstreamRemote = branch?.upstream?.split('/')[0]
  const remote = remotes.find((r) => r.name === upstreamRemote) ?? remotes.find((r) => r.name === 'origin') ?? remotes[0]

  return (
    <footer className="statusbar">
      <span className="status-branch">{branch ? (branch.head ?? `detached at ${branch.oid?.slice(0, 7) ?? '?'}`) : '…'}</span>
      {branch?.upstream && <span>→ {branch.upstream}</span>}
      {branch && (branch.ahead > 0 || branch.behind > 0) && (
        <span title="Commits to push / to pull">
          ↑ {branch.ahead} ↓ {branch.behind}
        </span>
      )}
      <span>
        {changed} change{changed === 1 ? '' : 's'}
      </span>
      <span className="spacer" />
      <span className="status-activity" aria-live="polite">
        {busy ? (
          <>
            <span className="spinner" /> {busy}…
          </>
        ) : (
          (message ?? (lastSync ? `Synced ${formatRelative(lastSync / 1000)}` : null))
        )}
      </span>
      {remote && (
        <span className="status-account" title={remote.fetchUrl}>
          <span className={`dot ${remote.accountLogin || remote.protocol === 'ssh' ? 'ok' : 'muted'}`} />
          {remote.service}
          {remote.accountLogin ? ` · ${remote.accountLogin}` : remote.protocol === 'ssh' ? ' · SSH' : ''}
        </span>
      )}
    </footer>
  )
}
