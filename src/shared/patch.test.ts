import { describe, expect, it } from 'vitest'
import { changedLineCount, hunkKeys, lineKey, parsePatch, patchPaths, selectLines } from './patch'

const diff = [
  'diff --git a/f.txt b/f.txt',
  'index 1111111..2222222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,4 +1,4 @@ heading',
  ' one',
  '-two',
  '+TWO',
  ' three',
  ' four',
  '@@ -10,3 +10,4 @@',
  ' ten',
  '+new',
  ' eleven',
  '-twelve',
  '\\ No newline at end of file',
  '+twelve!',
  '\\ No newline at end of file',
  ''
].join('\n')

describe('parsePatch', () => {
  it('reads hunks, their lines and the no-newline notes', () => {
    const patch = parsePatch(diff)
    expect(patch?.header).toHaveLength(4)
    expect(patch?.hunks.map((h) => [h.oldStart, h.oldCount, h.newStart, h.newCount, h.heading])).toEqual([
      [1, 4, 1, 4, ' heading'],
      [10, 3, 10, 4, '']
    ])
    expect(patch?.hunks[1]?.lines.map((l) => [l.kind, l.text, l.noNewline])).toEqual([
      ['context', 'ten', false],
      ['add', 'new', false],
      ['context', 'eleven', false],
      ['del', 'twelve', true],
      ['add', 'twelve!', true]
    ])
    expect(patch && changedLineCount(patch)).toBe(5)
    expect(patch && hunkKeys(patch, 1)).toEqual(['1:1', '1:3', '1:4'])
    expect(patch && patchPaths(patch)).toEqual({ old: 'f.txt', new: 'f.txt' })
  })

  it('turns down binary diffs and several files', () => {
    expect(parsePatch('diff --git a/b b/b\nBinary files a/b and b/b differ\n')).toBeNull()
    expect(parsePatch(`${diff}diff --git a/g b/g\n--- a/g\n+++ b/g\n@@ -1 +1 @@\n-x\n+y\n`)).toBeNull()
  })

  it('reads quoted paths', () => {
    const quoted = parsePatch('--- "a/tab\\there"\n+++ "b/tab\\there"\n@@ -1 +1 @@\n-x\n+y\n')
    expect(quoted && patchPaths(quoted)).toEqual({ old: 'tab\there', new: 'tab\there' })
  })
})

describe('selectLines', () => {
  const patch = parsePatch(diff)!

  it('stages the picked lines and keeps the rest of the index as it is', () => {
    // Only "+new" from the second hunk: the first hunk is left out, "-twelve" stays as context.
    expect(selectLines(patch, new Set([lineKey(1, 1)]), 'forward')).toBe(
      [
        ...patch.header,
        '@@ -10,3 +10,4 @@',
        ' ten',
        '+new',
        ' eleven',
        ' twelve',
        '\\ No newline at end of file',
        ''
      ].join('\n')
    )
  })

  it('moves later hunks by what earlier ones added', () => {
    const both = selectLines(patch, new Set([lineKey(0, 2), lineKey(1, 1)]), 'forward')
    expect(both?.split('\n').filter((line) => line.startsWith('@@'))).toEqual(['@@ -1,4 +1,5 @@ heading', '@@ -10,3 +11,4 @@'])
  })

  it('reverse patches keep unpicked additions as context and drop unpicked removals', () => {
    expect(selectLines(patch, new Set([lineKey(0, 1)]), 'reverse')).toBe(
      [...patch.header, '@@ -1,5 +1,4 @@ heading', ' one', '-two', ' TWO', ' three', ' four', ''].join('\n')
    )
  })

  it('returns null without a picked line', () => {
    expect(selectLines(patch, new Set(), 'forward')).toBeNull()
    expect(selectLines(patch, new Set([lineKey(0, 0)]), 'forward')).toBeNull()
  })

  it('edits a new file instead of creating it when only part of it is picked', () => {
    const added = parsePatch('diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\n+b\n')!
    expect(selectLines(added, new Set([lineKey(0, 0), lineKey(0, 1)]), 'reverse')).toContain('new file mode')
    expect(selectLines(added, new Set([lineKey(0, 1)]), 'reverse')).toBe(
      ['diff --git a/n b/n', '--- a/n', '+++ b/n', '@@ -1,1 +1,2 @@', ' a', '+b', ''].join('\n')
    )
  })
})
