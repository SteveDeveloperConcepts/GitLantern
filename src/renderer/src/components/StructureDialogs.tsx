import { useCallback, useEffect, useState } from 'react'
import type { Branch, LfsInfo, LfsLock, NewWorktree } from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { Modal } from './Modal'

const api = window.api

/** Join folder names the way the repository's own path does (backslashes on Windows). */
function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`
}

function parentFolder(folder: string): string {
  const trimmed = folder.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index > 0 ? trimmed.slice(0, index) : trimmed
}

const folderName = (name: string): string => name.replace(/[\\/:*?"<>|\s]+/g, '-')

interface WorktreeProps {
  repoPath: string
  repoName: string
  branches: Branch[]
  /** Branches already checked out in a worktree, which can't be checked out again. */
  busyBranches: string[]
  onConfirm(worktree: NewWorktree): void
  onCancel(): void
}

/** A second working folder for the same repository, on its own branch. */
export function WorktreeDialog({ repoPath, repoName, branches, busyBranches, onConfirm, onCancel }: WorktreeProps) {
  const free = branches.filter((b) => b.kind === 'local' && !busyBranches.includes(b.name))
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [newBranch, setNewBranch] = useState('')
  const [existing, setExisting] = useState(free[0]?.name ?? '')
  const [startPoint, setStartPoint] = useState('')
  const [parent, setParent] = useState(parentFolder(repoPath))
  const branch = mode === 'new' ? newBranch.trim() : existing
  const [folder, setFolder] = useState<string | null>(null)
  const location = folder ?? (branch ? joinPath(parent, `${repoName}-${folderName(branch)}`) : '')

  return (
    <Modal title="New worktree" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!branch || !location) return
          onConfirm(mode === 'new' ? { path: location, newBranch: branch, ...(startPoint ? { startPoint } : {}) } : { path: location, branch })
        }}
      >
        <p className="dialog-text">
          A worktree is another folder with its own checked-out branch, sharing this repository’s history. Work on two branches at once
          without stashing.
        </p>
        <div className="segmented choice" role="group" aria-label="Branch">
          <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
            New branch
          </button>
          <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')} disabled={free.length === 0}>
            Existing branch
          </button>
        </div>
        {mode === 'new' ? (
          <>
            <label className="field">
              <span className="field-label">Branch name</span>
              <input autoFocus value={newBranch} placeholder="feature/side-quest" onChange={(event) => setNewBranch(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Starting from</span>
              <select value={startPoint} onChange={(event) => setStartPoint(event.target.value)}>
                <option value="">The checked-out commit</option>
                {branches.map((b) => (
                  <option key={b.fullName} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="field">
            <span className="field-label">Branch</span>
            <select value={existing} onChange={(event) => setExisting(event.target.value)}>
              {free.map((b) => (
                <option key={b.fullName} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Folder</span>
          <span className="row-wrap">
            <input className="grow" value={location} onChange={(event) => setFolder(event.target.value)} placeholder="Where the worktree goes" />
            <button
              type="button"
              onClick={() =>
                void api.repo.pickSaveFolder('Put the worktree in').then((picked) => {
                  if (!picked) return
                  setParent(picked)
                  setFolder(null)
                })
              }
            >
              Browse…
            </button>
          </span>
          <span className="field-hint">A new folder; it’s created for you.</span>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!branch || !location}>
            Create worktree
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface SubmoduleProps {
  onConfirm(url: string, path: string): void
  onCancel(): void
}

/** Add another repository inside this one, pinned to a commit. */
export function SubmoduleDialog({ onConfirm, onCancel }: SubmoduleProps) {
  const [url, setUrl] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const guess = url.trim().replace(/\.git$/, '').split(/[/:]/).filter(Boolean).at(-1) ?? ''
  const target = path ?? (guess ? `libs/${guess}` : '')
  return (
    <Modal title="Add submodule" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (url.trim() && target.trim()) onConfirm(url.trim(), target.trim().replace(/\\/g, '/'))
        }}
      >
        <p className="dialog-text">
          Clones another repository into a folder here. This repository records which commit of it to use; committing records the change.
        </p>
        <label className="field">
          <span className="field-label">Address</span>
          <input autoFocus value={url} placeholder="https://github.com/owner/library.git" onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Folder inside this repository</span>
          <input value={target} placeholder="libs/library" onChange={(event) => setPath(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!url.trim() || !target.trim()}>
            Add submodule
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface LfsProps {
  repoPath: string
  onClose(): void
  /** Run an LFS command with the app's busy indicator and error reporting. */
  run(label: string, action: (repoPath: string) => Promise<void>, success: string): Promise<void>
}

/** Git LFS: whether it's set up, which patterns it stores, its files, and file locks. */
export function LfsDialog({ repoPath, onClose, run }: LfsProps) {
  const [info, setInfo] = useState<LfsInfo | null>(null)
  const [locks, setLocks] = useState<LfsLock[] | null>(null)
  const [locksError, setLocksError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pattern, setPattern] = useState('')
  const [lockPath, setLockPath] = useState('')

  const reload = useCallback(() => {
    api.git.lfs(repoPath).then(setInfo, (err: unknown) => setError(errorMessage(err)))
  }, [repoPath])
  useEffect(reload, [reload])

  const loadLocks = () => {
    setLocksError(null)
    api.git.lfsLocks(repoPath).then(setLocks, (err: unknown) => setLocksError(errorMessage(err)))
  }
  const act = (label: string, action: (path: string) => Promise<void>, success: string) => void run(label, action, success).then(reload)

  return (
    <Modal title="Git LFS" onClose={onClose} className="modal-wide">
      <div className="form">
        {error && <p className="test-fail">{error}</p>}
        {!info && !error && (
          <p className="dim">
            <span className="spinner" /> Checking Git LFS…
          </p>
        )}
        {info && !info.installed && (
          <p className="dialog-text">
            Git LFS isn’t installed. It comes with Git for Windows; elsewhere install it from git-lfs.com (or <span className="mono">brew install git-lfs</span>
            ), then open this again.
          </p>
        )}
        {info?.installed && (
          <>
            <p className="dialog-text">
              Large File Storage keeps big files (images, videos, builds) on the server and only small pointers in the history.
              {info.version ? ` Git LFS ${info.version.replace(/^git-lfs\//, '').split(' ')[0]}.` : ''}
            </p>
            <div className="row-wrap">
              <button onClick={() => act('Setting up Git LFS', api.git.lfsInstall, 'Git LFS is set up for this repository')}>Set up here</button>
              <button onClick={() => act('Downloading LFS files', api.git.lfsPull, 'Downloaded the LFS files')}>Pull files</button>
              <button onClick={() => act('Uploading LFS files', api.git.lfsPush, 'Uploaded the LFS files')}>Push files</button>
            </div>
            <section className="dialog-section">
              <h3>Stored with LFS · {info.patterns.length}</h3>
              {info.patterns.length === 0 && <p className="dim">No patterns yet. Add one like *.psd to store those files with LFS.</p>}
              <ul className="plain-list">
                {info.patterns.map((p) => (
                  <li key={p}>
                    <span className="mono">{p}</span>
                    <button className="link danger" onClick={() => act(`Untracking ${p}`, (path) => api.git.lfsUntrack(path, p), `${p} is no longer stored with LFS`)}>
                      Stop
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="row-wrap"
                onSubmit={(event) => {
                  event.preventDefault()
                  const value = pattern.trim()
                  if (!value) return
                  setPattern('')
                  act(`Tracking ${value}`, (path) => api.git.lfsTrack(path, value), `${value} is stored with LFS (commit .gitattributes)`)
                }}
              >
                <input className="grow" value={pattern} placeholder="*.psd" onChange={(event) => setPattern(event.target.value)} aria-label="Pattern" />
                <button type="submit" disabled={!pattern.trim()}>
                  Add pattern
                </button>
              </form>
            </section>
            <section className="dialog-section">
              <h3>Files · {info.files.length}</h3>
              {info.files.length === 0 && <p className="dim">No files are stored with LFS yet.</p>}
              <ul className={`plain-list${info.files.length > 0 ? ' scroll' : ''}`}>
                {info.files.slice(0, 500).map((file) => (
                  <li key={file.path}>
                    <span className="ellipsis">{file.path}</span>
                    <span className={`chip ${file.downloaded ? 'chip-ok' : ''}`}>{file.downloaded ? 'downloaded' : 'pointer only'}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="dialog-section">
              <h3>
                Locks {locks ? `· ${locks.length}` : ''}
                <button className="link" onClick={loadLocks}>
                  {locks ? 'Refresh' : 'Load from the server'}
                </button>
              </h3>
              {locksError && <p className="test-fail">{locksError}</p>}
              {locks && (
                <ul className="plain-list">
                  {locks.map((lock) => (
                    <li key={lock.id}>
                      <span className="ellipsis">{lock.path}</span>
                      <span className="dim">
                        {lock.owner} · {formatRelative(lock.lockedAt)}
                      </span>
                      <button
                        className="link danger"
                        onClick={() =>
                          void run(`Unlocking ${lock.path}`, (path) => api.git.lfsUnlock(path, lock.path, false), `Unlocked ${lock.path}`).then(loadLocks)
                        }
                      >
                        Unlock
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="row-wrap"
                onSubmit={(event) => {
                  event.preventDefault()
                  const value = lockPath.trim()
                  if (!value) return
                  setLockPath('')
                  void run(`Locking ${value}`, (path) => api.git.lfsLock(path, value), `Locked ${value}`).then(loadLocks)
                }}
              >
                <input className="grow" value={lockPath} placeholder="art/hero.psd" onChange={(event) => setLockPath(event.target.value)} aria-label="File to lock" />
                <button type="submit" disabled={!lockPath.trim()}>
                  Lock file
                </button>
              </form>
            </section>
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  )
}
