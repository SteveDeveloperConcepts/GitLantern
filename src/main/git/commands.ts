import fs from 'node:fs/promises'
import path from 'node:path'
import { countConflicts, resolveConflict as resolveConflictText } from '../../shared/conflicts'
import { parsePatch, patchPaths } from '../../shared/patch'
import { credentialOrigin, parseRemoteUrl, repoNameFromUrl } from '../../shared/remoteUrl'
import type {
  Branch,
  BranchComparison,
  ChangedFile,
  CloneProgress,
  Commit,
  CommitDetail,
  ConflictPick,
  ConnectionTest,
  DiffTarget,
  LogFilter,
  OperationResult,
  PatchAction,
  PullResult,
  PushResult,
  RepoOperation,
  RepoStatus,
  Stash
} from '../../shared/types'
import {
  BRANCH_FORMAT,
  DETAIL_FORMAT,
  LOG_FORMAT,
  STASH_FORMAT,
  parseBranches,
  parseCommitDetail,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseRemotes,
  parseStashes,
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

/** A branch name or commit hash from the UI. Rejects anything git could read as an option or a range. */
function assertRevision(ref: string): void {
  if (!ref || ref.startsWith('-') || ref.includes('..') || /[\s~^:?*[\\\x00-\x1f\x7f]/.test(ref)) {
    throw new Error(`Not a branch or commit: ${ref}`)
  }
}

/** Accept git's prepared commit messages instead of opening an editor, which would wait forever. */
const NO_EDITOR = { GIT_EDITOR: 'true' }

/** Paths go to git on stdin (NUL-separated), which avoids Windows' command-line length limit. */
function pathspecStdin(paths: string[]): { args: string[]; stdin: string } {
  return { args: ['--pathspec-from-file=-', '--pathspec-file-nul'], stdin: paths.join('\0') }
}

/** Paths are file names, not patterns: `*.txt` means the file called that, nothing more. */
const LITERAL_PATHS = { GIT_LITERAL_PATHSPECS: '1' }

/** The absolute path of a file inside the repository; throws for anything that would leave it. */
function insideRepo(repo: string, relPath: string): string {
  const absolute = path.resolve(repo, relPath)
  const relative = path.relative(repo, absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path is outside the repository')
  return absolute
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
  const [{ stdout }, current] = await Promise.all([
    runGit(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], {
      cwd: repo,
      // Background status must not take index.lock or rewrite the index (that would retrigger the watcher).
      env: { GIT_OPTIONAL_LOCKS: '0' }
    }),
    operation(repo)
  ])
  const result = parseStatus(stdout)
  return current ? { ...result, operation: current } : result
}

const OPERATION_FILES = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'] as const

async function readState(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, 'utf8')).trim()
  } catch {
    return null
  }
}

/** The merge, rebase, cherry-pick or revert waiting to be finished, read from git's state files. */
export async function operation(repo: string): Promise<RepoOperation | null> {
  const { stdout } = await runGit(['rev-parse', ...OPERATION_FILES.flatMap((name) => ['--git-path', name])], { cwd: repo })
  const lines = stdout.split('\n')
  const gitPath = (name: (typeof OPERATION_FILES)[number]): string =>
    path.resolve(repo, lines[OPERATION_FILES.indexOf(name)]?.trim() ?? '')

  // The merge backend keeps its state in rebase-merge/, the older apply backend in rebase-apply/.
  const backends = [
    ['rebase-merge', 'msgnum', 'end'],
    ['rebase-apply', 'next', 'last']
  ] as const
  for (const [dir, stepFile, totalFile] of backends) {
    const state = (file: string): Promise<string | null> => readState(path.join(gitPath(dir), file))
    const headName = await state('head-name')
    if (headName === null) continue
    const [onto, step, total] = await Promise.all([state('onto'), state(stepFile), state(totalFile)])
    return {
      kind: 'rebase',
      ...(headName.startsWith('refs/heads/') ? { branch: headName.slice('refs/heads/'.length) } : {}),
      ...(onto ? { onto } : {}),
      ...(step && total ? { step: Number(step), total: Number(total) } : {})
    }
  }
  const mergeHead = await readState(gitPath('MERGE_HEAD'))
  if (mergeHead !== null) {
    // One line per merged commit; an octopus merge has several.
    const incoming = mergeHead.split('\n')[0]
    return { kind: 'merge', ...(incoming ? { incoming } : {}) }
  }
  if ((await readState(gitPath('CHERRY_PICK_HEAD'))) !== null) return { kind: 'cherry-pick' }
  if ((await readState(gitPath('REVERT_HEAD'))) !== null) return { kind: 'revert' }
  return null
}

/**
 * Run a command that can stop on conflicts. Stopping there leaves the operation in progress for the
 * user to resolve, so it isn't an error; any other failure is.
 */
async function untilConflict(repo: string, command: () => Promise<unknown>): Promise<OperationResult> {
  try {
    await command()
    return { conflicted: false }
  } catch (error) {
    if (error instanceof GitError && (await operation(repo))) {
      const { stdout } = await runGit(['ls-files', '--unmerged'], { cwd: repo })
      if (stdout.trim()) return { conflicted: true }
    }
    throw error
  }
}

/** Compare the current branch with another branch or commit. */
export async function compare(repo: string, ref: string): Promise<BranchComparison> {
  assertRevision(ref)
  const { stdout } = await runGit(['rev-list', '--left-right', '--count', `HEAD...${ref}`, '--'], { cwd: repo })
  const [ahead = 0, behind = 0] = stdout.trim().split(/\s+/).map(Number)
  let published = 0
  if (ahead > 0) {
    // Exit 128: no upstream (or a detached HEAD), so nothing has been pushed.
    const upstream = await runGit(['rev-parse', '--verify', '--quiet', '@{upstream}'], { cwd: repo, allowedExitCodes: [0, 1, 128] })
    if (upstream.exitCode === 0) {
      const { stdout: unpublished } = await runGit(['rev-list', '--count', 'HEAD', `^${ref}`, `^${upstream.stdout.trim()}`, '--'], {
        cwd: repo
      })
      published = ahead - Number(unpublished.trim())
    }
  }
  return { ahead, behind, published }
}

/** Merge a branch or commit into the current branch (fast-forwarding when git can, unless told not to). */
export async function merge(repo: string, ref: string, options: { noFastForward?: boolean } = {}): Promise<OperationResult> {
  assertRevision(ref)
  const args = ['merge', '--no-edit', ...(options.noFastForward ? ['--no-ff'] : []), ref]
  return untilConflict(repo, () => runGit(args, { cwd: repo, env: NO_EDITOR }))
}

/** Replay the current branch's own commits on top of `onto`. */
export async function rebase(repo: string, onto: string): Promise<OperationResult> {
  assertRevision(onto)
  return untilConflict(repo, () => runGit(['rebase', onto], { cwd: repo, env: NO_EDITOR }))
}

/** Copy a commit onto the current branch as a new commit. A merge commit brings its changes against its first parent. */
export async function cherryPick(repo: string, hash: string): Promise<OperationResult> {
  assertHash(hash)
  const busy = await operation(repo)
  if (busy) throw new Error(`Finish the ${busy.kind} first`)
  const mainline = (await parentsOf(repo, hash)).length > 1 ? ['-m', '1'] : []
  try {
    return await untilConflict(repo, () => runGit(['cherry-pick', ...mainline, hash], { cwd: repo, env: NO_EDITOR }))
  } catch (error) {
    if (error instanceof GitError && /would be overwritten/.test(error.stderr)) {
      throw new Error('Cherry-pick refused: it would overwrite your uncommitted changes. Commit or stash them first, then try again.')
    }
    // Without conflicts, a cherry-pick only stops when the branch already has the commit's changes:
    // the copy would be empty. Nothing was changed, so call it off.
    if ((await operation(repo))?.kind !== 'cherry-pick') throw error
    await runGit(['cherry-pick', '--abort'], { cwd: repo })
    throw new Error(`Nothing to cherry-pick: the branch already has the changes from ${hash.slice(0, 7)}.`)
  }
}

async function currentOperation(repo: string): Promise<RepoOperation> {
  const current = await operation(repo)
  if (!current) throw new Error('No merge or rebase is in progress')
  return current
}

export async function continueOperation(repo: string): Promise<OperationResult> {
  const { kind } = await currentOperation(repo)
  return untilConflict(repo, () => runGit([kind, '--continue'], { cwd: repo, env: NO_EDITOR }))
}

export async function skipOperation(repo: string): Promise<OperationResult> {
  const { kind } = await currentOperation(repo)
  if (kind === 'merge') throw new Error('A merge has no commit to skip')
  return untilConflict(repo, () => runGit([kind, '--skip'], { cwd: repo, env: NO_EDITOR }))
}

export async function abortOperation(repo: string): Promise<void> {
  const { kind } = await currentOperation(repo)
  await runGit([kind, '--abort'], { cwd: repo })
}

export async function log(repo: string, maxCount = 2000, filter: LogFilter = {}): Promise<Commit[]> {
  if (filter.branch) assertRevision(filter.branch)
  // --exclude only applies to the --all that follows it.
  const revisions = filter.branch ? [filter.branch] : ['--exclude=refs/stash', '--all']
  // --parents rewrites each commit's parents to the nearest ones that also changed the path, so the
  // filtered graph still joins up.
  const paths = filter.path ? ['--parents', '--', filter.path] : []
  try {
    const { stdout } = await runGit(
      ['log', '--date-order', '--decorate=full', `--max-count=${maxCount}`, '-z', `--format=${LOG_FORMAT}`, ...revisions, ...paths],
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

/** Files changed between two commits, or in a root commit (`['--root', hash]`), with line counts. */
async function changedFiles(repo: string, range: string[]): Promise<ChangedFile[]> {
  const diffTree = ['diff-tree', '--no-commit-id', '-r', '-z', '-M']
  const [nameStatus, numstat] = await Promise.all([
    runGit([...diffTree, '--name-status', ...range], { cwd: repo }),
    runGit([...diffTree, '--numstat', ...range], { cwd: repo })
  ])
  const counts = parseNumstat(numstat.stdout)
  return parseNameStatus(nameStatus.stdout).map((file) => ({
    ...file,
    additions: counts.get(file.path)?.additions ?? null,
    deletions: counts.get(file.path)?.deletions ?? null
  }))
}

export async function show(repo: string, hash: string): Promise<CommitDetail> {
  assertHash(hash)
  const { stdout } = await runGit(['show', '-s', '--decorate=full', `--format=${DETAIL_FORMAT}`, hash], { cwd: repo })
  const parents = await parentsOf(repo, hash)
  // Merges are listed against their first parent.
  const files = await changedFiles(repo, parents[0] ? [parents[0], hash] : ['--root', hash])
  return parseCommitDetail(stdout, files)
}

function truncate(text: string): string {
  return text.length > MAX_DIFF_BYTES ? `${text.slice(0, MAX_DIFF_BYTES)}\n\n… diff truncated …` : text
}

/** Read up to MAX_DIFF_BYTES of a working-tree file inside the repository; null for a binary file. */
async function readWorktreeFile(repo: string, relPath: string): Promise<string | null> {
  const handle = await fs.open(insideRepo(repo, relPath), 'r')
  try {
    const { size } = await handle.stat()
    const buffer = Buffer.alloc(Math.min(size, MAX_DIFF_BYTES))
    await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, 8000).includes(0) ? null : buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Untracked files have no diff in git's eyes, so build an "all lines added" one. */
async function untrackedDiff(repo: string, relPath: string): Promise<string> {
  const text = await readWorktreeFile(repo, relPath)
  if (text === null) return `Binary file ${relPath} (untracked)`
  const lines = text.split(/\r?\n/)
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
}

export async function diff(repo: string, target: DiffTarget): Promise<string> {
  // Fixed a/ and b/ prefixes whatever the user's config says, so parts of the diff can be applied back.
  const common = ['--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/']
  const options = { cwd: repo, maxOutputBytes: 32 * MAX_DIFF_BYTES }
  switch (target.kind) {
    case 'worktree': {
      if (target.untracked) return untrackedDiff(repo, target.path)
      // git's combined diff of a conflicted file is hard to read; the file with its markers is clearer.
      if (target.conflicted) return (await readWorktreeFile(repo, target.path)) ?? `Binary file ${target.path}`
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
    case 'stash': {
      assertHash(target.hash)
      // A stash commit's first parent is where it was made; its third holds the untracked files.
      const args = target.untracked
        ? ['show', ...common, '--format=', `${target.hash}^3`, '--', target.path]
        : ['diff', ...common, `${target.hash}^1`, target.hash, '--', target.path]
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

/**
 * Throw away uncommitted changes to these files. Tracked files go back to their staged version (or
 * the committed one when nothing is staged); untracked files are handed to `removeFile`.
 */
export async function discard(
  repo: string,
  paths: string[],
  removeFile: (absolutePath: string) => Promise<void> = (file) => fs.rm(file)
): Promise<void> {
  const entries = new Map((await status(repo)).entries.map((entry) => [entry.path, entry]))
  const tracked: string[] = []
  const untracked: string[] = []
  for (const file of paths) {
    const entry = entries.get(file)
    if (!entry) continue
    if (entry.conflicted) throw new Error(`${file} has conflicts. Pick a side for them instead.`)
    if (entry.untracked) untracked.push(file)
    else if (entry.worktree !== null) tracked.push(file)
  }
  if (tracked.length > 0) {
    const { args, stdin } = pathspecStdin(tracked)
    await runGit(['restore', '--worktree', ...args], { cwd: repo, stdin, env: LITERAL_PATHS })
  }
  for (const file of untracked) await removeFile(insideRepo(repo, file))
}

/**
 * Apply a patch made by `selectLines` from this file's diff: `stage` adds its lines to the index,
 * `unstage` takes them out of it, `discard` takes them out of the working tree.
 */
export async function applyPatch(repo: string, file: string, patch: string, action: PatchAction): Promise<void> {
  const parsed = parsePatch(patch)
  const paths = parsed ? patchPaths(parsed) : null
  if (!paths || (paths.old ?? paths.new) !== file || (paths.new ?? paths.old) !== file) {
    throw new Error(`That patch isn’t for ${file}`)
  }
  // Text that wasn't valid UTF-8 was replaced on its way to the UI; applying it would corrupt the file.
  if (patch.includes('\uFFFD')) throw new Error(`${file} isn’t UTF-8 text, so it can only be staged or discarded as a whole.`)
  insideRepo(repo, file)
  const args = { stage: ['--cached'], unstage: ['--cached', '--reverse'], discard: ['--reverse'] }[action]
  try {
    await runGit(['apply', ...args, '--whitespace=nowarn', '-'], { cwd: repo, stdin: patch })
  } catch (error) {
    if (error instanceof GitError) {
      throw new Error(`Git couldn’t apply those lines. If the file changed since its diff was shown, try again.\n\n${error.message}`)
    }
    throw error
  }
}

/** Keep one side of a conflict in a file and save it. The file is staged once no conflicts are left. */
export async function resolveConflict(repo: string, file: string, pick: ConflictPick): Promise<{ remaining: number }> {
  const absolute = insideRepo(repo, file)
  // latin1 maps every byte to one character and back, so the file's encoding survives untouched.
  const text = await fs.readFile(absolute, 'latin1')
  if (countConflicts(text) !== pick.conflicts) throw new Error(`${file} changed on disk. Its conflicts are shown again as they are now.`)
  const result = resolveConflictText(text, pick.index, pick.choice)
  await fs.writeFile(absolute, result.text, 'latin1')
  if (result.remaining === 0) await runGit(['add', '--', file], { cwd: repo, env: LITERAL_PATHS })
  return { remaining: result.remaining }
}

/**
 * Take one side's whole version of a conflicted file and stage it. When that side deleted the file,
 * it's deleted.
 */
export async function resolveFile(repo: string, file: string, side: 'ours' | 'theirs'): Promise<void> {
  insideRepo(repo, file)
  const options = { cwd: repo, env: LITERAL_PATHS }
  try {
    await runGit(['checkout', `--${side}`, '--', file], options)
  } catch (error) {
    if (!(error instanceof GitError) || !/does not have (our|their) version/.test(error.stderr)) throw error
    await runGit(['rm', '-q', '--', file], options)
    return
  }
  await runGit(['add', '--', file], options)
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
  if (startPoint) assertRevision(startPoint)
  await runGit(['switch', '-c', name, ...(startPoint ? [startPoint] : [])], { cwd: repo })
}

export async function stashes(repo: string): Promise<Stash[]> {
  const { stdout } = await runGit(['stash', 'list', '-z', `--format=${STASH_FORMAT}`], { cwd: repo })
  return parseStashes(stdout)
}

/** Stash every uncommitted change, untracked files included, leaving a clean working copy. */
export async function stash(repo: string, message: string): Promise<void> {
  const text = message.trim()
  const { stdout } = await runGit(['stash', 'push', '--include-untracked', ...(text ? ['--message', text] : [])], { cwd: repo })
  if (/no local changes to save/i.test(stdout)) throw new Error('There are no changes to stash')
}

/** Where a stash is in the list now, found by its commit, so a list that changed since can't hit another one. */
async function stashRef(repo: string, hash: string): Promise<string> {
  assertHash(hash)
  const index = (await stashes(repo)).findIndex((entry) => entry.hash === hash)
  if (index === -1) throw new Error('That stash doesn’t exist any more')
  return `stash@{${index}}`
}

/**
 * Bring a stash's changes back into the working copy. `pop` also deletes the stash, except when
 * applying it stops on conflicts: then git keeps it.
 */
export async function applyStash(repo: string, hash: string, options: { pop: boolean }): Promise<OperationResult> {
  const ref = await stashRef(repo, hash)
  try {
    await runGit(['stash', options.pop ? 'pop' : 'apply', ref], { cwd: repo })
    return { conflicted: false }
  } catch (error) {
    // Unlike a merge, a stash leaves no state behind when it conflicts: only the conflicted files.
    if (!(error instanceof GitError)) throw error
    const { stdout } = await runGit(['ls-files', '--unmerged'], { cwd: repo })
    if (stdout.trim()) return { conflicted: true }
    throw error
  }
}

export async function dropStash(repo: string, hash: string): Promise<void> {
  await runGit(['stash', 'drop', '-q', await stashRef(repo, hash)], { cwd: repo })
}

/** A stash as a commit: its changes to tracked files, then the untracked files it saved (marked as such). */
export async function showStash(repo: string, hash: string): Promise<CommitDetail> {
  assertHash(hash)
  const { stdout } = await runGit(['show', '-s', `--format=${DETAIL_FORMAT}`, hash], { cwd: repo })
  // Parents: the commit it was made on, the staged changes, and (if any) the untracked files.
  const [base, , untrackedCommit] = await parentsOf(repo, hash)
  if (!base) throw new Error('Not a stash')
  const tracked = await changedFiles(repo, [base, hash])
  const untracked = untrackedCommit ? await changedFiles(repo, ['--root', untrackedCommit]) : []
  return parseCommitDetail(stdout, [...tracked, ...untracked.map((file) => ({ ...file, untracked: true }))])
}

/** Credential overrides for every remote of the repository. */
async function repoCredentialArgs(repo: string): Promise<string[]> {
  const list = await remotes(repo)
  return credentialArgs(list.flatMap((r) => [r.fetchUrl, r.pushUrl]))
}

export async function fetch(repo: string): Promise<void> {
  await runGit([...(await repoCredentialArgs(repo)), 'fetch', '--all', '--prune'], { cwd: repo })
}

const commitCount = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`

/**
 * How many commits on the upstream this branch has never pointed at, going by its reflog. None means
 * the upstream only has commits this branch once had, so it was rewritten (rebased, amended) since
 * they were pushed. Without a reflog every upstream commit counts as unseen, which leads to the safe
 * advice: pull.
 */
async function unseenUpstreamCommits(repo: string, branchName: string): Promise<number> {
  const { stdout: history } = await runGit(['reflog', 'show', '--format=%H', `refs/heads/${branchName}`], {
    cwd: repo,
    allowedExitCodes: [0, 128]
  })
  const seen = history.split('\n').filter(Boolean).map((hash) => `^${hash}`)
  const { stdout } = await runGit(['rev-list', '--count', '--stdin', '@{upstream}'], { cwd: repo, stdin: seen.join('\n') })
  return Number(stdout.trim())
}

function rewrittenMessage(upstream: string): string {
  return (
    `${upstream} still has the old copies of commits you've since rewritten, for example by rebasing. ` +
    'Click Push to replace them: Git Steve offers a force push.'
  )
}

/**
 * Fetch, then fast-forward if that's all it takes. When both sides have new commits nothing changes:
 * the user picks merge or rebase, so a pull never makes a merge commit behind their back.
 */
export async function pull(repo: string): Promise<PullResult> {
  const { branch } = await status(repo)
  if (branch.head === null) throw new Error('Check out a branch to pull into it')
  if (!branch.upstream) throw new Error(`${branch.head} isn’t linked to a remote branch yet. Push it first.`)
  const upstream = branch.upstream

  await runGit([...(await repoCredentialArgs(repo)), 'fetch'], { cwd: repo })
  const { ahead, behind } = (await status(repo)).branch
  if (behind === 0) return { outcome: 'up-to-date', upstream }
  if (ahead > 0) {
    if ((await unseenUpstreamCommits(repo, branch.head)) === 0) throw new Error(`Nothing to pull: ${rewrittenMessage(upstream)}`)
    return { outcome: 'diverged', upstream }
  }
  await runGit(['merge', '--ff-only', '@{upstream}'], { cwd: repo })
  return { outcome: 'fast-forward', upstream }
}

/**
 * Work out why the remote refused a push, after fetching what it has. If it only has old copies of
 * commits the branch has since rewritten, a force push is what's needed; otherwise someone else
 * pushed, and the advice is to pull.
 */
async function rejectedPush(repo: string, auth: string[], branchName: string, upstream: string): Promise<PushResult> {
  await runGit([...auth, 'fetch'], { cwd: repo })
  const unseen = await unseenUpstreamCommits(repo, branchName)
  if (unseen === 0) {
    const [expected, replaced] = await Promise.all([
      runGit(['rev-parse', '--verify', '@{upstream}'], { cwd: repo }),
      runGit(['rev-list', '--count', 'HEAD..@{upstream}', '--'], { cwd: repo })
    ])
    return { outcome: 'needs-force', upstream, expected: expected.stdout.trim(), replaced: Number(replaced.stdout.trim()) }
  }
  const them = unseen === 1 ? 'it' : 'them'
  throw new Error(
    `Push refused: ${upstream} has ${commitCount(unseen)} that ${branchName} doesn’t, and pushing would throw ${them} ` +
      `away. Click Pull to bring ${them} in (Git Steve asks whether to merge or rebase), then push again.`
  )
}

export async function push(repo: string): Promise<PushResult> {
  const { branch } = await status(repo)
  if (branch.head === null) throw new Error('Cannot push a detached HEAD')
  const auth = await repoCredentialArgs(repo)
  if (branch.upstream) {
    try {
      await runGit([...auth, 'push'], { cwd: repo })
    } catch (error) {
      // git translates the reason after "[rejected]" but not the marker itself.
      if (!(error instanceof GitError) || !error.stderr.includes('[rejected]')) throw error
      return rejectedPush(repo, auth, branch.head, branch.upstream)
    }
    return { outcome: 'pushed' }
  }
  const names = (await remotes(repo)).map((r) => r.name)
  const remote = names.includes('origin') ? 'origin' : names[0]
  if (!remote) throw new Error('This repository has no remote to push to. Add one on the Remotes tab.')
  await runGit([...auth, 'push', '--set-upstream', remote, 'HEAD'], { cwd: repo })
  return { outcome: 'pushed' }
}

async function configValue(repo: string, key: string): Promise<string | null> {
  const { stdout } = await runGit(['config', '--get', key], { cwd: repo, allowedExitCodes: [0, 1] })
  return stdout.trim() || null
}

/**
 * Replace the current branch's upstream with the branch, but only while the upstream is still at
 * `expected` (--force-with-lease): if anyone pushed since, git refuses instead of dropping their
 * commits. The remote and branch are named explicitly, so push.default can't widen it to others.
 */
export async function forcePush(repo: string, expected: string): Promise<void> {
  assertHash(expected)
  const { branch } = await status(repo)
  if (branch.head === null || !branch.upstream) throw new Error('Only a branch with an upstream can be force pushed')
  const [remote, target] = await Promise.all([
    configValue(repo, `branch.${branch.head}.remote`),
    configValue(repo, `branch.${branch.head}.merge`)
  ])
  if (!remote || !target?.startsWith('refs/heads/')) throw new Error(`Can’t tell where ${branch.head} pushes to`)
  const auth = await repoCredentialArgs(repo)
  try {
    await runGit([...auth, 'push', `--force-with-lease=${target}:${expected}`, remote, `HEAD:${target}`], { cwd: repo })
  } catch (error) {
    if (!(error instanceof GitError) || !error.stderr.includes('stale info')) throw error
    throw new Error(
      `Force push refused: someone pushed to ${branch.upstream} since you looked, and replacing the branch would ` +
        'throw their commits away. Click Pull to bring them in first.'
    )
  }
}

/** A remote's default branch (what its HEAD points at), without the remote's name; null if unknown. */
export async function remoteDefaultBranch(repo: string, remote: string): Promise<string | null> {
  assertRemoteName(remote)
  const head = await runGit(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { cwd: repo, allowedExitCodes: [0, 1, 128] })
  const name = head.stdout.trim()
  if (head.exitCode === 0 && name.startsWith(`${remote}/`)) return name.slice(remote.length + 1)
  for (const guess of ['main', 'master']) {
    const found = await runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${guess}`], { cwd: repo, allowedExitCodes: [0, 1] })
    if (found.exitCode === 0) return guess
  }
  return null
}

/** Fetch one branch of a remote, updating its remote-tracking branch. */
export async function fetchBranch(repo: string, remote: string, branchName: string): Promise<void> {
  assertRemoteName(remote)
  assertRevision(branchName)
  const auth = await repoCredentialArgs(repo)
  await runGit([...auth, 'fetch', remote, `+refs/heads/${branchName}:refs/remotes/${remote}/${branchName}`], { cwd: repo })
}

/**
 * Fetch a pull request's commits from where the service keeps them (`refs/pull/12/head` and the
 * like) and check them out as local branch `local`: a new one, or an existing one moved forward.
 */
export async function checkoutFetched(repo: string, remote: string, ref: string, local: string): Promise<void> {
  assertRemoteName(remote)
  if (!/^refs\/(pull|merge-requests)\/\d+\/head$/.test(ref)) throw new Error(`Not a pull request: ${ref}`)
  assertRevision(local)
  const auth = await repoCredentialArgs(repo)
  await runGit([...auth, 'fetch', remote, ref], { cwd: repo })
  const fetched = (await runGit(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { cwd: repo })).stdout.trim()
  if (!(await branches(repo)).some((b) => b.kind === 'local' && b.name === local)) {
    await runGit(['switch', '-c', local, fetched], { cwd: repo })
    return
  }
  await runGit(['switch', local], { cwd: repo })
  try {
    await runGit(['merge', '--ff-only', fetched], { cwd: repo })
  } catch {
    throw new Error(`Switched to ${local}, but couldn’t bring it up to date: it has commits the pull request doesn’t.`)
  }
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
