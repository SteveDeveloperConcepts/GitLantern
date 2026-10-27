import fs from 'node:fs/promises'
import path from 'node:path'
import type { LfsFile, LfsInfo, LfsLock, NewWorktree, Submodule, Worktree } from '../../shared/types'
import {
  LITERAL_PATHS,
  assertRemoteName,
  assertRemoteUrl,
  assertRevision,
  configValue,
  credentialArgs,
  insideRepo,
  readState,
  remotes,
  repoCredentialArgs,
  status
} from './commands'
import { GitError, runGit } from './runGit'

// Submodules

const SUBMODULE_STATES = { ' ': 'ok', '-': 'uninitialized', '+': 'modified', U: 'conflict' } as const
const SUBMODULE_LINE = /^([ +\-U])([0-9a-f]{40,64}) (.+)$/

/** Parse `git submodule status`: a state character, the commit, the path and, for checked-out ones, `(describe)`. */
export function parseSubmoduleStatus(output: string): Omit<Submodule, 'url'>[] {
  return output.split('\n').flatMap((line) => {
    const match = SUBMODULE_LINE.exec(line)
    if (!match) return []
    const [, flag = ' ', hash = '', rest = ''] = match
    // Only checked-out submodules get `git describe` output after the path, and ref names have no spaces.
    const describe = rest.lastIndexOf(' (')
    const file = (flag === ' ' || flag === '+') && describe !== -1 && rest.endsWith(')') ? rest.slice(0, describe) : rest
    return [{ path: file, hash, state: SUBMODULE_STATES[flag as keyof typeof SUBMODULE_STATES] }]
  })
}

interface DeclaredSubmodule {
  name: string
  path: string
  url: string
}

/** Parse `git config -z --get-regexp` over a .gitmodules file into its submodules (`key\nvalue\0` records). */
export function parseGitmodules(output: string): DeclaredSubmodule[] {
  const byName = new Map<string, { path?: string; url?: string }>()
  for (const record of output.split('\0')) {
    // A key without a value has no newline.
    const newline = record.indexOf('\n')
    if (newline === -1) continue
    // Names may contain dots, so the field is whatever follows the last one.
    const match = /^submodule\.(.+)\.(path|url)$/.exec(record.slice(0, newline))
    if (!match) continue
    const [, name = '', field] = match
    byName.set(name, { ...byName.get(name), [field === 'url' ? 'url' : 'path']: record.slice(newline + 1) })
  }
  return [...byName].flatMap(([name, { path: file, url }]) => (file ? [{ name, path: file.replace(/\/+$/, ''), url: url ?? '' }] : []))
}

/** The submodules declared in `.gitmodules` inside `folder` (the repository, or a submodule holding nested ones). */
async function declaredSubmodules(repo: string, folder: string): Promise<DeclaredSubmodule[]> {
  // With -f, git reads only that file: include directives in it aren't followed.
  const file = path.join(repo, folder, '.gitmodules')
  const { stdout } = await runGit(['config', '-z', '-f', file, '--get-regexp', '^submodule\\..*\\.(path|url)$'], {
    cwd: repo,
    allowedExitCodes: [0, 1]
  })
  return parseGitmodules(stdout)
}

/** The submodule that holds a nested one (`''` for the repository itself), going by the listed paths. */
function holderOf(paths: string[], file: string): string {
  return paths.filter((other) => file.startsWith(`${other}/`)).sort((a, b) => b.length - a.length)[0] ?? ''
}

/** Every submodule, nested ones included, with the commit the repository records for it and its address. */
export async function submodules(repo: string): Promise<Submodule[]> {
  if ((await readState(path.join(repo, '.gitmodules'))) === null) return []
  // --cached shows the recorded commit, not the one checked out in the submodule.
  const { stdout } = await runGit(['submodule', 'status', '--cached', '--recursive'], { cwd: repo })
  const list = parseSubmoduleStatus(stdout)
  const paths = list.map((entry) => entry.path)
  // A nested submodule is declared in the .gitmodules of the submodule that holds it.
  const holders = ['', ...paths.filter((file) => paths.some((other) => other.startsWith(`${file}/`)))]
  const urls = new Map<string, string>()
  for (const holder of holders) {
    for (const declared of await declaredSubmodules(repo, holder)) {
      urls.set(holder ? `${holder}/${declared.path}` : declared.path, declared.url)
    }
  }
  return list.map((entry) => ({ ...entry, url: urls.get(entry.path) ?? '' }))
}

/** Clone and check out submodules at their recorded commits, nested ones too; an empty list means all of them. */
export async function updateSubmodules(repo: string, paths: string[]): Promise<void> {
  const list = await submodules(repo)
  const auth = [...(await repoCredentialArgs(repo)), ...credentialArgs(list.map((entry) => entry.url))]
  const update = ['submodule', 'update', '--init', '--recursive']
  if (paths.length === 0) {
    await runGit([...auth, ...update], { cwd: repo })
    return
  }
  // git only knows a nested submodule from inside the submodule that holds it.
  const listed = list.map((entry) => entry.path)
  const byHolder = new Map<string, string[]>()
  for (const file of paths) {
    if (!listed.includes(file)) throw new Error(`${file} isn’t a submodule of this repository`)
    const holder = holderOf(listed, file)
    byHolder.set(holder, [...(byHolder.get(holder) ?? []), holder ? file.slice(holder.length + 1) : file])
  }
  for (const [holder, files] of byHolder) {
    await runGit([...auth, ...update, '--', ...files], { cwd: holder ? insideRepo(repo, holder) : repo, env: LITERAL_PATHS })
  }
}

/** Throw unless `folder` is missing or an empty folder, so git never mixes its files with what's there. */
async function assertFreeFolder(folder: string, name: string): Promise<void> {
  const stat = await fs.stat(folder).catch(() => null)
  if (!stat) return
  if (!stat.isDirectory()) throw new Error(`${name} already exists`)
  if ((await fs.readdir(folder)).length > 0) throw new Error(`${name} already exists and isn’t empty`)
}

/** Relative to the repository's default remote, as .gitmodules allows: `../lib.git`. */
const RELATIVE_URL = /^\.\.?\//

/** Clone a repository into a folder inside this one and record it as a submodule. */
export async function addSubmodule(repo: string, url: string, file: string): Promise<void> {
  if (!RELATIVE_URL.test(url)) assertRemoteUrl(url)
  const target = insideRepo(repo, file)
  await assertFreeFolder(target, file)
  // git refuses a folder that exists, even an empty one, unless it's already a repository.
  await fs.rmdir(target).catch(() => {})
  const relative = path.relative(repo, target).split(path.sep).join('/')
  const auth = [...(await repoCredentialArgs(repo)), ...credentialArgs([url])]
  await runGit([...auth, 'submodule', 'add', '--', url, relative], { cwd: repo })
}

/** Remove a submodule: its checkout, its entry in .gitmodules and the index, and its clone in the git folder. */
export async function removeSubmodule(repo: string, file: string): Promise<void> {
  const declared = (await declaredSubmodules(repo, '')).find((entry) => entry.path === file)
  if (!declared) throw new Error(`${file} isn’t a submodule of this repository. A nested one is removed from the submodule that holds it.`)
  insideRepo(repo, file)
  await runGit(['submodule', 'deinit', '-f', '--', file], { cwd: repo, env: LITERAL_PATHS })
  await runGit(['rm', '-f', '-q', '--', file], { cwd: repo, env: LITERAL_PATHS })
  // deinit keeps the clone under .git/modules, and adding the submodule again would quietly reuse it.
  const { stdout } = await runGit(['rev-parse', '--git-path', 'modules', '--git-path', `modules/${declared.name}`], { cwd: repo })
  const [modules = '', clone = ''] = stdout.split('\n').map((line) => path.resolve(repo, line.trim()))
  // The name comes from the repository's own files: only ever delete inside .git/modules.
  const relative = path.relative(modules, clone)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    await fs.rm(clone, { recursive: true, force: true, maxRetries: 3 })
  }
}

// Worktrees

/** A path to compare with another: resolved, and case-insensitive on Windows. */
function pathKey(folder: string): string {
  const resolved = path.resolve(folder)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const samePath = (a: string, b: string): boolean => pathKey(a) === pathKey(b)

/** Parse `git worktree list --porcelain` (NUL-separated with -z): the first entry is the main worktree. */
export function parseWorktrees(output: string, current: string): Worktree[] {
  const list: Worktree[] = []
  let entry: Worktree | null = null
  for (const line of output.split(output.includes('\0') ? '\0' : '\n')) {
    // An empty line ends an entry.
    if (!line) {
      entry = null
      continue
    }
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)
    if (key === 'worktree') {
      // Git for Windows prints D:/x/y.
      const folder = path.resolve(value)
      entry = {
        path: folder,
        head: null,
        branch: null,
        isMain: list.length === 0,
        isCurrent: samePath(folder, current),
        locked: false,
        prunable: false
      }
      list.push(entry)
    } else if (entry && key === 'HEAD') {
      entry.head = value
    } else if (entry && key === 'branch') {
      entry.branch = value.replace(/^refs\/heads\//, '')
    } else if (entry && key === 'locked') {
      entry.locked = true
    } else if (entry && key === 'prunable') {
      entry.prunable = true
    }
  }
  return list
}

const realPath = (folder: string): Promise<string> => fs.realpath(folder).catch(() => folder)

/** The repository's worktrees, the main one first. */
export async function worktrees(repo: string): Promise<Worktree[]> {
  let stdout: string
  try {
    stdout = (await runGit(['worktree', 'list', '--porcelain', '-z'], { cwd: repo })).stdout
  } catch (error) {
    // -z arrived in Git 2.36.
    if (!(error instanceof GitError) || !/unknown switch/.test(error.stderr)) throw error
    stdout = (await runGit(['worktree', 'list', '--porcelain'], { cwd: repo })).stdout
  }
  const list = parseWorktrees(stdout, repo)
  // The same folder can go by another name: a junction, or macOS's /var for /private/var.
  const here = await realPath(repo)
  return Promise.all(
    list.map(async (entry) => (entry.isCurrent ? entry : { ...entry, isCurrent: samePath(await realPath(entry.path), here) }))
  )
}

async function listedWorktree(repo: string, folder: string): Promise<Worktree> {
  // git lists real paths; the folder may be named another way (macOS's /var, a Windows 8.3 short name).
  const [list, wanted] = await Promise.all([worktrees(repo), realPath(folder)])
  const real = await Promise.all(list.map((candidate) => realPath(candidate.path)))
  const entry = list.find((candidate, index) => samePath(candidate.path, folder) || samePath(real[index] ?? candidate.path, wanted))
  if (!entry) throw new Error(`${folder} isn’t a worktree of this repository`)
  return entry
}

async function assertBranchName(repo: string, name: string): Promise<void> {
  // check-ref-format --branch expands @{-1} to the previous branch, which isn't a new name.
  const valid =
    !name.startsWith('-') &&
    !name.includes('@{') &&
    (await runGit(['check-ref-format', '--branch', name], { cwd: repo, allowedExitCodes: [0, 1, 128] })).exitCode === 0
  if (!valid) throw new Error(`"${name}" is not a valid branch name`)
}

/** Check out an existing local branch, or a new one, in another folder. */
export async function addWorktree(repo: string, worktree: NewWorktree): Promise<void> {
  if (!path.isAbsolute(worktree.path)) throw new Error('Choose a folder for the worktree')
  const target = path.resolve(worktree.path)
  // Checked before git runs: git makes the new branch first, and would leave it behind if the folder is taken.
  await assertFreeFolder(target, target)
  let args: string[]
  let branch: string
  if ('newBranch' in worktree) {
    branch = worktree.newBranch
    await assertBranchName(repo, branch)
    if (worktree.startPoint) assertRevision(worktree.startPoint)
    args = ['-b', branch, '--', target, ...(worktree.startPoint ? [worktree.startPoint] : [])]
  } else {
    branch = worktree.branch
    assertRevision(branch)
    const local = await runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repo, allowedExitCodes: [0, 1] })
    if (local.exitCode !== 0) throw new Error(`There’s no local branch called ${branch}`)
    args = ['--', target, branch]
  }
  try {
    await runGit(['worktree', 'add', ...args], { cwd: repo })
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    const busy = /is already (?:used by worktree|checked out) at '([^']+)'/.exec(error.stderr)
    if (busy) {
      const where = path.resolve(busy[1] ?? '')
      throw new Error(`${branch} is already checked out in ${where}. A branch can be checked out in only one worktree at a time.`)
    }
    if (/a branch named '.*' already exists/.test(error.stderr)) throw new Error(`A branch called ${branch} already exists`)
    throw error
  }
}

/** Delete a worktree's folder and git's record of it. `force` throws away its uncommitted changes. */
export async function removeWorktree(repo: string, folder: string, force: boolean): Promise<void> {
  const entry = await listedWorktree(repo, folder)
  if (entry.isMain) throw new Error('The main worktree can’t be removed: the repository lives there.')
  if (entry.isCurrent || samePath(entry.path, repo)) {
    throw new Error('That’s the worktree open in this window. Open another one to remove it.')
  }
  try {
    await runGit(['worktree', 'remove', ...(force ? ['--force'] : []), '--', entry.path], { cwd: repo })
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    if (/locked working tree/.test(error.stderr)) throw new Error(`${entry.path} is locked. Unlock it first.`)
    if (/modified or untracked files/.test(error.stderr)) {
      throw new Error(`${entry.path} has changes that aren’t committed. Remove it with force to throw them away.`)
    }
    throw error
  }
}

/** Forget worktrees whose folders are gone. */
export async function pruneWorktrees(repo: string): Promise<void> {
  await runGit(['worktree', 'prune'], { cwd: repo })
}

/** Lock a worktree so prune keeps it while its folder is away (on a removable drive, say), or unlock it. */
export async function lockWorktree(repo: string, folder: string, locked: boolean): Promise<void> {
  const entry = await listedWorktree(repo, folder)
  if (entry.isMain) throw new Error('The main worktree can’t be locked or unlocked')
  if (entry.locked === locked) return
  await runGit(['worktree', locked ? 'lock' : 'unlock', '--', entry.path], { cwd: repo })
}

// Git LFS

const NO_LFS: LfsInfo = { installed: false, version: null, patterns: [], files: [] }

/** The version number in `git lfs version` (`git-lfs/3.5.1 (GitHub; …)`), or the whole line if it has another shape. */
export function parseLfsVersion(output: string): string | null {
  return /git-lfs\/(\S+)/.exec(output)?.[1] ?? (output.trim() || null)
}

/** The patterns in a .gitattributes file that send files to Git LFS (`*.psd filter=lfs diff=lfs …`). */
export function parseLfsPatterns(attributes: string): string[] {
  return attributes.split(/\r?\n/).flatMap((line) => {
    const [pattern = '', ...attributesOfLine] = line.trim().split(/\s+/)
    // Comments, and [attr] macro definitions, aren't patterns.
    if (!pattern || pattern.startsWith('#') || pattern.startsWith('[attr]')) return []
    return attributesOfLine.includes('filter=lfs') ? [pattern] : []
  })
}

const LFS_FILE = /^([0-9a-f]+) ([*-]) (.+)$/

/** Parse `git lfs ls-files`: `<oid> * <path>` for a downloaded file, `<oid> - <path>` for a pointer only. */
export function parseLfsFiles(output: string): LfsFile[] {
  return output.split('\n').flatMap((line) => {
    const match = LFS_FILE.exec(line.replace(/\r$/, ''))
    if (!match) return []
    const [, oid = '', marker = '', file = ''] = match
    return [{ path: file, oid, downloaded: marker === '*' }]
  })
}

/** Parse `git lfs locks --json`: `[{ id, path, owner: { name }, locked_at }]`. */
export function parseLfsLocks(json: string): LfsLock[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json.trim() || '[]')
  } catch {
    throw new Error('Git LFS sent a list of locks GitLantern couldn’t read')
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item: unknown) => {
    const lock = item as { id?: unknown; path?: unknown; owner?: { name?: unknown } | null; locked_at?: unknown } | null
    if (!lock || (typeof lock.id !== 'string' && typeof lock.id !== 'number') || typeof lock.path !== 'string') return []
    const lockedAt = typeof lock.locked_at === 'string' ? Date.parse(lock.locked_at) : NaN
    return [
      {
        id: String(lock.id),
        path: lock.path,
        owner: typeof lock.owner?.name === 'string' ? lock.owner.name : '',
        lockedAt: Number.isNaN(lockedAt) ? 0 : Math.floor(lockedAt / 1000)
      }
    ]
  })
}

/** Whether Git LFS is installed, the patterns it tracks here, and the files it manages. */
export async function lfs(repo: string): Promise<LfsInfo> {
  let version: string | null
  try {
    // Without git-lfs, "lfs" is an unknown command: keep autocorrect from running a lookalike instead.
    version = parseLfsVersion((await runGit(['-c', 'help.autocorrect=0', 'lfs', 'version'], { cwd: repo })).stdout)
  } catch (error) {
    if (error instanceof GitError) return NO_LFS
    throw error
  }
  const [attributes, { stdout }] = await Promise.all([
    readState(path.join(repo, '.gitattributes')),
    runGit(['lfs', 'ls-files'], { cwd: repo })
  ])
  return { installed: true, version, patterns: parseLfsPatterns(attributes ?? ''), files: parseLfsFiles(stdout) }
}

/**
 * Run a Git LFS command that talks to the server, with the repository's credentials. Git LFS's hints
 * (about file:// remotes and the like) are left out of the error, which keeps the reason readable.
 */
async function runLfs(repo: string, args: string[]): Promise<string> {
  try {
    return (await runGit([...(await repoCredentialArgs(repo)), 'lfs', ...args], { cwd: repo })).stdout
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    const reason = error.stderr
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('hint:'))
      .join('\n')
    throw new GitError(error.args, error.exitCode, error.stderr, reason || error.message)
  }
}

/** Set up Git LFS's filters and hooks in this repository. */
export async function lfsInstall(repo: string): Promise<void> {
  await runGit(['lfs', 'install', '--local'], { cwd: repo })
}

function assertLfsPattern(pattern: string): void {
  if (!pattern.trim() || /[\r\n\0]/.test(pattern) || pattern.startsWith('-')) {
    throw new Error(`"${pattern}" isn’t a pattern Git LFS can track`)
  }
}

/** Send files matching a pattern (`*.psd`) to Git LFS, through the root .gitattributes. */
export async function lfsTrack(repo: string, pattern: string): Promise<void> {
  assertLfsPattern(pattern)
  await runGit(['lfs', 'track', '--', pattern], { cwd: repo })
}

/** Stop sending files matching a pattern to Git LFS. Files already stored there stay there. */
export async function lfsUntrack(repo: string, pattern: string): Promise<void> {
  assertLfsPattern(pattern)
  await runGit(['lfs', 'untrack', '--', pattern], { cwd: repo })
}

/** Download the Git LFS files of the current checkout and put them in place of their pointers. */
export async function lfsPull(repo: string): Promise<void> {
  await runLfs(repo, ['pull'])
}

/** Upload the current branch's Git LFS files to its upstream remote, or origin. */
export async function lfsPush(repo: string): Promise<void> {
  const { branch } = await status(repo)
  if (branch.head === null) throw new Error('Check out a branch to push its Git LFS files')
  const [configured, names] = await Promise.all([configValue(repo, `branch.${branch.head}.remote`), remotes(repo)])
  const listed = names.map((entry) => entry.name)
  const remote = configured && listed.includes(configured) ? configured : listed.includes('origin') ? 'origin' : null
  if (!remote) throw new Error('This repository has no remote to push to. Add one on the Remotes tab.')
  assertRemoteName(remote)
  // Without --all, Git LFS skips commits the remote-tracking branch already has, which is every
  // commit once the branch is pushed: exactly when files missing from the server need uploading.
  // The server is asked first, so files it has aren't sent again.
  await runLfs(repo, ['push', '--all', '--', remote, branch.head])
}

/** The files locked on the Git LFS server, by anyone. */
export async function lfsLocks(repo: string): Promise<LfsLock[]> {
  return parseLfsLocks(await runLfs(repo, ['locks', '--json']))
}

/** Lock a file on the Git LFS server, so others can't push changes to it. */
export async function lfsLock(repo: string, file: string): Promise<void> {
  insideRepo(repo, file)
  await runLfs(repo, ['lock', '--', file])
}

/** Release a lock. `force` also releases someone else's, where the server allows it. */
export async function lfsUnlock(repo: string, file: string, force: boolean): Promise<void> {
  insideRepo(repo, file)
  await runLfs(repo, ['unlock', ...(force ? ['--force'] : []), '--', file])
}
