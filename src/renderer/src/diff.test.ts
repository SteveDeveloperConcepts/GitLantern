import { describe, expect, it } from 'vitest'
import { parsePatch } from '../../shared/patch'
import { parseConflicts, parseDiff, sideName } from './diff'

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

describe('parseConflicts', () => {
  it('tags each side of every conflict, including a diff3 base', () => {
    const text = ['a', '<<<<<<< HEAD', 'mine', '||||||| base', 'old', '=======', 'theirs', '>>>>>>> feature', 'b', ''].join('\r\n')
    const { lines, conflicts } = parseConflicts(text)
    expect(conflicts).toBe(1)
    expect(lines.map((l) => [l.kind, l.newNumber, l.text])).toEqual([
      ['context', 1, 'a'],
      ['marker', 2, '<<<<<<< HEAD'],
      ['ours', 3, 'mine'],
      ['marker', 4, '||||||| base'],
      ['base', 5, 'old'],
      ['marker', 6, '======='],
      ['theirs', 7, 'theirs'],
      ['marker', 8, '>>>>>>> feature'],
      ['context', 9, 'b']
    ])
  })

  it('leaves look-alike lines alone', () => {
    const { lines, conflicts } = parseConflicts('========\n<<<<<<<<< no\n')
    expect(conflicts).toBe(0)
    expect(lines.every((l) => l.kind === 'context')).toBe(true)
  })

  it('labels every conflict and names its sides plainly', () => {
    const { lines, labels } = parseConflicts(['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> 1a2b3c4d (Fix it)', ''].join('\n'))
    expect(lines[0]?.conflict).toBe(0)
    expect(labels).toEqual([{ ours: 'HEAD', theirs: '1a2b3c4d (Fix it)' }])
    expect(sideName('HEAD', 'main')).toBe('main')
    expect(sideName('1a2b3c4d (Fix it)', 'main')).toBe('commit 1a2b3c4')
    expect(sideName('Stashed changes', 'main')).toBe('the stash')
    expect(sideName('feature', 'main')).toBe('feature')
  })
})

describe('line keys', () => {
  it('number changed lines the way parsePatch does', () => {
    const text = ['--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+c', '@@ -9 +9 @@', '-y', '+z', ''].join('\n')
    const patch = parsePatch(text)
    const keyed = parseDiff(text).filter((line) => line.key)
    expect(keyed.map((line) => line.key)).toEqual(['0:1', '0:2', '1:0', '1:1'])
    for (const line of keyed) {
      const [hunk = -1, index = -1] = (line.key ?? '').split(':').map(Number)
      expect(patch?.hunks[hunk]?.lines[index]?.text).toBe(line.text)
    }
  })
})
