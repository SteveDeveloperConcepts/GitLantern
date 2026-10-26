import { Fragment, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { hunkKeys, parsePatch, selectLines } from '../../../shared/patch'
import type { ConflictPick, DiffTarget, PatchAction } from '../../../shared/types'
import { parseConflicts, parseDiff, sideName, type DiffLine } from '../diff'
import { errorMessage } from '../format'

const api = window.api
const MAX_LINES = 10_000
const TRUNCATED = '… diff truncated …'

interface Props {
  repoPath: string
  target: DiffTarget
  busy?: boolean
  /** Stage or discard some lines of an unstaged diff, or unstage some of a staged one. */
  onLines?(action: PatchAction, patch: string, lineCount: number): void
  /** A conflicted file: keep a side of one conflict, or of the whole file. */
  conflicts?: {
    /** What to call HEAD's side: the checked-out branch, or what a rebase replays onto. */
    head: string
    onPick(pick: ConflictPick): void
    onPickFile(side: 'ours' | 'theirs'): void
    onMarkResolved(): void
  }
}

const describe = (target: DiffTarget): string => {
  switch (target.kind) {
    case 'commit':
      return `in ${target.hash.slice(0, 7)}`
    case 'stash':
      return target.untracked ? 'untracked, in the stash' : 'in the stash'
    case 'index':
      return 'staged'
    case 'worktree':
      return target.conflicted ? 'with conflicts' : 'not staged'
  }
}

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

const ACTION_LABELS: Record<PatchAction, string> = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard' }

/** Which line actions a diff offers: none for commits, stashes, untracked or conflicted files. */
function actionsFor(target: DiffTarget): PatchAction[] {
  if (target.kind === 'index') return ['unstage']
  if (target.kind === 'worktree' && !target.untracked && !target.conflicted) return ['stage', 'discard']
  return []
}

export function DiffView({ repoPath, target, busy = false, onLines, conflicts: conflictActions }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setError(null)
    setSelected(new Set())
    setAnchor(null)
    api.git.diff(repoPath, target).then(
      (result) => !cancelled && setText(result),
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, target])

  const conflictView = target.kind === 'worktree' && target.conflicted === true
  const { lines, conflicts, labels } = useMemo(
    () =>
      !text ? { lines: [], conflicts: 0, labels: [] } : conflictView ? parseConflicts(text) : { lines: parseDiff(text), conflicts: 0, labels: [] },
    [text, conflictView]
  )
  // Line actions need the whole diff as git wrote it.
  const patch = useMemo(() => (text && !text.endsWith(TRUNCATED) ? parsePatch(text) : null), [text])
  const actions = onLines && patch ? actionsFor(target) : []
  const changedKeys = useMemo(() => lines.flatMap((line) => (line.key ? [line.key] : [])), [lines])
  const added = lines.filter((l) => l.kind === 'add').length
  const removed = lines.filter((l) => l.kind === 'del').length

  const apply = (action: PatchAction, keys: ReadonlySet<string>) => {
    if (!patch || !onLines) return
    const result = selectLines(patch, keys, action === 'stage' ? 'forward' : 'reverse')
    if (result) onLines(action, result, keys.size)
  }

  const toggle = (key: string, event: MouseEvent) => {
    if (event.shiftKey && anchor) {
      const ends = [changedKeys.indexOf(anchor), changedKeys.indexOf(key)]
      setSelected(new Set([...selected, ...changedKeys.slice(Math.min(...ends), Math.max(...ends) + 1)]))
    } else {
      const next = new Set(selected)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      setSelected(next)
    }
    setAnchor(key)
  }

  const head = conflictActions?.head ?? 'HEAD'
  const fileSides = { ours: sideName(labels[0]?.ours ?? '', head), theirs: sideName(labels[0]?.theirs ?? '', 'the incoming side') }

  return (
    <div className="diff-view">
      <header className="diff-header">
        <span className="diff-path">{target.path}</span>
        <span className="diff-kind">{describe(target)}</span>
        {selected.size > 0 ? (
          <span className="diff-selection">
            {selected.size} line{selected.size === 1 ? '' : 's'}
            {actions.map((action) => (
              <button key={action} className={action === 'discard' ? 'danger' : ''} disabled={busy} onClick={() => apply(action, selected)}>
                {ACTION_LABELS[action]}
              </button>
            ))}
            <button className="link" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </span>
        ) : (
          lines.length > 0 &&
          (conflictView ? (
            <span className="file-counts conflict-count">
              {conflicts} conflict{conflicts === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="file-counts">
              <span className="add">+{added}</span> <span className="del">−{removed}</span>
            </span>
          ))
        )}
      </header>
      {conflictView && conflictActions && text !== null && (
        <div className="conflict-toolbar">
          {conflicts > 0 ? (
            <>
              <span className="dim">Whole file:</span>
              <button disabled={busy} onClick={() => conflictActions.onPickFile('ours')}>
                Use {fileSides.ours}
              </button>
              <button disabled={busy} onClick={() => conflictActions.onPickFile('theirs')}>
                Use {fileSides.theirs}
              </button>
              <span className="hint">Or pick a side for each conflict below.</span>
            </>
          ) : (
            <>
              <span className="dim">No conflict markers left.</span>
              <button className="primary" disabled={busy} onClick={conflictActions.onMarkResolved}>
                Mark resolved
              </button>
              <button disabled={busy} onClick={() => conflictActions.onPickFile('ours')}>
                Use {fileSides.ours}
              </button>
              <button disabled={busy} onClick={() => conflictActions.onPickFile('theirs')}>
                Use {fileSides.theirs}
              </button>
            </>
          )}
        </div>
      )}
      {actions.length > 0 && selected.size === 0 && changedKeys.length > 0 && (
        <p className="diff-tip">Click line numbers to pick lines (Shift-click for a range), or use the buttons on each hunk.</p>
      )}
      {error && <div className="panel-error">{error}</div>}
      {text === null && !error && <div className="panel-loading">Loading diff…</div>}
      {text !== null && lines.length === 0 && <div className="empty">No changes to show.</div>}
      {lines.length > 0 && (
        <div className="diff-body" role="table" aria-label={`Changes to ${target.path}`}>
          {lines.slice(0, MAX_LINES).map((line, index) => {
            const picked = line.key !== undefined && selected.has(line.key)
            const pickable = actions.length > 0 && line.key !== undefined
            const conflict = line.conflict !== undefined && conflictActions ? line.conflict : null
            const sides = conflict === null ? null : labels[conflict]
            return (
              <Fragment key={index}>
                {conflict !== null && sides && conflictActions && (
                  <div className="conflict-actions">
                    <span>
                      Conflict {conflict + 1} of {conflicts}
                    </span>
                    {(['ours', 'theirs', 'both'] as const).map((choice) => (
                      <button
                        key={choice}
                        disabled={busy}
                        onClick={() => conflictActions.onPick({ index: conflict, choice, conflicts })}
                      >
                        {choice === 'both'
                          ? 'Use both'
                          : `Use ${sideName(choice === 'ours' ? sides.ours : sides.theirs, choice === 'ours' ? head : 'the incoming side')}`}
                      </button>
                    ))}
                  </div>
                )}
                <div className={`diff-line diff-${line.kind}${picked ? ' picked' : ''}`} role="row">
                  <span
                    className={`gutter${pickable ? ' pickable' : ''}`}
                    {...(pickable && line.key
                      ? { onClick: (event: MouseEvent) => toggle(line.key ?? '', event), title: 'Pick this line' }
                      : {})}
                  >
                    <span className="ln" role="cell">
                      {line.oldNumber ?? ''}
                    </span>
                    <span className="ln" role="cell">
                      {line.newNumber ?? ''}
                    </span>
                    <span className="sign" role="cell">
                      {picked ? '✓' : SIGN[line.kind]}
                    </span>
                  </span>
                  <span className="code" role="cell">
                    {line.text || ' '}
                  </span>
                  {line.kind === 'hunk' && line.hunk !== undefined && actions.length > 0 && patch && (
                    <span className="hunk-actions">
                      {actions.map((action) => (
                        <button
                          key={action}
                          className={action === 'discard' ? 'danger' : ''}
                          disabled={busy}
                          onClick={() => apply(action, new Set(hunkKeys(patch, line.hunk ?? -1)))}
                        >
                          {ACTION_LABELS[action]} hunk
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </Fragment>
            )
          })}
          {lines.length > MAX_LINES && <div className="diff-line diff-note">… {lines.length - MAX_LINES} more lines not shown …</div>}
        </div>
      )}
    </div>
  )
}
