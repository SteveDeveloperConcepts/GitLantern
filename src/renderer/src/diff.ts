export interface DiffLine {
  kind: 'add' | 'del' | 'context' | 'hunk' | 'note'
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
