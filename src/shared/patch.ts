/**
 * Patches that stage, unstage or discard some of a file's changed lines.
 *
 * Lines are picked by key `hunk:line`: the hunk's position in the diff and the line's position inside
 * it, counting context, added and removed lines (not "\ No newline" notes), both from 0.
 */

export interface PatchLine {
  kind: 'context' | 'add' | 'del'
  /** The line without its leading +, - or space. */
  text: string
  /** Followed by "\ No newline at end of file". */
  noNewline: boolean
}

export interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** Whatever follows the second @@, usually the enclosing function. */
  heading: string
  lines: PatchLine[]
}

export interface FilePatch {
  /** Lines before the first hunk: `diff --git`, mode lines, `---` and `+++`. */
  header: string[]
  hunks: Hunk[]
}

export const lineKey = (hunk: number, line: number): string => `${hunk}:${line}`

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
const NO_NEWLINE = '\\ No newline at end of file'
const SIGNS: Record<string, PatchLine['kind']> = { ' ': 'context', '+': 'add', '-': 'del' }

/** Parse git's diff of one file. Null when it isn't one file's text diff (binary, several files). */
export function parsePatch(diff: string): FilePatch | null {
  const lines = diff.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const header: string[] = []
  const hunks: Hunk[] = []
  let hunk: Hunk | null = null
  for (const line of lines) {
    const start = HUNK.exec(line)
    if (start) {
      hunk = {
        oldStart: Number(start[1]),
        oldCount: start[2] === undefined ? 1 : Number(start[2]),
        newStart: Number(start[3]),
        newCount: start[4] === undefined ? 1 : Number(start[4]),
        heading: start[5] ?? '',
        lines: []
      }
      hunks.push(hunk)
    } else if (!hunk) {
      header.push(line)
    } else if (line.startsWith('\\')) {
      const previous = hunk.lines.at(-1)
      if (previous) previous.noNewline = true
    } else {
      const kind = SIGNS[line[0] ?? '']
      if (!kind) return null
      hunk.lines.push({ kind, text: line.slice(1), noNewline: false })
    }
  }
  const files = header.filter((line) => line.startsWith('diff --git ')).length
  if (files > 1 || hunks.length === 0 || !header.some((line) => line.startsWith('+++ '))) return null
  return { header, hunks }
}

/** Number of changed (added or removed) lines in a patch. */
export function changedLineCount(patch: FilePatch): number {
  return patch.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.kind !== 'context').length, 0)
}

/** Keys of every changed line in one hunk. */
export function hunkKeys(patch: FilePatch, hunk: number): string[] {
  return (patch.hunks[hunk]?.lines ?? []).flatMap((line, index) => (line.kind === 'context' ? [] : [lineKey(hunk, index)]))
}

/** `--- /dev/null` or `+++ /dev/null` become the other side's path, so a partial patch edits the file. */
function modificationHeader(header: string[]): string[] {
  const oldPath = header.find((line) => line.startsWith('--- '))?.slice(4) ?? ''
  const newPath = header.find((line) => line.startsWith('+++ '))?.slice(4) ?? ''
  const swap = (path: string, from: string, to: string) => path.replace(new RegExp(`^("?)${from}/`), `$1${to}/`)
  return [
    ...header.filter((line) => line.startsWith('diff --git ')),
    `--- ${oldPath === '/dev/null' ? swap(newPath, 'b', 'a') : oldPath}`,
    `+++ ${newPath === '/dev/null' ? swap(oldPath, 'a', 'b') : newPath}`
  ]
}

/** Start line for a range header. Git writes an empty range as the line before it. */
const startFor = (position: number, count: number): number => (count === 0 ? position - 1 : position)
const positionOf = (start: number, count: number): number => (count === 0 ? start + 1 : start)

/**
 * A patch with only the selected lines of `patch`, or null when none are selected.
 *
 * `forward` patches apply to the diff's old side: staging from the working tree into the index.
 * `reverse` patches are applied with --reverse to its new side: unstaging from the index, or
 * discarding from the working tree. Either way, the side the patch applies to keeps every change
 * that isn't selected: an unselected removal there becomes context, an unselected addition is
 * left out.
 */
export function selectLines(patch: FilePatch, selected: ReadonlySet<string>, direction: 'forward' | 'reverse'): string | null {
  const out: string[] = []
  // Lines added minus lines removed by the hunks written so far: how far the other side has moved.
  let shift = 0
  let wroteEverything = true
  patch.hunks.forEach((hunk, h) => {
    const lines: PatchLine[] = []
    let picked = 0
    hunk.lines.forEach((line, index) => {
      if (line.kind === 'context') lines.push(line)
      else if (selected.has(lineKey(h, index))) {
        lines.push(line)
        picked++
      } else {
        wroteEverything = false
        // The target side has this line: keep it as context. It doesn't have it: leave it out.
        if ((line.kind === 'del') === (direction === 'forward')) lines.push({ ...line, kind: 'context' })
      }
    })
    if (picked === 0) return
    const oldCount = lines.filter((line) => line.kind !== 'add').length
    const newCount = lines.filter((line) => line.kind !== 'del').length
    const oldStart =
      direction === 'forward' ? hunk.oldStart : startFor(positionOf(hunk.newStart, hunk.newCount) - shift, oldCount)
    const newStart =
      direction === 'forward' ? startFor(positionOf(hunk.oldStart, hunk.oldCount) + shift, newCount) : hunk.newStart
    shift += newCount - oldCount
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${hunk.heading}`)
    for (const line of lines) {
      out.push(`${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`)
      if (line.noNewline) out.push(NO_NEWLINE)
    }
  })
  if (out.length === 0) return null
  // A new or deleted file only stays one when the whole of it is picked.
  const addsOrDeletes = patch.header.some((line) => line === '--- /dev/null' || line === '+++ /dev/null')
  const header = wroteEverything || !addsOrDeletes ? patch.header : modificationHeader(patch.header)
  return [...header, ...out, ''].join('\n')
}

/** Undo git's C-style quoting of a path in a diff header ("a/tab\there"). */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path
  const escapes: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', r: '\r', v: '\v' }
  const bytes: number[] = []
  const body = path.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const char = body[i] ?? ''
    if (char !== '\\') {
      bytes.push(...new TextEncoder().encode(char))
      continue
    }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 3
    } else {
      bytes.push(...new TextEncoder().encode(escapes[body[i + 1] ?? ''] ?? ''))
      i++
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** The paths a patch's `---` and `+++` lines name, without their a/ and b/ prefixes; null for /dev/null. */
export function patchPaths(patch: FilePatch): { old: string | null; new: string | null } {
  const path = (prefix: string, side: string): string | null => {
    const raw = patch.header.find((line) => line.startsWith(prefix))?.slice(4) ?? '/dev/null'
    if (raw === '/dev/null') return null
    const name = unquote(raw)
    return name.startsWith(`${side}/`) ? name.slice(2) : name
  }
  return { old: path('--- ', 'a'), new: path('+++ ', 'b') }
}
