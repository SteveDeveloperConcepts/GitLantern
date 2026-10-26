/** Reading and resolving the conflict markers git leaves in a file. */

export type ConflictChoice = 'ours' | 'theirs' | 'both'

// <<<<<<< opens our side, ||||||| the common base (diff3 style), ======= their side, >>>>>>> closes.
export const CONFLICT_MARKER = /^([<|=>])\1{6}(?: |$)/

const markerOf = (line: string): string | undefined => CONFLICT_MARKER.exec(line.replace(/\r?\n$/, ''))?.[1]

interface Block {
  /** Every line of the conflict, markers included, as it is in the file. */
  lines: string[]
  ours: string[]
  theirs: string[]
}

/** Split text into lines that keep their own line ending, so joining them gives the text back exactly. */
function splitKeepingEndings(text: string): string[] {
  return text.split(/(?<=\n)/).filter((line) => line !== '')
}

/** Walk the file, handing each complete conflict to `onBlock` and every other line to `onLine`. */
function walk(text: string, onLine: (line: string) => void, onBlock: (block: Block) => void): void {
  let state: 'outside' | 'ours' | 'base' | 'theirs' = 'outside'
  let block: Block = { lines: [], ours: [], theirs: [] }
  for (const line of splitKeepingEndings(text)) {
    const marker = markerOf(line)
    if (state === 'outside') {
      if (marker === '<') {
        state = 'ours'
        block = { lines: [line], ours: [], theirs: [] }
      } else {
        onLine(line)
      }
      continue
    }
    block.lines.push(line)
    if (marker === '|' && state === 'ours') state = 'base'
    else if (marker === '=' && (state === 'ours' || state === 'base')) state = 'theirs'
    else if (marker === '>' && state === 'theirs') {
      state = 'outside'
      onBlock(block)
    } else if (state === 'ours') block.ours.push(line)
    else if (state === 'theirs') block.theirs.push(line)
  }
  // A conflict that never closes isn't one: keep its lines as they are.
  if (state !== 'outside') block.lines.forEach(onLine)
}

export function countConflicts(text: string): number {
  let count = 0
  walk(
    text,
    () => {},
    () => count++
  )
  return count
}

/**
 * Replace conflict number `index` (from 0, top to bottom) with the chosen side. Every other line,
 * line endings included, stays exactly as it was.
 */
export function resolveConflict(text: string, index: number, choice: ConflictChoice): { text: string; remaining: number } {
  const out: string[] = []
  let count = 0
  walk(
    text,
    (line) => out.push(line),
    (block) => {
      if (count++ !== index) out.push(...block.lines)
      else if (choice === 'ours') out.push(...block.ours)
      else if (choice === 'theirs') out.push(...block.theirs)
      else out.push(...block.ours, ...block.theirs)
    }
  )
  if (index < 0 || index >= count) throw new Error('That conflict isn’t in the file any more')
  return { text: out.join(''), remaining: count - 1 }
}
