import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AccountStore } from '../src/main/accounts/store'
import { comments, detail, submitReview } from '../src/main/pullRequests'
import type { Account } from '../src/shared/types'
import { commitAt, git, isolateGit, write } from './helpers'

// The repository's origin is a local bare repository, but the service has to see the address an
// account is for. Only `remotes` is changed, and only for the pull request code that asks for it.
const service = vi.hoisted(() => ({ url: '' }))
vi.mock('../src/main/git/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/git/commands')>()
  return {
    ...actual,
    remotes: async (repo: string) => (await actual.remotes(repo)).map((r) => ({ ...r, fetchUrl: service.url, pushUrl: service.url }))
  }
})

beforeAll(async () => {
  isolateGit()
  template = await build()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Call {
  method: string
  url: string
  body: unknown
}

/** Answer API requests from `routes` ("METHOD https://…" or an address prefix; the longest match wins). */
function mockApi(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method: string; body?: string }) => {
      calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined })
      const match = Object.entries(routes)
        .map(([key, body]) => ({ parts: key.includes(' ') ? key.split(' ') : ['', key], body }))
        .filter(({ parts: [method, prefix] }) => (!method || method === init.method) && url.startsWith(prefix ?? ''))
        .sort((a, b) => (b.parts[1] ?? '').length - (a.parts[1] ?? '').length)[0]
      return new Response(JSON.stringify(match?.body ?? {}))
    })
  )
  return calls
}

function accountsFor(account: Account): AccountStore {
  const store = {
    findByUrl: (url: string) => (url.includes(account.host) ? account : undefined),
    freshToken: async () => 'token'
  }
  return store as unknown as AccountStore
}

const github: Account = { id: 'gh', provider: 'github', host: 'github.com', login: 'priya', gitUsername: 'priya' }
const gitlab: Account = { id: 'gl', provider: 'gitlab', host: 'gitlab.com', login: 'priya', gitUsername: 'priya' }
const bitbucket: Account = { id: 'bb', provider: 'bitbucket', host: 'bitbucket.org', login: 'priya', gitUsername: 'x', email: 'p@x.dev' }
const azure: Account = { id: 'az', provider: 'azure', host: 'dev.azure.com', login: 'contoso', gitUsername: 'pat', organization: 'contoso' }

const tempDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const numbered = (from: number, to: number): string => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\n`).join('')
const sha = async (repo: string, revision: string): Promise<string> => (await git(repo, 'rev-parse', revision)).trim()

interface Fixture {
  root: string
  bare: string
  author: string
  work: string
  first: string
  feature: string
  main: string
}

/**
 * A bare "server" repository with main and feature branches that have moved apart since `first`,
 * an author's clone that pushes to it, and a reviewer's clone (`work`) of main and feature.
 */
async function build(): Promise<Fixture> {
  const root = tempDir('gitlantern-review-')
  const [bare, author] = [path.join(root, 'bare'), path.join(root, 'author')]
  fs.mkdirSync(bare)
  fs.mkdirSync(author)
  await git(bare, 'init', '-q', '--bare', '-b', 'main')
  await git(author, 'init', '-q', '-b', 'main')
  await git(author, 'remote', 'add', 'origin', bare)
  write(author, 'app.txt', numbered(1, 10))
  write(author, 'notes.txt', numbered(1, 8))
  await commitAt(author, 'first', 1_700_000_000)
  const first = await sha(author, 'HEAD')

  // feature: two lines inserted after line 3, line 9 removed, notes.txt renamed with a line added.
  await git(author, 'switch', '-q', '-c', 'feature')
  write(author, 'app.txt', numbered(1, 3) + 'new A\nnew B\n' + numbered(4, 8) + numbered(10, 10))
  fs.rmSync(path.join(author, 'notes.txt'))
  write(author, 'docs/notes.txt', numbered(1, 8) + 'line 9\n')
  await commitAt(author, 'feature work', 1_700_000_100)
  const feature = await sha(author, 'HEAD')

  await git(author, 'switch', '-q', 'main')
  write(author, 'main.txt', 'main moved on\n')
  await commitAt(author, 'main work', 1_700_000_200)
  const main = await sha(author, 'HEAD')
  await git(author, 'push', '-q', 'origin', 'main', 'feature')
  await git(root, 'clone', '-q', bare, 'work')
  return { root, bare, author, work: path.join(root, 'work'), first, feature, main }
}

let template: Fixture

/** A copy of the fixture for one test, which may change it freely (copying is much quicker than building). */
async function fixture(): Promise<Fixture> {
  const root = tempDir('gitlantern-review-')
  fs.cpSync(template.root, root, { recursive: true })
  const copy = { ...template, root, bare: path.join(root, 'bare'), author: path.join(root, 'author'), work: path.join(root, 'work') }
  await git(copy.author, 'remote', 'set-url', 'origin', copy.bare)
  await git(copy.work, 'remote', 'set-url', 'origin', copy.bare)
  return copy
}

/** A commit only on the server under `ref`, the way a service keeps a fork's pull request. */
async function pushPullRef(author: string, ref: string, file: string): Promise<string> {
  await git(author, 'switch', '-q', '--detach', 'main')
  write(author, file, 'from a fork\n')
  await commitAt(author, `fork: ${file}`, 1_700_000_300)
  await git(author, 'push', '-q', 'origin', `HEAD:${ref}`)
  return sha(author, 'HEAD')
}

const githubPull = (number: number, head: { ref: string; sha: string; repo: string }) => ({
  number,
  title: 'Faster builds',
  body: 'Caches the dependencies',
  state: 'open',
  draft: false,
  user: { login: 'sam' },
  head: { ref: head.ref, sha: head.sha, repo: { full_name: head.repo } },
  base: { ref: 'main', repo: { full_name: 'acme/web' } },
  html_url: `https://github.com/acme/web/pull/${number}`
})

const GH = 'https://api.github.com/repos/acme/web'

/** Refs that `git log --all` would show. */
const allRefs = async (repo: string): Promise<string[]> => (await git(repo, 'for-each-ref', '--format=%(refname)')).split('\n').filter(Boolean)

describe('reviewing a pull request', () => {
  it('fetches a same-repository pull request’s branch and the target, and diffs from their merge base', async () => {
    const { work, first, feature, main } = await fixture()
    service.url = 'https://github.com/acme/web.git'
    const calls = mockApi({ [`${GH}/pulls/7`]: githubPull(7, { ref: 'feature', sha: feature, repo: 'acme/web' }) })
    const before = await allRefs(work)

    const pr = await detail(work, accountsFor(github), 7)
    expect(calls.map((c) => c.url)).toEqual([`${GH}/pulls/7`])
    expect(pr).toMatchObject({
      number: 7,
      title: 'Faster builds',
      body: 'Caches the dependencies',
      state: 'open',
      author: 'sam',
      sourceBranch: 'feature',
      targetBranch: 'main',
      sameRepo: true,
      viewer: 'priya',
      head: feature,
      base: first
    })
    expect(await sha(work, 'refs/remotes/origin/main')).toBe(main)
    expect(await allRefs(work)).toEqual(before)
  })

  it('fetches a fork’s commits from the pull ref without adding any ref', async () => {
    const { work, author, first } = await fixture()
    const forked = await pushPullRef(author, 'refs/pull/8/head', 'fork.txt')
    service.url = 'https://github.com/acme/web.git'
    mockApi({ [`${GH}/pulls/8`]: githubPull(8, { ref: 'patch-1', sha: forked, repo: 'sam/web' }) })
    const before = await allRefs(work)

    const pr = await detail(work, accountsFor(github), 8)
    expect(pr).toMatchObject({ sameRepo: false, head: forked, base: (await sha(work, 'origin/main')).trim() })
    expect(pr.base).not.toBe(first)
    expect(await allRefs(work)).toEqual(before)
    expect(await git(work, 'rev-list', '--all')).not.toContain(forked)
    expect(await sha(work, 'FETCH_HEAD')).toBe(forked)
  })

  it('takes the fetched head when it’s newer than the service said, and the pull ref when the branch went elsewhere', async () => {
    const { work, author, first, feature } = await fixture()
    service.url = 'https://github.com/acme/web.git'

    // Pushed since the service answered: the fetched commit descends from the reported one, and wins.
    await git(author, 'switch', '-q', 'feature')
    write(author, 'later.txt', 'later\n')
    await commitAt(author, 'later', 1_700_000_400)
    await git(author, 'push', '-q', 'origin', 'feature')
    const later = await sha(author, 'HEAD')
    mockApi({ [`${GH}/pulls/7`]: githubPull(7, { ref: 'feature', sha: feature, repo: 'acme/web' }) })
    expect((await detail(work, accountsFor(github), 7)).head).toBe(later)

    // The branch was reset to unrelated work after the pull request: its pull ref still has the reported head.
    await git(author, 'push', '-q', 'origin', `${feature}:refs/pull/7/head`)
    await git(author, 'push', '-q', '--force', 'origin', `${first}:refs/heads/feature`)
    expect((await detail(work, accountsFor(github), 7)).head).toBe(feature)

    // The branch is gone: the pull ref again.
    await git(author, 'push', '-q', 'origin', '--delete', 'feature')
    expect((await detail(work, accountsFor(github), 7)).head).toBe(feature)
  })

  it('refuses a pull request with no history in common with its target', async () => {
    const { work, author } = await fixture()
    await git(author, 'switch', '-q', '--orphan', 'unrelated')
    write(author, 'other.txt', 'nothing shared\n')
    await commitAt(author, 'unrelated', 1_700_000_500)
    await git(author, 'push', '-q', 'origin', 'unrelated')
    service.url = 'https://github.com/acme/web.git'
    mockApi({ [`${GH}/pulls/9`]: githubPull(9, { ref: 'unrelated', sha: await sha(author, 'HEAD'), repo: 'acme/web' }) })
    await expect(detail(work, accountsFor(github), 9)).rejects.toThrow('#9 has no history in common with main, so there’s nothing to compare')
  })

  it('Bitbucket: fetches a fork’s branch from the fork itself; Azure DevOps without a fork address explains', async () => {
    const { work, author, first } = await fixture()
    const fork = tempDir('gitlantern-fork-')
    await git(fork, 'init', '-q', '--bare', '-b', 'main')
    await git(author, 'switch', '-q', '-c', 'fix', first)
    write(author, 'fix.txt', 'fixed\n')
    await commitAt(author, 'fix', 1_700_000_600)
    await git(author, 'push', '-q', fork, 'fix')
    const fixed = await sha(author, 'HEAD')
    // The fork's address as Bitbucket would give it, served by the local fork instead.
    await git(work, 'config', `url.${fork.replace(/\\/g, '/')}.insteadOf`, 'https://bitbucket.org/sam/api.git')

    service.url = 'https://bitbucket.org/team/api.git'
    mockApi({
      'https://api.bitbucket.org/2.0/repositories/team/api/pullrequests/4': {
        id: 4,
        state: 'OPEN',
        source: { branch: { name: 'fix' }, commit: { hash: fixed.slice(0, 12) }, repository: { full_name: 'sam/api' } },
        destination: { branch: { name: 'main' }, repository: { full_name: 'team/api' } }
      },
      'https://api.bitbucket.org/2.0/user': { display_name: 'Priya S' }
    })
    const before = await allRefs(work)
    const pr = await detail(work, accountsFor(bitbucket), 4)
    expect(pr).toMatchObject({ sameRepo: false, head: fixed, base: first, viewer: 'Priya S' })
    expect(await allRefs(work)).toEqual(before)

    service.url = 'https://dev.azure.com/contoso/web/_git/site'
    mockApi({
      'https://dev.azure.com/contoso/web/_apis/git/repositories/site/pullrequests/5': {
        pullRequestId: 5,
        sourceRefName: 'refs/heads/fix',
        targetRefName: 'refs/heads/main',
        forkSource: { name: 'refs/heads/fix' }
      },
      'https://dev.azure.com/contoso/_apis/connectionData': { authenticatedUser: { id: 'u', providerDisplayName: 'Ana' } }
    })
    await expect(detail(work, accountsFor(azure), 5)).rejects.toThrow(
      '#5 comes from a fork, and Azure DevOps doesn’t keep a fork’s commits in this repository. To review it, add the fork as a remote and fetch its branch.'
    )
  })

  it('reads the comments through the repository’s account', async () => {
    const { work } = await fixture()
    service.url = 'https://github.com/acme/web.git'
    mockApi({
      [`${GH}/pulls/7/comments`]: [{ id: 1, user: { login: 'sam' }, body: 'Hm', path: 'app.txt', line: 2, side: 'RIGHT', created_at: '2026-10-01T00:00:00Z' }],
      [`${GH}/issues/7/comments`]: [],
      [`${GH}/pulls/7/reviews`]: []
    })
    expect(await comments(work, accountsFor(github), 7)).toEqual([
      { id: '1', author: 'sam', body: 'Hm', createdAt: Date.parse('2026-10-01T00:00:00Z'), path: 'app.txt', line: 2, side: 'new' }
    ])
  })

  it('GitLab: gives each line comment both line numbers where the line is unchanged, and a renamed file’s old name', async () => {
    const { work, first, feature, main } = await fixture()
    service.url = 'https://gitlab.com/g/app.git'
    const MR = 'https://gitlab.com/api/v4/projects/g%2Fapp/merge_requests/3'
    const calls = mockApi({
      [`GET ${MR}`]: {
        iid: 3,
        state: 'opened',
        source_branch: 'feature',
        target_branch: 'main',
        source_project_id: 1,
        target_project_id: 1,
        sha: feature,
        diff_refs: { base_sha: first, start_sha: main, head_sha: feature }
      },
      [`POST ${MR}`]: { id: 1 }
    })
    const pr = await detail(work, accountsFor(gitlab), 3)
    expect(pr).toMatchObject({ head: feature, base: first })

    const at = (path: string, line: number, side: 'old' | 'new') => ({ path, line, side, body: `${side} ${line}` })
    await submitReview(work, accountsFor(gitlab), 3, pr.head, {
      verdict: 'comment',
      body: '',
      comments: [at('app.txt', 2, 'new'), at('app.txt', 4, 'new'), at('app.txt', 8, 'new'), at('app.txt', 9, 'old'), at('app.txt', 10, 'old'), at('docs/notes.txt', 9, 'new'), at('docs/notes.txt', 3, 'new')]
    })
    const positions = calls
      .filter((c) => c.url === `${MR}/discussions`)
      .map((c) => {
        const { old_path, new_path, old_line, new_line } = (c.body as { position: Record<string, unknown> }).position
        return [old_path, new_path, old_line ?? null, new_line ?? null]
      })
    expect(positions).toEqual([
      ['app.txt', 'app.txt', 2, 2], // before the inserted lines
      ['app.txt', 'app.txt', null, 4], // inserted
      ['app.txt', 'app.txt', 6, 8], // shifted down by the insertion
      ['app.txt', 'app.txt', 9, null], // removed
      ['app.txt', 'app.txt', 10, 11], // after both
      ['notes.txt', 'docs/notes.txt', null, 9], // added to the renamed file
      ['notes.txt', 'docs/notes.txt', 3, 3]
    ])
    expect(calls.every((c) => !c.url.endsWith('/notes'))).toBe(true)
  })

  it('refuses a head that isn’t a commit hash before asking the service anything', async () => {
    const { work } = await fixture()
    service.url = 'https://github.com/acme/web.git'
    const calls = mockApi({})
    await expect(
      submitReview(work, accountsFor(github), 7, '--upload-pack=evil', { verdict: 'approve', body: '', comments: [] })
    ).rejects.toThrow(/Invalid commit hash/)
    await expect(
      submitReview(work, accountsFor(github), 7, 'a'.repeat(40), { verdict: 'comment', body: '', comments: [] })
    ).rejects.toThrow(/nothing to send/)
    expect(calls).toHaveLength(0)
  })
})
