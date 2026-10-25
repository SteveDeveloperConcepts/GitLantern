import { useEffect, useState } from 'react'
import type { BranchComparison } from '../../../shared/types'
import type { IntegrateKind, RefTarget } from '../branchMenus'
import { errorMessage } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const api = window.api

interface Props {
  kind: IntegrateKind
  target: RefTarget
  /** The checked-out branch. */
  current: string
  upstream: string | null
  repoPath: string
  /** Uncommitted changes to tracked files. */
  dirty: boolean
  /** Opened by Pull on diverged branches: explains why, and lets the user switch between merge and rebase. */
  pull?: boolean
  onConfirm(options: { kind: IntegrateKind; noFastForward: boolean }): void
  onCancel(): void
}

const commits = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`

/** Confirms a merge or rebase after explaining what it will do to the current branch. */
export function IntegrateDialog({ kind: initialKind, target, current, upstream, repoPath, dirty, pull, onConfirm, onCancel }: Props) {
  const [kind, setKind] = useState(initialKind)
  const [comparison, setComparison] = useState<BranchComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noFastForward, setNoFastForward] = useState(false)

  useEffect(() => {
    api.git.compare(repoPath, target.ref).then(setComparison, (err: unknown) => setError(errorMessage(err)))
  }, [repoPath, target.ref])

  const merge = kind === 'merge'
  const upToDate = comparison !== null && comparison.behind === 0
  const fastForward = comparison !== null && comparison.ahead === 0 && comparison.behind > 0
  const canConfirm = comparison !== null && !upToDate && !dirty

  let summary: string | null = null
  if (comparison && upToDate) {
    summary = merge
      ? `${current} already has everything on ${target.label}. There’s nothing to merge.`
      : `${current} is already based on ${target.label}. There’s nothing to rebase.`
  } else if (comparison && fastForward) {
    summary = `${current} has no commits of its own since it split from ${target.label}, so it simply moves forward to take in ${commits(comparison.behind)} (a fast-forward).`
  } else if (comparison) {
    const { ahead, behind } = comparison
    summary = merge
      ? `Brings ${commits(behind)} from ${target.label} into ${current} and records ${behind === 1 ? 'it' : 'them'} with a new merge commit.`
      : `${target.label} has ${commits(behind)} that ${current} doesn’t. Rebasing moves the ${commits(ahead)} made on ${current} to after ${behind === 1 ? 'it' : 'them'}, one by one. ${ahead === 1 ? 'It gets a new ID' : 'They get new IDs'}, and the history becomes a straight line.`
  }

  const title = pull ? `Pull from ${target.label}` : merge ? `Merge ${target.label} into ${current}` : `Rebase ${current} onto ${target.label}`

  return (
    <Modal title={title} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (canConfirm) onConfirm({ kind, noFastForward: merge && fastForward && noFastForward })
        }}
      >
        {pull && (
          <>
            <p className="dialog-text">
              {current} and {target.label} have both changed since they split, so {current} can’t simply move
              forward. Choose how to combine them:
            </p>
            <div className="segmented choice" role="group" aria-label="How to combine the branches">
              {(['merge', 'rebase'] as const).map((option) => (
                <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)}>
                  {option === 'merge' ? 'Merge' : 'Rebase'}
                </button>
              ))}
            </div>
          </>
        )}
        {!comparison && !error && (
          <p className="dim">
            <span className="spinner" /> Comparing branches…
          </p>
        )}
        {error && <p className="test-fail">{error}</p>}
        {summary && <p className="dialog-text">{summary}</p>}

        {merge && fastForward && (
          <label className="checkbox">
            <input type="checkbox" checked={noFastForward} onChange={(event) => setNoFastForward(event.target.checked)} />
            Create a merge commit anyway, so the history shows where {target.label} came in
          </label>
        )}

        {!merge && comparison && !upToDate && !fastForward && comparison.published > 0 && (
          <div className="notice warning">
            <Icon name="warning" size={16} />
            <p>
              {comparison.published === comparison.ahead ? 'These commits are' : `${comparison.published} of them are`} already on{' '}
              {upstream ?? 'the remote'}. After rebasing, your branch and {upstream ?? 'the remote'} will have different
              histories, and you’ll need to force-push from a terminal (Git Steve can’t force-push yet). On a branch other
              people use, merging is safer.
            </p>
          </div>
        )}

        {dirty && (
          <div className="notice warning">
            <Icon name="warning" size={16} />
            <p>You have uncommitted changes. Commit them first, so they can’t get mixed up with the {kind}.</p>
          </div>
        )}

        {canConfirm && !fastForward && (
          <p className="hint">
            {merge
              ? 'If both branches changed the same lines, the merge stops so you can fix the conflicts, or abort it.'
              : 'If a commit conflicts, the rebase stops there so you can fix it, skip that commit, or abort.'}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!canConfirm}>
            {merge ? 'Merge' : 'Rebase'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
