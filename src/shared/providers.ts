/** Git hosting services Git Steve can connect to, and how to get a token for each. */

export type ProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea' | 'generic'

export interface ProviderInfo {
  id: ProviderId
  name: string
  /** Shown under the name on the "Add a service" tiles. */
  note: string
  /** Pre-filled server; empty when the user must type one. */
  defaultHost: string
  hostEditable: boolean
  hostHint?: string
  /** Extra fields this service needs besides the token. */
  needs: { organization?: boolean; email?: boolean; username?: boolean }
  tokenLabel: string
  /** Scopes or permissions to tick when creating the token. */
  scopes: string
  /** Page where the user creates a token, or null when we can't know it. */
  tokenUrl(host: string, organization?: string): string | null
}

const encode = encodeURIComponent

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'github',
    name: 'GitHub',
    note: 'github.com or Enterprise',
    defaultHost: 'github.com',
    hostEditable: true,
    hostHint: 'GitHub Enterprise Server? Enter your company’s address instead.',
    needs: {},
    tokenLabel: 'Personal access token',
    scopes: 'repo',
    tokenUrl: (host) => `https://${host}/settings/tokens/new?scopes=repo&description=Git%20Steve`
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    note: 'gitlab.com or self-managed',
    defaultHost: 'gitlab.com',
    hostEditable: true,
    hostHint: 'Self-managed GitLab? Enter your company’s address instead.',
    needs: {},
    tokenLabel: 'Personal access token',
    scopes: 'read_api, read_repository and write_repository',
    tokenUrl: (host) =>
      `https://${host}/-/user_settings/personal_access_tokens?name=Git%20Steve&scopes=read_api,read_repository,write_repository`
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    note: 'bitbucket.org',
    defaultHost: 'bitbucket.org',
    hostEditable: false,
    needs: { email: true },
    tokenLabel: 'API token',
    scopes: 'Bitbucket scopes to read your account and read and write repositories',
    tokenUrl: () => 'https://id.atlassian.com/manage-profile/security/api-tokens'
  },
  {
    id: 'azure',
    name: 'Azure DevOps',
    note: 'dev.azure.com',
    defaultHost: 'dev.azure.com',
    hostEditable: false,
    needs: { organization: true },
    tokenLabel: 'Personal access token',
    scopes: 'Code (Read & write)',
    tokenUrl: (_host, organization) =>
      organization ? `https://dev.azure.com/${encode(organization)}/_usersSettings/tokens` : null
  },
  {
    id: 'gitea',
    name: 'Gitea / Forgejo',
    note: 'Your own server',
    defaultHost: '',
    hostEditable: true,
    hostHint: 'For example git.example.com or codeberg.org.',
    needs: {},
    tokenLabel: 'Access token',
    scopes: 'repository (read and write) and user (read)',
    tokenUrl: (host) => (host ? `https://${host}/user/settings/applications` : null)
  },
  {
    id: 'generic',
    name: 'Other Git server',
    note: 'Any HTTPS address',
    defaultHost: '',
    hostEditable: true,
    hostHint: 'The server part of your repository addresses, e.g. git.example.com.',
    needs: { username: true },
    tokenLabel: 'Password or access token',
    scopes: 'whatever your server needs for cloning and pushing',
    tokenUrl: () => null
  }
]

export function providerInfo(id: ProviderId): ProviderInfo {
  const info = PROVIDERS.find((p) => p.id === id)
  if (!info) throw new Error(`Unknown provider: ${id}`)
  return info
}

/** "https://Git.Example.com/" → "git.example.com" (keeps a port). */
export function normalizeHost(input: string): string {
  return input
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}
