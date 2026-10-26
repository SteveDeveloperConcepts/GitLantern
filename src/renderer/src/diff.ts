import { CONFLICT_MARKER } from '../../shared/conflicts'
import { lineKey } from '../../shared/patch'

export interface DiffLine {
  /** `ours`, `base`, `theirs` and `marker` only appear in a conflicted file (see parseConflicts). */
  kind: 'add' | 'del' | 'context' | 'hunk' | 'note' | 'ours' | 'base' | 'theirs' | 'marker'
  oldNumber: number | null
  newNumber: number | null
  text: string
  /** Hunk headers and hunk lines: which hunk, counting from 0 as `parsePatch` does. */
  hunk?: number
  /** Added and removed lines: the key `selectLines` picks them by. */
  key?: string
  /** A conflict's opening marker: which conflict it starts, counting from 0. */
  conflict?: number
}

// Header lines that only repeat what the diff pane's title already says.
const SKIPPED = /^(diff --git|index |--- |\+\+\+ )/
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Turn unified diff text into display lines with old/new line numbers. */
export function parseDiff(text: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  let hunkIndex = -1
  // Position of the next line inside its hunk, counted the way parsePatch does (notes don't count).
  let position = 0
  for (const line of text.split('\n')) {
    const hunk = HUNK.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      hunkIndex++
      position = 0
      lines.push({ kind: 'hunk', oldNumber: null, newNumber: null, text: line, hunk: hunkIndex })
    } else if (!inHunk || line.startsWith('diff --git')) {
      inHunk = false
      if (line && !SKIPPED.test(line)) lines.push({ kind: 'note', oldNumber: null, newNumber: null, text: line })
    } else if (line.startsWith('+')) {
      const key = lineKey(hunkIndex, position++)
      lines.push({ kind: 'add', oldNumber: null, newNumber: newLine++, text: line.slice(1), hunk: hunkIndex, key })
    } else if (line.startsWith('-')) {
      const key = lineKey(hunkIndex, position++)
      lines.push({ kind: 'del', oldNumber: oldLine++, newNumber: null, text: line.slice(1), hunk: hunkIndex, key })
    } else if (line.startsWith('\\')) {
      lines.push({ kind: 'note', oldNumber: null, newNumber: null, text: line })
    } else {
      position++
      lines.push({ kind: 'context', oldNumber: oldLine++, newNumber: newLine++, text: line.slice(1), hunk: hunkIndex })
    }
  }
  // git's output ends with a newline, which leaves one empty context line; drop it.
  const last = lines.at(-1)
  if (last?.kind === 'context' && last.text === '') lines.pop()
  return lines
}

const SECTION_AFTER: Record<string, DiffLine['kind']> = { '<': 'ours', '|': 'base', '=': 'theirs', '>': 'context' }

/** The two sides of one conflict, as git labelled them after its markers ("HEAD", "feature"…). */
export interface ConflictLabels {
  ours: string
  theirs: string
}

/** Lines of a conflicted file, each tagged with the side of the conflict it belongs to. */
export function parseConflicts(text: string): { lines: DiffLine[]; conflicts: number; labels: ConflictLabels[] } {
  const source = text.split(/\r?\n/)
  if (source.at(-1) === '') source.pop()
  let section: DiffLine['kind'] = 'context'
  const labels: ConflictLabels[] = []
  const lines = source.map((line, index): DiffLine => {
    const marker = CONFLICT_MARKER.exec(line)?.[1]
    if (!marker) return { kind: section, oldNumber: null, newNumber: index + 1, text: line }
    section = SECTION_AFTER[marker] ?? 'context'
    const label = line.slice(8).trim()
    const last = labels.at(-1)
    if (marker === '<') labels.push({ ours: label, theirs: '' })
    else if (marker === '>' && last) last.theirs = label
    const opens = marker === '<' ? { conflict: labels.length - 1 } : {}
    return { kind: 'marker', oldNumber: null, newNumber: index + 1, text: line, ...opens }
  })
  return { lines, conflicts: labels.length, labels }
}

/** What to call one side of a conflict, from git's label for it. `head` is the name for HEAD. */
export function sideName(label: string, head: string): string {
  if (label === 'HEAD' || label === '') return head
  // Applying a stash: the working copy against the stash.
  if (label === 'Updated upstream') return 'your changes'
  if (label === 'Stashed changes') return 'the stash'
  // Rebase and cherry-pick label the commit being copied "1a2b3c4 (its subject)".
  const commit = /^([0-9a-f]{7,40})(?: \(.*\))?$/.exec(label)
  return commit ? `commit ${commit[1]?.slice(0, 7)}` : label
}
