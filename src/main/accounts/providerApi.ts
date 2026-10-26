import type { ProviderId } from '../../shared/providers'
import { hostName, parseRemoteUrl } from '../../shared/remoteUrl'
import type { HostedRepo, NewPullRequest, PullRequest } from '../../shared/types'

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
  /** The token came from a browser sign-in (OAuth), which some services send differently. */
  oauth?: boolean
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
      return account.oauth ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }
    case 'bitbucket':
      return { Authorization: basic(account.email ?? '') }
    case 'azure':
      return { Authorization: basic('') }
    case 'gitea':
      return { Authorization: `${account.oauth ? 'Bearer' : 'token'} ${token}` }
    case 'generic':
      return {}
  }
}

type Json = Record<string, unknown>

/** The explanation in a service's error response, in whichever shape that service uses. */
function errorText(body: unknown): string {
  const json = obj(body)
  const errors = list(json.errors)
    .map((error) => str(error.message))
    .filter(Boolean)
  if (errors.length > 0) return errors.join(' ')
  if (Array.isArray(json.message)) return json.message.filter((m) => typeof m === 'string').join(' ')
  return str(json.message) || str(obj(json.error).message) || str(json.error) || str(json.error_description)
}

/** Call the service's API: `path` is relative to its API base, or a full https:// address. */
async function request(account: ApiAccount, token: string, path: string, body?: Json): Promise<unknown> {
  const url = path.startsWith('https://') ? path : apiBase(account) + path
  let response: Response
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'User-Agent': 'GitLantern',
        ...authHeaders(account, token),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new Error(`Couldn't reach ${new URL(url).host}. Check the server address and your connection.`)
  }
  if (response.status === 401) throw new Error('The service rejected this token (401). Check it was copied in full and hasn’t expired.')
  if (response.status === 403) throw new Error('The token works but lacks a permission it needs (403). Recreate it with the scopes listed.')
  if (response.status === 404) throw new Error('Not found (404). Check the server address or organization.')
  if (!response.ok) {
    const detail = errorText(await response.json().catch(() => null))
    throw new Error(`The service answered ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`)
  }
  return response.json()
}

const getJson = (account: ApiAccount, token: string, path: string): Promise<unknown> => request(account, token, path)

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

/** Where the API keeps a repository's pull requests, and its web page, for a remote address. */
interface RepoApi {
  base: string
  web: string
}

export function repoApi(account: ApiAccount, url: string): RepoApi | null {
  const parsed = parseRemoteUrl(url)
  if (!parsed || parsed.protocol === 'file') return null
  // Addresses may already be percent-encoded ("Web%20Team"); decode once so nothing is encoded twice.
  const decode = (segment: string): string => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  }
  const segments = parsed.path.replace(/\.git\/?$/i, '').replace(/\/+$/, '').split('/').filter(Boolean).map(decode)
  const encoded = segments.map(encodeURIComponent)
  const host = hostName(parsed.host)
  const lastTwo = encoded.slice(-2).join('/')
  if (segments.length < 2) return null
  switch (account.provider) {
    case 'github':
    case 'gitea':
      return { base: `/repos/${lastTwo}`, web: `https://${account.host}/${lastTwo}` }
    case 'bitbucket':
      return { base: `/repositories/${lastTwo}`, web: `https://bitbucket.org/${lastTwo}` }
    case 'gitlab':
      return { base: `/projects/${encodeURIComponent(segments.join('/'))}`, web: `https://${account.host}/${encoded.join('/')}` }
    case 'azure': {
      // https://dev.azure.com/org/project/_git/repo, or git@ssh.dev.azure.com:v3/org/project/repo
      const [organization, project, repo] =
        host === 'ssh.dev.azure.com' ? encoded.slice(1, 4) : [encoded[0], encoded[1], encoded[3]]
      if (!organization || !project || !repo || (host !== 'ssh.dev.azure.com' && segments[2] !== '_git')) return null
      if (decode(organization).toLowerCase() !== (account.organization ?? '').toLowerCase()) return null
      const site = `https://dev.azure.com/${organization}/${project}`
      return { base: `${site}/_apis/git/repositories/${repo}`, web: `${site}/_git/${repo}` }
    }
    case 'generic':
      return null
  }
}

const WIP_TITLE = /^\s*(\[?(wip|draft)\]?:?)\s/i
const branchName = (ref: string): string => ref.replace(/^refs\/heads\//, '')

function toPullRequest(account: ApiAccount, item: Json, web: string): PullRequest {
  switch (account.provider) {
    case 'gitlab':
      return {
        number: Number(item.iid),
        title: str(item.title),
        author: str(obj(item.author).username) || str(obj(item.author).name),
        sourceBranch: str(item.source_branch),
        targetBranch: str(item.target_branch),
        sameRepo: item.source_project_id === item.target_project_id,
        draft: item.draft === true || item.work_in_progress === true,
        url: str(item.web_url),
        updatedAt: time(item.updated_at)
      }
    case 'bitbucket': {
      const source = obj(item.source)
      const destination = obj(item.destination)
      return {
        number: Number(item.id),
        title: str(item.title),
        author: str(obj(item.author).display_name) || str(obj(item.author).nickname),
        sourceBranch: str(obj(source.branch).name),
        targetBranch: str(obj(destination.branch).name),
        sameRepo: str(obj(source.repository).full_name) === str(obj(destination.repository).full_name),
        draft: item.draft === true,
        url: str(obj(obj(item.links).html).href),
        updatedAt: time(item.updated_on)
      }
    }
    case 'azure': {
      const id = Number(item.pullRequestId)
      return {
        number: id,
        title: str(item.title),
        author: str(obj(item.createdBy).displayName) || str(obj(item.createdBy).uniqueName),
        sourceBranch: branchName(str(item.sourceRefName)),
        targetBranch: branchName(str(item.targetRefName)),
        sameRepo: !item.forkSource,
        draft: item.isDraft === true,
        url: `${web}/pullrequest/${id}`,
        updatedAt: time(item.creationDate)
      }
    }
    default: {
      // GitHub and Gitea share a shape.
      const head = obj(item.head)
      const base = obj(item.base)
      const title = str(item.title)
      return {
        number: Number(item.number),
        title,
        author: str(obj(item.user).login),
        sourceBranch: str(head.ref),
        targetBranch: str(base.ref),
        sameRepo: str(obj(head.repo).full_name) !== '' && str(obj(head.repo).full_name) === str(obj(base.repo).full_name),
        draft: typeof item.draft === 'boolean' ? item.draft : WIP_TITLE.test(title),
        url: str(item.html_url),
        updatedAt: time(item.updated_at)
      }
    }
  }
}

function repoApiOrThrow(account: ApiAccount, url: string): RepoApi {
  const api = repoApi(account, url)
  if (!api) throw new Error(`Can’t tell which repository ${url} is on the service`)
  return api
}

/** Up to 50 open pull requests (merge requests on GitLab), most recently updated first. */
export async function listPullRequests(account: ApiAccount, token: string, remoteUrl: string): Promise<PullRequest[]> {
  const api = repoApiOrThrow(account, remoteUrl)
  const path = {
    github: '/pulls?state=open&sort=updated&direction=desc&per_page=50',
    gitea: '/pulls?state=open&sort=recentupdate&limit=50',
    gitlab: '/merge_requests?state=opened&order_by=updated_at&per_page=50',
    bitbucket: '/pullrequests?state=OPEN&sort=-updated_on&pagelen=50',
    azure: '/pullrequests?searchCriteria.status=active&$top=50&api-version=7.1',
    generic: ''
  }[account.provider]
  const body = await getJson(account, token, api.base + path)
  const items = account.provider === 'bitbucket' ? list(obj(body).values) : account.provider === 'azure' ? list(obj(body).value) : list(body)
  return items.map((item) => toPullRequest(account, item, api.web))
}

/** Open a pull request from one branch of the repository into another. */
export async function createPullRequest(account: ApiAccount, token: string, remoteUrl: string, input: NewPullRequest): Promise<PullRequest> {
  const api = repoApiOrThrow(account, remoteUrl)
  const { title, description, source, target } = input
  const [path, body]: [string, Json] = {
    github: ['/pulls', { title, body: description, head: source, base: target }],
    gitea: ['/pulls', { title, body: description, head: source, base: target }],
    gitlab: ['/merge_requests', { title, description, source_branch: source, target_branch: target }],
    bitbucket: ['/pullrequests', { title, description, source: { branch: { name: source } }, destination: { branch: { name: target } } }],
    azure: [
      '/pullrequests?api-version=7.1',
      { title, description, sourceRefName: `refs/heads/${source}`, targetRefName: `refs/heads/${target}` }
    ],
    generic: ['', {}]
  }[account.provider] as [string, Json]
  return toPullRequest(account, obj(await request(account, token, api.base + path, body)), api.web)
}
