import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { appStore } from './sandbox'

/** Where the bookmarks are kept (Settings): folder → bookmark data. */
export interface BookmarkStore {
  bookmarks(): Readonly<Record<string, string>>
  setBookmark(folder: string, bookmark: string): void
}

/** Whether `target` is `folder` or inside it. */
export function contains(folder: string, target: string): boolean {
  const relative = path.relative(folder, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Folders the user picked, kept reachable across restarts in the Mac App Store build. The App Sandbox
 * only lets GitLantern into a folder picked in an open dialog (and what's inside it), and only until it
 * quits. The security-scoped bookmark saved with the folder lets it back in on the next start. Programs
 * GitLantern starts afterwards, git among them, get the same access. Elsewhere every folder can be
 * reached, and none of this does anything.
 */
export class FolderAccess {
  /** Folders whose bookmark is in use: how to stop using each. */
  private readonly opened = new Map<string, () => void>()

  constructor(private readonly store: BookmarkStore) {}

  /** Keep a folder just picked in a dialog, with the bookmark the dialog made for it. */
  remember(folder: string, bookmark: string | undefined): void {
    if (appStore && bookmark) this.store.setBookmark(path.resolve(folder), bookmark)
  }

  /** Let GitLantern into `target` again, when a remembered folder is it or holds it. */
  open(target: string): void {
    if (!appStore) return
    const resolved = path.resolve(target)
    // Newest first: an older bookmark may no longer resolve.
    for (const [folder, bookmark] of Object.entries(this.store.bookmarks()).reverse()) {
      if (!contains(folder, resolved)) continue
      if (this.opened.has(folder)) return
      try {
        this.opened.set(folder, app.startAccessingSecurityScopedResource(bookmark) as () => void)
        return
      } catch {
        // The folder is gone, or the bookmark is stale: try the next one that covers it.
      }
    }
  }

  /**
   * Use every remembered folder, at startup. Git may need more than the folder a tab shows: a
   * worktree's main repository, a submodule's, or a worktree that `git worktree prune` would
   * otherwise take for deleted.
   */
  openAll(): void {
    for (const folder of Object.keys(this.store.bookmarks())) this.open(folder)
  }

  /** Whether GitLantern can read (or, with `write`, write in) the folder now. */
  reachable(folder: string, write = false): boolean {
    this.open(folder)
    try {
      fs.accessSync(folder, write ? fs.constants.W_OK : fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * In the Mac App Store build, a plainer reason for a repository that wouldn't open because the
   * sandbox kept git out: the folder was never picked, or only a folder inside the repository was.
   */
  explain(error: unknown, folder: string): unknown {
    if (!appStore) return error
    const name = path.basename(folder)
    if (!this.reachable(folder)) {
      return new Error(`macOS only lets GitLantern into folders you choose. Open “${name}” with Open repository… again.`)
    }
    if (error instanceof Error && /not a git repository/i.test(error.message)) {
      return new Error(
        `“${name}” isn’t a Git repository. If it’s a folder inside one, choose the repository’s top folder (the one with .git in it): ` +
          'macOS only lets GitLantern into the folder you choose and what’s inside it.'
      )
    }
    return error
  }

  /** Stop using every bookmark (when GitLantern quits). */
  close(): void {
    for (const stop of this.opened.values()) stop()
    this.opened.clear()
  }
}
