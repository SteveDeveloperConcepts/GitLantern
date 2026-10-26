import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { providerInfo, type ProviderId } from '../../shared/providers'
import type { SignInProgress } from '../../shared/types'

/**
 * OAuth applications registered for GitLantern, by server: host → client ID. Browser sign-in is only
 * offered where there is one, here or under `oauthClients` in settings.json (for a company's own
 * GitLab or Gitea, which needs its own application). Client IDs aren't secret: neither flow uses a
 * client secret. docs/DEVELOPMENT.md explains how to register the applications.
 */
export const REGISTERED_CLIENTS: Readonly<Record<string, string>> = {}

const SCOPES: Partial<Record<ProviderId, string>> = {
  github: 'repo',
  gitlab: 'api read_repository write_repository'
  // Gitea and Forgejo grant their OAuth tokens full access and don't take scopes.
}

// For GitHub's device flow, `authorize` is where the device code comes from.
const ENDPOINTS: Partial<Record<ProviderId, { authorize: string; token: string }>> = {
  github: { authorize: '/login/device/code', token: '/login/oauth/access_token' },
  gitlab: { authorize: '/oauth/authorize', token: '/oauth/token' },
  gitea: { authorize: '/login/oauth/authorize', token: '/login/oauth/access_token' }
}

const REQUEST_TIMEOUT_MS = 20_000
const BROWSER_TIMEOUT_MS = 10 * 60 * 1000

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Unix milliseconds. */
  expiresAt?: number
}

export interface SignInOptions {
  provider: ProviderId
  host: string
  clientId: string
  /** Show a page in the user's browser. */
  openUrl(url: string): void
  onProgress(progress: SignInProgress): void
  signal: AbortSignal
}

type Json = Record<string, unknown>
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const base64url = (bytes: Buffer): string => bytes.toString('base64url')

function endpoints(provider: ProviderId): { authorize: string; token: string } {
  const found = ENDPOINTS[provider]
  if (!found) throw new Error('This service doesn’t offer browser sign-in')
  return found
}

/** POST a form to an OAuth endpoint and return its JSON answer, errors included (they're in the body). */
async function postForm(url: string, params: Record<string, string>, signal?: AbortSignal): Promise<Json> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GitLantern' },
      body: new URLSearchParams(params).toString(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('Sign-in cancelled')
    throw new Error(`Couldn't reach ${new URL(url).host}. Check the server address and your connection.`, { cause: error })
  }
  const body = (await response.json().catch(() => null)) as Json | null
  if (!body || (!response.ok && !body.error)) throw new Error(`${new URL(url).host} answered ${response.status} ${response.statusText}`)
  return body
}

function tokenSet(body: Json): TokenSet {
  const accessToken = str(body.access_token)
  if (!accessToken) throw new Error(str(body.error_description) || str(body.error) || 'The service sent no token')
  const refreshToken = str(body.refresh_token)
  const lifetime = Number(body.expires_in)
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(lifetime > 0 ? { expiresAt: Date.now() + lifetime * 1000 } : {})
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = (): void => {
      clearTimeout(timer)
      reject(new Error('Sign-in cancelled'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
  })
}

/** GitHub's device flow: the user enters a code on github.com, and we poll until they have. */
async function deviceFlow({ host, clientId, openUrl, onProgress, signal }: SignInOptions): Promise<TokenSet> {
  const { authorize, token } = endpoints('github')
  const start = await postForm(`https://${host}${authorize}`, { client_id: clientId, scope: SCOPES.github ?? '' }, signal)
  const deviceCode = str(start.device_code)
  const userCode = str(start.user_code)
  const verification = str(start.verification_uri)
  if (!deviceCode || !userCode || !verification.startsWith('https://')) {
    throw new Error(str(start.error_description) || 'GitHub didn’t start the sign-in. Is device flow enabled for the app?')
  }
  onProgress({ url: verification, userCode })
  openUrl(verification)

  let interval = Math.max(0, Number(start.interval ?? 5)) * 1000
  const deadline = Date.now() + Number(start.expires_in ?? 900) * 1000
  while (Date.now() < deadline) {
    await sleep(interval, signal)
    const answer = await postForm(
      `https://${host}${token}`,
      { client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
      signal
    )
    if (answer.access_token) return tokenSet(answer)
    switch (answer.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval = Math.max(interval + 5000, Number(answer.interval ?? 0) * 1000)
        continue
      case 'access_denied':
        throw new Error('Sign-in was turned down in the browser')
      case 'expired_token':
        throw new Error('The code expired before sign-in finished. Start again.')
      default:
        throw new Error(str(answer.error_description) || str(answer.error) || 'Sign-in failed')
    }
  }
  throw new Error('The code expired before sign-in finished. Start again.')
}

const page = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>GitLantern</title><body style="font:16px system-ui;margin:15vh auto;max-width:28em;text-align:center"><p>${message}</p></body>`

/**
 * A one-off server on 127.0.0.1 for the browser to come back to with the authorization code. A
 * request without the right `state` is ignored, so another page can't slip in its own code.
 */
async function loopback(state: string, signal: AbortSignal): Promise<{ redirectUri: string; code: Promise<string>; close(): void }> {
  let settle: { resolve(code: string): void; reject(error: Error): void } | undefined
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject }
  })
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
      response.writeHead(404).end()
      return
    }
    const error = url.searchParams.get('error')
    const received = url.searchParams.get('code')
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    if (received && !error) {
      response.end(page('You’re signed in. You can close this tab and go back to GitLantern.'))
      settle?.resolve(received)
    } else {
      response.end(page('Sign-in didn’t finish. Go back to GitLantern to try again.'))
      settle?.reject(new Error(error === 'access_denied' ? 'Sign-in was turned down in the browser' : `Sign-in failed: ${error ?? 'no code'}`))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const cancel = (): void => settle?.reject(new Error('Sign-in cancelled'))
  const timer = setTimeout(() => settle?.reject(new Error('Sign-in timed out. Start again.')), BROWSER_TIMEOUT_MS)
  signal.addEventListener('abort', cancel, { once: true })
  return {
    redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`,
    code,
    close: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      server.close()
    }
  }
}

/** Authorization code with PKCE (RFC 7636) and a loopback redirect (RFC 8252), for GitLab and Gitea. */
async function browserFlow({ provider, host, clientId, openUrl, onProgress, signal }: SignInOptions): Promise<TokenSet> {
  const { authorize, token } = endpoints(provider)
  const verifier = base64url(randomBytes(32))
  const state = base64url(randomBytes(16))
  const { redirectUri, code, close } = await loopback(state, signal)
  try {
    const url = new URL(`https://${host}${authorize}`)
    const scope = SCOPES[provider]
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      code_challenge: base64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      ...(scope ? { scope } : {})
    }).toString()
    onProgress({ url: url.toString() })
    openUrl(url.toString())
    const params = { client_id: clientId, grant_type: 'authorization_code', code: await code, redirect_uri: redirectUri, code_verifier: verifier }
    return tokenSet(await postForm(`https://${host}${token}`, params, signal))
  } finally {
    close()
  }
}

/**
 * Sign in through the browser and get a token for `host`. GitHub uses the device flow, where the
 * user types a short code on github.com. GitLab and Gitea/Forgejo use an authorization code with
 * PKCE, the browser coming back to a one-off server on 127.0.0.1.
 */
export function signInWithBrowser(options: SignInOptions): Promise<TokenSet> {
  switch (providerInfo(options.provider).browserSignIn) {
    case 'device':
      return deviceFlow(options)
    case 'browser':
      return browserFlow(options)
    default:
      return Promise.reject(new Error('This service doesn’t offer browser sign-in'))
  }
}

/** Trade a refresh token for a new access token (GitLab's last two hours, Gitea's one). */
export async function refreshTokens(provider: ProviderId, host: string, clientId: string, refreshToken: string): Promise<TokenSet> {
  const params = { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }
  return tokenSet(await postForm(`https://${host}${endpoints(provider).token}`, params))
}
