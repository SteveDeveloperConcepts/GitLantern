import { useCallback, useEffect, useRef, useState } from 'react'
import type { Branch, Commit, PullRequest, PullRequestList, RepoStatus } from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { Icon } from './Icon'
import { NewPullRequestDialog } from './NewPullRequestDialog'

const api = window.api

interface Props {
  repoPath: string
  status: RepoStatus | null
  branches: Branch[]
  commits: Commit[]
  busy: boolean
  /** Changes when the list may have changed: after a push, say. */
  reloadKey: number
  onConnectAccount(): void
  onCheckout(pr: PullRequest): void
  onCreated(pr: PullRequest, noun: string): void
  onPush(): void
}

/** Open pull requests (merge requests on GitLab) on the service that hosts the repository. */
export function PullRequestsPanel({ repoPath, status, branches, commits, busy, reloadKey, onConnectAccount, onCheckout, onCreated, onPush }: Props) {
  const [list, setList] = useState<PullRequestList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  // Only the newest request's answer counts.
  const generation = useRef(0)
  const load = useCallback(() => {
    const id = ++generation.current
    const current = () => id === generation.current
    setLoading(true)
    setError(null)
    api.pullRequests
      .list(repoPath)
      .then(
        (result) => current() && setList(result),
        (err: unknown) => current() && setError(errorMessage(err))
      )
      .finally(() => current() && setLoading(false))
  }, [repoPath])

  useEffect(() => setList(null), [repoPath])
  useEffect(load, [load, reloadKey])

  if (!list) {
    return (
      <div className="prs-panel">
        {error ? <p className="panel-error">{error}</p> : <div className="panel-loading">Looking for pull requests…</div>}
      </div>
    )
  }

  const noun = list.noun
  const nouns = `${noun}s`
  const head = status?.branch.head ?? null
  const mine = head ? list.items.find((pr) => pr.sameRepo && pr.sourceBranch === branchOnRemote(status, list.remote, head)) : undefined

  return (
    <div className="prs-panel">
      {list.unavailable === 'no-remote' && (
        <div className="empty-state">
          <p className="empty-title">No remote yet</p>
          <p>Add one on the Remotes tab, and its {nouns} show up here.</p>
        </div>
      )}
      {list.unavailable === 'no-account' && (
        <div className="empty-state">
          <p className="empty-title">Connect {list.service} to see {nouns}</p>
          <p>
            {list.remote} is on {list.service}. Connect your account there and its open {nouns} show up here.
          </p>
          <button className="primary" onClick={onConnectAccount}>
            Connect an account
          </button>
        </div>
      )}
      {list.unavailable === 'unsupported' && (
        <div className="empty-state">
          <p className="empty-title">Not available for this server</p>
          <p>GitLantern doesn’t know how to read {nouns} from {list.service}.</p>
        </div>
      )}
      {!list.unavailable && (
        <>
          <header className="prs-head">
            <h3>
              Open {nouns} · {list.items.length}
            </h3>
            <button className="icon-button small" onClick={load} disabled={loading} aria-label="Reload" title="Reload">
              <Icon name="refresh" size={14} />
            </button>
            <span className="spacer" />
            <button className="small-button" disabled={!head} onClick={() => setCreating(true)} title={head ? `Open a ${noun} from ${head}` : 'Check out a branch first'}>
              <Icon name="plus" size={14} /> New
            </button>
          </header>
          {error && <p className="panel-error">{error}</p>}
          {mine && (
            <p className="hint prs-mine">
              {head} already has <a href={mine.url} target="_blank" rel="noreferrer">#{mine.number}</a>.
            </p>
          )}
          {list.items.length === 0 ? (
            <div className="empty-state">
              <p>No open {nouns} on {list.service}.</p>
            </div>
          ) : (
            <ul className="pr-list">
              {list.items.map((pr) => (
                <li key={pr.number} className="pr-item" onDoubleClick={() => onCheckout(pr)} title={`${pr.title}\nDouble-click to check it out`}>
                  <div className="pr-title">
                    <span className="dim">#{pr.number}</span>
                    <a className="ellipsis" href={pr.url} target="_blank" rel="noreferrer">
                      {pr.title}
                    </a>
                    {pr.draft && <span className="chip small">Draft</span>}
                  </div>
                  <div className="pr-meta ellipsis">
                    {pr.sameRepo ? pr.sourceBranch : `fork: ${pr.sourceBranch}`} → {pr.targetBranch} · {pr.author}
                    {pr.updatedAt ? ` · ${formatRelative(pr.updatedAt / 1000)}` : ''}
                  </div>
                  <span className="pr-actions">
                    <button className="small-button" disabled={busy} onClick={() => onCheckout(pr)}>
                      Check out
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {creating && head && list.remote && (
        <NewPullRequestDialog
          repoPath={repoPath}
          noun={noun}
          service={list.service}
          remote={list.remote}
          branch={head}
          source={branchOnRemote(status, list.remote, head)}
          ahead={status?.branch.upstream ? (status.branch.ahead ?? 0) : 0}
          targets={branches
            .filter((b) => b.kind === 'remote' && b.name.startsWith(`${list.remote}/`))
            .map((b) => b.name.slice((list.remote ?? '').length + 1))}
          defaultTarget={list.defaultBranch}
          suggestedTitle={commits.find((c) => c.hash === status?.branch.oid)?.subject ?? ''}
          onPush={onPush}
          onCancel={() => setCreating(false)}
          onCreated={(pr) => {
            setCreating(false)
            onCreated(pr, noun)
            load()
          }}
        />
      )}
    </div>
  )
}

/** The branch the checked-out branch pushes to on `remote`, or null when it has none there yet. */
function branchOnRemote(status: RepoStatus | null, remote: string | null, head: string): string | null {
  const upstream = status?.branch.upstream
  if (!remote || !upstream?.startsWith(`${remote}/`)) return null
  return upstream.slice(remote.length + 1) || head
}
