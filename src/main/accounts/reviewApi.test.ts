import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubmitReview } from '../../shared/types'
import type { ApiAccount } from './providerApi'
import { checkReview, getPullRequest, listReviewComments, postReview, viewerName, type TextPosition } from './reviewApi'

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

type Route = unknown | ((call: Call) => Response)

/**
 * Answer each request from `routes`, keyed "METHOD https://…" or just the address. The longest
 * address that starts the request's URL wins; a function route builds its own Response.
 */
function mockFetch(routes: Record<string, Route>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      const call = { method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }
      calls.push(call)
      const matches = Object.entries(routes)
        .map(([key, route]) => {
          const [method, prefix] = key.includes(' ') ? (key.split(' ') as [string, string]) : [null, key]
          return { prefix, route, fits: (!method || method === call.method) && url.startsWith(prefix) }
        })
        .filter((entry) => entry.fits)
        .sort((a, b) => b.prefix.length - a.prefix.length)
      const route = matches[0]?.route
      if (typeof route === 'function') return (route as (call: Call) => Response)(call)
      return new Response(JSON.stringify(route ?? {}))
    })
  )
  return calls
}

const refuse = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, statusText: 'Refused' })

afterEach(() => {
  vi.unstubAllGlobals()
})

const github: ApiAccount = { provider: 'github', host: 'github.com' }
const gitea: ApiAccount = { provider: 'gitea', host: 'git.acme.dev' }
const gitlab: ApiAccount = { provider: 'gitlab', host: 'gitlab.com' }
const bitbucket: ApiAccount = { provider: 'bitbucket', host: 'bitbucket.org', email: 'me@x.dev' }
const azure: ApiAccount = { provider: 'azure', host: 'dev.azure.com', organization: 'contoso' }

const HEAD = 'a'.repeat(40)
const GH = 'https://api.github.com/repos/acme/web'
const GT = 'https://git.acme.dev/api/v1/repos/acme/web'
const GL = 'https://gitlab.com/api/v4/projects/g%2Fapp/merge_requests/3'
const BB = 'https://api.bitbucket.org/2.0/repositories/team/api/pullrequests/4'
const AZ = 'https://dev.azure.com/contoso/web/_apis/git/repositories/site/pullrequests/12'
const AZURE_URL = 'https://dev.azure.com/contoso/web/_git/site'

const review = (overrides: Partial<SubmitReview> = {}): SubmitReview => ({ verdict: 'comment', body: '', comments: [], ...overrides })
const at = (iso: string): number => Date.parse(iso)

describe('getPullRequest', () => {
  it('GitHub: reads the description, state, head commit and whether it comes from a fork', async () => {
    const calls = mockFetch({
      [`${GH}/pulls/7`]: {
        number: 7,
        title: 'Faster builds',
        body: 'Caches the dependencies',
        state: 'closed',
        merged_at: '2026-10-02T00:00:00Z',
        draft: false,
        user: { login: 'priya' },
        head: { ref: 'fast', sha: HEAD, repo: { full_name: 'acme/web' } },
        base: { ref: 'main', repo: { full_name: 'acme/web' } },
        html_url: 'https://github.com/acme/web/pull/7',
        updated_at: '2026-10-01T00:00:00Z'
      }
    })
    const target = await getPullRequest(github, 'tok', 'git@github.com:acme/web.git', 7)
    expect(calls[0]).toMatchObject({ method: 'GET', url: `${GH}/pulls/7` })
    expect(calls[0]?.headers.Authorization).toBe('Bearer tok')
    expect(target).toEqual({
      pullRequest: {
        number: 7,
        title: 'Faster builds',
        author: 'priya',
        sourceBranch: 'fast',
        targetBranch: 'main',
        sameRepo: true,
        draft: false,
        url: 'https://github.com/acme/web/pull/7',
        updatedAt: at('2026-10-01T00:00:00Z'),
        body: 'Caches the dependencies',
        state: 'merged'
      },
      headSha: HEAD,
      forkUrl: ''
    })
  })

  it('Gitea and GitLab: closed and open states, the description, the head commit', async () => {
    const calls = mockFetch({
      [`${GT}/pulls/3`]: { number: 3, state: 'closed', merged: false, body: 'b', head: { ref: 'x', sha: 'c'.repeat(40) }, base: { ref: 'main' } },
      [GL]: { iid: 3, state: 'opened', description: 'Adds login', sha: 'd'.repeat(40), source_branch: 'login', target_branch: 'main', source_project_id: 1, target_project_id: 2 }
    })
    const fromGitea = await getPullRequest(gitea, 'gt', 'https://git.acme.dev/acme/web.git', 3)
    expect(calls[0]?.headers.Authorization).toBe('token gt')
    expect(fromGitea).toMatchObject({ pullRequest: { state: 'closed', body: 'b' }, headSha: 'c'.repeat(40) })
    const fromGitLab = await getPullRequest(gitlab, 'gl', 'git@gitlab.com:g/app.git', 3)
    expect(calls[1]?.headers['PRIVATE-TOKEN']).toBe('gl')
    expect(fromGitLab).toMatchObject({ pullRequest: { state: 'open', body: 'Adds login', sameRepo: false }, headSha: 'd'.repeat(40), forkUrl: '' })
  })

  it('Bitbucket: works out a fork’s address on the same server, written like the remote', async () => {
    mockFetch({
      [BB]: {
        id: 4,
        state: 'DECLINED',
        description: 'Typo',
        source: { branch: { name: 'fix' }, commit: { hash: 'abcdef123456' }, repository: { full_name: 'sam/api' } },
        destination: { branch: { name: 'main' }, repository: { full_name: 'team/api' } }
      }
    })
    const ssh = await getPullRequest(bitbucket, 't', 'git@bitbucket.org:team/api.git', 4)
    expect(ssh).toMatchObject({ pullRequest: { state: 'closed', sameRepo: false, sourceBranch: 'fix' }, headSha: 'abcdef123456', forkUrl: 'git@bitbucket.org:sam/api.git' })
    expect((await getPullRequest(bitbucket, 't', 'https://bitbucket.org/team/api', 4)).forkUrl).toBe('https://bitbucket.org/sam/api')
  })

  it('Azure DevOps: completed means merged, and a fork’s clone address comes from the service', async () => {
    const calls = mockFetch({
      [AZ]: {
        pullRequestId: 12,
        status: 'completed',
        description: 'Login page',
        sourceRefName: 'refs/heads/login',
        targetRefName: 'refs/heads/main',
        lastMergeSourceCommit: { commitId: HEAD },
        forkSource: { name: 'refs/heads/login', repository: { remoteUrl: 'https://ana@dev.azure.com/contoso/web/_git/site-fork', sshUrl: 'git@ssh.dev.azure.com:v3/contoso/web/site-fork' } }
      }
    })
    const target = await getPullRequest(azure, 'pat', AZURE_URL, 12)
    expect(calls[0]?.url).toBe(`${AZ}?api-version=7.1`)
    expect(target).toMatchObject({ pullRequest: { state: 'merged', body: 'Login page', sameRepo: false }, headSha: HEAD, forkUrl: 'https://dev.azure.com/contoso/web/_git/site-fork' })
  })
})

describe('viewerName', () => {
  it('is the login, except on Bitbucket and Azure DevOps, whose comments carry display names', async () => {
    const calls = mockFetch({
      'https://api.bitbucket.org/2.0/user': { username: 'sam', display_name: 'Sam Lee' },
      'https://dev.azure.com/contoso/_apis/connectionData': { authenticatedUser: { id: 'u-1', providerDisplayName: 'Ana Silva' } }
    })
    expect(await viewerName(github, 't', 'priya')).toBe('priya')
    expect(calls).toHaveLength(0)
    expect(await viewerName(bitbucket, 't', 'sam')).toBe('Sam Lee')
    expect(await viewerName(azure, 't', 'contoso')).toBe('Ana Silva')
    expect(calls[1]?.url).toBe('https://dev.azure.com/contoso/_apis/connectionData?api-version=7.1-preview.1')
  })
})

describe('listReviewComments', () => {
  it('GitHub: line comments page by page, general comments and review verdicts, oldest first', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: 1000 + i,
      user: { login: 'bot' },
      body: `note ${i}`,
      path: 'a.ts',
      line: i + 1,
      side: 'RIGHT',
      created_at: '2026-10-05T00:00:00Z'
    }))
    const calls = mockFetch({
      [`${GH}/pulls/7/comments`]: (call: Call) =>
        new Response(
          JSON.stringify(
            call.url.endsWith('page=1')
              ? many
              : [
                  { id: 1, user: { login: 'sam' }, body: 'Rename this', path: 'src/app.ts', line: 12, side: 'RIGHT', created_at: '2026-10-01T10:00:00Z' },
                  { id: 2, user: { login: 'priya' }, body: 'Done', path: 'src/app.ts', line: 12, side: 'RIGHT', in_reply_to_id: 1, created_at: '2026-10-01T11:00:00Z' },
                  { id: 3, user: { login: 'sam' }, body: 'Was here', path: 'src/old.ts', line: null, original_line: 4, side: 'LEFT', created_at: '2026-10-01T09:00:00Z' },
                  { id: 4, user: { login: 'sam' }, body: 'Whole file', path: 'src/x.ts', line: null, subject_type: 'file', created_at: '2026-10-01T12:00:00Z' }
                ]
          )
        ),
      [`${GH}/issues/7/comments`]: [{ id: 1, user: { login: 'ana' }, body: 'Thanks!', created_at: '2026-10-01T08:00:00Z' }],
      [`${GH}/pulls/7/reviews`]: [
        { id: 50, user: { login: 'sam' }, body: '', state: 'COMMENTED', submitted_at: '2026-10-01T10:00:00Z' },
        { id: 51, user: { login: 'sam' }, body: 'Needs tests', state: 'CHANGES_REQUESTED', submitted_at: '2026-10-01T10:30:00Z' },
        { id: 52, user: { login: 'ana' }, body: '', state: 'APPROVED', submitted_at: '2026-10-02T00:00:00Z' },
        { id: 53, user: { login: 'me' }, body: 'draft', state: 'PENDING' }
      ]
    })
    const comments = await listReviewComments(github, 't', 'https://github.com/acme/web.git', 7)
    expect(calls.map((c) => c.url)).toEqual([
      `${GH}/pulls/7/comments?per_page=100&page=1`,
      `${GH}/issues/7/comments?per_page=100&page=1`,
      `${GH}/pulls/7/reviews?per_page=100&page=1`,
      `${GH}/pulls/7/comments?per_page=100&page=2`
    ])
    expect(comments).toHaveLength(100 + 4 + 1 + 2)
    expect(comments.slice(0, 6)).toEqual([
      { id: 'issue-1', author: 'ana', body: 'Thanks!', createdAt: at('2026-10-01T08:00:00Z'), path: null, line: null, side: 'new' },
      { id: '3', author: 'sam', body: 'Was here', createdAt: at('2026-10-01T09:00:00Z'), path: 'src/old.ts', line: 4, side: 'old', outdated: true },
      { id: '1', author: 'sam', body: 'Rename this', createdAt: at('2026-10-01T10:00:00Z'), path: 'src/app.ts', line: 12, side: 'new' },
      {
        id: 'review-51',
        author: 'sam',
        body: 'Needs tests',
        createdAt: at('2026-10-01T10:30:00Z'),
        path: null,
        line: null,
        side: 'new',
        verdict: 'request-changes'
      },
      { id: '2', author: 'priya', body: 'Done', createdAt: at('2026-10-01T11:00:00Z'), path: 'src/app.ts', line: 12, side: 'new', inReplyTo: '1' },
      { id: '4', author: 'sam', body: 'Whole file', createdAt: at('2026-10-01T12:00:00Z'), path: 'src/x.ts', line: null, side: 'new' }
    ])
    expect(comments[6]).toMatchObject({ id: 'review-52', author: 'ana', body: '', verdict: 'approve' })
  })

  it('stops following pages at 300 comments', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: i, user: { login: 'bot' }, body: 'x', created_at: '2026-10-01T00:00:00Z' }))
    const calls = mockFetch({ [`${GH}/pulls/7/comments`]: [], [`${GH}/pulls/7/reviews`]: [], [`${GH}/issues/7/comments`]: () => new Response(JSON.stringify(page)) })
    expect(await listReviewComments(github, 't', 'https://github.com/acme/web.git', 7)).toHaveLength(300)
    expect(calls.filter((c) => c.url.includes('/issues/'))).toHaveLength(3)
  })

  it('Gitea: line comments from each submitted review, with the side they’re on', async () => {
    const calls = mockFetch({
      [`${GT}/pulls/3/reviews`]: [
        { id: 8, user: { login: 'sam' }, body: 'Looks good', state: 'APPROVED', comments_count: 2, submitted_at: '2026-10-01T12:00:00Z' },
        { id: 9, user: { login: 'ana' }, body: 'Blocked', state: 'REQUEST_CHANGES', dismissed: true, comments_count: 0, submitted_at: '2026-10-01T13:00:00Z' },
        { id: 10, user: { login: 'me' }, body: '', state: 'PENDING', comments_count: 1 }
      ],
      [`${GT}/pulls/3/reviews/8/comments`]: [
        { id: 81, user: { login: 'sam' }, body: 'Nice', path: 'a.go', position: 5, original_position: 0, created_at: '2026-10-01T11:00:00Z' },
        { id: 82, user: { login: 'sam' }, body: 'Why remove?', path: 'a.go', position: 0, original_position: 9, created_at: '2026-10-01T11:30:00Z' }
      ],
      [`${GT}/issues/3/comments`]: [{ id: 1, user: { login: 'ana' }, body: 'Ping', created_at: '2026-10-01T10:00:00Z' }]
    })
    const comments = await listReviewComments(gitea, 't', 'https://git.acme.dev/acme/web.git', 3)
    expect(calls.map((c) => c.url)).not.toContain(`${GT}/pulls/3/reviews/10/comments`)
    expect(comments.map((c) => [c.id, c.path, c.line, c.side, c.verdict])).toEqual([
      ['issue-1', null, null, 'new', undefined],
      ['81', 'a.go', 5, 'new', undefined],
      ['82', 'a.go', 9, 'old', undefined],
      ['review-8', null, null, 'new', 'approve'],
      ['review-9', null, null, 'new', undefined]
    ])
  })

  it('GitLab: diff notes, replies, outdated positions, approvals from system notes', async () => {
    const position = (head: string, lines: { new_line?: number; old_line?: number }) => ({ head_sha: head, old_path: 'app.rb', new_path: 'app.rb', ...lines })
    mockFetch({
      [GL]: { iid: 3, sha: HEAD, diff_refs: { head_sha: HEAD } },
      [`${GL}/discussions`]: [
        {
          id: 'd1',
          notes: [
            { id: 1, type: 'DiffNote', body: 'Off by one', author: { username: 'sam' }, created_at: '2026-10-01T10:00:00Z', position: position(HEAD, { new_line: 7 }) },
            { id: 2, type: 'DiffNote', body: 'Fixed', author: { username: 'priya' }, created_at: '2026-10-01T11:00:00Z', position: position(HEAD, { new_line: 7 }) }
          ]
        },
        { id: 'd2', notes: [{ id: 3, type: 'DiffNote', body: 'Gone', author: { username: 'sam' }, created_at: '2026-10-01T09:00:00Z', position: position('b'.repeat(40), { old_line: 3 }) }] },
        { id: 'd3', notes: [{ id: 4, type: null, system: true, body: 'approved this merge request', author: { username: 'ana' }, created_at: '2026-10-02T00:00:00Z' }] },
        { id: 'd4', notes: [{ id: 5, type: null, system: true, body: 'added 1 commit', author: { username: 'priya' }, created_at: '2026-10-01T12:00:00Z' }] },
        { id: 'd5', notes: [{ id: 6, type: null, body: '**Changes requested**\n\nAdd tests', author: { username: 'sam' }, created_at: '2026-10-01T13:00:00Z' }] }
      ]
    })
    const comments = await listReviewComments(gitlab, 't', 'git@gitlab.com:g/app.git', 3)
    expect(comments).toEqual([
      { id: '3', author: 'sam', body: 'Gone', createdAt: at('2026-10-01T09:00:00Z'), path: 'app.rb', line: 3, side: 'old', outdated: true },
      { id: '1', author: 'sam', body: 'Off by one', createdAt: at('2026-10-01T10:00:00Z'), path: 'app.rb', line: 7, side: 'new' },
      { id: '2', author: 'priya', body: 'Fixed', createdAt: at('2026-10-01T11:00:00Z'), path: 'app.rb', line: 7, side: 'new', inReplyTo: '1' },
      { id: '6', author: 'sam', body: 'Add tests', createdAt: at('2026-10-01T13:00:00Z'), path: null, line: null, side: 'new', verdict: 'request-changes' },
      { id: '4', author: 'ana', body: '', createdAt: at('2026-10-02T00:00:00Z'), path: null, line: null, side: 'new', verdict: 'approve' }
    ])
  })

  it('Bitbucket: follows next pages on the same API only, skips deleted and draft comments, reads verdicts from participants', async () => {
    const calls = mockFetch({
      [BB]: {
        participants: [
          { user: { uuid: '{a}', display_name: 'Ana' }, state: 'approved', approved: true, participated_on: '2026-10-03T00:00:00Z' },
          { user: { uuid: '{s}', display_name: 'Sam' }, state: 'changes_requested', approved: false, participated_on: '2026-10-02T00:00:00Z' },
          { user: { uuid: '{p}', display_name: 'Priya' }, state: null, approved: false }
        ]
      },
      [`${BB}/comments?pagelen=100`]: {
        values: [
          { id: 1, user: { display_name: 'Sam' }, content: { raw: 'Inline' }, inline: { path: 'api.py', to: 4, from: null }, created_on: '2026-10-01T10:00:00Z' },
          { id: 2, user: { display_name: 'Sam' }, content: { raw: 'gone' }, deleted: true, created_on: '2026-10-01T10:01:00Z' }
        ],
        next: `${BB}/comments?pagelen=100&page=2`
      },
      [`${BB}/comments?pagelen=100&page=2`]: {
        values: [
          { id: 3, user: { display_name: 'Priya' }, content: { raw: 'Old side' }, inline: { path: 'api.py', from: 8, outdated: true }, parent: { id: 1 }, created_on: '2026-10-01T11:00:00Z' },
          { id: 4, user: { display_name: 'Priya' }, content: { raw: 'draft' }, pending: true, created_on: '2026-10-01T11:05:00Z' }
        ],
        next: 'https://evil.example/steal'
      }
    })
    const comments = await listReviewComments(bitbucket, 't', 'git@bitbucket.org:team/api.git', 4)
    expect(calls.some((c) => c.url.startsWith('https://evil.example'))).toBe(false)
    expect(comments).toEqual([
      { id: '1', author: 'Sam', body: 'Inline', createdAt: at('2026-10-01T10:00:00Z'), path: 'api.py', line: 4, side: 'new' },
      { id: '3', author: 'Priya', body: 'Old side', createdAt: at('2026-10-01T11:00:00Z'), path: 'api.py', line: 8, side: 'old', outdated: true, inReplyTo: '1' },
      { id: 'verdict-{s}', author: 'Sam', body: '', createdAt: at('2026-10-02T00:00:00Z'), path: null, line: null, side: 'new', verdict: 'request-changes' },
      { id: 'verdict-{a}', author: 'Ana', body: '', createdAt: at('2026-10-03T00:00:00Z'), path: null, line: null, side: 'new', verdict: 'approve' }
    ])
  })

  it('Azure DevOps: threads on lines, replies, votes, and no system messages', async () => {
    const calls = mockFetch({
      [`${AZ}/threads`]: {
        value: [
          {
            id: 20,
            threadContext: { filePath: '/src/login.ts', rightFileStart: { line: 14, offset: 1 }, rightFileEnd: { line: 14, offset: 1 } },
            comments: [
              { id: 1, parentCommentId: 0, author: { displayName: 'Ana' }, content: 'Typo', publishedDate: '2026-10-01T10:00:00Z', commentType: 'text' },
              { id: 2, parentCommentId: 1, author: { displayName: 'Sam' }, content: 'Fixed', publishedDate: '2026-10-01T11:00:00Z', commentType: 'text' }
            ]
          },
          {
            id: 21,
            threadContext: { filePath: '/src/old.ts', leftFileStart: { line: 3, offset: 1 } },
            comments: [{ id: 1, parentCommentId: 0, author: { displayName: 'Ana' }, content: 'Keep this', publishedDate: '2026-10-01T09:00:00Z' }]
          },
          { id: 22, comments: [{ id: 1, author: { displayName: 'Ana' }, content: 'Ana joined', commentType: 'system', publishedDate: '2026-10-01T08:00:00Z' }] },
          {
            id: 23,
            publishedDate: '2026-10-02T00:00:00Z',
            properties: {
              CodeReviewThreadType: { $value: 'VoteUpdate' },
              CodeReviewVoteResult: { $value: '-10' },
              CodeReviewVotedByIdentity: { $value: '1' }
            },
            identities: { 1: { displayName: 'Ana' } },
            comments: [{ id: 1, author: { displayName: 'Ana' }, content: 'Ana voted -10', commentType: 'system' }]
          },
          { id: 24, isDeleted: true, comments: [{ id: 1, content: 'deleted', publishedDate: '2026-10-01T08:00:00Z' }] }
        ]
      }
    })
    const comments = await listReviewComments(azure, 'pat', AZURE_URL, 12)
    expect(calls[0]?.url).toBe(`${AZ}/threads?api-version=7.1`)
    expect(comments).toEqual([
      { id: '21/1', author: 'Ana', body: 'Keep this', createdAt: at('2026-10-01T09:00:00Z'), path: 'src/old.ts', line: 3, side: 'old' },
      { id: '20/1', author: 'Ana', body: 'Typo', createdAt: at('2026-10-01T10:00:00Z'), path: 'src/login.ts', line: 14, side: 'new' },
      { id: '20/2', author: 'Sam', body: 'Fixed', createdAt: at('2026-10-01T11:00:00Z'), path: 'src/login.ts', line: 14, side: 'new', inReplyTo: '20/1' },
      { id: '23', author: 'Ana', body: '', createdAt: at('2026-10-02T00:00:00Z'), path: null, line: null, side: 'new', verdict: 'request-changes' }
    ])
  })
})

describe('checkReview', () => {
  const line = { path: 'src/a.ts', line: 3, side: 'new' as const, body: 'Hm' }

  it('refuses a review that says nothing, and requests for changes without a reason', () => {
    expect(() => checkReview(review())).toThrow('There’s nothing to send yet: write a summary or comment on a line')
    expect(() => checkReview(review({ body: '  \n' }))).toThrow(/nothing to send/)
    expect(() => checkReview(review({ verdict: 'request-changes' }))).toThrow('Say what needs changing: write a summary or comment on a line')
    expect(checkReview(review({ verdict: 'approve' }))).toEqual(review({ verdict: 'approve' }))
    expect(checkReview(review({ comments: [line] })).comments).toHaveLength(1)
  })

  it('needs text in each comment, a positive whole line number and a path inside the repository', () => {
    expect(() => checkReview(review({ comments: [{ ...line, body: ' ' }] }))).toThrow('Your comment on line 3 of src/a.ts is empty. Write something or remove it.')
    expect(() => checkReview(review({ comments: [{ ...line, line: 0 }] }))).toThrow(/0 isn’t a line number/)
    expect(() => checkReview(review({ comments: [{ ...line, line: 2.5 }] }))).toThrow(/isn’t a line number/)
    for (const path of ['../secret', 'a/../../b', '/etc/passwd', 'C:/x.txt', '\\\\server\\share', '', 'a//b']) {
      expect(() => checkReview(review({ comments: [{ ...line, path }] }))).toThrow(/isn’t a path inside the repository/)
    }
  })

  it('makes no request for a review it refuses', async () => {
    const calls = mockFetch({})
    await expect(postReview(github, 't', 'https://github.com/acme/web.git', 7, HEAD, review())).rejects.toThrow(/nothing to send/)
    expect(calls).toHaveLength(0)
  })
})

describe('postReview', () => {
  const comments = [
    { path: 'src/app.ts', line: 12, side: 'new' as const, body: 'Rename this' },
    { path: 'src/old.ts', line: 4, side: 'old' as const, body: 'Keep this' }
  ]

  it('GitHub: one review pinned to the reviewed commit, with each verdict', async () => {
    const calls = mockFetch({ [`POST ${GH}/pulls/7/reviews`]: { id: 1 } })
    await postReview(github, 't', 'https://github.com/acme/web.git', 7, HEAD, review({ verdict: 'request-changes', body: 'Needs tests', comments }))
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${GH}/pulls/7/reviews`,
      body: {
        commit_id: HEAD,
        event: 'REQUEST_CHANGES',
        body: 'Needs tests',
        comments: [
          { path: 'src/app.ts', line: 12, side: 'RIGHT', body: 'Rename this' },
          { path: 'src/old.ts', line: 4, side: 'LEFT', body: 'Keep this' }
        ]
      }
    })
    expect(calls[0]?.headers['Content-Type']).toBe('application/json')
    await postReview(github, 't', 'https://github.com/acme/web.git', 7, HEAD, review({ verdict: 'approve' }))
    expect(calls[1]?.body).toEqual({ commit_id: HEAD, event: 'APPROVE', body: '' })
    await postReview(github, 't', 'https://github.com/acme/web.git', 7, HEAD, review({ body: 'Nice' }))
    expect(calls[2]?.body).toMatchObject({ event: 'COMMENT', body: 'Nice' })
  })

  it('GitHub: explains approving your own pull request and comments off the diff', async () => {
    const url = 'https://github.com/acme/web.git'
    mockFetch({ [`${GH}/pulls/7/reviews`]: refuse(422, { message: 'Unprocessable Entity', errors: ['Review Can not approve your own pull request'] }) })
    await expect(postReview(github, 't', url, 7, HEAD, review({ verdict: 'approve' }))).rejects.toThrow(
      'You can’t approve your own pull request. Submit your review as a comment instead.'
    )
    mockFetch({ [`${GH}/pulls/7/reviews`]: refuse(422, { message: 'Unprocessable Entity', errors: ['Review Can not request changes on your own pull request'] }) })
    await expect(postReview(github, 't', url, 7, HEAD, review({ verdict: 'request-changes', body: 'x' }))).rejects.toThrow(/can’t request changes on your own/)
    mockFetch({ [`${GH}/pulls/7/reviews`]: refuse(422, { message: 'Unprocessable Entity', errors: ['Line could not be resolved'] }) })
    await expect(postReview(github, 't', url, 7, HEAD, review({ comments }))).rejects.toThrow(/isn’t part of the pull request’s changes/)
    mockFetch({ [`${GH}/pulls/7/reviews`]: refuse(422, { message: 'Validation Failed', errors: [{ message: 'Something else' }] }) })
    await expect(postReview(github, 't', url, 7, HEAD, review({ body: 'x' }))).rejects.toThrow('The service answered 422 Refused. Something else')
  })

  it('Gitea: APPROVED / REQUEST_CHANGES / COMMENT events, with lines as new or old positions', async () => {
    const calls = mockFetch({ [`POST ${GT}/pulls/3/reviews`]: { id: 1 } })
    await postReview(gitea, 't', 'https://git.acme.dev/acme/web.git', 3, HEAD, review({ verdict: 'approve', body: 'LGTM', comments }))
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${GT}/pulls/3/reviews`,
      body: {
        event: 'APPROVED',
        body: 'LGTM',
        commit_id: HEAD,
        comments: [
          { path: 'src/app.ts', body: 'Rename this', new_position: 12 },
          { path: 'src/old.ts', body: 'Keep this', old_position: 4 }
        ]
      }
    })
    await postReview(gitea, 't', 'https://git.acme.dev/acme/web.git', 3, HEAD, review({ verdict: 'request-changes', body: 'No' }))
    expect(calls[1]?.body).toMatchObject({ event: 'REQUEST_CHANGES' })
    mockFetch({ [`${GT}/pulls/3/reviews`]: refuse(422, { message: 'approve your own pull is not allowed' }) })
    await expect(postReview(gitea, 't', 'https://git.acme.dev/acme/web.git', 3, HEAD, review({ verdict: 'approve' }))).rejects.toThrow(
      /can’t approve your own pull request/
    )
  })

  it('GitLab: discussions on the reviewed diff version, the summary as a note, then an approval pinned to the commit', async () => {
    const refs = { base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40), head_sha: HEAD }
    const calls = mockFetch({ [`GET ${GL}`]: { iid: 3, diff_refs: refs }, [`POST ${GL}`]: { id: 1 } })
    const located: TextPosition[] = [
      { oldPath: 'src/app.ts', newPath: 'src/app.ts', oldLine: 10, newLine: 12 },
      { oldPath: 'src/was.ts', newPath: 'src/old.ts', oldLine: 4, newLine: null }
    ]
    const locate = vi.fn(async () => located)
    await postReview(gitlab, 't', 'git@gitlab.com:g/app.git', 3, HEAD, review({ verdict: 'approve', body: 'Ship it', comments }), locate)
    expect(locate).toHaveBeenCalledWith(refs.base_sha, comments)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${GL}`,
      `POST ${GL}/discussions`,
      `POST ${GL}/discussions`,
      `POST ${GL}/notes`,
      `POST ${GL}/approve`
    ])
    const position = { position_type: 'text', base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: HEAD }
    expect(calls[1]?.body).toEqual({ body: 'Rename this', position: { ...position, old_path: 'src/app.ts', new_path: 'src/app.ts', old_line: 10, new_line: 12 } })
    expect(calls[2]?.body).toEqual({ body: 'Keep this', position: { ...position, old_path: 'src/was.ts', new_path: 'src/old.ts', old_line: 4 } })
    expect(calls[3]?.body).toEqual({ body: 'Ship it' })
    expect(calls[4]?.body).toEqual({ sha: HEAD })
  })

  it('GitLab: anchors comments to an older diff version when commits were pushed since, and refuses an unknown one', async () => {
    const newer = 'e'.repeat(40)
    const calls = mockFetch({
      [`GET ${GL}`]: { iid: 3, diff_refs: { base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40), head_sha: newer } },
      [`GET ${GL}/versions`]: [
        { id: 2, head_commit_sha: newer, base_commit_sha: 'b'.repeat(40), start_commit_sha: 'c'.repeat(40) },
        { id: 1, head_commit_sha: HEAD, base_commit_sha: '1'.repeat(40), start_commit_sha: '2'.repeat(40) }
      ],
      [`POST ${GL}`]: { id: 1 }
    })
    await postReview(gitlab, 't', 'git@gitlab.com:g/app.git', 3, HEAD, review({ comments: [comments[0]!] }))
    expect(calls[1]?.url).toBe(`${GL}/versions?per_page=100`)
    expect(calls[2]?.body).toMatchObject({
      position: { base_sha: '1'.repeat(40), start_sha: '2'.repeat(40), head_sha: HEAD, old_path: 'src/app.ts', new_path: 'src/app.ts', new_line: 12 }
    })
    await expect(postReview(gitlab, 't', 'git@gitlab.com:g/app.git', 3, 'f'.repeat(40), review({ comments: [comments[0]!] }))).rejects.toThrow(
      '!3 has changed since you opened it. Reload it, then submit your review again.'
    )
  })

  it('GitLab: a request for changes is a marked note, and withdraws an earlier approval if there is one', async () => {
    const calls = mockFetch({ [`POST ${GL}/notes`]: { id: 1 }, [`POST ${GL}/unapprove`]: refuse(404, { message: '404 Not found' }) })
    await postReview(gitlab, 't', 'git@gitlab.com:g/app.git', 3, HEAD, review({ verdict: 'request-changes', body: 'Add tests' }))
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${GL}/notes`, `POST ${GL}/unapprove`])
    expect(calls[0]?.body).toEqual({ body: '**Changes requested**\n\nAdd tests' })
    expect(calls[1]?.body).toBeUndefined()
  })

  it('GitLab: explains a refused approval', async () => {
    mockFetch({ [`POST ${GL}/approve`]: refuse(401, { message: '401 Unauthorized' }) })
    await expect(postReview(gitlab, 't', 'git@gitlab.com:g/app.git', 3, HEAD, review({ verdict: 'approve' }))).rejects.toThrow(/GitLab didn’t let you approve !3/)
    mockFetch({ [`POST ${GL}/approve`]: refuse(409, { message: 'SHA does not match HEAD of source branch' }) })
    await expect(postReview(gitlab, 't', 'git@gitlab.com:g/app.git', 3, HEAD, review({ verdict: 'approve' }))).rejects.toThrow(
      /New commits were pushed to !3/
    )
  })

  it('Bitbucket: inline comments, the summary, then approve or request changes', async () => {
    const calls = mockFetch({ [`GET ${BB}`]: { id: 4, source: { commit: { hash: HEAD.slice(0, 12) } } }, [`POST ${BB}`]: { id: 1 } })
    await postReview(bitbucket, 't', 'git@bitbucket.org:team/api.git', 4, HEAD, review({ verdict: 'approve', body: 'Good', comments }))
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${BB}`,
      `POST ${BB}/comments`,
      `POST ${BB}/comments`,
      `POST ${BB}/comments`,
      `POST ${BB}/approve`
    ])
    expect(calls[1]?.body).toEqual({ content: { raw: 'Rename this' }, inline: { path: 'src/app.ts', to: 12 } })
    expect(calls[2]?.body).toEqual({ content: { raw: 'Keep this' }, inline: { path: 'src/old.ts', from: 4 } })
    expect(calls[3]?.body).toEqual({ content: { raw: 'Good' } })
    expect(calls[4]?.body).toBeUndefined()
    expect(calls[0]?.headers.Authorization).toBe(`Basic ${Buffer.from('me@x.dev:t').toString('base64')}`)
    await postReview(bitbucket, 't', 'git@bitbucket.org:team/api.git', 4, HEAD, review({ verdict: 'request-changes', comments: [comments[0]!] }))
    expect(calls.slice(5).map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${BB}`, `POST ${BB}/comments`, `POST ${BB}/request-changes`])
  })

  it('Bitbucket: refuses when the pull request moved on, explains your own approval, and says what was already sent', async () => {
    mockFetch({ [`GET ${BB}`]: { source: { commit: { hash: 'ffffffffffff' } } } })
    await expect(postReview(bitbucket, 't', 'git@bitbucket.org:team/api.git', 4, HEAD, review({ verdict: 'approve' }))).rejects.toThrow(
      'New commits were pushed to #4 since you opened it. Reload it, then submit your review again.'
    )
    mockFetch({
      [`GET ${BB}`]: { source: { commit: { hash: HEAD.slice(0, 12) } } },
      [`POST ${BB}/approve`]: refuse(400, { type: 'error', error: { message: 'You can\'t approve your own pull request.' } })
    })
    await expect(postReview(bitbucket, 't', 'git@bitbucket.org:team/api.git', 4, HEAD, review({ verdict: 'approve' }))).rejects.toThrow(
      'You can’t approve your own pull request. Submit your review as a comment instead.'
    )
    let posted = 0
    mockFetch({
      [`GET ${BB}`]: { source: { commit: { hash: HEAD.slice(0, 12) } } },
      [`POST ${BB}/comments`]: () => (++posted === 2 ? refuse(500, { error: { message: 'Try again later' } })() : new Response('{}'))
    })
    await expect(postReview(bitbucket, 't', 'git@bitbucket.org:team/api.git', 4, HEAD, review({ comments }))).rejects.toThrow(
      'Only part of your review was sent (1 of 2 comments). The service answered 500 Refused. Try again later'
    )
  })

  it('Azure DevOps: a thread per comment, the summary as a thread, and the account’s vote', async () => {
    const calls = mockFetch({
      [`GET ${AZ}`]: { pullRequestId: 12, lastMergeSourceCommit: { commitId: HEAD } },
      'https://dev.azure.com/contoso/_apis/connectionData': { authenticatedUser: { id: 'user-1', providerDisplayName: 'Ana' } },
      [`POST ${AZ}/threads`]: { id: 1 },
      [`PUT ${AZ}/reviewers`]: { vote: 10 }
    })
    await postReview(azure, 'pat', AZURE_URL, 12, HEAD, review({ verdict: 'approve', body: 'Looks right', comments }))
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${AZ}?api-version=7.1`,
      'GET https://dev.azure.com/contoso/_apis/connectionData?api-version=7.1-preview.1',
      `POST ${AZ}/threads?api-version=7.1`,
      `POST ${AZ}/threads?api-version=7.1`,
      `POST ${AZ}/threads?api-version=7.1`,
      `PUT ${AZ}/reviewers/user-1?api-version=7.1`
    ])
    const comment = (content: string) => [{ parentCommentId: 0, content, commentType: 1 }]
    expect(calls[2]?.body).toEqual({
      comments: comment('Rename this'),
      status: 1,
      threadContext: { filePath: '/src/app.ts', rightFileStart: { line: 12, offset: 1 }, rightFileEnd: { line: 12, offset: 1 } }
    })
    expect(calls[3]?.body).toEqual({
      comments: comment('Keep this'),
      status: 1,
      threadContext: { filePath: '/src/old.ts', leftFileStart: { line: 4, offset: 1 }, leftFileEnd: { line: 4, offset: 1 } }
    })
    expect(calls[4]?.body).toEqual({ comments: comment('Looks right'), status: 1 })
    expect(calls[5]?.body).toEqual({ vote: 10 })

    await postReview(azure, 'pat', AZURE_URL, 12, HEAD, review({ verdict: 'request-changes', body: 'Not yet' }))
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { vote: -10 } })
    const before = calls.length
    await postReview(azure, 'pat', AZURE_URL, 12, HEAD, review({ body: 'Just a note' }))
    expect(calls.slice(before).map((c) => c.method)).toEqual(['GET', 'POST'])
  })
})
