import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPullRequest, listPullRequests, listRepos, repoApi, verifyAccount } from './providerApi'

function mockFetch(routes: Record<string, unknown>, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers })
      const body = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1]
      return new Response(JSON.stringify(body ?? {}), { status, statusText: status === 200 ? 'OK' : 'Error' })
    })
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyAccount', () => {
  it('GitHub: bearer token against api.github.com, Enterprise under /api/v3', async () => {
    const calls = mockFetch({ 'https://api.github.com/user': { login: 'priya-s' }, 'https://ghe.acme.dev/api/v3/user': { login: 'p' } })
    expect(await verifyAccount({ provider: 'github', host: 'github.com' }, 'tok')).toEqual({ login: 'priya-s', gitUsername: 'priya-s' })
    expect(calls[0]?.headers.Authorization).toBe('Bearer tok')
    expect((await verifyAccount({ provider: 'github', host: 'ghe.acme.dev' }, 'tok')).login).toBe('p')
  })

  it('GitLab, Gitea and Azure DevOps use their own auth headers', async () => {
    const calls = mockFetch({
      'https://gitlab.acme.dev/api/v4/user': { username: 'priya' },
      'https://git.acme.dev/api/v1/user': { login: 'steve' },
      'https://dev.azure.com/contoso/_apis/git/repositories': { value: [] }
    })
    expect((await verifyAccount({ provider: 'gitlab', host: 'gitlab.acme.dev' }, 'glpat')).login).toBe('priya')
    expect(calls[0]?.headers['PRIVATE-TOKEN']).toBe('glpat')
    expect((await verifyAccount({ provider: 'gitea', host: 'git.acme.dev' }, 'gt')).login).toBe('steve')
    expect(calls[1]?.headers.Authorization).toBe('token gt')
    expect(await verifyAccount({ provider: 'azure', host: 'dev.azure.com', organization: 'contoso' }, 'pat')).toEqual({
      login: 'contoso',
      gitUsername: 'pat'
    })
    expect(calls[2]?.headers.Authorization).toBe(`Basic ${Buffer.from(':pat').toString('base64')}`)
  })

  it('explains a rejected token', async () => {
    mockFetch({}, 401)
    await expect(verifyAccount({ provider: 'github', host: 'github.com' }, 'bad')).rejects.toThrow(/rejected this token/)
  })

  it('needs a username for other servers and makes no request', async () => {
    const calls = mockFetch({})
    expect(await verifyAccount({ provider: 'generic', host: 'git.example.com', username: 'me' }, 'pw')).toEqual({
      login: 'me',
      gitUsername: 'me'
    })
    await expect(verifyAccount({ provider: 'generic', host: 'git.example.com' }, 'pw')).rejects.toThrow(/username/)
    expect(calls).toHaveLength(0)
  })
})

describe('listRepos', () => {
  it('maps GitHub and Bitbucket repositories and strips user@ from HTTPS addresses', async () => {
    mockFetch({
      'https://api.github.com/user/repos': [
        {
          id: 1,
          name: 'web',
          owner: { login: 'acme' },
          description: 'Site',
          private: true,
          updated_at: '2026-10-01T00:00:00Z',
          clone_url: 'https://github.com/acme/web.git',
          ssh_url: 'git@github.com:acme/web.git'
        }
      ],
      'https://api.bitbucket.org/2.0/repositories': {
        values: [
          {
            uuid: '{u}',
            full_name: 'team/api',
            slug: 'api',
            description: '',
            is_private: false,
            updated_on: '2026-09-01T00:00:00Z',
            links: { clone: [{ name: 'https', href: 'https://me@bitbucket.org/team/api.git' }, { name: 'ssh', href: 'git@bitbucket.org:team/api.git' }] }
          }
        ]
      }
    })
    const [github] = await listRepos({ provider: 'github', host: 'github.com' }, 't')
    expect(github).toEqual({
      id: '1',
      owner: 'acme',
      name: 'web',
      description: 'Site',
      private: true,
      updatedAt: Date.parse('2026-10-01T00:00:00Z'),
      cloneUrl: 'https://github.com/acme/web.git',
      sshUrl: 'git@github.com:acme/web.git'
    })
    const [bitbucket] = await listRepos({ provider: 'bitbucket', host: 'bitbucket.org', email: 'me@x.dev' }, 't')
    expect(bitbucket).toMatchObject({ owner: 'team', name: 'api', cloneUrl: 'https://bitbucket.org/team/api.git' })
  })
})

describe('pull requests', () => {
  it('finds the repository behind a remote address on each service', () => {
    expect(repoApi({ provider: 'github', host: 'github.com' }, 'git@github.com:acme/web.git')?.base).toBe('/repos/acme/web')
    expect(repoApi({ provider: 'gitlab', host: 'gitlab.com' }, 'https://gitlab.com/group/sub/app.git')).toEqual({
      base: '/projects/group%2Fsub%2Fapp',
      web: 'https://gitlab.com/group/sub/app'
    })
    const azure = { provider: 'azure' as const, host: 'dev.azure.com', organization: 'Contoso' }
    expect(repoApi(azure, 'https://dev.azure.com/contoso/Web%20Team/_git/site')?.web).toBe('https://dev.azure.com/contoso/Web%20Team/_git/site')
    expect(repoApi(azure, 'git@ssh.dev.azure.com:v3/contoso/Web%20Team/site')?.base).toBe(
      'https://dev.azure.com/contoso/Web%20Team/_apis/git/repositories/site'
    )
    expect(repoApi(azure, 'https://dev.azure.com/other/p/_git/r')).toBeNull()
    expect(repoApi({ provider: 'generic', host: 'git.example.com' }, 'https://git.example.com/a/b.git')).toBeNull()
  })

  it('lists GitHub pull requests, telling forks apart', async () => {
    const calls = mockFetch({
      'https://api.github.com/repos/acme/web/pulls': [
        {
          number: 7,
          title: 'Faster builds',
          user: { login: 'priya' },
          head: { ref: 'fast', repo: { full_name: 'acme/web' } },
          base: { ref: 'main', repo: { full_name: 'acme/web' } },
          draft: true,
          html_url: 'https://github.com/acme/web/pull/7',
          updated_at: '2026-10-01T00:00:00Z'
        },
        { number: 8, title: 'Typo', user: { login: 'x' }, head: { ref: 'patch-1', repo: { full_name: 'x/web' } }, base: { ref: 'main', repo: { full_name: 'acme/web' } } }
      ]
    })
    const items = await listPullRequests({ provider: 'github', host: 'github.com' }, 't', 'https://github.com/acme/web.git')
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/pulls?state=open&sort=updated&direction=desc&per_page=50')
    expect(items[0]).toEqual({
      number: 7,
      title: 'Faster builds',
      author: 'priya',
      sourceBranch: 'fast',
      targetBranch: 'main',
      sameRepo: true,
      draft: true,
      url: 'https://github.com/acme/web/pull/7',
      updatedAt: Date.parse('2026-10-01T00:00:00Z')
    })
    expect(items[1]).toMatchObject({ number: 8, sameRepo: false, draft: false })
  })

  it('lists GitLab merge requests and Azure DevOps pull requests', async () => {
    mockFetch({
      'https://gitlab.com/api/v4/projects/g%2Fapp/merge_requests': [
        { iid: 3, title: 'Draft: x', author: { username: 'sam' }, source_branch: 'x', target_branch: 'main', source_project_id: 1, target_project_id: 1, draft: true, web_url: 'https://gitlab.com/g/app/-/merge_requests/3' }
      ],
      'https://dev.azure.com/contoso/web/_apis/git/repositories/site/pullrequests': {
        value: [{ pullRequestId: 12, title: 'Login', createdBy: { displayName: 'Ana' }, sourceRefName: 'refs/heads/login', targetRefName: 'refs/heads/main', isDraft: false }]
      }
    })
    const [mr] = await listPullRequests({ provider: 'gitlab', host: 'gitlab.com' }, 't', 'git@gitlab.com:g/app.git')
    expect(mr).toMatchObject({ number: 3, author: 'sam', sameRepo: true, draft: true })
    const [pr] = await listPullRequests(
      { provider: 'azure', host: 'dev.azure.com', organization: 'contoso' },
      't',
      'https://dev.azure.com/contoso/web/_git/site'
    )
    expect(pr).toMatchObject({ number: 12, sourceBranch: 'login', targetBranch: 'main', url: 'https://dev.azure.com/contoso/web/_git/site/pullrequest/12' })
  })

  it('creates a pull request, passing on why the service refused one', async () => {
    const calls: { url: string; body: unknown }[] = []
    let refuse = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body?: string }) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null })
        if (refuse) return new Response(JSON.stringify({ error: { message: 'There are no changes to be pulled' } }), { status: 400, statusText: 'Bad Request' })
        return new Response(JSON.stringify({ id: 4, title: 'T', source: { branch: { name: 'f' } }, destination: { branch: { name: 'main' } } }))
      })
    )
    const account = { provider: 'bitbucket' as const, host: 'bitbucket.org', email: 'me@x.dev' }
    const input = { title: 'T', description: 'D', source: 'f', target: 'main' }
    expect(await createPullRequest(account, 't', 'git@bitbucket.org:team/api.git', input)).toMatchObject({ number: 4, sourceBranch: 'f' })
    expect(calls[0]).toEqual({
      url: 'https://api.bitbucket.org/2.0/repositories/team/api/pullrequests',
      body: { title: 'T', description: 'D', source: { branch: { name: 'f' } }, destination: { branch: { name: 'main' } } }
    })
    refuse = true
    await expect(createPullRequest(account, 't', 'git@bitbucket.org:team/api.git', input)).rejects.toThrow(
      'The service answered 400 Bad Request. There are no changes to be pulled'
    )
  })
})
