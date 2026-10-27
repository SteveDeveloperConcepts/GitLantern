import type { DiffLine } from './diff'

/** A row of the side-by-side diff: the old line on the left, the new one on the right. */
export interface SplitRow {
  kind: 'hunk' | 'note' | 'lines'
  left: DiffLine | null
  right: DiffLine | null
  /** Hunk and note rows: the line spanning both sides. */
  full?: DiffLine
}

/**
 * Pair up a unified diff's lines for the side-by-side view. Within a run of changes, removals and
 * additions are matched in order, so a changed line sits next to what it became; the longer side
 * gets blank partners.
 */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let removed: DiffLine[] = []
  let added: DiffLine[] = []
  const flush = (): void => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      rows.push({ kind: 'lines', left: removed[i] ?? null, right: added[i] ?? null })
    }
    removed = []
    added = []
  }
  for (const line of lines) {
    if (line.kind === 'del') removed.push(line)
    else if (line.kind === 'add') added.push(line)
    else {
      flush()
      if (line.kind === 'hunk' || line.kind === 'note') rows.push({ kind: line.kind, left: null, right: null, full: line })
      else rows.push({ kind: 'lines', left: line, right: line })
    }
  }
  flush()
  return rows
}
