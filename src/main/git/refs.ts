import type { DeleteBranchResult, NewTag, Tag } from '../../shared/types'
import { NO_EDITOR, assertRemoteName, assertRevision, configValue, fetchBranch, remotes, repoCredentialArgs } from './commands'
import { GitError, runGit } from './runGit'

const FIELD = '\x1f'
const RECORD = '\x1e'

/**
 * `git for-each-ref --format` for {@link parseTags}: fields joined by 0x1f, each record ended by 0x1e.
 * `*objectname` is the commit an annotated tag points at; a lightweight tag points at it directly.
 */
export const TAG_FORMAT = `${[
  '%(refname)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(contents:subject)',
  '%(creatordate:unix)',
  '%(taggername)',
  '%(authorname)'
].join('%1f')}%1e`

/** Parse `git for-each-ref --format=<TAG_FORMAT> refs/tags`. Lightweight tags take their date and name from the commit. */
export function parseTags(stdout: string): Tag[] {
  const tags: Tag[] = []
  for (const record of stdout.split(RECORD)) {
    const trimmed = record.replace(/^\n/, '')
    if (!trimmed) continue
    const [ref = '', type = '', object = '', peeled = '', subject = '', date = '0', tagger = '', author = ''] = trimmed.split(FIELD)
    if (!ref.startsWith('refs/tags/')) continue
    const annotated = type === 'tag'
    tags.push({
      name: ref.slice('refs/tags/'.length),
      hash: annotated ? peeled || object : object,
      annotated,
      message: annotated ? subject : '',
      date: Number(date) || 0,
      tagger: annotated ? tagger : author
    })
  }
  return tags
}

/** Validate a branch name by git's own rules. Shorthands like `@{-1}` are refused rather than expanded. */
async function assertBranchName(repo: string, name: string): Promise<void> {
  const valid = await runGit(['check-ref-format', '--branch', name], { cwd: repo }).then(
    ({ stdout }) => stdout.trim() === name,
    () => false
  )
  if (!valid) throw new Error(`"${name}" is not a valid branch name`)
}

/** Validate a tag name by git's ref rules, refusing anything git could read as an option. */
async function assertTagName(repo: string, name: string): Promise<void> {
  const valid =
    !name.startsWith('-') &&
    (await runGit(['check-ref-format', `refs/tags/${name}`], { cwd: repo }).then(
      () => true,
      () => false
    ))
  if (!valid) throw new Error(`"${name}" is not a valid tag name`)
}

/** Whether a ref exists, matched exactly: on Windows, show-ref would also find `Main` for `main`. */
async function exists(repo: string, ref: string): Promise<boolean> {
  const { stdout } = await runGit(['for-each-ref', '--format=%(refname)', ref], { cwd: repo })
  return stdout.split('\n').includes(ref)
}

async function assertLocalBranch(repo: string, name: string): Promise<void> {
  await assertBranchName(repo, name)
  if (!(await exists(repo, `refs/heads/${name}`))) throw new Error(`There’s no branch called ${name}`)
}

async function assertKnownRemote(repo: string, remote: string): Promise<void> {
  assertRemoteName(remote)
  if (!(await remotes(repo)).some((r) => r.name === remote)) throw new Error(`This repository has no remote called ${remote}`)
}

/**
 * Whether `git branch -d` would delete the branch: its commits are all on its upstream, or on HEAD when
 * it has no upstream (or the upstream is gone). That's git's own rule, checked without reading its
 * (translated) refusal.
 */
async function isMerged(repo: string, name: string): Promise<boolean> {
  const { stdout } = await runGit(['for-each-ref', '--format=%(upstream)', `refs/heads/${name}`], { cwd: repo })
  const upstream = stdout.trim()
  for (const reference of upstream ? [upstream, 'HEAD'] : ['HEAD']) {
    const found = await runGit(['rev-parse', '--verify', '--quiet', `${reference}^{commit}`], { cwd: repo, allowedExitCodes: [0, 1] })
    if (found.exitCode !== 0) continue
    const ancestor = await runGit(['merge-base', '--is-ancestor', `refs/heads/${name}`, found.stdout.trim()], {
      cwd: repo,
      allowedExitCodes: [0, 1]
    })
    return ancestor.exitCode === 0
  }
  // No upstream and an unborn HEAD: nothing has the branch's commits.
  return false
}

/** Delete a local branch. Unless forced, one whose commits aren't merged comes back as `not-merged`, untouched. */
export async function deleteBranch(repo: string, name: string, force: boolean): Promise<DeleteBranchResult> {
  await assertLocalBranch(repo, name)
  const head = await runGit(['symbolic-ref', '--quiet', 'HEAD'], { cwd: repo, allowedExitCodes: [0, 1] })
  if (head.stdout.trim() === `refs/heads/${name}`) throw new Error(`${name} is checked out. Switch to another branch first.`)
  if (!force && !(await isMerged(repo, name))) return 'not-merged'
  try {
    await runGit(['branch', force ? '-D' : '-d', '--', name], { cwd: repo })
  } catch (error) {
    // Only reachable when the branch moved since the check above.
    if (!force && error instanceof GitError && /not fully merged/.test(error.stderr)) return 'not-merged'
    throw error
  }
  return 'deleted'
}

/** `origin/feature` → remote `origin`, branch `feature`. Remote names can contain slashes: the longest match wins. */
async function splitRemoteBranch(repo: string, remoteBranch: string): Promise<{ remote: string; branch: string }> {
  const [remote] = (await remotes(repo))
    .map((r) => r.name)
    .filter((name) => remoteBranch.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length)
  if (!remote) throw new Error(`${remoteBranch} isn’t a branch on any of this repository’s remotes`)
  assertRemoteName(remote)
  const branch = remoteBranch.slice(remote.length + 1)
  await assertBranchName(repo, branch)
  return { remote, branch }
}

/** Delete a branch on its remote (`origin/feature`); git drops the remote-tracking branch with it. */
export async function deleteRemoteBranch(repo: string, remoteBranch: string): Promise<void> {
  const { remote, branch } = await splitRemoteBranch(repo, remoteBranch)
  const auth = await repoCredentialArgs(repo)
  await runGit([...auth, 'push', remote, '--delete', `refs/heads/${branch}`], { cwd: repo })
}

/** Rename a local branch; its upstream link and reflog go with it. */
export async function renameBranch(repo: string, name: string, newName: string): Promise<void> {
  await assertLocalBranch(repo, name)
  await assertBranchName(repo, newName)
  if (newName === name) return
  if (await exists(repo, `refs/heads/${newName}`)) throw new Error(`There’s already a branch called ${newName}`)
  // On a case-insensitive disk git takes `Feature` for the existing `feature` and refuses; -M lets it
  // through, and the exact check above has already ruled out a real branch of that name.
  const caseOnly = newName.toLowerCase() === name.toLowerCase()
  await runGit(['branch', caseOnly ? '-M' : '-m', '--', name, newName], { cwd: repo })
}

/** Link a local branch to a remote-tracking branch (`origin/main`), or unlink it with null. */
export async function setUpstream(repo: string, name: string, upstream: string | null): Promise<void> {
  await assertLocalBranch(repo, name)
  if (upstream === null) {
    // git refuses to unset an upstream that isn't there, which is already what was asked for.
    if ((await configValue(repo, `branch.${name}.merge`)) === null) return
    await runGit(['branch', '--unset-upstream', '--', name], { cwd: repo })
    return
  }
  assertRevision(upstream)
  const ref = `refs/remotes/${upstream}`
  if (upstream.endsWith('/HEAD') || !(await exists(repo, ref))) {
    throw new Error(`${upstream} isn’t a remote branch. Fetch first if it’s new.`)
  }
  await runGit(['branch', `--set-upstream-to=${ref}`, '--', name], { cwd: repo })
}

/**
 * Explain why `remote` refused a branch, after fetching what it has there. Commits the branch never
 * pointed at (by its reflog) mean someone else pushed; none means the branch's own commits were
 * rewritten since they were pushed.
 */
async function rejectedBranch(repo: string, name: string, remote: string): Promise<Error> {
  await fetchBranch(repo, remote, name)
  const { stdout: history } = await runGit(['reflog', 'show', '--format=%H', `refs/heads/${name}`], {
    cwd: repo,
    allowedExitCodes: [0, 128]
  })
  const seen = history.split('\n').filter(Boolean).map((hash) => `^${hash}`)
  const { stdout } = await runGit(['rev-list', '--count', '--stdin', `refs/remotes/${remote}/${name}`], {
    cwd: repo,
    stdin: seen.join('\n')
  })
  const unseen = Number(stdout.trim())
  const there = `${remote}/${name}`
  if (unseen === 0) {
    return new Error(
      `Push refused: ${there} still has the old copies of commits you’ve since rewritten, for example by rebasing. ` +
        `Check out ${name} and click Push to replace them: GitLantern offers a force push.`
    )
  }
  const them = unseen === 1 ? 'it' : 'them'
  return new Error(
    `Push refused: ${there} has ${unseen} commit${unseen === 1 ? '' : 's'} that ${name} doesn’t, and pushing would throw ${them} ` +
      `away. Check out ${name} and click Pull to bring ${them} in, then push again.`
  )
}

/** Push a local branch, checked out or not, to the branch of the same name on `remote`. The first push links them. */
export async function pushBranch(repo: string, name: string, remote: string): Promise<void> {
  await assertLocalBranch(repo, name)
  await assertKnownRemote(repo, remote)
  const linked = (await configValue(repo, `branch.${name}.merge`)) !== null
  const ref = `refs/heads/${name}`
  const auth = await repoCredentialArgs(repo)
  try {
    await runGit([...auth, 'push', ...(linked ? [] : ['--set-upstream']), remote, `${ref}:${ref}`], { cwd: repo })
  } catch (error) {
    // git translates the reason after "[rejected]" but not the marker itself.
    if (!(error instanceof GitError) || !error.stderr.includes('[rejected]')) throw error
    throw await rejectedBranch(repo, name, remote)
  }
}

/** The repository's tags, newest first. */
export async function tags(repo: string): Promise<Tag[]> {
  // The last --sort is the main one: newest first, then by name.
  const { stdout } = await runGit(['for-each-ref', '--sort=refname', '--sort=-creatordate', `--format=${TAG_FORMAT}`, 'refs/tags'], {
    cwd: repo
  })
  return parseTags(stdout)
}

/** Tag a commit: annotated (and signed, if asked) when there's a message, lightweight otherwise. */
export async function createTag(repo: string, tag: NewTag): Promise<void> {
  await assertTagName(repo, tag.name)
  assertRevision(tag.target)
  const message = tag.message?.trim() ? tag.message : ''
  if (tag.sign && !message) throw new Error('A signed tag needs a message.')
  if (await exists(repo, `refs/tags/${tag.name}`)) throw new Error(`A tag called ${tag.name} already exists.`)
  const commit = await runGit(['rev-parse', '--verify', '--quiet', `${tag.target}^{commit}`], { cwd: repo, allowedExitCodes: [0, 1] })
  if (commit.exitCode !== 0) throw new Error(`There’s no branch or commit called ${tag.target}`)
  const hash = commit.stdout.trim()
  // --no-sign: the dialog's choice wins over tag.gpgSign, which would otherwise sign every tag and wait
  // in an editor for the message of a lightweight one. --cleanup=whitespace keeps lines starting with #.
  const args = message
    ? ['tag', '-a', tag.sign ? '-s' : '--no-sign', '--cleanup=whitespace', '-F', '-', '--', tag.name, hash]
    : ['tag', '--no-sign', '--', tag.name, hash]
  await runGit(args, { cwd: repo, stdin: message, env: NO_EDITOR })
}

/** Delete a local tag. */
export async function deleteTag(repo: string, name: string): Promise<void> {
  await assertTagName(repo, name)
  if (!(await exists(repo, `refs/tags/${name}`))) throw new Error(`There’s no tag called ${name}`)
  await runGit(['tag', '-d', '--', name], { cwd: repo })
}

/** Push one tag to a remote. */
export async function pushTag(repo: string, name: string, remote: string): Promise<void> {
  await assertTagName(repo, name)
  if (!(await exists(repo, `refs/tags/${name}`))) throw new Error(`There’s no tag called ${name}`)
  await assertKnownRemote(repo, remote)
  const ref = `refs/tags/${name}`
  const auth = await repoCredentialArgs(repo)
  try {
    await runGit([...auth, 'push', remote, `${ref}:${ref}`], { cwd: repo })
  } catch (error) {
    if (!(error instanceof GitError) || !error.stderr.includes('[rejected]')) throw error
    throw new Error(`Push refused: ${remote} already has a different tag called ${name}. Delete it there first to replace it.`)
  }
}

/** Delete a tag on a remote. The local tag, if there is one, stays. */
export async function deleteRemoteTag(repo: string, name: string, remote: string): Promise<void> {
  await assertTagName(repo, name)
  await assertKnownRemote(repo, remote)
  const auth = await repoCredentialArgs(repo)
  await runGit([...auth, 'push', remote, '--delete', `refs/tags/${name}`], { cwd: repo })
}
