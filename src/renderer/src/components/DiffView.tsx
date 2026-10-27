import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { imageMime } from '../../../shared/images'
import { hunkKeys, parsePatch, selectLines } from '../../../shared/patch'
import type { ConflictPick, DiffTarget, DraftComment, IssueLinkRule, PatchAction, ReviewComment } from '../../../shared/types'
import { parseConflicts, parseDiff, sideName, type DiffLine } from '../diff'
import { errorMessage } from '../format'
import { lineAnchor, onLine, unplaced } from '../review'
import { splitRows } from '../splitDiff'
import { readStored, writeStored } from '../storage'
import { ImageDiff } from './ImageDiff'
import { CommentCard, CommentComposer, LineThread } from './ReviewThreads'

const api = window.api
const MAX_LINES = 10_000
const TRUNCATED = '… diff truncated …'
const LAYOUT_KEY = 'gitlantern.diffLayout'
const WHITESPACE_KEY = 'gitlantern.ignoreWhitespace'


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
  /** Open the file's history or blame. */
  onInspect?(path: string, view: 'history' | 'blame'): void
  /** Report an error from the external diff or merge tool. */
  onError?(message: string): void
  /** Reviewing a pull request: show its comments on this file, and let lines be commented on. */
  review?: {
    comments: ReviewComment[]
    drafts: DraftComment[]
    rules: IssueLinkRule[]
    viewer: string
    onAddDraft(draft: DraftComment): void
    onRemoveDraft(draft: DraftComment): void
  }
}

/** A branch by its name, a commit by its short hash. */
const refName = (ref: string): string => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref)

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
    case 'range':
      return `${refName(target.from)} → ${refName(target.to)}`
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

export function DiffView({ repoPath, target, busy = false, onLines, conflicts: conflictActions, onInspect, onError, review }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  /** The line a review comment is being written on. */
  const [composing, setComposing] = useState<{ side: 'old' | 'new'; line: number } | null>(null)
  // The layout and whitespace choice are kept for the next diff (and the next start).
  const [layout, setLayout] = useState<'unified' | 'split'>(() => (readStored<string>(LAYOUT_KEY, 'unified') === 'split' ? 'split' : 'unified'))
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(() => readStored<unknown>(WHITESPACE_KEY, false) === true)
  const conflictView = target.kind === 'worktree' && target.conflicted === true
  const image = imageMime(target.path) !== null && !conflictView

  useEffect(() => {
    // Whatever was shown before goes, an image's too: its line counts would describe the last file.
    setText(null)
    setError(null)
    setSelected(new Set())
    setAnchor(null)
    setComposing(null)
    if (image) return
    let cancelled = false
    const request = ignoreWhitespace ? api.git.diffWith(repoPath, target, { ignoreWhitespace }) : api.git.diff(repoPath, target)
    request.then(
      (result) => !cancelled && setText(result),
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, target, ignoreWhitespace, image])

  const { lines, conflicts, labels } = useMemo(
    () =>
      !text ? { lines: [], conflicts: 0, labels: [] } : conflictView ? parseConflicts(text) : { lines: parseDiff(text), conflicts: 0, labels: [] },
    [text, conflictView]
  )
  // Line actions need the whole diff as git wrote it, whitespace changes included.
  const patch = useMemo(() => (text && !text.endsWith(TRUNCATED) && !ignoreWhitespace ? parsePatch(text) : null), [text, ignoreWhitespace])
  const actions = onLines && patch ? actionsFor(target) : []
  // Review comments go under lines, which the unified layout has one of each.
  const split = layout === 'split' && !conflictView && !review
  // Until the diff is in, nothing can be placed, so nothing is listed as elsewhere either.
  const elsewhere = useMemo(() => (review && text !== null ? unplaced(review.comments, lines) : []), [review, lines, text])
  const rows = useMemo(() => (split ? splitRows(lines.slice(0, MAX_LINES)) : []), [split, lines])
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
  const external = () => {
    const tool = conflictView ? api.tools.mergeTool(repoPath, target.path) : api.tools.diffTool(repoPath, target)
    tool.catch((err: unknown) => onError?.(errorMessage(err)))
  }
  const untracked = target.kind === 'worktree' && target.untracked === true

  const hunkButtons = (line: DiffLine): ReactNode =>
    line.kind === 'hunk' &&
    line.hunk !== undefined &&
    actions.length > 0 &&
    patch && (
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
    )

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
        <span className="diff-tools">
          {!conflictView && !image && (
            <>
              {review ? (
                <span className="hint">Click a line number to comment</span>
              ) : (
                <div className="segmented small" role="group" aria-label="Layout">
                  {(['unified', 'split'] as const).map((option) => (
                    <button
                      key={option}
                      aria-pressed={layout === option}
                      title={option === 'split' ? 'Old and new side by side' : 'One column, removals above additions'}
                      onClick={() => {
                        setLayout(option)
                        writeStored(LAYOUT_KEY, option)
                      }}
                    >
                      {option === 'split' ? 'Split' : 'Unified'}
                    </button>
                  ))}
                </div>
              )}
              <label className="checkbox compact" title="Hide changes that only add or remove spaces. Line staging is off while hidden.">
                <input
                  type="checkbox"
                  checked={ignoreWhitespace}
                  onChange={(event) => {
                    setIgnoreWhitespace(event.target.checked)
                    writeStored(WHITESPACE_KEY, event.target.checked)
                  }}
                />
                Ignore spaces
              </label>
            </>
          )}
          {onInspect && target.kind !== 'stash' && !untracked && (
            <>
              <button className="link" onClick={() => onInspect(target.path, 'history')} title="Every commit that changed this file">
                History
              </button>
              <button className="link" onClick={() => onInspect(target.path, 'blame')} title="Who last changed each line">
                Blame
              </button>
            </>
          )}
          {!untracked && (
            <button className="link" onClick={external} title={conflictView ? 'Resolve in your merge tool (git mergetool)' : 'Open in your diff tool (git difftool)'}>
              {conflictView ? 'Merge tool' : 'Diff tool'}
            </button>
          )}
        </span>
      </header>
      {image ? (
        <ImageDiff repoPath={repoPath} target={target} />
      ) : (
        <>
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
          {actions.length > 0 && selected.size === 0 && changedKeys.length > 0 && !split && (
            <p className="diff-tip">Click line numbers to pick lines (Shift-click for a range), or use the buttons on each hunk.</p>
          )}
          {onLines && ignoreWhitespace && actionsFor(target).length > 0 && (
            <p className="diff-tip">Spaces are hidden, so lines can’t be staged one by one. Stage the whole file, or show spaces again.</p>
          )}
          {error && <div className="panel-error">{error}</div>}
          {text === null && !error && <div className="panel-loading">Loading diff…</div>}
          {text !== null && lines.length === 0 && <div className="empty">{ignoreWhitespace ? 'Only spaces changed.' : 'No changes to show.'}</div>}
          {split && rows.length > 0 && (
            <div className="diff-body split" role="table" aria-label={`Changes to ${target.path}, side by side`}>
              {rows.map((row, index) =>
                row.full ? (
                  <div key={index} className={`diff-line diff-${row.kind}`} role="row">
                    <span className="code" role="cell">
                      {row.full.text}
                    </span>
                    {hunkButtons(row.full)}
                  </div>
                ) : (
                  <div key={index} className="split-row" role="row">
                    {(['left', 'right'] as const).map((side) => {
                      const line = row[side]
                      const kind = !line ? 'empty' : line.kind
                      return (
                        <div key={side} className={`split-cell diff-${kind}`} role="cell">
                          <span className="ln">{line ? (side === 'left' ? line.oldNumber : line.newNumber) : ''}</span>
                          <span className="sign">{line ? SIGN[line.kind] : ''}</span>
                          <span className="code">{line ? line.text || ' ' : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              )}
              {lines.length > MAX_LINES && <div className="diff-line diff-note">… {lines.length - MAX_LINES} more lines not shown …</div>}
            </div>
          )}
          {review && elsewhere.length > 0 && (
            <details className="review-elsewhere">
              <summary>
                {elsewhere.length} comment{elsewhere.length === 1 ? '' : 's'} on an older version of this file
              </summary>
              {elsewhere.map((comment) => (
                <CommentCard key={comment.id} comment={comment} rules={review.rules} viewer={review.viewer} />
              ))}
            </details>
          )}
          {!split && lines.length > 0 && (
            <div className="diff-body" role="table" aria-label={`Changes to ${target.path}`}>
              {lines.slice(0, MAX_LINES).map((line, index) => {
                const picked = line.key !== undefined && selected.has(line.key)
                const pickable = actions.length > 0 && line.key !== undefined
                const conflict = line.conflict !== undefined && conflictActions ? line.conflict : null
                const sides = conflict === null ? null : labels[conflict]
                const spot = review ? lineAnchor(line) : null
                const commentable = spot !== null
                const here = review && spot ? review.comments.filter((c) => !c.outdated && onLine(c, line)) : []
                const mine = review && spot ? review.drafts.filter((d) => onLine(d, line)) : []
                const writing = composing !== null && spot !== null && composing.side === spot.side && composing.line === spot.line
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
                    <div className={`diff-line diff-${line.kind}${picked ? ' picked' : ''}${here.length + mine.length > 0 ? ' commented' : ''}`} role="row">
                      <span
                        className={`gutter${pickable || commentable ? ' pickable' : ''}${commentable ? ' commentable' : ''}`}
                        {...(pickable && line.key
                          ? { onClick: (event: MouseEvent) => toggle(line.key ?? '', event), title: 'Pick this line' }
                          : commentable && spot
                            ? { onClick: () => setComposing(writing ? null : spot), title: 'Comment on this line' }
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
                      {hunkButtons(line)}
                    </div>
                    {review && (
                      <LineThread comments={here} drafts={mine} rules={review.rules} viewer={review.viewer} onRemoveDraft={review.onRemoveDraft} />
                    )}
                    {review && writing && spot && (
                      <CommentComposer
                        line={`${spot.side === 'old' ? 'old ' : ''}line ${spot.line}`}
                        onCancel={() => setComposing(null)}
                        onSave={(body) => {
                          review.onAddDraft({ path: target.path, line: spot.line, side: spot.side, body })
                          setComposing(null)
                        }}
                      />
                    )}
                  </Fragment>
                )
              })}
              {lines.length > MAX_LINES && <div className="diff-line diff-note">… {lines.length - MAX_LINES} more lines not shown …</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
