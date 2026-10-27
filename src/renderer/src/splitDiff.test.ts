import { describe, expect, it } from 'vitest'
import { parseDiff } from './diff'
import { splitRows } from './splitDiff'

const DIFF = ['@@ -1,4 +1,4 @@', ' keep', '-old one', '-old two', '+new one', ' tail', '+added'].join('\n')

describe('side-by-side diff', () => {
  it('pairs removals with the additions that replaced them', () => {
    const rows = splitRows(parseDiff(DIFF))
    expect(rows.map((row) => [row.kind, row.left?.text ?? row.full?.text ?? null, row.right?.text ?? null])).toEqual([
      ['hunk', '@@ -1,4 +1,4 @@', null],
      ['lines', 'keep', 'keep'],
      ['lines', 'old one', 'new one'],
      ['lines', 'old two', null],
      ['lines', 'tail', 'tail'],
      ['lines', null, 'added']
    ])
    expect(rows[2]?.left?.oldNumber).toBe(2)
    expect(rows[2]?.right?.newNumber).toBe(2)
  })
})
