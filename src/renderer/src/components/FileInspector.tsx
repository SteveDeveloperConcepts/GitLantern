import { useEffect, useMemo, useState } from 'react'
import type { BlameResult, DiffTarget, FileHistoryEntry } from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { Avatar } from './Avatar'
import { DiffView } from './DiffView'
import { Modal } from './Modal'

const api = window.api
const MAX_BLAME_LINES = 20_000

export type InspectView = 'history' | 'blame'

interface Props {
  repoPath: string
  path: string
  view: InspectView
  onView(view: InspectView): void
  /** Show a commit in the graph (and close this). */
  onShowCommit(hash: string): void
  onError(message: string): void
  onClose(): void
}

/** One file's history (every commit that changed it, across renames) and its blame. */
export function FileInspector({ repoPath, path, view, onView, onShowCommit, onError, onClose }: Props) {
  return (
    <Modal title={path} onClose={onClose} className="modal-full">
      <div className="inspector">
        <div className="segmented small inspector-tabs" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'history'} aria-pressed={view === 'history'} onClick={() => onView('history')}>
            History
          </button>
          <button role="tab" aria-selected={view === 'blame'} aria-pressed={view === 'blame'} onClick={() => onView('blame')}>
            Blame
          </button>
        </div>
        {view === 'history' ? (
          <FileHistory repoPath={repoPath} path={path} onShowCommit={onShowCommit} onError={onError} />
        ) : (
          <Blame repoPath={repoPath} path={path} onShowCommit={onShowCommit} />
        )}
      </div>
    </Modal>
  )
}

function FileHistory({ repoPath, path, onShowCommit, onError }: { repoPath: string; path: string; onShowCommit(hash: string): void; onError(message: string): void }) {
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<FileHistoryEntry | null>(null)
  // One object per entry: DiffView reloads whenever its target changes.
  const target = useMemo<DiffTarget | null>(
    () => (open ? { kind: 'commit', hash: open.commit.hash, path: open.path, ...(open.origPath ? { origPath: open.origPath } : {}) } : null),
    [open]
  )

  useEffect(() => {
    api.git.fileHistory(repoPath, path).then(
      (list) => {
        setEntries(list)
        setOpen(list[0] ?? null)
      },
      (err: unknown) => setError(errorMessage(err))
    )
  }, [repoPath, path])

  if (error) return <div className="panel-error">{error}</div>
  if (!entries) return <div className="panel-loading">Loading history…</div>
  if (entries.length === 0) return <div className="empty">No commits have changed this file yet.</div>

  return (
    <div className="inspector-split">
      <ul className="history-list" aria-label="Commits that changed the file">
        {entries.map((entry) => (
          <li key={entry.commit.hash}>
            <button className={`history-item${open?.commit.hash === entry.commit.hash ? ' selected' : ''}`} onClick={() => setOpen(entry)}>
              <Avatar name={entry.commit.authorName} email={entry.commit.authorEmail} />
              <span className="history-text">
                <span className="ellipsis">{entry.commit.subject}</span>
                <span className="dim ellipsis">
                  {entry.commit.authorName} · {formatRelative(entry.commit.authorDate)} · <span className="mono">{entry.commit.hash.slice(0, 7)}</span>
                  {entry.origPath ? ` · renamed from ${entry.origPath}` : ''}
                </span>
              </span>
              <span className={`file-status status-${entry.status}`}>{entry.status}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && target && (
        <div className="inspector-diff">
          <div className="inspector-diff-head">
            <span className="ellipsis">{open.commit.subject}</span>
            <button className="link" onClick={() => onShowCommit(open.commit.hash)}>
              Show in history
            </button>
          </div>
          <DiffView repoPath={repoPath} target={target} onError={onError} />
        </div>
      )}
    </div>
  )
}

/** Consecutive lines from the same commit, shown with one annotation. */
interface BlameGroup {
  hash: string
  start: number
  lines: { number: number; text: string }[]
}

function Blame({ repoPath, path, onShowCommit }: { repoPath: string; path: string; onShowCommit(hash: string): void }) {
  const [result, setResult] = useState<BlameResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    api.git.blame(repoPath, path).then(setResult, (err: unknown) => setError(errorMessage(err)))
  }, [repoPath, path])

  const groups = useMemo(() => {
    const list: BlameGroup[] = []
    for (const line of result?.lines.slice(0, MAX_BLAME_LINES) ?? []) {
      const last = list.at(-1)
      if (last && last.hash === line.hash) last.lines.push(line)
      else list.push({ hash: line.hash, start: line.number, lines: [line] })
    }
    return list
  }, [result])

  // Older lines get a fainter bar, so recent changes stand out.
  const ages = useMemo(() => {
    const dates = Object.values(result?.commits ?? {}).map((c) => c.authorDate)
    const oldest = Math.min(...dates)
    const newest = Math.max(...dates)
    return (date: number) => (newest === oldest ? 1 : 0.25 + (0.75 * (date - oldest)) / (newest - oldest))
  }, [result])

  if (error) return <div className="panel-error">{error}</div>
  if (!result) return <div className="panel-loading">Working out who changed each line…</div>
  if (result.binary) return <div className="empty">This is a binary file, so it has no lines to blame.</div>

  return (
    <div className="blame" role="table" aria-label={`Blame of ${path}`}>
      {groups.map((group) => {
        const commit = result.commits[group.hash]
        return (
          <div
            key={`${group.hash}:${group.start}`}
            className={`blame-group${hover === group.hash ? ' hovered' : ''}`}
            onMouseEnter={() => setHover(group.hash)}
            onMouseLeave={() => setHover(null)}
            role="rowgroup"
          >
            <div className="blame-info" style={{ borderLeftColor: `rgba(232, 163, 61, ${commit ? ages(commit.authorDate) : 0})` }}>
              {commit?.uncommitted ? (
                <span className="dim">Not committed yet</span>
              ) : (
                <>
                  <button className="link mono" onClick={() => onShowCommit(group.hash)} title={commit?.summary}>
                    {group.hash.slice(0, 7)}
                  </button>
                  <span className="ellipsis" title={commit?.summary}>
                    {commit?.summary}
                  </span>
                  <span className="dim nowrap">
                    {commit?.authorName} · {commit ? formatRelative(commit.authorDate) : ''}
                  </span>
                </>
              )}
            </div>
            <div className="blame-lines">
              {group.lines.map((line) => (
                <div key={line.number} className="blame-line" role="row">
                  <span className="ln" role="cell">
                    {line.number}
                  </span>
                  <span className="code" role="cell">
                    {line.text || ' '}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {result.lines.length > MAX_BLAME_LINES && <div className="diff-line diff-note">… {result.lines.length - MAX_BLAME_LINES} more lines not shown …</div>}
    </div>
  )
}
