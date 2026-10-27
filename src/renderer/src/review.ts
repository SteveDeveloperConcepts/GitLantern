import type { DraftComment, ReviewComment } from '../../shared/types'
import type { DiffLine } from './diff'

/** Where on a diff line a comment goes: removed lines by their old number, the rest by their new one. */
export function lineAnchor(line: DiffLine): { side: 'old' | 'new'; line: number } | null {
  if (line.kind === 'del' && line.oldNumber !== null) return { side: 'old', line: line.oldNumber }
  if ((line.kind === 'add' || line.kind === 'context') && line.newNumber !== null) return { side: 'new', line: line.newNumber }
  return null
}

/** Whether a comment (or draft) belongs under this line. A context line also takes comments made on its old side. */
export function onLine(comment: Pick<ReviewComment, 'side' | 'line'>, line: DiffLine): boolean {
  if (comment.line === null) return false
  if (comment.side === 'old') return (line.kind === 'del' || line.kind === 'context') && line.oldNumber === comment.line
  return (line.kind === 'add' || line.kind === 'context') && line.newNumber === comment.line
}

/**
 * The comments of one file that no line of its current diff shows: made on an older version, or on a
 * line that isn't in any hunk. They're listed above the diff instead of being lost.
 */
export function unplaced(comments: ReviewComment[], lines: DiffLine[]): ReviewComment[] {
  return comments.filter((comment) => comment.outdated || comment.line === null || !lines.some((line) => onLine(comment, line)))
}

/** Replies sit under the comment they answer; a thread is shown in that order. */
export function threaded(comments: ReviewComment[]): ReviewComment[] {
  const byId = new Map(comments.map((c) => [c.id, c]))
  const roots = comments.filter((c) => !c.inReplyTo || !byId.has(c.inReplyTo))
  const replies = (id: string): ReviewComment[] => comments.filter((c) => c.inReplyTo === id).flatMap((c) => [c, ...replies(c.id)])
  return roots.flatMap((root) => [root, ...replies(root.id)])
}

export const sameDraft = (a: DraftComment, b: DraftComment): boolean => a.path === b.path && a.line === b.line && a.side === b.side && a.body === b.body
