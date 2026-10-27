import { useEffect, useState } from 'react'
import type { BranchComparison, RebaseCommit, RebaseStep, ResetMode } from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const api = window.api
const commits = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`

const RESET_MODES: { mode: ResetMode; title: string; text: string }[] = [
  { mode: 'soft', title: 'Soft', text: 'Keep every change, staged: the commits after it become one set of staged changes to commit again.' },
  { mode: 'mixed', title: 'Mixed', text: 'Keep every change in your files, unstaged. Nothing in your working copy is lost.' },
  { mode: 'hard', title: 'Hard', text: 'Throw away the commits after it and every uncommitted change. Your files match the commit exactly.' }
]

interface ResetProps {
  repoPath: string
  hash: string
  subject: string
  current: string
  upstream: string | null
  onConfirm(mode: ResetMode): void
  onCancel(): void
}

/** Move the current branch to another commit, after explaining what each mode keeps. */
export function ResetDialog({ repoPath, hash, subject, current, upstream, onConfirm, onCancel }: ResetProps) {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [comparison, setComparison] = useState<BranchComparison | null>(null)
  const [sure, setSure] = useState(false)

  useEffect(() => {
    api.git.compare(repoPath, hash).then(setComparison, () => setComparison(null))
  }, [repoPath, hash])

  const leaving = comparison?.ahead ?? 0
  return (
    <Modal title={`Reset ${current} to ${hash.slice(0, 7)}`} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (mode !== 'hard' || sure) onConfirm(mode)
        }}
      >
        <p className="dialog-text">
          {current} will point at <span className="mono">{hash.slice(0, 7)}</span> “{subject}”.
          {comparison && leaving > 0 && ` ${commits(leaving)} after it leave the branch.`}
          {comparison && comparison.behind > 0 && ` It also moves ${current} onto ${commits(comparison.behind)} it doesn’t have yet.`}
        </p>
        <div className="radio-cards" role="radiogroup" aria-label="What to keep">
          {RESET_MODES.map((option) => (
            <label key={option.mode} className={`radio-card${mode === option.mode ? ' selected' : ''}${option.mode === 'hard' ? ' danger' : ''}`}>
              <input type="radio" name="reset-mode" checked={mode === option.mode} onChange={() => setMode(option.mode)} />
              <span>
                <strong>{option.title}</strong>
                <span className="dim">{option.text}</span>
              </span>
            </label>
          ))}
        </div>
        {comparison && comparison.published > 0 && (
          <div className="notice warning">
            <Icon name="warning" size={16} />
            <p>
              {comparison.published === leaving ? 'They are' : `${comparison.published} of them are`} already on {upstream ?? 'the remote'}. Pushing
              afterwards takes a force push, which removes them there too.
            </p>
          </div>
        )}
        {mode === 'hard' && (
          <label className="checkbox">
            <input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} />
            I understand uncommitted changes are lost for good
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="submit" className={mode === 'hard' ? 'primary danger-fill' : 'primary'} disabled={mode === 'hard' && !sure}>
            Reset
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Split a whole commit message into its summary line and the rest. */
export function splitMessage(message: string): { summary: string; description: string } {
  const trimmed = message.replace(/\s+$/, '')
  const newline = trimmed.indexOf('\n')
  if (newline === -1) return { summary: trimmed, description: '' }
  return { summary: trimmed.slice(0, newline).trim(), description: trimmed.slice(newline + 1).replace(/^\n+/, '') }
}

export function joinMessage(summary: string, description: string): string {
  const body = description.trim()
  return body ? `${summary.trim()}\n\n${body}\n` : `${summary.trim()}\n`
}

interface MessageProps {
  title: string
  intro: string
  initial: string
  confirm: string
  onConfirm(message: string): void
  onCancel(): void
}

/** Edit a commit message: summary line and description. */
export function MessageDialog({ title, intro, initial, confirm, onConfirm, onCancel }: MessageProps) {
  const start = splitMessage(initial)
  const [summary, setSummary] = useState(start.summary)
  const [description, setDescription] = useState(start.description)
  const changed = joinMessage(summary, description) !== joinMessage(start.summary, start.description)
  return (
    <Modal title={title} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (summary.trim() && changed) onConfirm(joinMessage(summary, description))
        }}
      >
        <p className="dialog-text">{intro}</p>
        <input autoFocus value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Summary" aria-label="Summary" />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={6} placeholder="Description (optional)" aria-label="Description" />
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!summary.trim() || !changed}>
            {confirm}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const ACTIONS: { action: RebaseStep['action']; label: string; hint: string }[] = [
  { action: 'pick', label: 'Keep', hint: 'Keep the commit as it is' },
  { action: 'reword', label: 'Edit message', hint: 'Keep the changes, write a new message' },
  { action: 'squash', label: 'Squash', hint: 'Fold into the commit above, combining the messages' },
  { action: 'fixup', label: 'Fixup', hint: 'Fold into the commit above, dropping this message' },
  { action: 'edit', label: 'Stop to amend', hint: 'Stop after this commit so you can change it, then Continue' },
  { action: 'drop', label: 'Drop', hint: 'Leave the commit out' }
]

interface Row extends RebaseCommit {
  action: RebaseStep['action']
  /** The new message for reword, or for the commit a squash makes. */
  newMessage: string
}

interface RebaseProps {
  repoPath: string
  /** The commit the rewritten ones go on top of; null to rewrite from the very first commit. */
  base: string | null
  current: string
  /** Start with one commit already set, from a shortcut like "Squash into parent". */
  preset?: { hash: string; action: RebaseStep['action'] }
  /** The branch's upstream, to warn when rewritten commits were already pushed there. */
  upstream: string | null
  onConfirm(steps: RebaseStep[]): void
  onCancel(): void
}

/** Interactive rebase: reorder, squash, fix up, reword, stop at or drop the commits after `base`. */
export function RebaseDialog({ repoPath, base, current, preset, upstream, onConfirm, onCancel }: RebaseProps) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  /** The commits' hashes in the order git listed them, oldest first. */
  const [original, setOriginal] = useState<string[]>([])

  // Rewriting from the first commit rewrites whatever was pushed; otherwise ask git how much of it was.
  useEffect(() => {
    if (!upstream) setPublished(false)
    else if (base === null) setPublished(true)
    else api.git.compare(repoPath, base).then((c) => setPublished(c.published > 0), () => setPublished(false))
  }, [repoPath, base, upstream])

  useEffect(() => {
    api.git.rebaseCommits(repoPath, base).then(
      (list) => {
        setOriginal(list.map((commit) => commit.hash))
        setRows(
          list.map((commit) => {
            const action = preset?.hash === commit.hash ? preset.action : 'pick'
            return { ...commit, action, newMessage: commit.message }
          })
        )
        if (preset && (preset.action === 'reword' || preset.action === 'squash')) setOpen(preset.hash)
      },
      (err: unknown) => setError(errorMessage(err))
    )
    // The preset only applies when the dialog opens, so it isn't a dependency.
  }, [repoPath, base])

  const update = (hash: string, change: Partial<Row>) => setRows((list) => list?.map((row) => (row.hash === hash ? { ...row, ...change } : row)) ?? null)
  const move = (index: number, by: number) =>
    setRows((list) => {
      if (!list) return list
      const next = [...list]
      const [row] = next.splice(index, 1)
      if (row) next.splice(Math.max(0, Math.min(next.length, index + by)), 0, row)
      return next
    })

  const kept = rows?.filter((row) => row.action !== 'drop') ?? []
  const firstKept = kept[0]
  const merges = rows?.some((row) => row.isMerge) ?? false
  const problem = !rows
    ? null
    : merges
      ? 'These commits include a merge, which GitLantern can’t keep while rewriting. Pick a commit after the merge.'
      : kept.length === 0
        ? 'At least one commit has to stay.'
        : firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')
          ? 'The first commit kept has nothing above it to fold into.'
          : null
  // Compared with the order git listed them in: moving a commit is a change even if every action is Keep.
  const reordered = rows?.some((row, index) => row.hash !== original[index]) ?? false
  const changed = reordered || (rows?.some((row) => row.action !== 'pick') ?? false)

  return (
    <Modal title={`Edit history of ${current}`} onClose={onCancel} className="modal-wide">
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!rows || problem) return
          onConfirm(
            rows.map((row) => ({
              hash: row.hash,
              action: row.action,
              // A squash left with its own message combines both, as git does.
              ...(row.action === 'reword' || (row.action === 'squash' && row.newMessage.trim() !== row.message.trim())
                ? { message: row.newMessage }
                : {})
            }))
          )
        }}
      >
        <p className="dialog-text">
          Oldest first. Each commit is replayed in this order with what you pick for it. Move commits with the arrows. Squash and fixup fold a
          commit into the one above it.
        </p>
        {error && <p className="test-fail">{error}</p>}
        {!rows && !error && (
          <p className="dim">
            <span className="spinner" /> Loading commits…
          </p>
        )}
        {rows && (
          <ol className="rebase-list">
            {rows.map((row, index) => (
              <li key={row.hash} className={`rebase-row action-${row.action}`}>
                <div className="rebase-main">
                  <span className="rebase-move">
                    <button type="button" className="icon-button small" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                      <Icon name="up" size={14} />
                    </button>
                    <button type="button" className="icon-button small" disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label="Move down">
                      <Icon name="down" size={14} />
                    </button>
                  </span>
                  <select
                    value={row.action}
                    aria-label={`What to do with ${row.subject}`}
                    title={ACTIONS.find((a) => a.action === row.action)?.hint}
                    onChange={(event) => {
                      const action = event.target.value as RebaseStep['action']
                      update(row.hash, { action })
                      if (action === 'reword' || action === 'squash') setOpen(row.hash)
                    }}
                  >
                    {ACTIONS.map((option) => (
                      <option key={option.action} value={option.action} disabled={index === 0 && (option.action === 'squash' || option.action === 'fixup')}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="mono dim">{row.hash.slice(0, 7)}</span>
                  <span className={`rebase-subject ellipsis${row.action === 'drop' ? ' struck' : ''}`} title={row.message}>
                    {row.action === 'reword' && row.newMessage.trim() !== row.message.trim() ? row.newMessage.split('\n')[0] : row.subject}
                  </span>
                  {row.isMerge && <span className="chip chip-warn">merge</span>}
                  <span className="dim nowrap">
                    {row.authorName} · {formatRelative(row.authorDate)}
                  </span>
                  {(row.action === 'reword' || row.action === 'squash') && (
                    <button type="button" className="link" onClick={() => setOpen(open === row.hash ? null : row.hash)}>
                      {open === row.hash ? 'Done' : 'Message'}
                    </button>
                  )}
                </div>
                {open === row.hash && (row.action === 'reword' || row.action === 'squash') && (
                  <textarea
                    className="rebase-message"
                    rows={4}
                    value={row.newMessage}
                    aria-label="New message"
                    placeholder={row.action === 'squash' ? 'Message for the combined commit (leave as is to combine both messages)' : 'New message'}
                    onChange={(event) => update(row.hash, { newMessage: event.target.value })}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        {problem && <p className="test-fail">{problem}</p>}
        {published && (
          <div className="notice warning">
            <Icon name="warning" size={16} />
            <p>
              Some of these commits are already on {upstream}. Afterwards your branch and {upstream} have different histories, and Push offers a
              force push to replace the old copies. On a branch other people use, check with them first.
            </p>
          </div>
        )}
        <p className="hint">
          If a commit conflicts, the rewrite stops there so you can fix it, skip it or abort; nothing is lost until it finishes.
          {reordered && ' Reordered commits are more likely to conflict.'}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!rows || problem !== null || !changed}>
            Rewrite {rows ? commits(kept.length) : ''}
          </button>
        </div>
      </form>
    </Modal>
  )
}
