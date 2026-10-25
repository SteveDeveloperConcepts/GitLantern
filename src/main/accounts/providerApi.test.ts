import { afterEach, describe, expect, it, vi } from 'vitest'
import { listRepos, verifyAccount } from './providerApi'

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
