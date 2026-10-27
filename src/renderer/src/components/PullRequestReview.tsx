import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangedFile,
  Commit,
  DiffTarget,
  DraftComment,
  IssueLinkRule,
  PullRequest,
  PullRequestDetail,
  ReviewComment,
  ReviewVerdict
} from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { sameDraft } from '../review'
import { readStored, writeStored } from '../storage'
import { Avatar } from './Avatar'
import { DiffView } from './DiffView'
import { FileList } from './FileList'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { CommentCard, CommentText } from './ReviewThreads'

const api = window.api


const VERDICT_OPTIONS: { verdict: ReviewVerdict; title: string; text: string }[] = [
  { verdict: 'comment', title: 'Comment', text: 'Feedback without approving or blocking.' },
  { verdict: 'approve', title: 'Approve', text: 'It’s good to merge.' },
  { verdict: 'request-changes', title: 'Request changes', text: 'It needs changes before it can be merged.' }
]

interface Props {
  repoPath: string
  pr: PullRequest
  /** "pull request" or "merge request". */
  noun: string
  rules: IssueLinkRule[]
  busy: boolean
  onClose(): void
  onCheckout(pr: PullRequest): void
  onShowCommit(hash: string): void
  onError(message: string): void
  onSubmitted(message: string): void
}

/** Review a pull request: its description and conversation, every file it changes with comments on lines, and a verdict. */
export function PullRequestReview({ repoPath, pr, noun, rules, busy, onClose, onCheckout, onShowCommit, onError, onSubmitted }: Props) {
  const key = `gitlantern.review.${repoPath}#${pr.number}`
  const [detail, setDetail] = useState<PullRequestDetail | null>(null)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftComment[]>(() => readStored(`${key}.drafts`, []))
  const [viewed, setViewed] = useState<Record<string, string[]>>(() => readStored(`${key}.viewed`, {}))
  const [submitting, setSubmitting] = useState(false)
  const [sending, setSending] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => writeStored(`${key}.drafts`, drafts), [key, drafts])
  useEffect(() => writeStored(`${key}.viewed`, viewed), [key, viewed])

  const loadComments = useCallback(
    () => api.pullRequests.comments(repoPath, pr.number).then(setComments, (err: unknown) => onError(errorMessage(err))),
    [repoPath, pr.number, onError]
  )

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setFiles(null)
    setError(null)
    api.pullRequests.detail(repoPath, pr.number).then(
      async (found) => {
        if (cancelled) return
        setDetail(found)
        const [changed, history] = await Promise.all([
          api.git.compareFiles(repoPath, found.base, found.head),
          api.git.log(repoPath, { branch: found.head })
        ])
        if (cancelled) return
        setFiles(changed)
        setOpen((current) => current ?? changed[0]?.path ?? null)
        // The pull request's own commits: those the base doesn't have.
        const byHash = new Map(history.map((c) => [c.hash, c]))
        const inBase = new Set<string>()
        const queue = [found.base]
        for (let hash = queue.pop(); hash !== undefined; hash = queue.pop()) {
          if (inBase.has(hash)) continue
          inBase.add(hash)
          queue.push(...(byHash.get(hash)?.parents ?? []))
        }
        setCommits(history.filter((c) => !inBase.has(c.hash)))
      },
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    void loadComments()
    return () => {
      cancelled = true
    }
  }, [repoPath, pr.number, loadComments])

  const head = detail?.head ?? ''
  const viewedHere = useMemo(() => new Set(viewed[head] ?? []), [viewed, head])
  const general = comments.filter((c) => c.path === null)
  const onFiles = comments.filter((c) => c.path !== null)
  const countFor = (path: string) => onFiles.filter((c) => c.path === path).length + drafts.filter((d) => d.path === path).length
  const openFile = files?.find((f) => f.path === open) ?? null
  // One object per file: DiffView reloads whenever its target changes.
  const target = useMemo<DiffTarget | null>(
    () =>
      detail && openFile
        ? { kind: 'range', from: detail.base, to: detail.head, path: openFile.path, ...(openFile.origPath ? { origPath: openFile.origPath } : {}) }
        : null,
    [detail, openFile]
  )

  const toggleViewed = (path: string) =>
    setViewed((current) => {
      const list = new Set(current[head] ?? [])
      if (list.has(path)) list.delete(path)
      else list.add(path)
      // Only the newest version's marks are kept: new commits mean another look.
      return { [head]: [...list] }
    })

  const step = (by: number) => {
    if (!files || files.length === 0) return
    const index = files.findIndex((f) => f.path === open)
    setOpen(files[(index + by + files.length) % files.length]?.path ?? null)
  }

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      // Only the tab on show, and not while typing.
      if (!root.current?.offsetParent || (event.target as HTMLElement).closest('input, textarea, select')) return
      if (event.key === 'j' || event.key === ']') step(1)
      if (event.key === 'k' || event.key === '[') step(-1)
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  })

  const submit = (verdict: ReviewVerdict, body: string) => {
    if (!detail) return
    setSending(true)
    api.pullRequests
      .submitReview(repoPath, pr.number, detail.head, { verdict, body, comments: drafts })
      .then(
        () => {
          setDrafts([])
          setSubmitting(false)
          onSubmitted(
            verdict === 'approve' ? `Approved #${pr.number}` : verdict === 'request-changes' ? `Requested changes on #${pr.number}` : `Reviewed #${pr.number}`
          )
          void loadComments()
        },
        (err: unknown) => onError(errorMessage(err))
      )
      .finally(() => setSending(false))
  }

  const reviewed = files ? files.filter((f) => viewedHere.has(f.path)).length : 0

  return (
    <div className="pr-review" ref={root}>
      <header className="pr-review-head">
        <button className="icon-button" onClick={onClose} title="Back to the history" aria-label="Back to the history">
          <Icon name="close" size={16} />
        </button>
        <div className="pr-review-title">
          <span className="ellipsis">
            <span className="dim">#{pr.number}</span> {pr.title}
          </span>
          <span className="dim ellipsis">
            {pr.author} wants to merge <span className="mono">{pr.sourceBranch}</span> into <span className="mono">{pr.targetBranch}</span>
            {detail && ` · ${commits.length} commit${commits.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {pr.draft && <span className="chip">Draft</span>}
        {detail && detail.state !== 'open' && <span className="chip chip-warn">{detail.state}</span>}
        <span className="spacer" />
        <button className="link" onClick={() => void api.tools.openUrl(pr.url)}>
          <Icon name="external" size={14} /> Open in browser
        </button>
        <button disabled={busy} onClick={() => onCheckout(pr)}>
          Check out
        </button>
        <button className="primary" disabled={!detail || detail.state !== 'open'} onClick={() => setSubmitting(true)}>
          Finish review{drafts.length > 0 ? ` · ${drafts.length}` : ''}
        </button>
      </header>
      {error && <div className="panel-error">{error}</div>}
      {!detail && !error && (
        <div className="panel-loading">
          <span className="spinner" /> Fetching #{pr.number}…
        </div>
      )}
      {detail && (
        <div className="pr-review-body">
          <aside className="pr-review-side">
            <section className="pr-overview">
              <div className="comment-head">
                <Avatar name={pr.author} size={22} />
                <strong>{pr.author}</strong>
                <span className="dim">{pr.updatedAt ? `updated ${formatRelative(pr.updatedAt / 1000)}` : ''}</span>
              </div>
              {detail.body.trim() ? <CommentText text={detail.body} rules={rules} /> : <p className="dim">No description.</p>}
            </section>
            {general.length > 0 && (
              <section>
                <h3>Conversation · {general.length}</h3>
                <div className="pr-conversation">
                  {general.map((comment) => (
                    <CommentCard key={comment.id} comment={comment} rules={rules} viewer={detail.viewer} />
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3 className="section-head">
                Files · {files?.length ?? '…'}
                {files && files.length > 0 && (
                  <span className="dim">
                    {reviewed} of {files.length} viewed
                  </span>
                )}
              </h3>
              {files && files.length > 0 && (
                <div className="viewed-bar" aria-hidden="true">
                  <span style={{ width: `${(100 * reviewed) / files.length}%` }} />
                </div>
              )}
              {files && (
                <FileList
                  items={files.map((file) => ({
                    key: file.path,
                    path: file.path,
                    ...(file.origPath ? { origPath: file.origPath } : {}),
                    status: viewedHere.has(file.path) ? '✓' : file.status,
                    additions: file.additions ?? null,
                    deletions: file.deletions ?? null
                  }))}
                  selectedKey={open}
                  onOpen={(item) => setOpen(item.path)}
                  actions={[
                    {
                      label: <Icon name="check" size={14} />,
                      title: 'Mark viewed',
                      run: (item) => toggleViewed(item.path)
                    }
                  ]}
                />
              )}
              <p className="hint">J and K move between files. Comment counts include your pending ones.</p>
            </section>
            <section>
              <h3>Commits · {commits.length}</h3>
              <ul className="plain-list">
                {commits.map((commit) => (
                  <li key={commit.hash}>
                    <button className="link mono inline" onClick={() => onShowCommit(commit.hash)}>
                      {commit.hash.slice(0, 7)}
                    </button>
                    <span className="ellipsis">{commit.subject}</span>
                    <span className="dim nowrap">{formatRelative(commit.authorDate)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
          <div className="pr-review-diff">
            {openFile && target ? (
              <>
                <div className="pr-file-bar">
                  <button className="icon-button small" onClick={() => step(-1)} aria-label="Previous file" title="Previous file (K)">
                    <Icon name="up" size={14} />
                  </button>
                  <button className="icon-button small" onClick={() => step(1)} aria-label="Next file" title="Next file (J)">
                    <Icon name="down" size={14} />
                  </button>
                  <span className="dim">
                    File {(files?.findIndex((f) => f.path === open) ?? 0) + 1} of {files?.length}
                    {countFor(openFile.path) > 0 && ` · ${countFor(openFile.path)} comment${countFor(openFile.path) === 1 ? '' : 's'}`}
                  </span>
                  <span className="spacer" />
                  <label className="checkbox compact">
                    <input type="checkbox" checked={viewedHere.has(openFile.path)} onChange={() => toggleViewed(openFile.path)} />
                    Viewed
                  </label>
                </div>
                <DiffView
                  repoPath={repoPath}
                  target={target}
                  onError={onError}
                  review={{
                    comments: onFiles.filter((c) => c.path === openFile.path),
                    drafts: drafts.filter((d) => d.path === openFile.path),
                    rules,
                    viewer: detail.viewer,
                    onAddDraft: (draft) => setDrafts((list) => [...list, draft]),
                    onRemoveDraft: (draft) => setDrafts((list) => list.filter((d) => !sameDraft(d, draft)))
                  }}
                />
              </>
            ) : (
              <div className="empty">{files ? `This ${noun} changes no files.` : 'Loading files…'}</div>
            )}
          </div>
        </div>
      )}
      {submitting && detail && (
        <SubmitDialog
          noun={noun}
          drafts={drafts.length}
          own={detail.viewer !== '' && detail.viewer === pr.author}
          sending={sending}
          onCancel={() => setSubmitting(false)}
          onSubmit={submit}
        />
      )}
    </div>
  )
}

function SubmitDialog({
  noun,
  drafts,
  own,
  sending,
  onCancel,
  onSubmit
}: {
  noun: string
  drafts: number
  own: boolean
  sending: boolean
  onCancel(): void
  onSubmit(verdict: ReviewVerdict, body: string): void
}) {
  const [verdict, setVerdict] = useState<ReviewVerdict>('comment')
  const [body, setBody] = useState('')
  const empty = verdict !== 'approve' && !body.trim() && drafts === 0
  return (
    <Modal title="Finish your review" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!empty) onSubmit(verdict, body.trim())
        }}
      >
        <textarea autoFocus rows={5} value={body} placeholder="Leave a summary (optional for an approval)" onChange={(event) => setBody(event.target.value)} />
        <div className="radio-cards" role="radiogroup" aria-label="Verdict">
          {VERDICT_OPTIONS.map((option) => {
            const blocked = own && option.verdict !== 'comment'
            return (
              <label key={option.verdict} className={`radio-card${verdict === option.verdict ? ' selected' : ''}${blocked ? ' disabled' : ''}`}>
                <input type="radio" name="verdict" disabled={blocked} checked={verdict === option.verdict} onChange={() => setVerdict(option.verdict)} />
                <span>
                  <strong>{option.title}</strong>
                  <span className="dim">{blocked ? `Not on your own ${noun}.` : option.text}</span>
                </span>
              </label>
            )
          })}
        </div>
        <p className="hint">
          {drafts === 0 ? 'No line comments.' : `${drafts} line comment${drafts === 1 ? '' : 's'} go${drafts === 1 ? 'es' : ''} with it.`} The service
          notifies the author.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Keep reviewing
          </button>
          <button type="submit" className="primary" disabled={empty || sending}>
            {sending ? 'Sending…' : 'Submit review'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
