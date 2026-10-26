import type { Branch, RepoOperation } from '../../../shared/types'

interface Props {
  operation: RepoOperation
  /** The checked-out branch; null while a rebase has HEAD detached. */
  current: string | null
  /** Files still marked as conflicted. */
  conflicts: number
  branches: Branch[]
  busy: boolean
  onShowChanges(): void
  onContinue(): void
  onSkip(): void
  onAbort(): void
}

/** A branch that points at the commit (a local one first), or else its short hash. */
export function nameFor(hash: string, branches: Branch[]): string {
  const branch = branches.find((b) => b.hash === hash && b.kind === 'local') ?? branches.find((b) => b.hash === hash)
  return branch?.name ?? hash.slice(0, 7)
}

function title(operation: RepoOperation, current: string | null, branches: Branch[]): string {
  switch (operation.kind) {
    case 'merge':
      return `Merging ${operation.incoming ? nameFor(operation.incoming, branches) : 'a branch'} into ${current ?? 'HEAD'}`
    case 'rebase': {
      const onto = operation.onto ? ` onto ${nameFor(operation.onto, branches)}` : ''
      const step = operation.step && operation.total ? ` · commit ${operation.step} of ${operation.total}` : ''
      return `Rebasing ${operation.branch ?? 'HEAD'}${onto}${step}`
    }
    case 'cherry-pick':
      return 'Cherry-picking a commit'
    case 'revert':
      return 'Reverting a commit'
  }
}

/** Shown while a merge or rebase is stopped on conflicts: what's going on and how to finish it. */
export function OperationBanner({ operation, current, conflicts, branches, busy, onShowChanges, onContinue, onSkip, onAbort }: Props) {
  const merge = operation.kind === 'merge'
  return (
    <div className="operation-banner" role="status">
      <div className="operation-text">
        <strong>{title(operation, current, branches)}</strong>
        <span>
          {conflicts > 0
            ? `${conflicts} file${conflicts === 1 ? ' has' : 's have'} conflicts. Open ${conflicts === 1 ? 'it' : 'each'} on the Changes tab and pick a side for every conflict, or fix ${conflicts === 1 ? 'it' : 'them'} in your editor and stage ${conflicts === 1 ? 'it' : 'them'}.`
            : `All conflicts are resolved. ${merge ? 'Finish the merge to commit it.' : 'Continue to carry on.'}`}
        </span>
      </div>
      {conflicts > 0 && (
        <button className="link" onClick={onShowChanges}>
          Show changes
        </button>
      )}
      <button onClick={onAbort} disabled={busy}>
        Abort {operation.kind}
      </button>
      {!merge && (
        <button onClick={onSkip} disabled={busy} title="Leave out the commit that conflicted">
          Skip commit
        </button>
      )}
      <button className="primary" onClick={onContinue} disabled={busy || conflicts > 0}>
        {merge ? 'Finish merge' : 'Continue'}
      </button>
    </div>
  )
}
