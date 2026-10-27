import fs from 'node:fs/promises'
import path from 'node:path'
import type { OperationResult, RebaseCommit, RebaseStep, ResetMode } from '../../shared/types'
import { assertHash, assertRevision, NO_EDITOR, operation, parentsOf, status, untilConflict } from './commands'
import { GitError, runGit } from './runGit'

/** `git log --format` for {@link rebaseCommits}: fields joined by 0x1f, the whole message last (use with -z). */
const REBASE_FORMAT = ['%H', '%P', '%an', '%at', '%s', '%B'].join('%x1f')
const RESET_MODES: readonly ResetMode[] = ['soft', 'mixed', 'hard']

const short = (hash: string): string => hash.slice(0, 7)

/** A path as one single-quoted sh word. Git for Windows' sh reads C:/ paths, so backslashes become slashes there. */
function shellPath(file: string): string {
  const native = process.platform === 'win32' ? file.replace(/\\/g, '/') : file
  return `'${native.replace(/'/g, `'\\''`)}'`
}

/** The full hash of a commit; throws when there's no such commit. */
async function resolveCommit(repo: string, revision: string): Promise<string> {
  const { stdout, exitCode } = await runGit(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], {
    cwd: repo,
    allowedExitCodes: [0, 1]
  })
  if (exitCode !== 0) throw new Error(`Can’t find the commit ${revision}`)
  return stdout.trim()
}

async function isAncestor(repo: string, ancestor: string, descendant: string): Promise<boolean> {
  const { exitCode } = await runGit(['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repo, allowedExitCodes: [0, 1] })
  return exitCode === 0
}

async function assertNoOperation(repo: string): Promise<void> {
  const busy = await operation(repo)
  if (busy) throw new Error(`Finish the ${busy.kind} first`)
}

/** Add the staged changes to the last commit, keeping its message (null) or replacing it. */
export async function amend(repo: string, message: string | null): Promise<void> {
  const { branch, entries, operation: busy } = await status(repo)
  if (branch.oid === null) throw new Error('There’s no commit to amend yet.')
  if (busy) throw new Error(`Finish the ${busy.kind} first`)
  if (message === null) {
    if (!entries.some((entry) => entry.index !== null)) throw new Error('Nothing is staged to add to the last commit.')
    await runGit(['commit', '--amend', '--no-edit'], { cwd: repo, env: NO_EDITOR })
    return
  }
  if (!message.trim()) throw new Error('Commit message is empty')
  await runGit(['commit', '--amend', '--file=-'], { cwd: repo, stdin: message, env: NO_EDITOR })
}

/** The last commit's whole message, without its trailing newlines. */
export async function headMessage(repo: string): Promise<string> {
  try {
    const { stdout } = await runGit(['log', '-1', '--format=%B', 'HEAD', '--'], { cwd: repo })
    return stdout.replace(/[\r\n]+$/, '')
  } catch (error) {
    if (error instanceof GitError && /does not have any commits|bad revision|unknown revision/.test(error.stderr)) {
      throw new Error('There’s no commit to amend yet.')
    }
    throw error
  }
}

/** Replace a commit's message: HEAD is amended, an older commit on the branch is reworded by an interactive rebase. */
export async function reword(repo: string, hash: string, message: string): Promise<OperationResult> {
  assertHash(hash)
  if (!message.trim()) throw new Error('Commit message is empty')
  const [target, head] = await Promise.all([resolveCommit(repo, hash), resolveCommit(repo, 'HEAD')])
  if (target === head) {
    await assertNoOperation(repo)
    // --only commits HEAD's own tree: whatever is staged stays out of the commit, and still staged.
    await runGit(['commit', '--amend', '--only', '--allow-empty', '--file=-'], { cwd: repo, stdin: message, env: NO_EDITOR })
    return { conflicted: false }
  }
  if (!(await isAncestor(repo, target, head))) {
    throw new Error(`${short(target)} isn’t on the checked-out branch, so it can’t be reworded here.`)
  }
  // Replay everything after the commit's first parent; a root commit is reworded from the very start.
  const [base = null] = await parentsOf(repo, target)
  const steps = (await rebaseCommits(repo, base)).map(({ hash: each }): RebaseStep =>
    each === target ? { hash: each, action: 'reword', message } : { hash: each, action: 'pick' }
  )
  return interactiveRebase(repo, base, steps)
}

/** Make a new commit that undoes one; a merge commit is undone against its first parent. */
export async function revert(repo: string, hash: string): Promise<OperationResult> {
  assertHash(hash)
  await assertNoOperation(repo)
  const mainline = (await parentsOf(repo, hash)).length > 1 ? ['-m', '1'] : []
  try {
    return await untilConflict(repo, () => runGit(['revert', '--no-edit', ...mainline, hash], { cwd: repo, env: NO_EDITOR }))
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    if (/would be overwritten/.test(error.stderr)) {
      throw new Error('Revert refused: it would overwrite your uncommitted changes. Commit or stash them first, then try again.')
    }
    // A revert with nothing left to undo fails quietly ("nothing to commit" goes to stdout) and leaves no state behind.
    if ((await operation(repo)) || error.stderr.trim()) throw error
    throw new Error(`Nothing to revert: the branch no longer has the changes from ${short(hash)}.`)
  }
}

/** Move the current branch to a commit: soft keeps the changes staged, mixed keeps them unstaged, hard throws them away. */
export async function reset(repo: string, hash: string, mode: ResetMode): Promise<void> {
  assertHash(hash)
  if (!RESET_MODES.includes(mode)) throw new Error(`Not a reset mode: ${mode}`)
  await assertNoOperation(repo)
  const target = await resolveCommit(repo, hash)
  await runGit(['reset', '-q', `--${mode}`, target, '--'], { cwd: repo })
}

/** The commits after `base` on the checked-out branch, oldest first; `base` null for every commit HEAD reaches. */
export async function rebaseCommits(repo: string, base: string | null): Promise<RebaseCommit[]> {
  if (base !== null) assertRevision(base)
  const range = base === null ? 'HEAD' : `${base}..HEAD`
  const { stdout } = await runGit(['log', '--topo-order', '--reverse', '-z', `--format=${REBASE_FORMAT}`, range, '--'], { cwd: repo })
  return stdout
    .split('\0')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash = '', parents = '', authorName = '', authorDate = '0', subject = '', ...message] = record.split('\x1f')
      return {
        hash,
        subject,
        message: message.join('\x1f').replace(/\n+$/, ''),
        authorName,
        authorDate: Number(authorDate),
        isMerge: parents.split(' ').filter(Boolean).length > 1
      }
    })
}

/**
 * Turn the steps into `git rebase -i` todo lines, after checking they name each of `commits` exactly
 * once. Messages are set by an exec line that amends from a file in `dir`, once their commit is made:
 * right after a reword's pick (so a squash into it combines with the new message), and at the end of a
 * squash's group (so it names the whole combined commit).
 */
function rebaseTodo(commits: RebaseCommit[], steps: RebaseStep[], dir: string): { todo: string[]; messages: Map<string, string> } {
  const listed = new Set<string>()
  const ordered = steps.map((step) => {
    const matches = commits.filter((commit) => commit.hash.startsWith(step.hash.toLowerCase()))
    const [commit] = matches
    if (!commit) {
      throw new Error(`${step.hash} isn’t one of the commits being rewritten. The branch may have changed since they were listed.`)
    }
    if (matches.length > 1) throw new Error(`${step.hash} is short for more than one of the commits being rewritten.`)
    if (listed.has(commit.hash)) throw new Error(`${short(commit.hash)} is listed more than once.`)
    listed.add(commit.hash)
    return { ...step, hash: commit.hash }
  })
  const missing = commits.find((commit) => !listed.has(commit.hash))
  if (missing) throw new Error(`${short(missing.hash)} (${missing.subject}) has no step. Give it one: drop removes it.`)
  const [first] = ordered.filter((step) => step.action !== 'drop')
  if (!first) throw new Error('At least one commit has to stay. To remove them all, reset the branch instead.')
  if (first.action === 'squash' || first.action === 'fixup') {
    throw new Error(`${short(first.hash)} can’t be squashed or fixed up: there’s no commit before it to fold it into.`)
  }

  const todo: string[] = []
  const messages = new Map<string, string>()
  const amendWith = (message: string): string => {
    const file = path.join(dir, `message-${messages.size + 1}`)
    messages.set(file, message)
    return `exec git commit --amend --allow-empty --only -q --file=${shellPath(file)}`
  }
  let squashMessage: string | undefined
  const endGroup = (): void => {
    if (squashMessage !== undefined) todo.push(amendWith(squashMessage))
    squashMessage = undefined
  }
  for (const step of ordered) {
    const message = step.message?.trim() ? step.message : undefined
    if (step.action === 'drop') {
      todo.push(`drop ${step.hash}`)
    } else if (step.action === 'squash' || step.action === 'fixup') {
      todo.push(`${step.action} ${step.hash}`)
      if (step.action === 'squash' && message) squashMessage = message
    } else {
      endGroup()
      todo.push(`${step.action === 'reword' ? 'pick' : step.action} ${step.hash}`)
      if (step.action === 'reword') {
        if (!message) throw new Error(`Give ${short(step.hash)} a new message to reword it.`)
        todo.push(amendWith(message))
      }
    }
  }
  endGroup()
  return { todo, messages }
}

/** Rewrite the commits after `base` (all of them when null) as `steps` says, in the order given. */
export async function interactiveRebase(repo: string, base: string | null, steps: RebaseStep[]): Promise<OperationResult> {
  if (base !== null) assertRevision(base)
  for (const step of steps) assertHash(step.hash)
  const { branch, entries, operation: busy } = await status(repo)
  if (busy) throw new Error(`Finish the ${busy.kind} first`)
  if (branch.head === null) throw new Error('Check out a branch first: only a branch’s commits can be rewritten.')
  if (entries.some((entry) => !entry.untracked)) {
    throw new Error('Rewriting commits needs a clean working copy. Commit or stash your changes first.')
  }
  const baseHash = base === null ? null : await resolveCommit(repo, base)
  if (baseHash !== null && !(await isAncestor(repo, baseHash, 'HEAD'))) {
    throw new Error(`${short(baseHash)} isn’t on the checked-out branch.`)
  }
  const commits = await rebaseCommits(repo, baseHash)
  const merge = commits.find((commit) => commit.isMerge)
  if (merge) {
    throw new Error(
      `${short(merge.hash)} (${merge.subject}) is a merge commit. GitLantern can’t keep merges while rebasing, so it can ` +
        'only rewrite commits made after the last merge.'
    )
  }

  // In the git dir, not a temp folder: exec lines still to run after a stop (conflicts, edit) read their messages here.
  const { stdout } = await runGit(['rev-parse', '--git-path', 'gitlantern-rebase'], { cwd: repo })
  const dir = path.resolve(repo, stdout.trim())
  const { todo, messages } = rebaseTodo(commits, steps, dir)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  const todoFile = path.join(dir, 'todo')
  await fs.writeFile(todoFile, `${todo.join('\n')}\n`)
  for (const [file, message] of messages) await fs.writeFile(file, message)

  // git runs the sequence editor as `sh -c '<editor> "$@"'` with the todo's path: copy ours over it.
  // GIT_EDITOR=true takes git's combined message for a squash without one.
  const env = { ...NO_EDITOR, GIT_SEQUENCE_EDITOR: `cp ${shellPath(todoFile)}` }
  const args = ['rebase', '-i', '--no-autosquash', ...(baseHash === null ? ['--root'] : [baseHash])]
  try {
    return await untilConflict(repo, () => runGit(args, { cwd: repo, env }))
  } finally {
    if ((await operation(repo)) === null) await fs.rm(dir, { recursive: true, force: true })
  }
}
