import type { ProviderId } from '../../shared/providers'
import type { HostedRepo } from '../../shared/types'

/** What we learn about an account when its token is checked. */
export interface VerifiedAccount {
  login: string
  gitUsername: string
}

export interface ApiAccount {
  provider: ProviderId
  host: string
  organization?: string
  email?: string
  username?: string
}

const TIMEOUT_MS = 20_000

function apiBase(account: ApiAccount): string {
  switch (account.provider) {
    case 'github':
      return account.host === 'github.com' ? 'https://api.github.com' : `https://${account.host}/api/v3`
    case 'gitlab':
      return `https://${account.host}/api/v4`
    case 'bitbucket':
      return 'https://api.bitbucket.org/2.0'
    case 'azure':
      return `https://dev.azure.com/${encodeURIComponent(account.organization ?? '')}/_apis`
    case 'gitea':
      return `https://${account.host}/api/v1`
    case 'generic':
      return ''
  }
}

function authHeaders(account: ApiAccount, token: string): Record<string, string> {
  const basic = (user: string) => `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`
  switch (account.provider) {
    case 'github':
      return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    case 'gitlab':
      return { 'PRIVATE-TOKEN': token }
    case 'bitbucket':
      return { Authorization: basic(account.email ?? '') }
    case 'azure':
      return { Authorization: basic('') }
    case 'gitea':
      return { Authorization: `token ${token}` }
    case 'generic':
      return {}
  }
}

async function getJson(account: ApiAccount, token: string, path: string): Promise<unknown> {
  const url = apiBase(account) + path
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'GitSteve', ...authHeaders(account, token) },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new Error(`Couldn't reach ${new URL(url).host}. Check the server address and your connection.`)
  }
  if (response.status === 401) throw new Error('The service rejected this token (401). Check it was copied in full and hasn’t expired.')
  if (response.status === 403) throw new Error('The token works but lacks a permission it needs (403). Recreate it with the scopes listed.')
  if (response.status === 404) throw new Error('Not found (404). Check the server address or organization.')
  if (!response.ok) throw new Error(`The service answered ${response.status} ${response.statusText}.`)
  return response.json()
}

type Json = Record<string, unknown>
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const time = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(parsed) ? null : parsed
}
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : [])
const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {})

/** Check a token against the service and find out who it belongs to. */
export async function verifyAccount(account: ApiAccount, token: string): Promise<VerifiedAccount> {
  switch (account.provider) {
    case 'github': {
      const login = str(obj(await getJson(account, token, '/user')).login)
      return { login, gitUsername: login }
    }
    case 'gitlab': {
      const login = str(obj(await getJson(account, token, '/user')).username)
      return { login, gitUsername: login }
    }
    case 'bitbucket': {
      const user = obj(await getJson(account, token, '/user'))
      // Git over HTTPS with an Atlassian API token uses this fixed username.
      return { login: str(user.username) || str(user.display_name) || (account.email ?? ''), gitUsername: 'x-bitbucket-api-token-auth' }
    }
    case 'azure': {
      // A Code-scoped token can't read the profile, so listing repositories is the check.
      await getJson(account, token, '/git/repositories?api-version=7.1')
      return { login: account.organization ?? 'Azure DevOps', gitUsername: 'pat' }
    }
    case 'gitea': {
      const login = str(obj(await getJson(account, token, '/user')).login)
      return { login, gitUsername: login }
    }
    case 'generic': {
      const username = account.username?.trim()
      if (!username) throw new Error('Enter the username for this server')
      return { login: username, gitUsername: username }
    }
  }
}

/** Strip `user@` from an HTTPS clone address so git asks (and askpass answers) per host. */
function withoutUser(url: string): string {
  return url.replace(/^(https?:\/\/)[^@/]+@/i, '$1')
}

/** Up to 100 of the account's most recently updated repositories. */
export async function listRepos(account: ApiAccount, token: string): Promise<HostedRepo[]> {
  switch (account.provider) {
    case 'github':
    case 'gitea': {
      const path =
        account.provider === 'github'
          ? '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member'
          : '/user/repos?limit=50'
      return list(await getJson(account, token, path)).map((repo) => ({
        id: String(repo.id),
        owner: str(obj(repo.owner).login),
        name: str(repo.name),
        description: str(repo.description),
        private: repo.private === true,
        updatedAt: time(repo.updated_at),
        cloneUrl: str(repo.clone_url),
        sshUrl: str(repo.ssh_url)
      }))
    }
    case 'gitlab': {
      const projects = list(await getJson(account, token, '/projects?membership=true&order_by=last_activity_at&per_page=100'))
      return projects.map((project) => {
        const full = str(project.path_with_namespace)
        return {
          id: String(project.id),
          owner: full.slice(0, full.lastIndexOf('/')),
          name: str(project.path) || str(project.name),
          description: str(project.description),
          private: str(project.visibility) !== 'public',
          updatedAt: time(project.last_activity_at),
          cloneUrl: str(project.http_url_to_repo),
          sshUrl: str(project.ssh_url_to_repo)
        }
      })
    }
    case 'bitbucket': {
      const page = obj(await getJson(account, token, '/repositories?role=member&sort=-updated_on&pagelen=100'))
      return list(page.values).map((repo) => {
        const clones = list(obj(repo.links).clone)
        const href = (kind: string) => str(clones.find((c) => c.name === kind)?.href)
        const full = str(repo.full_name)
        return {
          id: str(repo.uuid) || full,
          owner: full.slice(0, full.indexOf('/')),
          name: str(repo.slug) || str(repo.name),
          description: str(repo.description),
          private: repo.is_private === true,
          updatedAt: time(repo.updated_on),
          cloneUrl: withoutUser(href('https')),
          sshUrl: href('ssh')
        }
      })
    }
    case 'azure': {
      const page = obj(await getJson(account, token, '/git/repositories?api-version=7.1'))
      return list(page.value).map((repo) => ({
        id: str(repo.id),
        owner: str(obj(repo.project).name),
        name: str(repo.name),
        description: '',
        private: true,
        updatedAt: null,
        cloneUrl: withoutUser(str(repo.remoteUrl)),
        sshUrl: str(repo.sshUrl)
      }))
    }
    case 'generic':
      return []
  }
}
