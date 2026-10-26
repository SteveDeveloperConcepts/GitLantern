import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SignInProgress } from '../../shared/types'
import { refreshTokens, signInWithBrowser } from './oauth'

type Route = (params: URLSearchParams) => unknown

/** Answer POSTs to the service's OAuth endpoints; requests to 127.0.0.1 go to the real network. */
function mockService(routes: Record<string, Route>) {
  const calls: { url: string; params: URLSearchParams }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      const params = new URLSearchParams(init.body)
      calls.push({ url, params })
      const route = routes[url]
      if (!route) return new Response('{}', { status: 404, statusText: 'Not Found' })
      return new Response(JSON.stringify(route(params)))
    })
  )
  return calls
}

/** What the browser does after the user approves: load the redirect address. */
function visit(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    }).on('error', reject)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitHub device sign-in', () => {
  it('shows the code, then polls until the user has entered it', async () => {
    let polls = 0
    const calls = mockService({
      'https://github.com/login/device/code': () => ({
        device_code: 'dev',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 0
      }),
      'https://github.com/login/oauth/access_token': () => (++polls < 3 ? { error: 'authorization_pending' } : { access_token: 'gho_x', scope: 'repo' })
    })
    const progress: SignInProgress[] = []
    const opened: string[] = []
    const tokens = await signInWithBrowser({
      provider: 'github',
      host: 'github.com',
      clientId: 'client',
      openUrl: (url) => opened.push(url),
      onProgress: (p) => progress.push(p),
      signal: new AbortController().signal
    })
    expect(tokens).toEqual({ accessToken: 'gho_x' })
    expect(progress).toEqual([{ url: 'https://github.com/login/device', userCode: 'ABCD-1234' }])
    expect(opened).toEqual(['https://github.com/login/device'])
    expect(calls[0]?.params.get('scope')).toBe('repo')
    expect(calls.at(-1)?.params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
  })

  it('stops when the user turns it down', async () => {
    mockService({
      'https://github.com/login/device/code': () => ({ device_code: 'd', user_code: 'C', verification_uri: 'https://github.com/login/device', interval: 0 }),
      'https://github.com/login/oauth/access_token': () => ({ error: 'access_denied' })
    })
    const options = { provider: 'github' as const, host: 'github.com', clientId: 'c', openUrl: () => {}, onProgress: () => {} }
    await expect(signInWithBrowser({ ...options, signal: new AbortController().signal })).rejects.toThrow(/turned down/)
  })
})

describe('GitLab browser sign-in', () => {
  it('sends the browser to GitLab, takes the code on 127.0.0.1 and trades it with the PKCE verifier', async () => {
    const calls = mockService({
      'https://gitlab.example.com/oauth/token': () => ({ access_token: 'glo', refresh_token: 'r1', expires_in: 7200 })
    })
    const tokens = await signInWithBrowser({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      clientId: 'app',
      onProgress: () => {},
      signal: new AbortController().signal,
      openUrl: (address) => {
        const url = new URL(address)
        expect(url.origin + url.pathname).toBe('https://gitlab.example.com/oauth/authorize')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(url.searchParams.get('scope')).toBe('api read_repository write_repository')
        const redirect = url.searchParams.get('redirect_uri') ?? ''
        expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
        // A request with the wrong state is ignored; the right one finishes the sign-in.
        void visit(`${redirect}?code=evil&state=wrong`).then((status) => {
          expect(status).toBe(404)
          return visit(`${redirect}?code=good&state=${url.searchParams.get('state')}`)
        })
      }
    })
    expect(tokens.accessToken).toBe('glo')
    expect(tokens.refreshToken).toBe('r1')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now() + 7000_000)
    const exchange = calls[0]?.params
    expect(exchange?.get('code')).toBe('good')
    expect(exchange?.get('grant_type')).toBe('authorization_code')
    expect(exchange?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('can be cancelled while waiting for the browser', async () => {
    mockService({})
    const controller = new AbortController()
    const pending = signInWithBrowser({
      provider: 'gitea',
      host: 'codeberg.org',
      clientId: 'app',
      onProgress: () => {},
      openUrl: () => controller.abort(),
      signal: controller.signal
    })
    await expect(pending).rejects.toThrow(/cancelled/)
  })

  it('renews a token with the refresh token', async () => {
    const calls = mockService({ 'https://codeberg.org/login/oauth/access_token': () => ({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }) })
    expect(await refreshTokens('gitea', 'codeberg.org', 'app', 'r1')).toMatchObject({ accessToken: 'new', refreshToken: 'r2' })
    expect(Object.fromEntries(calls[0]?.params ?? [])).toEqual({ client_id: 'app', grant_type: 'refresh_token', refresh_token: 'r1' })
  })
})
