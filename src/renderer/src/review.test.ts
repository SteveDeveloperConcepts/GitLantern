import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '../../shared/types'
import { parseDiff } from './diff'
import { lineAnchor, onLine, threaded, unplaced } from './review'

const lines = parseDiff(['@@ -1,3 +1,3 @@', ' keep', '-old', '+new', ' tail'].join('\n'))
const comment = (id: string, side: 'old' | 'new', line: number | null, extra: Partial<ReviewComment> = {}): ReviewComment => ({
  id,
  author: 'maya',
  body: id,
  createdAt: null,
  path: 'a.ts',
  line,
  side,
  ...extra
})

describe('review comments on diff lines', () => {
  it('anchors removed lines by their old number and the rest by the new one', () => {
    expect(lines.map(lineAnchor)).toEqual([null, { side: 'new', line: 1 }, { side: 'old', line: 2 }, { side: 'new', line: 2 }, { side: 'new', line: 3 }])
  })

  it('puts comments under the lines they were made on', () => {
    const removed = lines[2]
    const added = lines[3]
    const context = lines[4]
    if (!removed || !added || !context) throw new Error('diff')
    expect(onLine(comment('a', 'old', 2), removed)).toBe(true)
    expect(onLine(comment('a', 'old', 2), added)).toBe(false)
    expect(onLine(comment('b', 'new', 2), added)).toBe(true)
    // A context line has both numbers; a comment on its old side still shows there.
    expect(onLine(comment('c', 'old', 3), context)).toBe(true)
  })

  it('lists the comments no line shows, and keeps replies under what they answer', () => {
    const list = [comment('far', 'new', 40), comment('old', 'new', 2, { outdated: true }), comment('here', 'new', 2)]
    expect(unplaced(list, lines).map((c) => c.id)).toEqual(['far', 'old'])
    const thread = [comment('root', 'new', 1), comment('other', 'new', 1), comment('reply', 'new', 1, { inReplyTo: 'root' })]
    expect(threaded(thread).map((c) => c.id)).toEqual(['root', 'reply', 'other'])
  })
})
