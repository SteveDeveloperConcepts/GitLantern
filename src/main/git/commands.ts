import fs from 'node:fs/promises'
import path from 'node:path'
import { credentialOrigin, parseRemoteUrl, repoNameFromUrl } from '../../shared/remoteUrl'
import type { Branch, CloneProgress, Commit, CommitDetail, ConnectionTest, DiffTarget, RepoStatus } from '../../shared/types'
import {
  BRANCH_FORMAT,
  DETAIL_FORMAT,
  LOG_FORMAT,
  parseBranches,
  parseCommitDetail,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseRemotes,
  parseStatus,
  type Remote
} from './parsers'
import { GitError, runGit } from './runGit'

/** Hosts (with port) that have a connected account; set by the main process at startup. */
let accountHosts: () => ReadonlySet<string> = () => new Set()

export function setAccountHosts(provider: () => ReadonlySet<string>): void {
  accountHosts = provider
}

/**
 * For servers with a connected account, clear git's credential helpers so the request falls
 * through to askpass, which answers with the account's token instead of a stale saved password.
 */
export function credentialArgs(urls: string[]): string[] {
  const hosts = accountHosts()
  const origins = new Set<string>()
  for (const url of urls) {
    const origin = credentialOrigin(url)
    const host = parseRemoteUrl(url)?.host
    if (origin && host && hosts.has(host)) origins.add(origin)
  }
  return [...origins].flatMap((origin) => ['-c', `credential.${origin}.helper=`])
}

/** Validate an address before it reaches git, so it can't be read as an option. */
export function assertRemoteUrl(url: string): void {
  if (!parseRemoteUrl(url)) throw new Error(`Not a Git address: ${url}`)
}

const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
function assertRemoteName(name: string): void {
  if (!REMOTE_NAME.test(name) || name.includes('..') || name.endsWith('/') || name.endsWith('.lock')) {
    throw new Error(`"${name}" is not a valid remote name`)
  }
}

/** Diffs bigger than this are cut off; the UI shows a note. */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024
const HASH = /^[0-9a-f]{4,64}$/i

function assertHash(hash: string): void {
  if (!HASH.test(hash)) throw new Error(`Invalid commit hash: ${hash}`)
}

/** Paths go to git on stdin (NUL-separated), which avoids Windows' command-line length limit. */
function pathspecStdin(paths: string[]): { args: string[]; stdin: string } {
  return { args: ['--pathspec-from-file=-', '--pathspec-file-nul'], stdin: paths.join('\0') }
}

export async function getRepoRoot(dir: string): Promise<string> {
  try {
    const { stdout } = await runGit(['rev-parse', '--show-toplevel'], { cwd: dir })
    return path.resolve(stdout.trim())
  } catch (error) {
    if (error instanceof GitError) throw new Error(`Not a Git repository: ${dir}`)
    throw error
  }
}

export async function status(repo: string): Promise<RepoStatus> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], {
    cwd: repo,
    // Background status must not take index.lock or rewrite the index (that would retrigger the watcher).
    env: { GIT_OPTIONAL_LOCKS: '0' }
  })
  return parseStatus(stdout)
}

export async function log(repo: string, maxCount = 2000): Promise<Commit[]> {
  try {
    const { stdout } = await runGit(
      [
        'log',
        '--date-order',
        '--decorate=full',
        `--max-count=${maxCount}`,
        '-z',
        `--format=${LOG_FORMAT}`,
        // --exclude only applies to the --all that follows it.
        '--exclude=refs/stash',
        '--all'
      ],
      { cwd: repo }
    )
    return parseLog(stdout)
  } catch (error) {
    // A repository with no commits yet.
    if (error instanceof GitError && /does not have any commits/.test(error.stderr)) return []
    throw error
  }
}

export async function branches(repo: string): Promise<Branch[]> {
  const { stdout } = await runGit(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'], {
    cwd: repo
  })
  return parseBranches(stdout)
}

async function parentsOf(repo: string, hash: string): Promise<string[]> {
  const { stdout } = await runGit(['rev-list', '--parents', '-n', '1', hash], { cwd: repo })
  return stdout.trim().split(' ').slice(1)
}

export async function show(repo: string, hash: string): Promise<CommitDetail> {
  assertHash(hash)
  const { stdout } = await runGit(['show', '-s', '--decorate=full', `--format=${DETAIL_FORMAT}`, hash], { cwd: repo })
  const parents = await parentsOf(repo, hash)
  // Merges are listed against their first parent.
  const range = parents[0] ? [parents[0], hash] : ['--root', hash]
  const diffTree = ['diff-tree', '--no-commit-id', '-r', '-z', '-M']
  const [nameStatus, numstat] = await Promise.all([
    runGit([...diffTree, '--name-status', ...range], { cwd: repo }),
    runGit([...diffTree, '--numstat', ...range], { cwd: repo })
  ])
  const counts = parseNumstat(numstat.stdout)
  const files = parseNameStatus(nameStatus.stdout).map((file) => ({
    ...file,
    additions: counts.get(file.path)?.additions ?? null,
    deletions: counts.get(file.path)?.deletions ?? null
  }))
  return parseCommitDetail(stdout, files)
}

function truncate(text: string): string {
  return text.length > MAX_DIFF_BYTES ? `${text.slice(0, MAX_DIFF_BYTES)}\n\n… diff truncated …` : text
}

/** Untracked files have no diff in git's eyes, so build an "all lines added" one. */
async function untrackedDiff(repo: string, relPath: string): Promise<string> {
  const absolute = path.resolve(repo, relPath)
  const relative = path.relative(repo, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path is outside the repository')

  const handle = await fs.open(absolute, 'r')
  try {
    const { size } = await handle.stat()
    const buffer = Buffer.alloc(Math.min(size, MAX_DIFF_BYTES))
    await handle.read(buffer, 0, buffer.length, 0)
    if (buffer.subarray(0, 8000).includes(0)) return `Binary file ${relPath} (untracked)`
    const lines = buffer.toString('utf8').split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    return truncate(
      [
        `diff --git a/${relPath} b/${relPath}`,
        'new file (untracked)',
        '--- /dev/null',
        `+++ b/${relPath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`)
      ].join('\n')
    )
  } finally {
    await handle.close()
  }
}

export async function diff(repo: string, target: DiffTarget): Promise<string> {
  const common = ['--no-ext-diff', '--no-color']
  const options = { cwd: repo, maxOutputBytes: 32 * MAX_DIFF_BYTES }
  switch (target.kind) {
    case 'worktree': {
      if (target.untracked) return untrackedDiff(repo, target.path)
      const { stdout } = await runGit(['diff', ...common, '--', target.path], options)
      return truncate(stdout)
    }
    case 'index': {
      const { stdout } = await runGit(['diff', '--cached', ...common, '--', target.path], options)
      return truncate(stdout)
    }
    case 'commit': {
      assertHash(target.hash)
      const parents = await parentsOf(repo, target.hash)
      const args = parents[0]
        ? ['diff', ...common, '-M', parents[0], target.hash, '--', target.path]
        : ['show', ...common, '--format=', target.hash, '--', target.path]
      const { stdout } = await runGit(args, options)
      return truncate(stdout)
    }
  }
}

export async function stage(repo: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { args, stdin } = pathspecStdin(paths)
  // -A also records deletions.
  await runGit(['add', '-A', ...args], { cwd: repo, stdin })
}

export async function unstage(repo: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const { branch } = await status(repo)
  if (branch.oid === null) {
    // No HEAD to restore from yet: drop the paths from the index instead.
    await runGit(['rm', '--cached', '-r', '-q', '--', ...paths], { cwd: repo })
    return
  }
  const { args, stdin } = pathspecStdin(paths)
  await runGit(['restore', '--staged', ...args], { cwd: repo, stdin })
}

export async function commit(repo: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Commit message is empty')
  await runGit(['commit', '--file=-'], { cwd: repo, stdin: message })
}

export async function checkout(repo: string, branch: Pick<Branch, 'name' | 'kind'>): Promise<void> {
  if (branch.kind === 'local') {
    await runGit(['switch', branch.name], { cwd: repo })
    return
  }
  // origin/feature → feature, reusing an existing local branch with that name.
  const localName = branch.name.slice(branch.name.indexOf('/') + 1)
  const local = (await branches(repo)).some((b) => b.kind === 'local' && b.name === localName)
  await runGit(local ? ['switch', localName] : ['switch', '--track', branch.name], { cwd: repo })
}

export async function createBranch(repo: string, name: string, startPoint?: string): Promise<void> {
  try {
    await runGit(['check-ref-format', '--branch', name], { cwd: repo })
  } catch {
    throw new Error(`"${name}" is not a valid branch name`)
  }
  await runGit(['switch', '-c', name, ...(startPoint ? [startPoint] : [])], { cwd: repo })
}

/** Credential overrides for every remote of the repository. */
async function repoCredentialArgs(repo: string): Promise<string[]> {
  const list = await remotes(repo)
  return credentialArgs(list.flatMap((r) => [r.fetchUrl, r.pushUrl]))
}

export async function fetch(repo: string): Promise<void> {
  await runGit([...(await repoCredentialArgs(repo)), 'fetch', '--all', '--prune'], { cwd: repo })
}

export async function pull(repo: string): Promise<void> {
  // Fast-forward only, so a pull never creates a merge commit behind the user's back.
  await runGit([...(await repoCredentialArgs(repo)), 'pull', '--ff-only'], { cwd: repo })
}

export async function push(repo: string): Promise<void> {
  const { branch } = await status(repo)
  if (branch.head === null) throw new Error('Cannot push a detached HEAD')
  const auth = await repoCredentialArgs(repo)
  if (branch.upstream) {
    await runGit([...auth, 'push'], { cwd: repo })
    return
  }
  const names = (await remotes(repo)).map((r) => r.name)
  const remote = names.includes('origin') ? 'origin' : names[0]
  if (!remote) throw new Error('This repository has no remote to push to. Add one on the Remotes tab.')
  await runGit([...auth, 'push', '--set-upstream', remote, 'HEAD'], { cwd: repo })
}

/** URL of `origin`, or null when there isn't one. */
export async function originUrl(repo: string): Promise<string | null> {
  const { stdout } = await runGit(['config', '--get', 'remote.origin.url'], { cwd: repo, allowedExitCodes: [0, 1] })
  return stdout.trim() || null
}

export async function remotes(repo: string): Promise<Remote[]> {
  const { stdout } = await runGit(['remote', '-v'], { cwd: repo })
  return parseRemotes(stdout)
}

export async function addRemote(repo: string, name: string, url: string): Promise<void> {
  assertRemoteName(name)
  assertRemoteUrl(url)
  await runGit(['remote', 'add', name, url], { cwd: repo })
}

export async function setRemoteUrl(repo: string, name: string, url: string): Promise<void> {
  assertRemoteName(name)
  assertRemoteUrl(url)
  await runGit(['remote', 'set-url', name, url], { cwd: repo })
}

export async function removeRemote(repo: string, name: string): Promise<void> {
  assertRemoteName(name)
  await runGit(['remote', 'remove', name], { cwd: repo })
}

/** Can we reach this address with the current credentials? Lists its branches to find out. */
export async function testRemote(url: string, cwd: string): Promise<ConnectionTest> {
  assertRemoteUrl(url)
  try {
    const { stdout } = await runGit([...credentialArgs([url]), 'ls-remote', '--heads', url], {
      cwd,
      signal: AbortSignal.timeout(60_000)
    })
    const count = stdout.split('\n').filter(Boolean).length
    return { ok: true, message: count === 0 ? 'Reachable · no branches yet' : `Reachable · ${count} branch${count === 1 ? '' : 'es'}` }
  } catch (error) {
    const message = error instanceof GitError ? error.message : error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
}

const PROGRESS = /([A-Za-z][A-Za-z ]+):\s+(\d+)%/g

/** Pull the latest "Receiving objects: 42%" style update out of a chunk of git's stderr. */
export function parseCloneProgress(chunk: string): CloneProgress | null {
  let last: CloneProgress | null = null
  for (const match of chunk.matchAll(PROGRESS)) {
    last = { phase: (match[1] ?? '').trim(), percent: Number(match[2]) }
  }
  return last
}

/** Clone into a new folder named after the repository inside `parentFolder`; returns its path. */
export async function clone(
  url: string,
  parentFolder: string,
  onProgress: (progress: CloneProgress) => void = () => {}
): Promise<string> {
  assertRemoteUrl(url)
  if (!path.isAbsolute(parentFolder)) throw new Error('Choose a folder to clone into')
  await fs.mkdir(parentFolder, { recursive: true })
  const target = path.join(parentFolder, repoNameFromUrl(url))
  const existing = await fs.readdir(target).catch(() => null)
  if (existing && existing.length > 0) throw new Error(`${target} already exists and isn't empty`)

  onProgress({ phase: 'Connecting', percent: null })
  await runGit([...credentialArgs([url]), 'clone', '--progress', '--', url, target], {
    cwd: parentFolder,
    onStderr: (chunk) => {
      const progress = parseCloneProgress(chunk)
      if (progress) onProgress(progress)
    }
  })
  return target
}
