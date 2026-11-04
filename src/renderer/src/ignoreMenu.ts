import { escapeIgnored, ignorePattern } from '../../shared/gitignore'
import type { MenuItem } from './components/Menu'

/** Where a pattern goes: .gitignore for everyone, .git/info/exclude for this copy only. */
export type IgnoreFile = 'gitignore' | 'exclude'

/** What an ignore item does. `covers` says which paths the pattern takes in. */
export type IgnoreAction = (pattern: string, where: IgnoreFile, covers: (path: string) => boolean) => void

/** Longer folder paths lose their start, to fit the menu's width with the hint beside them. */
const MAX_FOLDER_LABEL = 36

/** The folders a path is in, nearest first. A path ending in / is a folder itself: git shows a repository inside this one that way. */
export function parentFolders(path: string): string[] {
  const names = path.split('/').slice(0, -1)
  return names.map((_, index) => `${names.slice(0, index + 1).join('/')}/`).reverse()
}

/** These folders all start the same way, so a long one keeps its end, which the menu would otherwise cut off. */
function folderLabel(folder: string): string {
  // By character, not by UTF-16 unit, so an emoji isn't cut in half.
  const characters = [...folder]
  return `Ignore ${characters.length > MAX_FOLDER_LABEL ? `…${characters.slice(-MAX_FOLDER_LABEL).join('')}` : folder}`
}

/**
 * The ignore items for a file in the Changes list. Any file offers the folders it's in, but only a new
 * file offers itself: ignoring a file doesn't stop Git tracking it.
 */
export function ignoreMenu(file: string, untracked: boolean, ignore: IgnoreAction): MenuItem[] {
  const folders = parentFolders(file).map(
    (folder): MenuItem => ({
      key: `ignore-dir:${folder}`,
      label: folderLabel(folder),
      title: folder,
      hint: '.gitignore',
      onSelect: () => ignore(ignorePattern(folder), 'gitignore', (path) => path.startsWith(folder))
    })
  )
  if (!untracked) return folders
  const slash = file.lastIndexOf('/')
  const dot = file.lastIndexOf('.')
  const ext = dot > slash + 1 ? file.slice(dot) : null
  const isFile = (path: string) => path === file
  return [
    ...(file.endsWith('/') ? [] : [{ key: 'ignore', label: 'Ignore this file', hint: '.gitignore', onSelect: () => ignore(ignorePattern(file), 'gitignore', isFile) }]),
    ...(ext ? [{ key: 'ignore-ext', label: `Ignore all ${ext} files`, hint: '.gitignore', onSelect: () => ignore(`*${escapeIgnored(ext)}`, 'gitignore', (path) => path.endsWith(ext)) }] : []),
    ...folders,
    { key: 'exclude', label: 'Ignore here only', hint: '.git/info/exclude', onSelect: () => ignore(ignorePattern(file), 'exclude', isFile) }
  ]
}
