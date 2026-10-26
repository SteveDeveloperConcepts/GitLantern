import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeHost, providerInfo, type ProviderId } from '../../shared/providers'
import { hostName, parseRemoteUrl } from '../../shared/remoteUrl'
import type { Account, AccountInput, HostedRepo, SignInProgress } from '../../shared/types'
import type { SecretStore } from '../secrets'
import { REGISTERED_CLIENTS, refreshTokens, signInWithBrowser, type TokenSet } from './oauth'
import { listRepos, verifyAccount } from './providerApi'

const TOKEN_PREFIX = 'account:'
const REFRESH_PREFIX = 'account-refresh:'
/** Renew an OAuth token this long before it runs out, so a slow push doesn't outlive it. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000

/**
 * Connected accounts. Metadata (host, login) lives in accounts.json; each token is kept
 * in the SecretStore, encrypted with the OS keychain, and never sent to the renderer.
 */
export class AccountStore {
  /** Refreshes under way, so two prompts at once don't both spend the same refresh token. */
  private readonly refreshing = new Map<string, Promise<string | null>>()

  constructor(
    private readonly file: string,
    private readonly secrets: SecretStore,
    /** OAuth client IDs the user added in settings.json, by host. */
    private readonly extraClients: () => Readonly<Record<string, string>> = () => ({})
  ) {}

  list(): Account[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed) ? (parsed as Account[]) : []
    } catch {
      return []
    }
  }

  /** Hosts with an account, for routing git's credential prompts. */
  hosts(): Set<string> {
    return new Set(this.list().map((a) => a.host))
  }

  findByHost(host: string): Account | undefined {
    return this.list().find((a) => a.host === host.toLowerCase())
  }

  /** The account for a remote's server, over HTTPS or SSH (Azure DevOps' SSH server included). */
  findByUrl(url: string): Account | undefined {
    const parsed = parseRemoteUrl(url)
    if (!parsed || parsed.protocol === 'file') return undefined
    if (parsed.protocol !== 'ssh') return this.findByHost(parsed.host)
    const host = hostName(parsed.host)
    return this.findByHost(host === 'ssh.dev.azure.com' ? 'dev.azure.com' : host)
  }

  token(id: string): string | null {
    return this.secrets.get(TOKEN_PREFIX + id)
  }

  /** The account's token, renewed first when it's an OAuth token about to run out. */
  async freshToken(id: string): Promise<string | null> {
    const account = this.list().find((a) => a.id === id)
    if (!account?.expiresAt || account.expiresAt - Date.now() > REFRESH_MARGIN_MS) return this.token(id)
    const pending = this.refreshing.get(id) ?? this.refresh(account).finally(() => this.refreshing.delete(id))
    this.refreshing.set(id, pending)
    return pending
  }

  private async refresh(account: Account): Promise<string | null> {
    const refreshToken = this.secrets.get(REFRESH_PREFIX + account.id)
    const clientId = this.clientId(account.host)
    if (!refreshToken || !clientId) return this.token(account.id)
    let tokens: TokenSet
    try {
      tokens = await refreshTokens(account.provider, account.host, clientId, refreshToken)
    } catch (error) {
      throw new Error(`Your ${providerInfo(account.provider).name} sign-in has run out. Sign in again under Accounts.`, { cause: error })
    }
    this.saveTokens(account.id, tokens)
    const { expiresAt: _old, ...rest } = account
    this.write(this.list().map((a) => (a.id === account.id ? { ...rest, ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}) } : a)))
    return tokens.accessToken
  }

  private saveTokens(id: string, tokens: TokenSet): void {
    this.secrets.set(TOKEN_PREFIX + id, tokens.accessToken)
    if (tokens.refreshToken) this.secrets.set(REFRESH_PREFIX + id, tokens.refreshToken)
    else this.secrets.delete(REFRESH_PREFIX + id)
  }

  private clientId(host: string): string | undefined {
    return { ...REGISTERED_CLIENTS, ...this.extraClients() }[host]
  }

  /** Servers with an OAuth application, where browser sign-in works. */
  browserSignInHosts(): string[] {
    return Object.keys({ ...REGISTERED_CLIENTS, ...this.extraClients() }).filter((host) => this.clientId(host))
  }

  /** Sign in through the browser instead of with a pasted token, then keep the token like any other. */
  async signIn(
    provider: ProviderId,
    hostInput: string,
    ui: { openUrl(url: string): void; onProgress(progress: SignInProgress): void; signal: AbortSignal }
  ): Promise<Account> {
    const info = providerInfo(provider)
    const host = normalizeHost(info.hostEditable ? hostInput : info.defaultHost)
    const clientId = this.clientId(host)
    if (!clientId || !info.browserSignIn) throw new Error(`Browser sign-in isn’t set up for ${host || info.name}. Paste a token instead.`)
    if (!this.secrets.available()) {
      throw new Error('Your system keychain isn’t available, so the sign-in can’t be stored securely.')
    }
    const tokens = await signInWithBrowser({ provider, host, clientId, ...ui })
    const verified = await verifyAccount({ provider, host, oauth: true }, tokens.accessToken)
    const account: Account = {
      id: randomUUID(),
      provider,
      host,
      login: verified.login,
      // GitLab takes OAuth tokens over HTTPS with this fixed username.
      gitUsername: provider === 'gitlab' ? 'oauth2' : verified.gitUsername,
      oauth: true,
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {})
    }
    const previous = this.findByHost(host)
    if (previous) this.remove(previous.id)
    this.saveTokens(account.id, tokens)
    this.write([...this.list(), account])
    return account
  }

  async connect(input: AccountInput): Promise<Account> {
    const info = providerInfo(input.provider)
    const host = normalizeHost(info.hostEditable ? input.host : info.defaultHost)
    const token = input.token.trim()
    if (!host) throw new Error('Enter the server address')
    if (!token) throw new Error(`Paste your ${info.tokenLabel.toLowerCase()}`)
    if (info.needs.organization && !input.organization?.trim()) throw new Error('Enter your Azure DevOps organization')
    if (info.needs.email && !input.email?.trim()) throw new Error('Enter the email address of your Atlassian account')
    if (!this.secrets.available()) {
      throw new Error('Your system keychain isn’t available, so the token can’t be stored securely.')
    }

    const details = {
      provider: input.provider,
      host,
      ...(input.organization?.trim() ? { organization: input.organization.trim() } : {}),
      ...(input.email?.trim() ? { email: input.email.trim() } : {}),
      ...(input.username?.trim() ? { username: input.username.trim() } : {})
    }
    const verified = await verifyAccount(details, token)
    const { username: _username, ...stored } = details
    const account: Account = { id: randomUUID(), ...stored, login: verified.login, gitUsername: verified.gitUsername }

    // One account per server: connecting again replaces the old one.
    const previous = this.findByHost(host)
    if (previous) this.remove(previous.id)
    this.secrets.set(TOKEN_PREFIX + account.id, token)
    this.write([...this.list(), account])
    return account
  }

  remove(id: string): void {
    this.secrets.delete(TOKEN_PREFIX + id)
    this.secrets.delete(REFRESH_PREFIX + id)
    this.write(this.list().filter((a) => a.id !== id))
  }

  async repos(id: string): Promise<HostedRepo[]> {
    const account = this.list().find((a) => a.id === id)
    const token = account ? await this.freshToken(account.id) : null
    if (!account || !token) throw new Error('This account is no longer connected')
    return listRepos(account, token)
  }

  private write(accounts: Account[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(accounts, null, 2))
  }
}
