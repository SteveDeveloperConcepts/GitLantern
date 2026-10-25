import { describe, expect, it } from 'vitest'
import { parseDiff } from './diff'

describe('parseDiff', () => {
  it('numbers old and new lines from the hunk header', () => {
    const text = [
      'diff --git a/x.ts b/x.ts',
      'index 1..2 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -12,3 +12,4 @@ function f() {',
      ' keep',
      '-old',
      '+new',
      '+added',
      ' tail',
      ''
    ].join('\n')
    expect(parseDiff(text).map((l) => [l.kind, l.oldNumber, l.newNumber, l.text])).toEqual([
      ['hunk', null, null, '@@ -12,3 +12,4 @@ function f() {'],
      ['context', 12, 12, 'keep'],
      ['del', 13, null, 'old'],
      ['add', null, 13, 'new'],
      ['add', null, 14, 'added'],
      ['context', 14, 15, 'tail']
    ])
  })

  it('keeps notes such as new-file and binary markers', () => {
    const text = 'diff --git a/b b/b\nnew file mode 100644\nBinary files /dev/null and b/b differ\n'
    expect(parseDiff(text).map((l) => l.text)).toEqual(['new file mode 100644', 'Binary files /dev/null and b/b differ'])
  })
})
