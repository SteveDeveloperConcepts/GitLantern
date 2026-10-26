import { useState } from 'react'
import type { DiffTarget, RepoStatus, StatusEntry } from '../../../shared/types'
import { OPERATION_NAMES } from '../branchMenus'
import { FileList, type FileListItem } from './FileList'
import { Icon } from './Icon'

interface Props {
  status: RepoStatus | null
  busy: boolean
  /** The working-copy diff currently shown, to highlight its file. */
  openTarget: DiffTarget | null
  onOpenDiff(target: DiffTarget): void
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  /** Throw away unstaged changes to these files (asks first). */
  onDiscard(paths: string[]): void
  onCommit(message: string): void
}

const unstagedItem = (entry: StatusEntry): FileListItem => ({
  key: `worktree:${entry.path}`,
  path: entry.path,
  status: entry.untracked ? '?' : entry.conflicted ? 'U' : (entry.worktree ?? 'M')
})

const stagedItem = (entry: StatusEntry): FileListItem => ({
  key: `index:${entry.path}`,
  path: entry.path,
  ...(entry.origPath ? { origPath: entry.origPath } : {}),
  status: entry.index ?? 'M'
})

export function ChangesPanel({ status, busy, openTarget, onOpenDiff, onStage, onUnstage, onDiscard, onCommit }: Props) {
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')

  if (!status) return <div className="panel-loading">Loading…</div>

  const unstaged = status.entries.filter((e) => e.untracked || e.conflicted || e.worktree !== null)
  const staged = status.entries.filter((e) => !e.conflicted && e.index !== null)
  const untracked = new Set(unstaged.filter((e) => e.untracked).map((e) => e.path))
  const conflicted = new Set(unstaged.filter((e) => e.conflicted).map((e) => e.path))
  const canCommit = !busy && staged.length > 0 && summary.trim().length > 0
  const selectedKey = openTarget && openTarget.kind !== 'commit' ? `${openTarget.kind}:${openTarget.path}` : null
  const branchName = status.branch.head ?? 'detached HEAD'

  const commit = () => {
    if (!canCommit) return
    const body = description.trim()
    onCommit(body ? `${summary.trim()}\n\n${body}\n` : `${summary.trim()}\n`)
    setSummary('')
    setDescription('')
  }

  return (
    <div className="changes-panel">
      <div className="changes-lists">
        {status.entries.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">Working copy is clean</p>
            <p>Edit files in this repository and they’ll show up here.</p>
          </div>
        )}
        {unstaged.length > 0 && (
          <section className="changes-section">
            <header>
              <h3>Unstaged · {unstaged.length}</h3>
              <span>
                <button
                  className="link danger"
                  disabled={busy || unstaged.every((e) => e.conflicted)}
                  onClick={() => onDiscard(unstaged.filter((e) => !e.conflicted).map((e) => e.path))}
                >
                  Discard all
                </button>
                <button className="link" disabled={busy} onClick={() => onStage(unstaged.map((e) => e.path))}>
                  Stage all
                </button>
              </span>
            </header>
            <FileList
              items={unstaged.map(unstagedItem)}
              selectedKey={selectedKey}
              onOpen={(item) =>
                onOpenDiff({
                  kind: 'worktree',
                  path: item.path,
                  untracked: untracked.has(item.path),
                  conflicted: conflicted.has(item.path)
                })
              }
              actions={[
                {
                  label: <Icon name="discard" size={14} />,
                  title: 'Discard changes to',
                  run: (item) => onDiscard([item.path]),
                  hidden: (item) => conflicted.has(item.path)
                },
                { label: '+', title: 'Stage', run: (item) => onStage([item.path]) }
              ]}
            />
          </section>
        )}
        {staged.length > 0 && (
          <section className="changes-section">
            <header>
              <h3>Staged · {staged.length}</h3>
              <button className="link" disabled={busy} onClick={() => onUnstage(staged.map((e) => e.path))}>
                Unstage all
              </button>
            </header>
            <FileList
              items={staged.map(stagedItem)}
              selectedKey={selectedKey}
              onOpen={(item) => onOpenDiff({ kind: 'index', path: item.path })}
              actions={[{ label: '−', title: 'Unstage', run: (item) => onUnstage([item.path]) }]}
            />
          </section>
        )}
      </div>

      {status.operation ? (
        <div className="commit-form operation-note">
          Click a conflicted file to pick a side for each conflict (it’s staged once none are left), or fix it in your editor and
          stage it.{' '}
          {status.operation.kind === 'merge'
            ? 'Then click Finish merge at the top to commit the merge.'
            : `Then click Continue at the top to go on with the ${OPERATION_NAMES[status.operation.kind]}.`}
        </div>
      ) : (
        <form
          className="commit-form"
          onSubmit={(event) => {
            event.preventDefault()
            commit()
          }}
        >
          <label htmlFor="commit-summary" className="field-label">
            Commit message
          </label>
          <input
            id="commit-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commit()
            }}
            placeholder="Summary (required)"
            maxLength={200}
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commit()
            }}
            placeholder="Description (optional)"
            rows={3}
            aria-label="Commit description"
          />
          <button type="submit" className="primary large" disabled={!canCommit}>
            {staged.length > 0
              ? `Commit ${staged.length} file${staged.length === 1 ? '' : 's'} to ${branchName}`
              : 'Stage files to commit'}
          </button>
          <span className="hint center">Ctrl / ⌘ + Enter</span>
        </form>
      )}
    </div>
  )
}
