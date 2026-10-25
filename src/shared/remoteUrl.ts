/** Parsing and converting Git remote addresses (HTTPS, SSH, scp-style and local paths). */

export type RemoteProtocol = 'https' | 'http' | 'ssh' | 'git' | 'file'

export interface ParsedRemote {
  protocol: RemoteProtocol
  /** Lower-cased host, including a port if the URL has one. Empty for local paths. */
  host: string
  /** Path after the host, without a leading slash. */
  path: string
  user?: string
}

const URL_FORM = /^(https?|ssh|git):\/\/(?:([^@/]+)@)?([^/]+)(\/.*)?$/i
// git@github.com:owner/repo.git (but not a Windows drive like C:\code)
const SCP_FORM = /^(?:([^@/\s]+)@)?([^:/\s]{2,}):(?!\/\/)(.+)$/

export function parseRemoteUrl(input: string): ParsedRemote | null {
  const url = input.trim()
  if (!url || url.startsWith('-')) return null
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('\\\\') || url.startsWith('file://')) {
    return { protocol: 'file', host: '', path: url }
  }
  const full = URL_FORM.exec(url)
  if (full) {
    const [, scheme = '', user, host = '', rest = '/'] = full
    return {
      protocol: scheme.toLowerCase() as RemoteProtocol,
      host: host.toLowerCase(),
      path: rest.replace(/^\/+/, ''),
      ...(user ? { user: decodeURIComponent(user) } : {})
    }
  }
  const scp = SCP_FORM.exec(url)
  if (scp) {
    const [, user, host = '', rest = ''] = scp
    return { protocol: 'ssh', host: host.toLowerCase(), path: rest.replace(/^\/+/, ''), ...(user ? { user } : {}) }
  }
  return null
}

/** Host without a port, for display and SSH. */
export function hostName(host: string): string {
  return host.replace(/:\d+$/, '')
}

/** Folder name git clone would create: the last path segment without `.git`. */
export function repoNameFromUrl(input: string): string {
  const parsed = parseRemoteUrl(input)
  const path = (parsed?.path ?? input).replace(/[\\/]+$/, '')
  const last = path.split(/[\\/:]/).pop() ?? ''
  return last.replace(/\.git$/i, '') || 'repository'
}

/** `https://host` for credential config, or null when the URL isn't HTTP(S). */
export function credentialOrigin(input: string): string | null {
  const parsed = parseRemoteUrl(input)
  if (!parsed || (parsed.protocol !== 'https' && parsed.protocol !== 'http')) return null
  return `${parsed.protocol}://${parsed.host}`
}

const AZURE_HTTPS_PATH = /^([^/]+)\/([^/]+)\/_git\/([^/]+)$/
const AZURE_SSH_PATH = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/

/** https://host/owner/repo.git → git@host:owner/repo.git (Azure DevOps has its own SSH form). */
export function toSshUrl(input: string): string | null {
  const parsed = parseRemoteUrl(input)
  if (!parsed || (parsed.protocol !== 'https' && parsed.protocol !== 'http')) return null
  const host = hostName(parsed.host)
  if (host === 'dev.azure.com') {
    const azure = AZURE_HTTPS_PATH.exec(parsed.path)
    return azure ? `git@ssh.dev.azure.com:v3/${azure[1]}/${azure[2]}/${azure[3]}` : null
  }
  return `git@${host}:${parsed.path}`
}

/** git@host:owner/repo.git → https://host/owner/repo.git (and back from Azure DevOps' SSH form). */
export function toHttpsUrl(input: string): string | null {
  const parsed = parseRemoteUrl(input)
  if (!parsed || parsed.protocol !== 'ssh') return null
  const host = hostName(parsed.host)
  if (host === 'ssh.dev.azure.com') {
    const azure = AZURE_SSH_PATH.exec(parsed.path)
    return azure ? `https://dev.azure.com/${azure[1]}/${azure[2]}/_git/${azure[3]}` : null
  }
  return `https://${host}/${parsed.path}`
}

const KNOWN_SERVICES: [RegExp, string][] = [
  [/^github\.com$/, 'GitHub'],
  [/^gitlab\.com$/, 'GitLab'],
  [/^bitbucket\.org$/, 'Bitbucket'],
  [/^(ssh\.)?dev\.azure\.com$|\.visualstudio\.com$/, 'Azure DevOps'],
  [/^codeberg\.org$/, 'Codeberg']
]

/** Friendly name for a remote's host: a known service, else the host itself. */
export function serviceName(input: string): string {
  const parsed = parseRemoteUrl(input)
  if (!parsed) return 'Unknown'
  if (parsed.protocol === 'file') return 'Local folder'
  const host = hostName(parsed.host)
  return KNOWN_SERVICES.find(([pattern]) => pattern.test(host))?.[1] ?? host
}
