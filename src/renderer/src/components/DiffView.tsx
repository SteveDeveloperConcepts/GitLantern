import { useEffect, useMemo, useState } from 'react'
import type { DiffTarget } from '../../../shared/types'
import { parseConflicts, parseDiff, type DiffLine } from '../diff'
import { errorMessage } from '../format'

const api = window.api
const MAX_LINES = 10_000

interface Props {
  repoPath: string
  target: DiffTarget
}

const describe = (target: DiffTarget): string =>
  target.kind === 'commit'
    ? `in ${target.hash.slice(0, 7)}`
    : target.kind === 'index'
      ? 'staged'
      : target.conflicted
        ? 'with conflicts'
        : 'not staged'

const SIGN: Record<DiffLine['kind'], string> = {
  add: '+',
  del: '−',
  context: '',
  hunk: '',
  note: '',
  ours: '',
  base: '',
  theirs: '',
  marker: ''
}

export function DiffView({ repoPath, target }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setError(null)
    api.git.diff(repoPath, target).then(
      (result) => !cancelled && setText(result),
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, target])

  const conflictView = target.kind === 'worktree' && target.conflicted === true
  const { lines, conflicts } = useMemo(
    () => (!text ? { lines: [], conflicts: 0 } : conflictView ? parseConflicts(text) : { lines: parseDiff(text), conflicts: 0 }),
    [text, conflictView]
  )
  const added = lines.filter((l) => l.kind === 'add').length
  const removed = lines.filter((l) => l.kind === 'del').length

  return (
    <div className="diff-view">
      <header className="diff-header">
        <span className="diff-path">{target.path}</span>
        <span className="diff-kind">{describe(target)}</span>
        {lines.length > 0 &&
          (conflictView ? (
            <span className="file-counts conflict-count">
              {conflicts} conflict{conflicts === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="file-counts">
              <span className="add">+{added}</span> <span className="del">−{removed}</span>
            </span>
          ))}
      </header>
      {error && <div className="panel-error">{error}</div>}
      {text === null && !error && <div className="panel-loading">Loading diff…</div>}
      {text !== null && lines.length === 0 && <div className="empty">No changes to show.</div>}
      {lines.length > 0 && (
        <div className="diff-body" role="table" aria-label={`Changes to ${target.path}`}>
          {lines.slice(0, MAX_LINES).map((line, index) => (
            <div key={index} className={`diff-line diff-${line.kind}`} role="row">
              <span className="ln" role="cell">
                {line.oldNumber ?? ''}
              </span>
              <span className="ln" role="cell">
                {line.newNumber ?? ''}
              </span>
              <span className="sign" role="cell">
                {SIGN[line.kind]}
              </span>
              <span className="code" role="cell">
                {line.text || ' '}
              </span>
            </div>
          ))}
          {lines.length > MAX_LINES && <div className="diff-line diff-note">… {lines.length - MAX_LINES} more lines not shown …</div>}
        </div>
      )}
    </div>
  )
}
