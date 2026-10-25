export interface DiffLine {
  /** `ours`, `base`, `theirs` and `marker` only appear in a conflicted file (see parseConflicts). */
  kind: 'add' | 'del' | 'context' | 'hunk' | 'note' | 'ours' | 'base' | 'theirs' | 'marker'
  oldNumber: number | null
  newNumber: number | null
  text: string
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
  for (const line of text.split('\n')) {
    const hunk = HUNK.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      lines.push({ kind: 'hunk', oldNumber: null, newNumber: null, text: line })
    } else if (!inHunk || line.startsWith('diff --git')) {
      inHunk = false
      if (line && !SKIPPED.test(line)) lines.push({ kind: 'note', oldNumber: null, newNumber: null, text: line })
    } else if (line.startsWith('+')) {
      lines.push({ kind: 'add', oldNumber: null, newNumber: newLine++, text: line.slice(1) })
    } else if (line.startsWith('-')) {
      lines.push({ kind: 'del', oldNumber: oldLine++, newNumber: null, text: line.slice(1) })
    } else if (line.startsWith('\\')) {
      lines.push({ kind: 'note', oldNumber: null, newNumber: null, text: line })
    } else {
      lines.push({ kind: 'context', oldNumber: oldLine++, newNumber: newLine++, text: line.slice(1) })
    }
  }
  // git's output ends with a newline, which leaves one empty context line; drop it.
  const last = lines.at(-1)
  if (last?.kind === 'context' && last.text === '') lines.pop()
  return lines
}

// <<<<<<< opens our side, ||||||| the common base (diff3 style), ======= their side, >>>>>>> closes.
const CONFLICT_MARKER = /^([<|=>])\1{6}(?: |$)/
const SECTION_AFTER: Record<string, DiffLine['kind']> = { '<': 'ours', '|': 'base', '=': 'theirs', '>': 'context' }

/** Lines of a conflicted file, each tagged with the side of the conflict it belongs to. */
export function parseConflicts(text: string): { lines: DiffLine[]; conflicts: number } {
  const source = text.split(/\r?\n/)
  if (source.at(-1) === '') source.pop()
  let section: DiffLine['kind'] = 'context'
  let conflicts = 0
  const lines = source.map((line, index): DiffLine => {
    const marker = CONFLICT_MARKER.exec(line)?.[1]
    if (marker) {
      section = SECTION_AFTER[marker] ?? 'context'
      if (marker === '<') conflicts++
      return { kind: 'marker', oldNumber: null, newNumber: index + 1, text: line }
    }
    return { kind: section, oldNumber: null, newNumber: index + 1, text: line }
  })
  return { lines, conflicts }
}
