import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeHost, providerInfo } from '../../shared/providers'
import type { Account, AccountInput, HostedRepo } from '../../shared/types'
import type { SecretStore } from '../secrets'
import { listRepos, verifyAccount } from './providerApi'

const TOKEN_PREFIX = 'account:'

/**
 * Connected accounts. Metadata (host, login) lives in accounts.json; each token is kept
 * in the SecretStore, encrypted with the OS keychain, and never sent to the renderer.
 */
export class AccountStore {
  constructor(
    private readonly file: string,
    private readonly secrets: SecretStore
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

  token(id: string): string | null {
    return this.secrets.get(TOKEN_PREFIX + id)
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
    this.write(this.list().filter((a) => a.id !== id))
  }

  async repos(id: string): Promise<HostedRepo[]> {
    const account = this.list().find((a) => a.id === id)
    const token = account ? this.token(account.id) : null
    if (!account || !token) throw new Error('This account is no longer connected')
    return listRepos(account, token)
  }

  private write(accounts: Account[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(accounts, null, 2))
  }
}
