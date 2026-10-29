import { useEffect, useMemo, useState } from 'react'
import { providerInfo } from '../../../shared/providers'
import { parseRemoteUrl, repoNameFromUrl, serviceName } from '../../../shared/remoteUrl'
import type { Account, CloneProgress, HostedRepo, RepoInfo } from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const api = window.api

interface Props {
  onClose(): void
  onCloned(repo: RepoInfo): void
  onManageAccounts(): void
}

function describe(url: string, accounts: Account[]): { ok: boolean; text: string } | null {
  if (!url.trim()) return null
  const parsed = parseRemoteUrl(url)
  if (!parsed) return { ok: false, text: 'Paste an address like https://host/owner/repo.git or git@host:owner/repo.git' }
  if (parsed.protocol === 'file') return { ok: true, text: 'A folder on this computer' }
  if (parsed.protocol === 'ssh') return { ok: true, text: `${serviceName(url)} over SSH · uses your SSH key` }
  const account = accounts.find((a) => a.host === parsed.host)
  if (account) {
    return { ok: true, text: `${providerInfo(account.provider).name} over HTTPS · signed in as ${account.login}, so no password prompt` }
  }
  return { ok: false, text: `${serviceName(url)} over HTTPS · you’ll be asked to sign in, or connect an account first` }
}

export function CloneDialog({ onClose, onCloned, onManageAccounts }: Props) {
  const [url, setUrl] = useState('')
  const [folder, setFolder] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState<string | null>(null)
  const [repos, setRepos] = useState<HostedRepo[] | null>(null)
  const [reposError, setReposError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<HostedRepo | null>(null)
  const [useSsh, setUseSsh] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.repo.defaultCloneFolder().then(setFolder)
    void api.accounts.list().then((list) => {
      setAccounts(list)
      setAccountId(list.find((a) => a.provider !== 'generic')?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    setRepos(null)
    setReposError(null)
    api.accounts.repos(accountId).then(
      (list) => !cancelled && setRepos(list),
      (err: unknown) => !cancelled && setReposError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [accountId])

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return (repos ?? []).filter((r) => !term || `${r.owner}/${r.name} ${r.description}`.toLowerCase().includes(term))
  }, [repos, filter])

  const pick = (repo: HostedRepo, ssh = useSsh) => {
    setPicked(repo)
    setUrl(ssh && repo.sshUrl ? repo.sshUrl : repo.cloneUrl)
  }

  const cloning = progress !== null
  const valid = parseRemoteUrl(url) !== null && folder.trim().length > 0
  const separator = folder.includes('\\') ? '\\' : '/'
  const target = folder && url ? `${folder.replace(/[\\/]+$/, '')}${separator}${repoNameFromUrl(url)}` : ''
  const hint = describe(url, accounts)

  const clone = async () => {
    if (!valid || cloning) return
    setError(null)
    setProgress({ phase: 'Starting', percent: null })
    const stop = api.repo.onCloneProgress(setProgress)
    try {
      onCloned(await api.repo.clone(url.trim(), folder.trim()))
    } catch (err) {
      setError(errorMessage(err))
      setProgress(null)
    } finally {
      stop()
    }
  }

  return (
    <Modal title="Clone a repository" onClose={() => !cloning && onClose()} className="modal-wide">
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          void clone()
        }}
      >
        <div className="field">
          <label htmlFor="clone-url">Repository address</label>
          <input
            id="clone-url"
            className="mono"
            autoFocus
            value={url}
            placeholder="https://github.com/owner/repo.git or git@gitlab.com:owner/repo.git"
            onChange={(event) => {
              setUrl(event.target.value)
              setPicked(null)
            }}
            disabled={cloning}
          />
          {hint && (
            <span className={`field-hint ${hint.ok ? 'hint-ok' : ''}`}>
              {hint.ok && <Icon name="check" size={14} />} {hint.text}
            </span>
          )}
        </div>

        <div className="or-divider">
          <span>or pick from your accounts</span>
        </div>

        {accounts.filter((a) => a.provider !== 'generic').length === 0 ? (
          <div className="callout">
            <p>Connect GitHub, GitLab, Bitbucket, Azure DevOps or Gitea to browse your repositories here.</p>
            <button type="button" onClick={onManageAccounts}>
              <Icon name="link" size={15} /> Connect an account
            </button>
          </div>
        ) : (
          <>
            <div className="row-wrap">
              <select
                aria-label="Account"
                value={accountId ?? ''}
                onChange={(event) => setAccountId(event.target.value)}
                disabled={cloning}
              >
                {accounts
                  .filter((a) => a.provider !== 'generic')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {providerInfo(a.provider).name} · {a.login}
                    </option>
                  ))}
              </select>
              <input
                aria-label="Filter repositories"
                placeholder="Filter repositories"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="repo-list" role="listbox" aria-label="Repositories">
              {reposError && <p className="panel-error">{reposError}</p>}
              {!repos && !reposError && <p className="panel-loading">Loading repositories…</p>}
              {repos && visible.length === 0 && <p className="panel-loading">No repositories match.</p>}
              {visible.map((repo) => (
                <button
                  type="button"
                  key={repo.id}
                  role="option"
                  aria-selected={picked?.id === repo.id}
                  className={`repo-option${picked?.id === repo.id ? ' selected' : ''}`}
                  onClick={() => pick(repo)}
                  onDoubleClick={() => void clone()}
                  disabled={cloning}
                >
                  <span className="repo-text">
                    <span>
                      <span className="dim">{repo.owner} / </span>
                      <strong>{repo.name}</strong>
                    </span>
                    {repo.description && <span className="repo-description">{repo.description}</span>}
                  </span>
                  {repo.private && <span className="chip">Private</span>}
                  {repo.updatedAt && <span className="repo-updated">{formatRelative(repo.updatedAt / 1000)}</span>}
                </button>
              ))}
            </div>
            {picked?.sshUrl && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={useSsh}
                  onChange={(event) => {
                    setUseSsh(event.target.checked)
                    pick(picked, event.target.checked)
                  }}
                />
                Clone over SSH instead of HTTPS
              </label>
            )}
          </>
        )}

        <div className="field">
          <label htmlFor="clone-folder">Clone into</label>
          <div className="row">
            <input
              id="clone-folder"
              className="mono"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              disabled={cloning}
              // The App Store version may only write in a folder picked with Browse….
              readOnly={api.appStore}
              placeholder={api.appStore ? 'Choose a folder with Browse…' : undefined}
            />
            <button
              type="button"
              disabled={cloning}
              onClick={() => void api.repo.pickFolder().then((picked) => picked && setFolder(picked))}
            >
              Browse…
            </button>
          </div>
          {target && (
            <span className="field-hint">
              Creates <span className="mono">{target}</span>
            </span>
          )}
        </div>

        {error && <p className="panel-error">{error}</p>}
        {progress && (
          <div className="progress" aria-live="polite">
            <div className="progress-track">
              <div
                className={`progress-bar${progress.percent === null ? ' indeterminate' : ''}`}
                style={progress.percent === null ? undefined : { width: `${progress.percent}%` }}
              />
            </div>
            <span className="dim">
              {progress.phase}
              {progress.percent !== null ? ` · ${progress.percent}%` : '…'}
            </span>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="link left" onClick={onManageAccounts} disabled={cloning}>
            Manage accounts
          </button>
          <button type="button" onClick={onClose} disabled={cloning}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid || cloning}>
            {cloning ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
