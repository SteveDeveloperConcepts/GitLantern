import { parseRemoteUrl } from '../../shared/remoteUrl'
import type { DraftComment, PullRequestDetail, ReviewComment, ReviewVerdict, SubmitReview } from '../../shared/types'
import {
  ServiceError,
  apiBase,
  list,
  obj,
  repoApiOrThrow,
  request,
  str,
  time,
  toPullRequest,
  withoutUser,
  type ApiAccount,
  type Json,
  type RepoApi
} from './providerApi'

/** At most this many comments of each kind are read from one pull request. */
const MAX_COMMENTS = 300
const AZURE_VERSION = 'api-version=7.1'

/** What the service says about a pull request opened for review, before its commits are fetched. */
export interface ReviewTarget {
  pullRequest: Omit<PullRequestDetail, 'base' | 'head' | 'viewer'>
  /** Its newest commit as the service reports it, or '' when it doesn't. Bitbucket gives only the first 12 characters. */
  headSha: string
  /** A fork's clone address on the same server, when the service tells enough to work it out; '' otherwise. */
  forkUrl: string
}

/** Where a line comment sits in GitLab's terms: the file's name on each side, and the line on each side it exists on. */
export interface TextPosition {
  oldPath: string
  newPath: string
  oldLine: number | null
  newLine: number | null
}

/** Works out GitLab positions for line comments from the diff that starts at `base`, one per comment. */
export type LocateLines = (base: string, comments: DraftComment[]) => Promise<TextPosition[]>

/** Marks a GitLab note as a request for changes, which GitLab has no verdict for (see gitlabReview). */
export const GITLAB_CHANGES_REQUESTED = '**Changes requested**'

const label = (account: ApiAccount, number: number): string => `${account.provider === 'gitlab' ? '!' : '#'}${number}`

function pullRequestPath(account: ApiAccount, api: RepoApi, number: number): string {
  switch (account.provider) {
    case 'gitlab':
      return `${api.base}/merge_requests/${number}`
    case 'bitbucket':
    case 'azure':
      return `${api.base}/pullrequests/${number}`
    default:
      return `${api.base}/pulls/${number}`
  }
}

function stateOf(account: ApiAccount, item: Json): PullRequestDetail['state'] {
  switch (account.provider) {
    case 'gitlab':
      return item.state === 'merged' ? 'merged' : item.state === 'closed' ? 'closed' : 'open'
    case 'bitbucket':
      return item.state === 'MERGED' ? 'merged' : item.state === 'DECLINED' || item.state === 'SUPERSEDED' ? 'closed' : 'open'
    case 'azure':
      return item.status === 'completed' ? 'merged' : item.status === 'abandoned' ? 'closed' : 'open'
    default:
      return item.merged === true || str(item.merged_at) !== '' ? 'merged' : item.state === 'closed' ? 'closed' : 'open'
  }
}

function bodyOf(account: ApiAccount, item: Json): string {
  switch (account.provider) {
    case 'gitlab':
    case 'azure':
      return str(item.description)
    case 'bitbucket':
      return str(item.description) || str(obj(item.summary).raw)
    default:
      return str(item.body)
  }
}

function headShaOf(account: ApiAccount, item: Json): string {
  switch (account.provider) {
    case 'gitlab':
      return str(item.sha) || str(obj(item.diff_refs).head_sha)
    case 'bitbucket':
      return str(obj(obj(item.source).commit).hash)
    case 'azure':
      return str(obj(item.lastMergeSourceCommit).commitId)
    default:
      return str(obj(item.head).sha)
  }
}

/** The address of another repository on the same server, written the same way (HTTPS or SSH) as `url`. */
function sameServer(url: string, fullName: string): string {
  const parsed = parseRemoteUrl(url)
  if (!parsed?.path || !url.endsWith(parsed.path)) return ''
  return url.slice(0, url.length - parsed.path.length) + fullName + (/\.git\/?$/i.test(parsed.path) ? '.git' : '')
}

/**
 * Where a fork's commits can be fetched from, for services that don't keep them in the target
 * repository: Bitbucket names the fork, Azure DevOps gives its clone addresses.
 */
function forkUrlOf(account: ApiAccount, item: Json, remoteUrl: string): string {
  if (account.provider === 'bitbucket') {
    const fullName = str(obj(obj(item.source).repository).full_name)
    const parts = fullName.split('/')
    const valid = parts.length === 2 && parts.every((part) => /^[\w.-]+$/.test(part) && !/^\.+$/.test(part))
    return valid ? sameServer(remoteUrl, fullName) : ''
  }
  if (account.provider === 'azure') {
    const repository = obj(obj(item.forkSource).repository)
    const ssh = parseRemoteUrl(remoteUrl)?.protocol === 'ssh'
    return ssh && str(repository.sshUrl) ? str(repository.sshUrl) : withoutUser(str(repository.remoteUrl))
  }
  return ''
}

/** One pull request (merge request on GitLab) with its description, state and newest commit. */
export async function getPullRequest(account: ApiAccount, token: string, remoteUrl: string, number: number): Promise<ReviewTarget> {
  const api = repoApiOrThrow(account, remoteUrl)
  const path = pullRequestPath(account, api, number) + (account.provider === 'azure' ? `?${AZURE_VERSION}` : '')
  const item = obj(await request(account, token, path))
  const pullRequest = { ...toPullRequest(account, item, api.web), body: bodyOf(account, item), state: stateOf(account, item) }
  return { pullRequest, headSha: headShaOf(account, item), forkUrl: pullRequest.sameRepo ? '' : forkUrlOf(account, item, remoteUrl) }
}

/** Who an Azure DevOps token belongs to: the id votes are cast with, and the name on their comments. */
async function azureIdentity(account: ApiAccount, token: string): Promise<{ id: string; name: string }> {
  const user = obj(obj(await request(account, token, '/connectionData?api-version=7.1-preview.1')).authenticatedUser)
  return { id: str(user.id), name: str(user.customDisplayName) || str(user.providerDisplayName) }
}

/**
 * The name the service puts on the account's own comments, to tell them apart. That's the login,
 * except on Bitbucket and Azure DevOps, which show display names.
 */
export async function viewerName(account: ApiAccount, token: string, login: string): Promise<string> {
  if (account.provider === 'bitbucket') {
    const user = obj(await request(account, token, '/user'))
    return str(user.display_name) || str(user.nickname) || login
  }
  if (account.provider === 'azure') return (await azureIdentity(account, token)).name || login
  return login
}

/** Read a list page by page (`page=1`, `2`, …) until a page comes back short or there are enough. */
async function pages(account: ApiAccount, token: string, path: (page: number) => string, perPage: number): Promise<Json[]> {
  const items: Json[] = []
  for (let page = 1; items.length < MAX_COMMENTS; page++) {
    const batch = list(await request(account, token, path(page)))
    items.push(...batch)
    if (batch.length < perPage) break
  }
  return items.slice(0, MAX_COMMENTS)
}

/** Bitbucket's pages link to the next one. Only links back into the same API are followed, so the token goes nowhere else. */
async function linkedPages(account: ApiAccount, token: string, first: string): Promise<Json[]> {
  const items: Json[] = []
  let next = first
  while (next && items.length < MAX_COMMENTS) {
    const page = obj(await request(account, token, next))
    items.push(...list(page.values))
    const link = str(page.next)
    next = link.startsWith(`${apiBase(account)}/`) ? link : ''
  }
  return items.slice(0, MAX_COMMENTS)
}

const line = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)

function onWhole(id: string, author: string, body: string, createdAt: number | null, verdict?: ReviewVerdict): ReviewComment {
  return { id, author, body, createdAt, path: null, line: null, side: 'new', ...(verdict ? { verdict } : {}) }
}

/** A review summary, unless it says nothing: a plain comment-review often just holds line comments. */
function summary(id: string, author: string, body: string, createdAt: number | null, verdict: ReviewVerdict | undefined): ReviewComment[] {
  if (!body.trim() && (!verdict || verdict === 'comment')) return []
  return [onWhole(id, author, body, createdAt, verdict)]
}

/** A service's review state as a verdict, looking only at the table's own keys (not "constructor" and the like). */
const verdictOf = (table: Record<string, ReviewVerdict>, state: unknown): ReviewVerdict | undefined =>
  typeof state === 'string' && Object.hasOwn(table, state) ? table[state] : undefined

const GITHUB_VERDICTS: Record<string, ReviewVerdict> = { APPROVED: 'approve', CHANGES_REQUESTED: 'request-changes', COMMENTED: 'comment' }

async function githubComments(account: ApiAccount, token: string, api: RepoApi, number: number): Promise<ReviewComment[]> {
  const pr = `${api.base}/pulls/${number}`
  const [lines, general, reviews] = await Promise.all([
    pages(account, token, (page) => `${pr}/comments?per_page=100&page=${page}`, 100),
    pages(account, token, (page) => `${api.base}/issues/${number}/comments?per_page=100&page=${page}`, 100),
    pages(account, token, (page) => `${pr}/reviews?per_page=100&page=${page}`, 100)
  ])
  return [
    ...lines.map((comment): ReviewComment => {
      const onFile = comment.subject_type === 'file'
      // An outdated comment no longer has a line in the current diff, only the one it was made on.
      const current = line(comment.line)
      return {
        id: String(comment.id),
        author: str(obj(comment.user).login),
        body: str(comment.body),
        createdAt: time(comment.created_at),
        path: str(comment.path) || null,
        line: onFile ? null : (current ?? line(comment.original_line)),
        side: comment.side === 'LEFT' ? 'old' : 'new',
        ...(!onFile && current === null ? { outdated: true } : {}),
        ...(comment.in_reply_to_id != null ? { inReplyTo: String(comment.in_reply_to_id) } : {})
      }
    }),
    ...general.map((comment) => onWhole(`issue-${comment.id}`, str(obj(comment.user).login), str(comment.body), time(comment.created_at))),
    ...reviews
      .filter((review) => review.state !== 'PENDING')
      .flatMap((review) => {
        const verdict = verdictOf(GITHUB_VERDICTS, review.state)
        return summary(`review-${review.id}`, str(obj(review.user).login), str(review.body), time(review.submitted_at), verdict)
      })
  ]
}

const GITEA_VERDICTS: Record<string, ReviewVerdict> = { APPROVED: 'approve', REQUEST_CHANGES: 'request-changes', COMMENT: 'comment' }

async function giteaComments(account: ApiAccount, token: string, api: RepoApi, number: number): Promise<ReviewComment[]> {
  const pr = `${api.base}/pulls/${number}`
  const [reviews, general] = await Promise.all([
    pages(account, token, (page) => `${pr}/reviews?limit=50&page=${page}`, 50),
    request(account, token, `${api.base}/issues/${number}/comments`).then(list)
  ])
  // Gitea lists line comments per review. PENDING is a draft only its author sees; REQUEST_REVIEW asks someone to review.
  const submitted = reviews.filter((review) => review.state !== 'PENDING' && review.state !== 'REQUEST_REVIEW')
  const lines: Json[] = []
  for (const review of submitted) {
    if (lines.length >= MAX_COMMENTS) break
    if (Number(review.comments_count) > 0) lines.push(...list(await request(account, token, `${pr}/reviews/${review.id}/comments`)))
  }
  return [
    ...lines.slice(0, MAX_COMMENTS).map((comment): ReviewComment => {
      // `position` is the line in the new file, `original_position` in the old one; the other is 0.
      const newLine = line(comment.position)
      const oldLine = line(comment.original_position)
      return {
        id: String(comment.id),
        author: str(obj(comment.user).login),
        body: str(comment.body),
        createdAt: time(comment.created_at),
        path: str(comment.path) || null,
        line: newLine ?? oldLine,
        side: newLine === null && oldLine !== null ? 'old' : 'new'
      }
    }),
    ...general
      .slice(0, MAX_COMMENTS)
      .map((comment) => onWhole(`issue-${comment.id}`, str(obj(comment.user).login), str(comment.body), time(comment.created_at))),
    ...submitted.flatMap((review) =>
      summary(
        `review-${review.id}`,
        str(obj(review.user).login),
        str(review.body),
        time(review.submitted_at),
        review.dismissed === true ? undefined : verdictOf(GITEA_VERDICTS, review.state)
      )
    )
  ]
}

/** GitLab records approvals (and, on newer versions, requests for changes) as system notes. */
function gitlabSystemVerdict(body: string): ReviewVerdict | undefined {
  if (/^approved this merge request/i.test(body)) return 'approve'
  if (/^requested changes/i.test(body)) return 'request-changes'
  return undefined
}

async function gitlabComments(account: ApiAccount, token: string, api: RepoApi, number: number): Promise<ReviewComment[]> {
  const mr = `${api.base}/merge_requests/${number}`
  const [item, discussions] = await Promise.all([
    request(account, token, mr).then(obj),
    pages(account, token, (page) => `${mr}/discussions?per_page=100&page=${page}`, 100)
  ])
  const head = str(obj(item.diff_refs).head_sha) || str(item.sha)
  return discussions.flatMap((discussion) => {
    const notes = list(discussion.notes)
    const root = notes[0]
    return notes.flatMap((note): ReviewComment[] => {
      const id = String(note.id)
      const author = str(obj(note.author).username)
      const createdAt = time(note.created_at)
      const body = str(note.body)
      if (note.system === true) {
        const verdict = gitlabSystemVerdict(body)
        return verdict ? [onWhole(id, author, '', createdAt, verdict)] : []
      }
      const reply = root && note !== root ? { inReplyTo: String(root.id) } : {}
      if (note.type === 'DiffNote') {
        const position = obj(note.position)
        const newLine = line(position.new_line)
        const oldLine = line(position.old_line)
        // GitLab moves a note's position along with new commits while its line stays the same; one left behind is outdated.
        const outdated = head !== '' && str(position.head_sha) !== '' && str(position.head_sha) !== head
        return [
          {
            id,
            author,
            body,
            createdAt,
            path: str(position.new_path) || str(position.old_path) || null,
            line: newLine ?? oldLine,
            side: newLine === null && oldLine !== null ? 'old' : 'new',
            ...(outdated ? { outdated: true } : {}),
            ...reply
          }
        ]
      }
      if (body.startsWith(GITLAB_CHANGES_REQUESTED)) {
        return [{ ...onWhole(id, author, body.slice(GITLAB_CHANGES_REQUESTED.length).trim(), createdAt, 'request-changes'), ...reply }]
      }
      return [{ ...onWhole(id, author, body, createdAt), ...reply }]
    })
  })
}

async function bitbucketComments(account: ApiAccount, token: string, api: RepoApi, number: number): Promise<ReviewComment[]> {
  const pr = `${api.base}/pullrequests/${number}`
  const [item, comments] = await Promise.all([
    request(account, token, pr).then(obj),
    linkedPages(account, token, `${pr}/comments?pagelen=100`)
  ])
  const author = (user: Json): string => str(user.display_name) || str(user.nickname)
  // Deleted comments stay in the list, and pending ones are an unfinished review's drafts.
  const notes = comments
    .filter((comment) => comment.deleted !== true && comment.pending !== true)
    .map((comment): ReviewComment => {
      const inline = obj(comment.inline)
      const to = line(inline.to)
      const from = line(inline.from)
      const parent = obj(comment.parent).id
      return {
        id: String(comment.id),
        author: author(obj(comment.user)),
        body: str(obj(comment.content).raw),
        createdAt: time(comment.created_on),
        path: str(inline.path) || null,
        line: to ?? from,
        side: to === null && from !== null ? 'old' : 'new',
        ...(inline.outdated === true ? { outdated: true } : {}),
        ...(parent != null ? { inReplyTo: String(parent) } : {})
      }
    })
  // Approvals and requests for changes aren't comments on Bitbucket: they're each participant's state.
  const verdicts = list(item.participants).flatMap((participant) => {
    const verdict: ReviewVerdict | undefined =
      participant.state === 'approved' || participant.approved === true
        ? 'approve'
        : participant.state === 'changes_requested'
          ? 'request-changes'
          : undefined
    const user = obj(participant.user)
    const id = `verdict-${str(user.uuid) || author(user)}`
    return verdict ? [onWhole(id, author(user), '', time(participant.participated_on), verdict)] : []
  })
  return [...notes, ...verdicts]
}

async function azureComments(account: ApiAccount, token: string, api: RepoApi, number: number): Promise<ReviewComment[]> {
  const threads = list(obj(await request(account, token, `${api.base}/pullrequests/${number}/threads?${AZURE_VERSION}`)).value)
  return threads
    .filter((thread) => thread.isDeleted !== true)
    .flatMap((thread): ReviewComment[] => {
      const comments = list(thread.comments).filter((comment) => comment.isDeleted !== true)
      const property = (name: string): string => str(obj(obj(thread.properties)[name]).$value)
      if (property('CodeReviewThreadType') === 'VoteUpdate') {
        // 10 approved, 5 approved with suggestions, -5 waiting for the author, -10 rejected, 0 vote reset.
        const vote = Number(property('CodeReviewVoteResult'))
        const verdict: ReviewVerdict | undefined = vote > 0 ? 'approve' : vote < 0 ? 'request-changes' : undefined
        const voter = obj(obj(thread.identities)[property('CodeReviewVotedByIdentity')])
        const name = str(voter.displayName) || str(obj(comments[0]?.author).displayName)
        return verdict ? [onWhole(String(thread.id), name, '', time(thread.publishedDate), verdict)] : []
      }
      const context = obj(thread.threadContext)
      const path = str(context.filePath).replace(/^\/+/, '') || null
      const newLine = line(obj(context.rightFileStart).line)
      const oldLine = line(obj(context.leftFileStart).line)
      return comments
        .filter((comment) => comment.commentType !== 'system' && comment.commentType !== 3)
        .map((comment): ReviewComment => ({
          id: `${thread.id}/${comment.id}`,
          author: str(obj(comment.author).displayName),
          body: str(comment.content),
          createdAt: time(comment.publishedDate),
          path,
          line: path ? (newLine ?? oldLine) : null,
          side: newLine === null && oldLine !== null ? 'old' : 'new',
          ...(Number(comment.parentCommentId) > 0 ? { inReplyTo: `${thread.id}/${comment.parentCommentId}` } : {})
        }))
    })
}

/** Everything said on a pull request so far, oldest first: line comments, general comments and review verdicts. */
export async function listReviewComments(account: ApiAccount, token: string, remoteUrl: string, number: number): Promise<ReviewComment[]> {
  const api = repoApiOrThrow(account, remoteUrl)
  const readers: Record<ApiAccount['provider'], typeof githubComments> = {
    github: githubComments,
    gitea: giteaComments,
    gitlab: gitlabComments,
    bitbucket: bitbucketComments,
    azure: azureComments,
    generic: async () => []
  }
  const read = readers[account.provider]
  const comments = await read(account, token, api, number)
  const at = (comment: ReviewComment): number => comment.createdAt ?? Number.MAX_SAFE_INTEGER
  return comments.sort((a, b) => at(a) - at(b))
}

const relativePath = (path: string): boolean =>
  path !== '' &&
  !/^([\\/]|[A-Za-z]:)/.test(path) &&
  !/[\x00-\x1f]/.test(path) &&
  !path.split(/[\\/]/).some((part) => part === '' || part === '.' || part === '..')

/** Check a review before anything is sent: it says something, and each comment has text and sits on a line of a file. */
export function checkReview(review: SubmitReview): SubmitReview {
  for (const { path, line: at, side, body } of review.comments) {
    if (!relativePath(path)) throw new Error(`Can’t comment on ${path || 'that file'}: it isn’t a path inside the repository`)
    if (!Number.isInteger(at) || at <= 0) throw new Error(`Can’t comment on ${path}: ${at} isn’t a line number`)
    if (side !== 'old' && side !== 'new') throw new Error(`Can’t comment on ${path}: pick the old or the new side of line ${at}`)
    if (!body.trim()) throw new Error(`Your comment on line ${at} of ${path} is empty. Write something or remove it.`)
  }
  const said = review.body.trim() !== '' || review.comments.length > 0
  if (review.verdict === 'request-changes' && !said) throw new Error('Say what needs changing: write a summary or comment on a line')
  if (review.verdict === 'comment' && !said) throw new Error('There’s nothing to send yet: write a summary or comment on a line')
  return review
}

/** Turn the refusals people actually run into into plain words; anything else is passed on as it is. */
function plainRefusal(error: unknown, verdict: ReviewVerdict): unknown {
  if (!(error instanceof ServiceError)) return error
  if (verdict !== 'comment' && /own pull/i.test(error.detail)) {
    const act = verdict === 'approve' ? 'approve' : 'request changes on'
    return new Error(`You can’t ${act} your own pull request. Submit your review as a comment instead.`)
  }
  if (/part of the diff|could not be resolved/i.test(error.detail)) {
    return new Error('One of your comments is on a line that isn’t part of the pull request’s changes. Reload it and try again.')
  }
  const emptyBody = /\bbody\b.*\b(required|blank|empty)\b/i
  if (error.status === 422 && emptyBody.test(error.detail)) return new Error('Write a summary for this review and try again')
  return error
}

const GITHUB_EVENTS: Record<ReviewVerdict, string> = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' }
const GITEA_EVENTS: Record<ReviewVerdict, string> = { comment: 'COMMENT', approve: 'APPROVED', 'request-changes': 'REQUEST_CHANGES' }

/** GitHub and Gitea take a whole review, comments and verdict, in one call, pinned to the commit that was reviewed. */
async function oneCallReview(
  account: ApiAccount,
  token: string,
  api: RepoApi,
  number: number,
  head: string,
  review: SubmitReview
): Promise<void> {
  const github = account.provider === 'github'
  const comments = review.comments.map((comment) =>
    github
      ? { path: comment.path, line: comment.line, side: comment.side === 'old' ? 'LEFT' : 'RIGHT', body: comment.body }
      : { path: comment.path, body: comment.body, ...(comment.side === 'old' ? { old_position: comment.line } : { new_position: comment.line }) }
  )
  const body: Json = {
    commit_id: head,
    event: (github ? GITHUB_EVENTS : GITEA_EVENTS)[review.verdict],
    body: review.body,
    ...(comments.length > 0 ? { comments } : {})
  }
  try {
    await request(account, token, `${api.base}/pulls/${number}/reviews`, body)
  } catch (error) {
    throw plainRefusal(error, review.verdict)
  }
}

interface Step {
  kind: 'comment' | 'summary' | 'verdict'
  run: () => Promise<unknown>
}

/** Make a review's calls one after another. When one fails after others went through, say what was sent, so it isn't sent twice. */
async function sendInOrder(steps: Step[], verdict: ReviewVerdict): Promise<void> {
  const total = steps.filter((step) => step.kind === 'comment').length
  let comments = 0
  let summarized = false
  for (const step of steps) {
    try {
      await step.run()
    } catch (caught) {
      const error = plainRefusal(caught, verdict)
      if (comments === 0 && !summarized) throw error
      const sent = [comments > 0 ? `${comments} of ${total} comment${total === 1 ? '' : 's'}` : '', summarized ? 'the summary' : '']
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Only part of your review was sent (${sent.filter(Boolean).join(' and ')}). ${reason}`)
    }
    if (step.kind === 'comment') comments++
    if (step.kind === 'summary') summarized = true
  }
}

const sameCommit = (a: string, b: string): boolean =>
  a.length >= 7 && b.length >= 7 && (a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase()))

/**
 * Bitbucket and Azure DevOps place line comments, and count votes, against the pull request as it
 * is now. If it moved on since the review began, comments would land on the wrong lines.
 */
async function assertUnchanged(account: ApiAccount, token: string, remoteUrl: string, number: number, head: string): Promise<void> {
  const { headSha } = await getPullRequest(account, token, remoteUrl, number)
  if (headSha && !sameCommit(headSha, head)) {
    throw new Error(`New commits were pushed to ${label(account, number)} since you opened it. Reload it, then submit your review again.`)
  }
}

const simplePosition = (comment: DraftComment): TextPosition => ({
  oldPath: comment.path,
  newPath: comment.path,
  oldLine: comment.side === 'old' ? comment.line : null,
  newLine: comment.side === 'new' ? comment.line : null
})

/** The diff version of a merge request that was reviewed: its latest, or an earlier one if commits were pushed since. */
async function gitlabDiffRefs(
  account: ApiAccount,
  token: string,
  mr: string,
  number: number,
  head: string
): Promise<Record<'base' | 'start' | 'head', string>> {
  const refs = obj(obj(await request(account, token, mr)).diff_refs)
  if (str(refs.head_sha) === head) return { base: str(refs.base_sha), start: str(refs.start_sha), head }
  const version = list(await request(account, token, `${mr}/versions?per_page=100`)).find((v) => v.head_commit_sha === head)
  if (!version) throw new Error(`!${number} has changed since you opened it. Reload it, then submit your review again.`)
  return { base: str(version.base_commit_sha), start: str(version.start_commit_sha), head }
}

/**
 * GitLab: each line comment becomes a discussion on the reviewed diff version, the summary a note,
 * and an approval a call to /approve, pinned to the reviewed commit. GitLab has no "request
 * changes" verdict on every tier (and none in its REST API), so the summary note goes out marked
 * with GITLAB_CHANGES_REQUESTED, which `comments` reads back as that verdict, and any approval the
 * reviewer gave earlier is withdrawn with /unapprove.
 */
async function gitlabReview(
  account: ApiAccount,
  token: string,
  api: RepoApi,
  number: number,
  head: string,
  review: SubmitReview,
  locate?: LocateLines
): Promise<void> {
  const mr = `${api.base}/merge_requests/${number}`
  const steps: Step[] = []
  if (review.comments.length > 0) {
    const refs = await gitlabDiffRefs(account, token, mr, number, head)
    const positions = locate ? await locate(refs.base, review.comments) : []
    review.comments.forEach((comment, index) => {
      const at = positions[index] ?? simplePosition(comment)
      const position = {
        position_type: 'text',
        base_sha: refs.base,
        start_sha: refs.start,
        head_sha: refs.head,
        old_path: at.oldPath,
        new_path: at.newPath,
        // A line the diff doesn't change needs both its numbers; an added or removed one only its own.
        ...(at.oldLine !== null ? { old_line: at.oldLine } : {}),
        ...(at.newLine !== null ? { new_line: at.newLine } : {})
      }
      steps.push({ kind: 'comment', run: () => request(account, token, `${mr}/discussions`, { body: comment.body, position }) })
    })
  }
  const said = review.body.trim() !== ''
  const note =
    review.verdict === 'request-changes'
      ? `${GITLAB_CHANGES_REQUESTED}${said ? `\n\n${review.body}` : ''}`
      : said
        ? review.body
        : ''
  if (note) steps.push({ kind: 'summary', run: () => request(account, token, `${mr}/notes`, { body: note }) })
  if (review.verdict === 'approve') {
    const approve = async (): Promise<void> => {
      try {
        await request(account, token, `${mr}/approve`, { sha: head })
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error
        if (error.status === 409) {
          throw new Error(`New commits were pushed to !${number} since you opened it. Reload it to review them, then approve.`)
        }
        if (error.status === 401 || error.status === 403) {
          throw new Error(
            `GitLab didn’t let you approve !${number}. You may have approved it already, or the project doesn’t allow ` +
              'approvals from the merge request’s author or from you.'
          )
        }
        throw error
      }
    }
    steps.push({ kind: 'verdict', run: approve })
  }
  if (review.verdict === 'request-changes') {
    const unapprove = async (): Promise<void> => {
      try {
        await request(account, token, `${mr}/unapprove`, undefined, 'POST')
      } catch (error) {
        // Nothing to withdraw (404), or approvals aren't the reviewer's to change: the marked note still stands.
        if (!(error instanceof ServiceError) || ![401, 403, 404].includes(error.status)) throw error
      }
    }
    steps.push({ kind: 'verdict', run: unapprove })
  }
  await sendInOrder(steps, review.verdict)
}

/** Bitbucket Cloud: a comment per line comment, the summary as one more, then /approve or /request-changes. */
async function bitbucketReview(
  account: ApiAccount,
  token: string,
  remoteUrl: string,
  number: number,
  head: string,
  review: SubmitReview
): Promise<void> {
  const pr = pullRequestPath(account, repoApiOrThrow(account, remoteUrl), number)
  await assertUnchanged(account, token, remoteUrl, number, head)
  const steps: Step[] = review.comments.map((comment) => ({
    kind: 'comment',
    run: () =>
      request(account, token, `${pr}/comments`, {
        content: { raw: comment.body },
        inline: { path: comment.path, ...(comment.side === 'old' ? { from: comment.line } : { to: comment.line }) }
      })
  }))
  if (review.body.trim()) {
    steps.push({ kind: 'summary', run: () => request(account, token, `${pr}/comments`, { content: { raw: review.body } }) })
  }
  if (review.verdict === 'approve') steps.push({ kind: 'verdict', run: () => request(account, token, `${pr}/approve`, undefined, 'POST') })
  if (review.verdict === 'request-changes') {
    steps.push({ kind: 'verdict', run: () => request(account, token, `${pr}/request-changes`, undefined, 'POST') })
  }
  await sendInOrder(steps, review.verdict)
}

/** Azure DevOps: a thread per line comment, the summary as a thread, then the account's vote (10 approve, -10 reject). */
async function azureReview(
  account: ApiAccount,
  token: string,
  remoteUrl: string,
  number: number,
  head: string,
  review: SubmitReview
): Promise<void> {
  const pr = pullRequestPath(account, repoApiOrThrow(account, remoteUrl), number)
  await assertUnchanged(account, token, remoteUrl, number, head)
  const reviewer = review.verdict === 'comment' ? '' : (await azureIdentity(account, token)).id
  if (review.verdict !== 'comment' && !reviewer) {
    throw new Error('Couldn’t tell which Azure DevOps user this token belongs to, so it can’t vote')
  }
  const threads = `${pr}/threads?${AZURE_VERSION}`
  // commentType 1 is a text comment; status 1 an active thread. Offsets count from 1, so { line, offset: 1 } is the line's start.
  const thread = (content: string, threadContext?: Json): Json => ({
    comments: [{ parentCommentId: 0, content, commentType: 1 }],
    status: 1,
    ...(threadContext ? { threadContext } : {})
  })
  const steps: Step[] = review.comments.map((comment) => {
    const at = { line: comment.line, offset: 1 }
    const range = comment.side === 'old' ? { leftFileStart: at, leftFileEnd: at } : { rightFileStart: at, rightFileEnd: at }
    return { kind: 'comment', run: () => request(account, token, threads, thread(comment.body, { filePath: `/${comment.path}`, ...range })) }
  })
  if (review.body.trim()) steps.push({ kind: 'summary', run: () => request(account, token, threads, thread(review.body)) })
  if (reviewer) {
    const vote = review.verdict === 'approve' ? 10 : -10
    const path = `${pr}/reviewers/${encodeURIComponent(reviewer)}?${AZURE_VERSION}`
    steps.push({ kind: 'verdict', run: () => request(account, token, path, { vote }, 'PUT') })
  }
  await sendInOrder(steps, review.verdict)
}

/**
 * Submit a review of the pull request as it was at `head`: its line comments, summary and verdict.
 * `locate` gives GitLab both sides of each commented line; without it only the commented side is sent.
 */
export async function postReview(
  account: ApiAccount,
  token: string,
  remoteUrl: string,
  number: number,
  head: string,
  review: SubmitReview,
  locate?: LocateLines
): Promise<void> {
  checkReview(review)
  const api = repoApiOrThrow(account, remoteUrl)
  switch (account.provider) {
    case 'github':
    case 'gitea':
      return oneCallReview(account, token, api, number, head, review)
    case 'gitlab':
      return gitlabReview(account, token, api, number, head, review, locate)
    case 'bitbucket':
      return bitbucketReview(account, token, remoteUrl, number, head, review)
    case 'azure':
      return azureReview(account, token, remoteUrl, number, head, review)
    case 'generic':
      throw new Error('Reviews need a GitHub, GitLab, Bitbucket, Azure DevOps or Gitea account')
  }
}
