import { useState } from 'react'
import type { DraftComment, IssueLinkRule, ReviewComment, ReviewVerdict } from '../../../shared/types'
import { formatRelative } from '../format'
import { threaded } from '../review'
import { Avatar } from './Avatar'
import { LinkedText } from './LinkedText'

export const VERDICTS: Record<ReviewVerdict, string> = {
  approve: 'approved',
  'request-changes': 'requested changes',
  comment: 'reviewed'
}

/** Comment text with issue numbers as links; line breaks kept. */
export function CommentText({ text, rules }: { text: string; rules: IssueLinkRule[] }) {
  return (
    <div className="comment-text selectable">
      <LinkedText text={text} rules={rules} />
    </div>
  )
}

/** One comment: who, when, what. */
export function CommentCard({ comment, rules, viewer }: { comment: ReviewComment; rules: IssueLinkRule[]; viewer: string }) {
  return (
    <div className={`comment-card${comment.inReplyTo ? ' reply' : ''}`}>
      <div className="comment-head">
        <Avatar name={comment.author} email="" size={20} />
        <strong>{comment.author}</strong>
        {comment.author === viewer && <span className="chip small">you</span>}
        {comment.verdict && comment.verdict !== 'comment' && (
          <span className={`chip small ${comment.verdict === 'approve' ? 'chip-ok' : 'chip-danger'}`}>{VERDICTS[comment.verdict]}</span>
        )}
        {comment.outdated && <span className="chip small">outdated</span>}
        <span className="dim">{comment.createdAt ? formatRelative(comment.createdAt / 1000) : ''}</span>
        {comment.path && comment.line !== null && comment.outdated && (
          <span className="dim mono">
            {comment.side === 'old' ? 'was ' : ''}line {comment.line}
          </span>
        )}
      </div>
      {comment.body && <CommentText text={comment.body} rules={rules} />}
    </div>
  )
}

interface ThreadProps {
  comments: ReviewComment[]
  drafts: DraftComment[]
  rules: IssueLinkRule[]
  viewer: string
  onRemoveDraft(draft: DraftComment): void
}

/** The comments under one diff line: what others said, then your pending ones. */
export function LineThread({ comments, drafts, rules, viewer, onRemoveDraft }: ThreadProps) {
  if (comments.length === 0 && drafts.length === 0) return null
  return (
    <div className="review-thread">
      {threaded(comments).map((comment) => (
        <CommentCard key={comment.id} comment={comment} rules={rules} viewer={viewer} />
      ))}
      {drafts.map((draft, index) => (
        <div key={index} className="comment-card draft">
          <div className="comment-head">
            <strong>Your comment</strong>
            <span className="chip small chip-warn">pending</span>
            <span className="spacer" />
            <button className="link danger" onClick={() => onRemoveDraft(draft)}>
              Remove
            </button>
          </div>
          <CommentText text={draft.body} rules={rules} />
        </div>
      ))}
    </div>
  )
}

/** Writing a comment on a line; it waits with the review until that's submitted. */
export function CommentComposer({ line, onSave, onCancel }: { line: string; onSave(body: string): void; onCancel(): void }) {
  const [body, setBody] = useState('')
  return (
    <form
      className="review-thread composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (body.trim()) onSave(body.trim())
      }}
    >
      <textarea
        autoFocus
        rows={3}
        value={body}
        placeholder={`Comment on ${line}. It’s sent with your review.`}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && body.trim()) onSave(body.trim())
        }}
      />
      <div className="row-wrap">
        <span className="hint">Ctrl / ⌘ + Enter to add</span>
        <span className="spacer" />
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!body.trim()}>
          Add to review
        </button>
      </div>
    </form>
  )
}
