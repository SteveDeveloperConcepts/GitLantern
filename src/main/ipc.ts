import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clipboard, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { Events, Invoke } from '../shared/ipc'
import { PROVIDERS, providerInfo, type ProviderId } from '../shared/providers'
import { parseRemoteUrl, serviceName } from '../shared/remoteUrl'
import type {
  AccountInput,
  AskPassAnswer,
  Branch,
  DiffTarget,
  IpcResult,
  RemoteInfo,
  RepoChangedEvent,
  RepoInfo
} from '../shared/types'
import type { AccountStore } from './accounts/store'
import { REMEMBERED_PREFIX, type AskPass } from './askpass'
import * as git from './git/commands'
import type { SecretStore } from './secrets'
import type { Settings } from './settings'
import { generateKey, loadKey, testSsh } from './ssh'
import { watchRepo } from './watcher'

interface Context {
  settings: Settings
  secrets: SecretStore
  accounts: AccountStore
  askpass: AskPass
  sshTools: { ssh: string; keygen: string }
  getWindow(): BrowserWindow | null
}

// The renderer is treated as untrusted: every argument is checked before it reaches git.
function str(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${name}`)
  return value
}

function strArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error(`Invalid ${name}`)
  }
  return value as string[]
}

function diffTarget(value: unknown): DiffTarget {
  const target = value as Partial<DiffTarget> | null
  const filePath = str(target?.path, 'path')
  switch (target?.kind) {
    case 'worktree':
      return { kind: 'worktree', path: filePath, untracked: target.untracked === true, conflicted: target.conflicted === true }
    case 'index':
      return { kind: 'index', path: filePath }
    case 'commit':
      return { kind: 'commit', path: filePath, hash: str(target.hash, 'hash') }
    default:
      throw new Error('Invalid diff target')
  }
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function accountInput(value: unknown): AccountInput {
  const input = value as Partial<AccountInput> | null
  const provider = input?.provider
  if (!PROVIDERS.some((p) => p.id === provider)) throw new Error('Unknown Git service')
  const host = typeof input?.host === 'string' ? input.host : ''
  const organization = optionalStr(input?.organization)
  const email = optionalStr(input?.email)
  const username = optionalStr(input?.username)
  return {
    provider: provider as ProviderId,
    host,
    token: str(input?.token, 'token'),
    ...(organization ? { organization } : {}),
    ...(email ? { email } : {}),
    ...(username ? { username } : {})
  }
}

function branchRef(value: unknown): Pick<Branch, 'name' | 'kind'> {
  const branch = value as Partial<Branch> | null
  if (branch?.kind !== 'local' && branch?.kind !== 'remote') throw new Error('Invalid branch')
  return { name: str(branch.name, 'branch name'), kind: branch.kind }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env.ELECTRON_RENDERER_URL
  return url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl))
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender' }
    try {
      return { ok: true, value: await fn(...args) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export function registerIpc(ctx: Context): void {
  // Repositories the user opened this session; git calls are only allowed on these.
  const openRepos = new Set<string>()
  let stopWatching: (() => void) | undefined

  const repoInfo = (repoPath: string, origin?: string | null): RepoInfo => ({
    path: repoPath,
    name: path.basename(repoPath),
    ...(origin ? { service: serviceLabel(origin) } : {})
  })

  /** Provider name when a connected account covers the URL's host, else a generic service name. */
  function serviceLabel(url: string): string {
    const host = parseRemoteUrl(url)?.host
    const account = host ? ctx.accounts.findByHost(host) : undefined
    return account ? providerInfo(account.provider).name : serviceName(url)
  }

  function remoteInfo(remote: { name: string; fetchUrl: string; pushUrl: string }): RemoteInfo {
    const parsed = parseRemoteUrl(remote.fetchUrl)
    const https = parsed?.protocol === 'https' || parsed?.protocol === 'http'
    const account = https && parsed ? ctx.accounts.findByHost(parsed.host) : undefined
    return {
      ...remote,
      protocol: parsed?.protocol ?? 'unknown',
      service: serviceLabel(remote.fetchUrl),
      accountLogin: account?.login ?? null
    }
  }

  function knownRepo(value: unknown): string {
    const repoPath = path.resolve(str(value, 'repository path'))
    if (!openRepos.has(repoPath)) throw new Error('Repository has not been opened')
    return repoPath
  }

  async function openRepo(dir: string): Promise<RepoInfo> {
    const root = await git.getRepoRoot(dir)
    openRepos.add(root)
    ctx.settings.addRecentRepo(root)
    stopWatching?.()
    stopWatching = watchRepo(root, (kinds) => {
      const event: RepoChangedEvent = { repoPath: root, kinds }
      ctx.getWindow()?.webContents.send(Events.repoChanged, event)
    })
    return repoInfo(root, await git.originUrl(root))
  }

  async function pickFolder(title: string): Promise<string | null> {
    const window = ctx.getWindow()
    const options = { title, properties: ['openDirectory' as const, 'createDirectory' as const] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  handle(Invoke.repoPick, async () => {
    const dir = await pickFolder('Open repository')
    return dir ? openRepo(dir) : null
  })
  handle(Invoke.repoPickFolder, () => pickFolder('Clone into'))
  handle(Invoke.repoDefaultCloneFolder, () => ctx.settings.get().cloneFolder ?? path.join(os.homedir(), 'Code'))
  handle(Invoke.repoClone, async (url, parentFolder) => {
    const parent = path.resolve(str(parentFolder, 'folder'))
    const target = await git.clone(str(url, 'address'), parent, (progress) =>
      ctx.getWindow()?.webContents.send(Events.cloneProgress, progress)
    )
    ctx.settings.setCloneFolder(parent)
    return openRepo(target)
  })
  handle(Invoke.repoOpen, (dir) => {
    // Only reopen folders the user picked before; new folders must go through the dialog.
    const repoPath = path.resolve(str(dir, 'repository path'))
    if (!ctx.settings.get().recentRepos.includes(repoPath)) throw new Error('Unknown repository')
    return openRepo(repoPath)
  })
  handle(Invoke.repoRecent, () =>
    Promise.all(
      ctx.settings
        .get()
        .recentRepos.filter((p) => fs.existsSync(p))
        .map(async (p) => repoInfo(p, await git.originUrl(p).catch(() => null)))
    )
  )

  handle(Invoke.remotesList, async (repo) => (await git.remotes(knownRepo(repo))).map(remoteInfo))
  handle(Invoke.remotesAdd, (repo, name, url) => git.addRemote(knownRepo(repo), str(name, 'name'), str(url, 'address')))
  handle(Invoke.remotesSetUrl, (repo, name, url) => git.setRemoteUrl(knownRepo(repo), str(name, 'name'), str(url, 'address')))
  handle(Invoke.remotesRemove, (repo, name) => git.removeRemote(knownRepo(repo), str(name, 'name')))
  handle(Invoke.remotesTest, (url) => git.testRemote(str(url, 'address'), os.homedir()))

  handle(Invoke.accountsList, () => ctx.accounts.list())
  handle(Invoke.accountsConnect, (input) => ctx.accounts.connect(accountInput(input)))
  handle(Invoke.accountsRemove, (id) => ctx.accounts.remove(str(id, 'account')))
  handle(Invoke.accountsRepos, (id) => ctx.accounts.repos(str(id, 'account')))

  handle(Invoke.sshKey, () => loadKey(ctx.sshTools.keygen))
  handle(Invoke.sshGenerate, (comment) => generateKey(ctx.sshTools.keygen, typeof comment === 'string' ? comment : ''))
  handle(Invoke.sshTest, (host) => testSsh(ctx.sshTools.ssh, str(host, 'host'), ctx.askpass.env))

  handle(Invoke.clipboardWrite, (text) => clipboard.writeText(str(text, 'text')))

  handle(Invoke.gitStatus, (repo) => git.status(knownRepo(repo)))
  handle(Invoke.gitLog, (repo, maxCount) =>
    git.log(knownRepo(repo), typeof maxCount === 'number' && maxCount > 0 ? Math.floor(maxCount) : undefined)
  )
  handle(Invoke.gitBranches, (repo) => git.branches(knownRepo(repo)))
  handle(Invoke.gitShow, (repo, hash) => git.show(knownRepo(repo), str(hash, 'hash')))
  handle(Invoke.gitDiff, (repo, target) => git.diff(knownRepo(repo), diffTarget(target)))
  handle(Invoke.gitStage, (repo, paths) => git.stage(knownRepo(repo), strArray(paths, 'paths')))
  handle(Invoke.gitUnstage, (repo, paths) => git.unstage(knownRepo(repo), strArray(paths, 'paths')))
  handle(Invoke.gitCommit, (repo, message) => git.commit(knownRepo(repo), str(message, 'commit message')))
  handle(Invoke.gitCheckout, (repo, branch) => git.checkout(knownRepo(repo), branchRef(branch)))
  handle(Invoke.gitCreateBranch, (repo, name, startPoint) =>
    git.createBranch(knownRepo(repo), str(name, 'branch name'), startPoint === undefined ? undefined : str(startPoint, 'start point'))
  )
  handle(Invoke.gitCompare, (repo, ref) => git.compare(knownRepo(repo), str(ref, 'branch or commit')))
  handle(Invoke.gitMerge, (repo, ref, options) =>
    git.merge(knownRepo(repo), str(ref, 'branch or commit'), {
      noFastForward: (options as { noFastForward?: unknown } | null)?.noFastForward === true
    })
  )
  handle(Invoke.gitRebase, (repo, onto) => git.rebase(knownRepo(repo), str(onto, 'branch or commit')))
  handle(Invoke.gitContinue, (repo) => git.continueOperation(knownRepo(repo)))
  handle(Invoke.gitSkip, (repo) => git.skipOperation(knownRepo(repo)))
  handle(Invoke.gitAbort, (repo) => git.abortOperation(knownRepo(repo)))
  handle(Invoke.gitFetch, (repo) => git.fetch(knownRepo(repo)))
  handle(Invoke.gitPull, (repo) => git.pull(knownRepo(repo)))
  handle(Invoke.gitPush, (repo) => git.push(knownRepo(repo)))

  handle(Invoke.askpassRespond, (id, answer) => {
    const reply = answer as Partial<AskPassAnswer> | null
    ctx.askpass.respond(
      str(id, 'prompt id'),
      reply && typeof reply.value === 'string' ? { value: reply.value, remember: reply.remember === true } : null
    )
  })

  handle(Invoke.secretsAvailable, () => ctx.secrets.available())
  handle(Invoke.secretsCount, () => ctx.secrets.keys(REMEMBERED_PREFIX).length)
  handle(Invoke.secretsClear, () => ctx.secrets.clear(REMEMBERED_PREFIX))
}
