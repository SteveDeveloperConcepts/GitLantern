import fs from 'node:fs'
import type { ChangeKind } from '../shared/types'

const DEBOUNCE_MS = 250
// Churn that never changes what the UI shows.
const IGNORED = [/^\.git\/objects\//, /^\.git\/logs\//, /\.lock$/, /^\.git\/fsmonitor/, /(^|\/)node_modules\//]

/** Classify a changed path: anything under .git except the index means refs/HEAD/config changed. */
export function classifyChange(filename: string): ChangeKind | null {
  const file = filename.replace(/\\/g, '/')
  if (IGNORED.some((pattern) => pattern.test(file))) return null
  if (file === '.git' || file.startsWith('.git/')) return file === '.git/index' ? 'worktree' : 'refs'
  return 'worktree'
}

/**
 * Watch a repository recursively (native on macOS and Windows) and report batched changes.
 * Returns a function that stops watching.
 */
export function watchRepo(root: string, onChange: (kinds: ChangeKind[]) => void): () => void {
  const pending = new Set<ChangeKind>()
  let timer: NodeJS.Timeout | undefined

  const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
    // Some platforms omit the filename; refresh everything then.
    const kind = filename ? classifyChange(filename.toString()) : 'refs'
    if (!kind) return
    pending.add(kind)
    clearTimeout(timer)
    timer = setTimeout(() => {
      const kinds = [...pending]
      pending.clear()
      onChange(kinds)
    }, DEBOUNCE_MS)
  })
  watcher.on('error', () => {})

  return () => {
    clearTimeout(timer)
    watcher.close()
  }
}
