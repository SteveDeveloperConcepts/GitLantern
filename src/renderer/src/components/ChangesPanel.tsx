import { useEffect, useState } from 'react'
import type { CommitTemplate, DiffTarget, RepoStatus, StatusEntry } from '../../../shared/types'
import { OPERATION_NAMES } from '../branchMenus'
import { errorMessage } from '../format'
import { ConventionalDialog } from './ConventionalDialog'
import { FileList, type FileListItem } from './FileList'
import { joinMessage, splitMessage } from './HistoryDialogs'
import { Icon } from './Icon'
import { Menu } from './Menu'

const api = window.api

/** Which list a right-clicked file is in. */
export type ChangeList = 'unstaged' | 'staged'

interface Props {
  repoPath: string
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
  /** Amend the last commit: add what's staged, and replace the message unless it's null. */
  onAmend(message: string | null): void
  onFileMenu(path: string, list: ChangeList, untracked: boolean, position: { x: number; y: number }): void
  onError(message: string): void
  templates: CommitTemplate[]
  /** The file Git's commit.template points at, read in; empty when there's none. */
  gitTemplate: string
  conventionalCommits: boolean
  /** The repository has a commit to amend. */
  canAmend: boolean
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

export function ChangesPanel(props: Props) {
  const { repoPath, status, busy, openTarget, onOpenDiff, onStage, onUnstage, onDiscard, onCommit, onAmend, onFileMenu, onError } = props
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  /** The last commit's message when amending started, to tell whether it was changed. */
  const [original, setOriginal] = useState<string | null>(null)
  /** What was typed before amending, put back when amending is turned off. */
  const [typed, setTyped] = useState<{ summary: string; description: string } | null>(null)
  const [conventional, setConventional] = useState(false)
  const [generating, setGenerating] = useState(false)

  // A commit or a change of repository ends amending.
  useEffect(() => {
    setAmend(false)
    setOriginal(null)
  }, [repoPath])

  if (!status) return <div className="panel-loading">Loading…</div>

  const unstaged = status.entries.filter((e) => e.untracked || e.conflicted || e.worktree !== null)
  const staged = status.entries.filter((e) => !e.conflicted && e.index !== null)
  const untracked = new Set(unstaged.filter((e) => e.untracked).map((e) => e.path))
  const conflicted = new Set(unstaged.filter((e) => e.conflicted).map((e) => e.path))
  const message = summary.trim() ? joinMessage(summary, description) : ''
  const messageChanged = original !== null && message !== joinMessage(splitMessage(original).summary, splitMessage(original).description)
  const canCommit = !busy && summary.trim().length > 0 && (amend ? staged.length > 0 || messageChanged : staged.length > 0)
  const selectedKey = openTarget && openTarget.kind !== 'commit' ? `${openTarget.kind}:${openTarget.path}` : null
  const branchName = status.branch.head ?? 'detached HEAD'

  const fill = (text: { summary: string; description: string }) => {
    setSummary(text.summary)
    setDescription(text.description)
  }

  const toggleAmend = (on: boolean) => {
    if (!on) {
      setAmend(false)
      setOriginal(null)
      fill(typed ?? { summary: '', description: '' })
      return
    }
    void api.git.headMessage(repoPath).then(
      (text) => {
        setTyped({ summary, description })
        setOriginal(text)
        fill(splitMessage(text))
        setAmend(true)
      },
      (err: unknown) => onError(errorMessage(err))
    )
  }

  const commit = () => {
    if (!canCommit) return
    if (amend) onAmend(messageChanged ? message : null)
    else onCommit(message)
    setAmend(false)
    setOriginal(null)
    setTyped(null)
    fill({ summary: '', description: '' })
  }

  const generate = () => {
    setGenerating(true)
    api.ai
      .commitMessage(repoPath)
      .then((text) => fill(splitMessage(text)), (err: unknown) => onError(errorMessage(err)))
      .finally(() => setGenerating(false))
  }

  const templates = [
    ...(props.gitTemplate.trim() ? [{ id: 'git', name: 'From Git’s commit.template', text: props.gitTemplate }] : []),
    ...props.templates
  ]
  const menuFor = (list: ChangeList) => (item: FileListItem, position: { x: number; y: number }) =>
    onFileMenu(item.path, list, untracked.has(item.path), position)

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
              onContextMenu={menuFor('unstaged')}
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
              onContextMenu={menuFor('staged')}
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
          <div className="commit-form-head">
            <label htmlFor="commit-summary" className="field-label">
              {amend ? 'Amend the last commit' : 'Commit message'}
            </label>
            <span className="commit-tools">
              {props.conventionalCommits && (
                <button type="button" className="link" onClick={() => setConventional(true)} title="Write a Conventional Commits message">
                  feat/fix…
                </button>
              )}
              {templates.length > 0 && (
                <Menu
                  label="Templates"
                  triggerClassName="link"
                  trigger="Templates"
                  groups={[templates.map((template) => ({ key: template.id, label: template.name, onSelect: () => fill(splitMessage(template.text)) }))]}
                />
              )}
              <button
                type="button"
                className="icon-button small"
                disabled={generating || busy || staged.length === 0}
                onClick={generate}
                title={staged.length === 0 ? 'Stage changes first, then let AI write the message' : 'Write the message with AI from the staged changes (Settings → AI)'}
                aria-label="Write the message with AI"
              >
                {generating ? <span className="spinner" /> : <Icon name="sparkle" size={14} />}
              </button>
            </span>
          </div>
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
          <label className="checkbox compact" title="Add the staged changes to the last commit, and change its message if you like">
            <input type="checkbox" checked={amend} disabled={!props.canAmend || busy} onChange={(event) => toggleAmend(event.target.checked)} />
            Amend last commit
          </label>
          <button type="submit" className="primary large" disabled={!canCommit}>
            {amend
              ? staged.length > 0
                ? `Amend with ${staged.length} file${staged.length === 1 ? '' : 's'}`
                : 'Amend message'
              : staged.length > 0
                ? `Commit ${staged.length} file${staged.length === 1 ? '' : 's'} to ${branchName}`
                : 'Stage files to commit'}
          </button>
          <span className="hint center">Ctrl / ⌘ + Enter</span>
        </form>
      )}
      {conventional && (
        <ConventionalDialog
          onCancel={() => setConventional(false)}
          onConfirm={(text) => {
            setConventional(false)
            fill(text)
          }}
        />
      )}
    </div>
  )
}
