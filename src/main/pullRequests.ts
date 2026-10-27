import { providerInfo } from '../shared/providers'
import { serviceName } from '../shared/remoteUrl'
import type {
  Account,
  DraftComment,
  NewPullRequest,
  PullRequest,
  PullRequestDetail,
  PullRequestList,
  ReviewComment,
  SubmitReview
} from '../shared/types'
import type { AccountStore } from './accounts/store'
import { createPullRequest, listPullRequests } from './accounts/providerApi'
import {
  checkReview,
  getPullRequest,
  listReviewComments,
  postReview,
  viewerName,
  type ReviewTarget,
  type TextPosition
} from './accounts/reviewApi'
import * as git from './git/commands'
import type { Remote } from './git/parsers'
import { runGit } from './git/runGit'

interface Source {
  remote: Remote
  account: Account
  token: string
}

/** Where pull requests for a repository live: its origin (or only) remote, and the account for that server. */
async function lookUp(repo: string, accounts: AccountStore): Promise<{ list: Omit<PullRequestList, 'items'>; source?: Source }> {
  const remotes = await git.remotes(repo)
  const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0]
  if (!remote) return { list: { remote: null, service: '', noun: 'pull request', unavailable: 'no-remote', defaultBranch: null } }

  const account = accounts.findByUrl(remote.fetchUrl)
  const service = account ? providerInfo(account.provider).name : serviceName(remote.fetchUrl)
  const list: Omit<PullRequestList, 'items'> = {
    remote: remote.name,
    service,
    noun: account?.provider === 'gitlab' || service === 'GitLab' ? 'merge request' : 'pull request',
    defaultBranch: await git.remoteDefaultBranch(repo, remote.name)
  }
  if (!account) return { list: { ...list, unavailable: 'no-account' } }
  if (account.provider === 'generic') return { list: { ...list, unavailable: 'unsupported' } }
  const token = await accounts.freshToken(account.id)
  if (!token) return { list: { ...list, unavailable: 'no-account' } }
  return { list, source: { remote, account, token } }
}

async function source(repo: string, accounts: AccountStore): Promise<Source> {
  const { list, source: found } = await lookUp(repo, accounts)
  if (!found) throw new Error(`Connect your ${list.service || 'Git service'} account first, under Accounts`)
  return found
}

export async function list(repo: string, accounts: AccountStore): Promise<PullRequestList> {
  const { list: info, source: found } = await lookUp(repo, accounts)
  if (!found) return { ...info, items: [] }
  return { ...info, items: await listPullRequests(found.account, found.token, found.remote.fetchUrl) }
}

export async function create(repo: string, accounts: AccountStore, input: NewPullRequest): Promise<PullRequest> {
  const title = input.title.trim()
  if (!title) throw new Error('Give it a title')
  if (input.source === input.target) throw new Error('Pick a different branch to merge into')
  const found = await source(repo, accounts)
  return createPullRequest(found.account, found.token, found.remote.fetchUrl, { ...input, title })
}

/** Where a service keeps the commits of a pull request from a fork, if it keeps them in the target repository. */
const FORK_REFS: Partial<Record<Account['provider'], (n: number) => string>> = {
  github: (n) => `refs/pull/${n}/head`,
  gitea: (n) => `refs/pull/${n}/head`,
  gitlab: (n) => `refs/merge-requests/${n}/head`
}

/** Check out a pull request: its branch when it's in this repository, else a `pr/<number>` branch. */
export async function checkout(repo: string, accounts: AccountStore, number: number): Promise<string> {
  const found = await source(repo, accounts)
  const pr = (await listPullRequests(found.account, found.token, found.remote.fetchUrl)).find((p) => p.number === number)
  if (!pr) throw new Error(`#${number} isn’t open any more`)
  if (pr.sameRepo) {
    await git.fetchBranch(repo, found.remote.name, pr.sourceBranch)
    await git.checkout(repo, { kind: 'remote', name: `${found.remote.name}/${pr.sourceBranch}` })
    return pr.sourceBranch
  }
  const ref = FORK_REFS[found.account.provider]
  if (!ref) throw new Error(`#${number} comes from a fork, which GitLantern can only check out on GitHub, GitLab and Gitea`)
  const local = `pr/${number}`
  await git.checkoutFetched(repo, found.remote.name, ref(number), local)
  return local
}

const HASH = /^[0-9a-f]{7,64}$/i

/** The commit a ref or hash names, or null when the repository doesn't have it. */
async function commitOf(repo: string, revision: string): Promise<string | null> {
  const found = await runGit(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], { cwd: repo, allowedExitCodes: [0, 1, 128] })
  return found.exitCode === 0 ? found.stdout.trim() : null
}

/**
 * Fetch one ref into FETCH_HEAD only, so no new branch or ref appears in the repository, and return
 * its commit. Read straight after the fetch, before anything else can rewrite FETCH_HEAD.
 */
async function fetchCommit(repo: string, auth: string[], from: string, ref: string): Promise<string> {
  await runGit([...auth, 'fetch', '--no-tags', '--write-fetch-head', from, ref], { cwd: repo })
  const fetched = await commitOf(repo, 'FETCH_HEAD')
  if (!fetched) throw new Error(`Fetched ${ref}, but it isn’t a commit`)
  return fetched
}

/** Whether `tip` already has the commit the service reported (or the service didn't report one). */
async function hasReported(repo: string, tip: string, reported: string): Promise<boolean> {
  if (!HASH.test(reported) || tip.startsWith(reported.toLowerCase())) return true
  const check = await runGit(['merge-base', '--is-ancestor', reported, tip], { cwd: repo, allowedExitCodes: [0, 1, 128] })
  return check.exitCode === 0
}

/**
 * Fetch a pull request's newest commit: a same-repository one through its remote branch, a fork's
 * through the pull ref the service keeps in the target repository, or (Bitbucket, Azure DevOps)
 * from the fork itself. When what's fetched is newer than what the service reported, it wins.
 */
async function fetchHead(repo: string, accounts: AccountStore, found: Source, number: number, target: ReviewTarget): Promise<string> {
  const { remote, account } = found
  const { pullRequest, headSha, forkUrl } = target
  const pullRef = FORK_REFS[account.provider]?.(number)
  if (pullRequest.sameRepo) {
    let tip: string | null = null
    try {
      await git.fetchBranch(repo, remote.name, pullRequest.sourceBranch)
      tip = await commitOf(repo, `refs/remotes/${remote.name}/${pullRequest.sourceBranch}`)
    } catch (error) {
      // Deleted since, perhaps after a merge; the pull ref still has the commits.
      if (!pullRef) throw error
    }
    // A branch without the reported commit was rewritten or reused since; the pull ref follows the pull request itself.
    if (tip && (!pullRef || (await hasReported(repo, tip, headSha)))) return tip
    if (!pullRef) throw new Error(`${pullRequest.sourceBranch}, the branch of #${number}, isn’t on ${remote.name} any more`)
    return fetchCommit(repo, await git.repoCredentialArgs(repo), remote.name, pullRef)
  }
  if (pullRef) return fetchCommit(repo, await git.repoCredentialArgs(repo), remote.name, pullRef)
  // Only fetch from a fork on the same server and account: the address came from the service.
  if (forkUrl && accounts.findByUrl(forkUrl)?.id === account.id) {
    git.assertRemoteUrl(forkUrl)
    git.assertRevision(pullRequest.sourceBranch)
    try {
      return await fetchCommit(repo, git.credentialArgs([forkUrl]), forkUrl, `refs/heads/${pullRequest.sourceBranch}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Couldn’t fetch #${number} from its fork, ${forkUrl}: ${reason}`)
    }
  }
  throw new Error(
    `#${number} comes from a fork, and ${providerInfo(account.provider).name} doesn’t keep a fork’s commits in this repository. ` +
      'To review it, add the fork as a remote and fetch its branch.'
  )
}

/** A pull request opened for review: what the service says about it, with its commits fetched so git can diff them. */
export async function detail(repo: string, accounts: AccountStore, number: number): Promise<PullRequestDetail> {
  const found = await source(repo, accounts)
  const { account, token, remote } = found
  const [target, viewer] = await Promise.all([
    getPullRequest(account, token, remote.fetchUrl, number),
    viewerName(account, token, account.login).catch(() => account.login)
  ])
  const { pullRequest } = target
  // The target branch first: fetching it rewrites FETCH_HEAD, which the head may be read from.
  await git.fetchBranch(repo, remote.name, pullRequest.targetBranch)
  const targetTip = await commitOf(repo, `refs/remotes/${remote.name}/${pullRequest.targetBranch}`)
  const head = await fetchHead(repo, accounts, found, number, target)
  const merged = targetTip ? await runGit(['merge-base', targetTip, head], { cwd: repo, allowedExitCodes: [0, 1] }) : null
  const base = merged?.exitCode === 0 ? merged.stdout.trim() : ''
  if (!base) throw new Error(`#${number} has no history in common with ${pullRequest.targetBranch}, so there’s nothing to compare`)
  return { ...pullRequest, base, head, viewer }
}

/** Everything already said on a pull request, oldest first: line comments, general comments and review verdicts. */
export async function comments(repo: string, accounts: AccountStore, number: number): Promise<ReviewComment[]> {
  const found = await source(repo, accounts)
  return listReviewComments(found.account, found.token, found.remote.fetchUrl, number)
}

/** Lines a zero-context diff changes: its hunk headers. */
interface ChangedRange {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

async function changedRanges(repo: string, base: string, head: string, oldPath: string, newPath: string): Promise<ChangedRange[]> {
  const paths = oldPath !== newPath ? [oldPath, newPath] : [newPath]
  const { stdout } = await runGit(['diff', '--no-ext-diff', '--no-color', '-U0', '-M', base, head, '--', ...paths], {
    cwd: repo,
    env: git.LITERAL_PATHS
  })
  return [...stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4])
  }))
}

/** The same line on the other side of the diff, for a line it doesn't change; null for an added or removed line. */
function otherSide(ranges: ChangedRange[], line: number, side: 'old' | 'new'): number | null {
  let shift = 0
  for (const range of ranges) {
    const [start, count, otherCount] =
      side === 'new' ? [range.newStart, range.newCount, range.oldCount] : [range.oldStart, range.oldCount, range.newCount]
    // A range with no lines on this side sits after line `start`.
    if (line <= (count === 0 ? start : start - 1)) break
    if (line < start + count) return null
    shift += otherCount - count
  }
  return line + shift
}

/**
 * GitLab places a line comment by both sides of the diff: a line the diff doesn't change needs its
 * number in the old file and the new one, and a renamed file its old name. Worked out from git's diff.
 */
async function textPositions(repo: string, base: string, head: string, drafts: DraftComment[]): Promise<TextPosition[]> {
  const sideOnly = drafts.map((draft) => ({
    oldPath: draft.path,
    newPath: draft.path,
    oldLine: draft.side === 'old' ? draft.line : null,
    newLine: draft.side === 'new' ? draft.line : null
  }))
  if (!HASH.test(base) || !(await commitOf(repo, base)) || !(await commitOf(repo, head))) return sideOnly
  const files = await git.changedFiles(repo, [base, head])
  const ranges = new Map<string, ChangedRange[]>()
  const positions: TextPosition[] = []
  for (const draft of drafts) {
    const file = files.find((f) => f.path === draft.path)
    const oldPath = file?.origPath ?? draft.path
    let fileRanges = ranges.get(draft.path)
    if (!fileRanges) {
      // A file the pull request doesn't change has the same lines on both sides.
      fileRanges = file ? await changedRanges(repo, base, head, oldPath, draft.path) : []
      ranges.set(draft.path, fileRanges)
    }
    const other = otherSide(fileRanges, draft.line, draft.side)
    positions.push({
      oldPath,
      newPath: draft.path,
      oldLine: draft.side === 'old' ? draft.line : other,
      newLine: draft.side === 'new' ? draft.line : other
    })
  }
  return positions
}

/** Send a review of the pull request as it was at `head`, the commit the reviewer was shown. */
export async function submitReview(repo: string, accounts: AccountStore, number: number, head: string, review: SubmitReview): Promise<void> {
  git.assertHash(head)
  checkReview(review)
  const found = await source(repo, accounts)
  const locate =
    found.account.provider === 'gitlab' ? (base: string, drafts: DraftComment[]) => textPositions(repo, base, head, drafts) : undefined
  await postReview(found.account, found.token, found.remote.fetchUrl, number, head, review, locate)
}
