import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clipboard, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { Events, Invoke } from '../shared/ipc'
import { PROVIDERS, providerInfo, type ProviderId } from '../shared/providers'
import { parseRemoteUrl, serviceName } from '../shared/remoteUrl'
import type {
  AccountInput,
  AiSettings,
  AskPassAnswer,
  NewPullRequest,
  Branch,
  ConflictPick,
  CustomActionContext,
  DiffOptions,
  DiffTarget,
  DraftComment,
  FinishFlowOptions,
  FlowConfig,
  FlowKind,
  GitConfigKey,
  IpcResult,
  LogFilter,
  NewTag,
  NewWorktree,
  PatchAction,
  RebaseStep,
  RemoteInfo,
  RepoChangedEvent,
  RepoInfo,
  ResetMode,
  SubmitReview
} from '../shared/types'
import type { AccountStore } from './accounts/store'
import * as ai from './ai'
import { REMEMBERED_PREFIX, type AskPass } from './askpass'
import { commandLog } from './commandLog'
import * as bisect from './git/bisect'
import * as git from './git/commands'
import * as files from './git/files'
import * as flow from './git/flow'
import * as history from './git/history'
import * as inspect from './git/inspect'
import * as refs from './git/refs'
import * as structure from './git/structure'
import * as pullRequests from './pullRequests'
import type { SecretStore } from './secrets'
import { sanitizeSettings, type Settings } from './settings'
import { generateKey, loadKey, testSsh } from './ssh'
import * as tools from './tools'
import type { Updater } from './updater'
import { watchRepo } from './watcher'

interface Context {
  settings: Settings
  secrets: SecretStore
  accounts: AccountStore
  askpass: AskPass
  updater: Updater
  sshTools: { ssh: string; keygen: string }
  getWindow(): BrowserWindow | null
}

/** The AI provider's API key, in the SecretStore, with the origin it was saved for. */
const AI_KEY = 'ai:api-key'

interface SavedAiKey {
  key: string
  origin: string
}

/** Where AI requests go for these settings: Anthropic's API, or the OpenAI-compatible server's origin. */
function aiOrigin(settings: AiSettings): string {
  if (settings.provider === 'anthropic') return 'https://api.anthropic.com'
  try {
    return new URL(settings.endpoint.trim() || ai.DEFAULT_ENDPOINT).origin
  } catch {
    return ''
  }
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
    case 'commit': {
      const origPath = optionalStr(target.origPath)
      return { kind: 'commit', path: filePath, hash: str(target.hash, 'hash'), ...(origPath ? { origPath } : {}) }
    }
    case 'stash':
      return { kind: 'stash', path: filePath, hash: str(target.hash, 'hash'), untracked: target.untracked === true }
    case 'range': {
      const origPath = optionalStr(target.origPath)
      return { kind: 'range', path: filePath, from: str(target.from, 'commit'), to: str(target.to, 'commit'), ...(origPath ? { origPath } : {}) }
    }
    default:
      throw new Error('Invalid diff target')
  }
}

function diffOptions(value: unknown): DiffOptions {
  return { ignoreWhitespace: (value as DiffOptions | null)?.ignoreWhitespace === true }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new Error(`Invalid ${name}`)
  return value as T
}

const REBASE_ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'] as const
const FLOW_KINDS = ['feature', 'release', 'hotfix'] as const
const CONFIG_KEYS = ['user.name', 'user.email', 'commit.gpgsign', 'tag.gpgsign'] as const

function rebaseSteps(value: unknown): RebaseStep[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid rebase steps')
  return value.map((item) => {
    const step = item as Partial<RebaseStep> | null
    const message = typeof step?.message === 'string' && step.message.trim() ? step.message : undefined
    return { hash: str(step?.hash, 'hash'), action: oneOf(step?.action, REBASE_ACTIONS, 'rebase action'), ...(message ? { message } : {}) }
  })
}

function newTag(value: unknown): NewTag {
  const tag = value as Partial<NewTag> | null
  const message = optionalStr(tag?.message)
  return { name: str(tag?.name, 'tag name'), target: str(tag?.target, 'commit'), ...(message ? { message } : {}), sign: tag?.sign === true }
}

function newWorktree(value: unknown): NewWorktree {
  const input = value as { path?: unknown; branch?: unknown; newBranch?: unknown; startPoint?: unknown } | null
  const worktreePath = str(input?.path, 'folder')
  if (!path.isAbsolute(worktreePath)) throw new Error('Choose a folder for the worktree')
  if (typeof input?.newBranch === 'string' && input.newBranch) {
    const startPoint = optionalStr(input.startPoint)
    return { path: worktreePath, newBranch: input.newBranch, ...(startPoint ? { startPoint } : {}) }
  }
  return { path: worktreePath, branch: str(input?.branch, 'branch') }
}

function flowConfig(value: unknown): FlowConfig {
  const config = value as Partial<FlowConfig> | null
  const prefixes = (config?.prefixes ?? {}) as Partial<Record<FlowKind, unknown>>
  const prefix = (kind: FlowKind): string => (typeof prefixes[kind] === 'string' ? (prefixes[kind] as string) : `${kind}/`)
  return {
    master: str(config?.master, 'production branch'),
    develop: str(config?.develop, 'development branch'),
    prefixes: { feature: prefix('feature'), release: prefix('release'), hotfix: prefix('hotfix') },
    versionTagPrefix: typeof config?.versionTagPrefix === 'string' ? config.versionTagPrefix : ''
  }
}

function finishOptions(value: unknown): FinishFlowOptions {
  const options = value as Partial<FinishFlowOptions> | null
  const tagMessage = optionalStr(options?.tagMessage)
  return { ...(tagMessage ? { tagMessage } : {}), keepBranch: options?.keepBranch === true }
}

function prNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error('Invalid pull request')
  return value
}

function submitReview(value: unknown): SubmitReview {
  const review = value as Partial<SubmitReview> | null
  const comments = Array.isArray(review?.comments) ? review.comments : []
  return {
    verdict: oneOf(review?.verdict, ['comment', 'approve', 'request-changes'] as const, 'review'),
    body: typeof review?.body === 'string' ? review.body : '',
    comments: comments.map((item) => {
      const comment = item as Partial<DraftComment> | null
      const line = comment?.line
      if (typeof line !== 'number' || !Number.isInteger(line) || line <= 0) throw new Error('Invalid comment line')
      return { path: str(comment?.path, 'path'), line, side: oneOf(comment?.side, ['old', 'new'] as const, 'side'), body: str(comment?.body, 'comment') }
    })
  }
}

function actionContext(value: unknown): CustomActionContext {
  const context = value as Partial<CustomActionContext> | null
  const sha = optionalStr(context?.sha)
  const branch = optionalStr(context?.branch)
  const file = optionalStr(context?.file)
  return { ...(sha ? { sha } : {}), ...(branch ? { branch } : {}), ...(file ? { file } : {}) }
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

function newPullRequest(value: unknown): NewPullRequest {
  const input = value as Partial<NewPullRequest> | null
  return {
    title: str(input?.title, 'title'),
    description: typeof input?.description === 'string' ? input.description : '',
    source: str(input?.source, 'branch'),
    target: str(input?.target, 'branch')
  }
}

function logFilter(value: unknown): LogFilter {
  const filter = value as Partial<LogFilter> | null
  const branch = optionalStr(filter?.branch)
  const filePath = optionalStr(filter?.path)
  return { ...(branch ? { branch } : {}), ...(filePath ? { path: filePath } : {}) }
}

function patchAction(value: unknown): PatchAction {
  if (value !== 'stage' && value !== 'unstage' && value !== 'discard') throw new Error('Invalid patch action')
  return value
}

function conflictPick(value: unknown): ConflictPick {
  const pick = value as Partial<ConflictPick> | null
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
  if (!whole(pick?.index) || !whole(pick.conflicts) || !['ours', 'theirs', 'both'].includes(pick.choice ?? '')) {
    throw new Error('Invalid conflict choice')
  }
  return { index: pick.index, conflicts: pick.conflicts, choice: pick.choice as ConflictPick['choice'] }
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
  // One watcher per repository open in a tab.
  const watchers = new Map<string, () => void>()

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
    if (!watchers.has(root)) {
      watchers.set(
        root,
        watchRepo(root, (kinds) => {
          const event: RepoChangedEvent = { repoPath: root, kinds }
          ctx.getWindow()?.webContents.send(Events.repoChanged, event)
        })
      )
    }
    return repoInfo(root, await git.originUrl(root))
  }

  async function pickFolder(title: string): Promise<string | null> {
    const window = ctx.getWindow()
    const options = { title, properties: ['openDirectory' as const, 'createDirectory' as const] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  async function pickSaveFile(title: string, defaultName: string, extension: string): Promise<string | null> {
    const window = ctx.getWindow()
    const options = {
      title,
      defaultPath: path.join(os.homedir(), defaultName),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  }

  async function pickOpenFile(title: string, extensions: string[]): Promise<string | null> {
    const window = ctx.getWindow()
    const options = {
      title,
      properties: ['openFile' as const],
      filters: [
        { name: 'Patches', extensions },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  const shortName = (revision: string): string => revision.replace(/[^\w.-]+/g, '-').slice(0, 40)

  /** Tool detection runs once: it looks through PATH and the usual install folders. */
  let detected: Promise<tools.DetectedTools> | undefined
  const detectedTools = (): Promise<tools.DetectedTools> => (detected ??= tools.findTools())

  const broadcastSettings = (): void => ctx.getWindow()?.webContents.send(Events.settingsChanged, ctx.settings.user())
  // Windows paths compare without case.
  const samePath = (a: string, b: string): boolean =>
    process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)

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
    if (!ctx.settings.knownRepos().has(repoPath)) throw new Error('Unknown repository')
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
  handle(Invoke.repoOpenRelated, async (repo, target) => {
    const parent = knownRepo(repo)
    const requested = path.resolve(parent, str(target, 'path'))
    // Only what git lists for this repository: its submodules (folders inside it) and its worktrees.
    const [submodules, worktrees] = await Promise.all([structure.submodules(parent), structure.worktrees(parent)])
    const listed =
      submodules.some((s) => samePath(git.insideRepo(parent, s.path), requested)) || worktrees.some((w) => samePath(w.path, requested))
    if (!listed) throw new Error('That folder isn’t a submodule or worktree of this repository')
    // And it must be a repository of its own, not a folder git resolves to something else.
    if (!samePath(await git.getRepoRoot(requested), requested)) throw new Error('That folder isn’t a repository of its own')
    return openRepo(requested)
  })
  handle(Invoke.repoOpenKnown, async (paths) => {
    // Tabs and workspaces only hold repositories the user opened before.
    const known = ctx.settings.knownRepos()
    const opened: (RepoInfo | null)[] = []
    for (const p of Array.isArray(paths) ? paths : []) {
      if (typeof p !== 'string' || !p) continue
      const repoPath = path.resolve(p)
      if (!known.has(repoPath) || !fs.existsSync(repoPath)) continue
      // One that's no longer a repository is left out.
      opened.push(await openRepo(repoPath).catch(() => null))
    }
    return opened.filter((info): info is RepoInfo => info !== null)
  })
  handle(Invoke.repoClose, (repo) => {
    const repoPath = path.resolve(str(repo, 'repository path'))
    watchers.get(repoPath)?.()
    watchers.delete(repoPath)
  })
  handle(Invoke.repoPickSaveFolder, (title) => pickFolder(typeof title === 'string' ? title : 'Choose a folder'))

  handle(Invoke.remotesList, async (repo) => (await git.remotes(knownRepo(repo))).map(remoteInfo))
  handle(Invoke.remotesAdd, (repo, name, url) => git.addRemote(knownRepo(repo), str(name, 'name'), str(url, 'address')))
  handle(Invoke.remotesSetUrl, (repo, name, url) => git.setRemoteUrl(knownRepo(repo), str(name, 'name'), str(url, 'address')))
  handle(Invoke.remotesRemove, (repo, name) => git.removeRemote(knownRepo(repo), str(name, 'name')))
  handle(Invoke.remotesTest, (url) => git.testRemote(str(url, 'address'), os.homedir()))

  handle(Invoke.accountsList, () => ctx.accounts.list())
  handle(Invoke.accountsConnect, (input) => ctx.accounts.connect(accountInput(input)))
  handle(Invoke.accountsRemove, (id) => ctx.accounts.remove(str(id, 'account')))
  handle(Invoke.accountsRepos, (id) => ctx.accounts.repos(str(id, 'account')))
  handle(Invoke.accountsBrowserSignInHosts, () => ctx.accounts.browserSignInHosts())

  // One browser sign-in at a time; starting another or cancelling stops the one before.
  let signIn: AbortController | undefined
  handle(Invoke.accountsSignIn, async (provider, host) => {
    if (!PROVIDERS.some((p) => p.id === provider)) throw new Error('Unknown Git service')
    signIn?.abort()
    const controller = new AbortController()
    signIn = controller
    try {
      return await ctx.accounts.signIn(provider as ProviderId, typeof host === 'string' ? host : '', {
        // Only ever the service's own https pages.
        openUrl: (url) => void (url.startsWith('https://') && shell.openExternal(url)),
        onProgress: (progress) => ctx.getWindow()?.webContents.send(Events.signInProgress, progress),
        signal: controller.signal
      })
    } finally {
      if (signIn === controller) signIn = undefined
    }
  })
  handle(Invoke.accountsCancelSignIn, () => signIn?.abort())

  handle(Invoke.pullRequestsList, (repo) => pullRequests.list(knownRepo(repo), ctx.accounts))
  handle(Invoke.pullRequestsCreate, (repo, input) => pullRequests.create(knownRepo(repo), ctx.accounts, newPullRequest(input)))
  handle(Invoke.pullRequestsCheckout, (repo, number) => pullRequests.checkout(knownRepo(repo), ctx.accounts, prNumber(number)))
  handle(Invoke.pullRequestsDetail, (repo, number) => pullRequests.detail(knownRepo(repo), ctx.accounts, prNumber(number)))
  handle(Invoke.pullRequestsComments, (repo, number) => pullRequests.comments(knownRepo(repo), ctx.accounts, prNumber(number)))
  handle(Invoke.pullRequestsSubmitReview, (repo, number, head, review) =>
    pullRequests.submitReview(knownRepo(repo), ctx.accounts, prNumber(number), str(head, 'commit'), submitReview(review))
  )

  handle(Invoke.sshKey, () => loadKey(ctx.sshTools.keygen))
  handle(Invoke.sshGenerate, (comment) => generateKey(ctx.sshTools.keygen, typeof comment === 'string' ? comment : ''))
  handle(Invoke.sshTest, (host) => testSsh(ctx.sshTools.ssh, str(host, 'host'), ctx.askpass.env))

  handle(Invoke.clipboardWrite, (text) => clipboard.writeText(str(text, 'text')))

  handle(Invoke.gitStatus, (repo) => git.status(knownRepo(repo)))
  handle(Invoke.gitLog, (repo, filter) => git.log(knownRepo(repo), undefined, logFilter(filter)))
  handle(Invoke.gitBranches, (repo) => git.branches(knownRepo(repo)))
  handle(Invoke.gitShow, (repo, hash) => git.show(knownRepo(repo), str(hash, 'hash')))
  handle(Invoke.gitDiff, (repo, target) => git.diff(knownRepo(repo), diffTarget(target)))
  handle(Invoke.gitStage, (repo, paths) => git.stage(knownRepo(repo), strArray(paths, 'paths')))
  handle(Invoke.gitUnstage, (repo, paths) => git.unstage(knownRepo(repo), strArray(paths, 'paths')))
  // Untracked files go to the trash rather than being deleted outright, in case one mattered.
  handle(Invoke.gitDiscard, (repo, paths) => git.discard(knownRepo(repo), strArray(paths, 'paths'), (file) => shell.trashItem(file)))
  handle(Invoke.gitApplyPatch, (repo, file, patch, action) =>
    git.applyPatch(knownRepo(repo), str(file, 'path'), str(patch, 'patch'), patchAction(action))
  )
  handle(Invoke.gitResolveConflict, (repo, file, pick) => git.resolveConflict(knownRepo(repo), str(file, 'path'), conflictPick(pick)))
  handle(Invoke.gitResolveFile, (repo, file, side) => {
    if (side !== 'ours' && side !== 'theirs') throw new Error('Invalid side')
    return git.resolveFile(knownRepo(repo), str(file, 'path'), side)
  })
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
  handle(Invoke.gitCherryPick, (repo, hash) => git.cherryPick(knownRepo(repo), str(hash, 'hash')))
  handle(Invoke.gitContinue, (repo) => git.continueOperation(knownRepo(repo)))
  handle(Invoke.gitSkip, (repo) => git.skipOperation(knownRepo(repo)))
  handle(Invoke.gitAbort, (repo) => git.abortOperation(knownRepo(repo)))
  handle(Invoke.gitFetch, (repo) => git.fetch(knownRepo(repo)))
  handle(Invoke.gitPull, (repo) => git.pull(knownRepo(repo)))
  handle(Invoke.gitPush, (repo) => git.push(knownRepo(repo)))
  handle(Invoke.gitForcePush, (repo, expected) => git.forcePush(knownRepo(repo), str(expected, 'commit')))
  handle(Invoke.gitStashes, (repo) => git.stashes(knownRepo(repo)))
  handle(Invoke.gitStash, (repo, message) => git.stash(knownRepo(repo), typeof message === 'string' ? message : ''))
  handle(Invoke.gitApplyStash, (repo, hash, options) =>
    git.applyStash(knownRepo(repo), str(hash, 'stash'), { pop: (options as { pop?: unknown } | null)?.pop === true })
  )
  handle(Invoke.gitDropStash, (repo, hash) => git.dropStash(knownRepo(repo), str(hash, 'stash')))
  handle(Invoke.gitShowStash, (repo, hash) => git.showStash(knownRepo(repo), str(hash, 'stash')))

  handle(Invoke.gitDiffWith, (repo, target, options) => git.diff(knownRepo(repo), diffTarget(target), diffOptions(options)))
  handle(Invoke.gitImagePair, (repo, target) => inspect.imagePair(knownRepo(repo), diffTarget(target)))
  handle(Invoke.gitCompareFiles, (repo, from, to) => inspect.compareFiles(knownRepo(repo), str(from, 'commit'), str(to, 'commit')))
  handle(Invoke.gitBlame, (repo, file, revision) =>
    inspect.blame(knownRepo(repo), str(file, 'path'), revision === undefined || revision === null ? undefined : str(revision, 'commit'))
  )
  handle(Invoke.gitFileHistory, (repo, file) => inspect.fileHistory(knownRepo(repo), str(file, 'path')))

  handle(Invoke.gitAmend, (repo, message) =>
    history.amend(knownRepo(repo), message === null ? null : str(message, 'commit message'))
  )
  handle(Invoke.gitHeadMessage, (repo) => history.headMessage(knownRepo(repo)))
  handle(Invoke.gitReword, (repo, hash, message) => history.reword(knownRepo(repo), str(hash, 'hash'), str(message, 'commit message')))
  handle(Invoke.gitRevert, (repo, hash) => history.revert(knownRepo(repo), str(hash, 'hash')))
  handle(Invoke.gitReset, (repo, hash, mode) =>
    history.reset(knownRepo(repo), str(hash, 'hash'), oneOf<ResetMode>(mode, ['soft', 'mixed', 'hard'], 'reset mode'))
  )
  handle(Invoke.gitRebaseCommits, (repo, base) => history.rebaseCommits(knownRepo(repo), base === null ? null : str(base, 'commit')))
  handle(Invoke.gitInteractiveRebase, (repo, base, steps) =>
    history.interactiveRebase(knownRepo(repo), base === null ? null : str(base, 'commit'), rebaseSteps(steps))
  )

  handle(Invoke.gitDeleteBranch, (repo, name, force) => refs.deleteBranch(knownRepo(repo), str(name, 'branch'), force === true))
  handle(Invoke.gitDeleteRemoteBranch, (repo, name) => refs.deleteRemoteBranch(knownRepo(repo), str(name, 'branch')))
  handle(Invoke.gitRenameBranch, (repo, name, newName) => refs.renameBranch(knownRepo(repo), str(name, 'branch'), str(newName, 'branch name')))
  handle(Invoke.gitSetUpstream, (repo, name, upstream) =>
    refs.setUpstream(knownRepo(repo), str(name, 'branch'), upstream === null ? null : str(upstream, 'remote branch'))
  )
  handle(Invoke.gitPushBranch, (repo, name, remote) => refs.pushBranch(knownRepo(repo), str(name, 'branch'), str(remote, 'remote')))
  handle(Invoke.gitTags, (repo) => refs.tags(knownRepo(repo)))
  handle(Invoke.gitCreateTag, (repo, tag) => refs.createTag(knownRepo(repo), newTag(tag)))
  handle(Invoke.gitDeleteTag, (repo, name) => refs.deleteTag(knownRepo(repo), str(name, 'tag')))
  handle(Invoke.gitPushTag, (repo, name, remote) => refs.pushTag(knownRepo(repo), str(name, 'tag'), str(remote, 'remote')))
  handle(Invoke.gitDeleteRemoteTag, (repo, name, remote) => refs.deleteRemoteTag(knownRepo(repo), str(name, 'tag'), str(remote, 'remote')))

  handle(Invoke.gitSubmodules, (repo) => structure.submodules(knownRepo(repo)))
  handle(Invoke.gitUpdateSubmodules, (repo, paths) =>
    structure.updateSubmodules(knownRepo(repo), Array.isArray(paths) && paths.length === 0 ? [] : strArray(paths, 'paths'))
  )
  handle(Invoke.gitAddSubmodule, (repo, url, file) => structure.addSubmodule(knownRepo(repo), str(url, 'address'), str(file, 'path')))
  handle(Invoke.gitRemoveSubmodule, (repo, file) => structure.removeSubmodule(knownRepo(repo), str(file, 'path')))
  handle(Invoke.gitWorktrees, (repo) => structure.worktrees(knownRepo(repo)))
  handle(Invoke.gitAddWorktree, (repo, worktree) => structure.addWorktree(knownRepo(repo), newWorktree(worktree)))
  handle(Invoke.gitRemoveWorktree, (repo, file, force) => structure.removeWorktree(knownRepo(repo), str(file, 'folder'), force === true))
  handle(Invoke.gitPruneWorktrees, (repo) => structure.pruneWorktrees(knownRepo(repo)))
  handle(Invoke.gitLockWorktree, (repo, file, locked) => structure.lockWorktree(knownRepo(repo), str(file, 'folder'), locked === true))
  handle(Invoke.gitLfs, (repo) => structure.lfs(knownRepo(repo)))
  handle(Invoke.gitLfsInstall, (repo) => structure.lfsInstall(knownRepo(repo)))
  handle(Invoke.gitLfsTrack, (repo, pattern) => structure.lfsTrack(knownRepo(repo), str(pattern, 'pattern')))
  handle(Invoke.gitLfsUntrack, (repo, pattern) => structure.lfsUntrack(knownRepo(repo), str(pattern, 'pattern')))
  handle(Invoke.gitLfsPull, (repo) => structure.lfsPull(knownRepo(repo)))
  handle(Invoke.gitLfsPush, (repo) => structure.lfsPush(knownRepo(repo)))
  handle(Invoke.gitLfsLocks, (repo) => structure.lfsLocks(knownRepo(repo)))
  handle(Invoke.gitLfsLock, (repo, file) => structure.lfsLock(knownRepo(repo), str(file, 'path')))
  handle(Invoke.gitLfsUnlock, (repo, file, force) => structure.lfsUnlock(knownRepo(repo), str(file, 'path'), force === true))

  handle(Invoke.gitFlowConfig, (repo) => flow.flowConfig(knownRepo(repo)))
  handle(Invoke.gitFlowInit, (repo, config) => flow.flowInit(knownRepo(repo), flowConfig(config)))
  handle(Invoke.gitFlowStart, (repo, kind, name) => flow.flowStart(knownRepo(repo), oneOf(kind, FLOW_KINDS, 'branch kind'), str(name, 'name')))
  handle(Invoke.gitFlowFinish, (repo, kind, name, options) =>
    flow.flowFinish(knownRepo(repo), oneOf(kind, FLOW_KINDS, 'branch kind'), str(name, 'name'), finishOptions(options))
  )

  handle(Invoke.gitBisectStart, (repo, bad, good) => bisect.bisectStart(knownRepo(repo), str(bad, 'commit'), str(good, 'commit')))
  handle(Invoke.gitBisectMark, (repo, verdict) => bisect.bisectMark(knownRepo(repo), oneOf(verdict, ['good', 'bad', 'skip'] as const, 'verdict')))
  handle(Invoke.gitBisectReset, (repo) => bisect.bisectReset(knownRepo(repo)))

  handle(Invoke.gitArchive, async (repo, revision) => {
    const repoPath = knownRepo(repo)
    const rev = str(revision, 'commit')
    const file = await pickSaveFile('Save archive', `${path.basename(repoPath)}-${shortName(rev)}.zip`, 'zip')
    if (!file) return null
    await files.archive(repoPath, rev, file)
    return file
  })
  handle(Invoke.gitSavePatch, async (repo, hashes) => {
    const repoPath = knownRepo(repo)
    const list = Array.isArray(hashes) && hashes.length === 0 ? [] : strArray(hashes, 'commits')
    const name = list.length === 0 ? 'uncommitted-changes' : list.length === 1 ? shortName(list[0]?.slice(0, 7) ?? 'commit') : `${list.length}-commits`
    const file = await pickSaveFile('Save as patch', `${name}.patch`, 'patch')
    if (!file) return null
    await files.savePatch(repoPath, list, file)
    return file
  })
  handle(Invoke.gitApplyPatchFile, async (repo) => {
    const repoPath = knownRepo(repo)
    const file = await pickOpenFile('Apply a patch', ['patch', 'diff', 'mbox', 'eml'])
    return file ? files.applyPatchFile(repoPath, file) : null
  })
  handle(Invoke.gitCleanPreview, (repo, ignored) => files.cleanPreview(knownRepo(repo), ignored === true))
  // Like discarding new files, cleaning moves them to the trash in case one mattered.
  handle(Invoke.gitClean, (repo, paths) => files.clean(knownRepo(repo), strArray(paths, 'paths'), (file) => shell.trashItem(file)))
  handle(Invoke.gitIgnore, (repo, pattern, where) =>
    files.ignore(knownRepo(repo), str(pattern, 'pattern'), oneOf(where, ['gitignore', 'exclude'] as const, 'ignore file'))
  )
  handle(Invoke.gitIdentity, (repo) => files.identity(knownRepo(repo)))
  handle(Invoke.gitSetConfig, (repo, key, value) =>
    files.setConfig(
      repo === null ? null : knownRepo(repo),
      oneOf<GitConfigKey>(key, CONFIG_KEYS, 'setting'),
      value === null ? null : typeof value === 'string' ? value : str(value, 'value')
    )
  )

  handle(Invoke.settingsGet, () => ctx.settings.user())
  handle(Invoke.settingsSet, (patch) => {
    const result = ctx.settings.setUser(sanitizeSettings(patch))
    // The interface size is Chromium's zoom, so pointer positions and the graph's canvas stay in step.
    ctx.getWindow()?.webContents.setZoomFactor(result.zoom / 100)
    broadcastSettings()
    return result
  })
  handle(Invoke.settingsAiKeyOrigin, () => savedAiKey()?.origin ?? null)
  handle(Invoke.settingsSetAiKey, (key) => {
    if (key === null || key === '') {
      ctx.secrets.delete(AI_KEY)
      return
    }
    // The key is kept with the address it was saved for, and only ever sent there.
    const saved: SavedAiKey = { key: str(key, 'API key').trim(), origin: aiOrigin(ctx.settings.user().ai) }
    if (!ctx.secrets.set(AI_KEY, JSON.stringify(saved))) {
      throw new Error('This computer’s keychain isn’t available, so the key can’t be saved safely.')
    }
  })
  handle(Invoke.settingsChooseGit, async (reset) => {
    if (reset === true) {
      const result = ctx.settings.setGitPath(null)
      broadcastSettings()
      return result
    }
    // A program GitLantern runs for every git command, so it's picked here, never typed in by the renderer.
    const window = ctx.getWindow()
    const options = {
      title: 'Choose the git program',
      properties: ['openFile' as const],
      ...(process.platform === 'win32' ? { filters: [{ name: 'git.exe', extensions: ['exe'] }] } : {})
    }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const file = picked.canceled ? undefined : picked.filePaths[0]
    if (!file) return ctx.settings.user()
    if (!/^git(\.exe)?$/i.test(path.basename(file))) throw new Error(`${path.basename(file)} isn’t git. Pick git${process.platform === 'win32' ? '.exe' : ''}.`)
    const result = ctx.settings.setGitPath(file)
    broadcastSettings()
    return result
  })

  handle(Invoke.toolsList, async () => {
    const found = await detectedTools()
    const plain = (list: tools.LaunchableTool[]) => list.map(({ id, name }) => ({ id, name }))
    return { editors: plain(found.editors), terminals: plain(found.terminals) }
  })
  handle(Invoke.toolsOpenInEditor, async (repo, file) => {
    const repoPath = knownRepo(repo)
    const found = await detectedTools()
    const editor = found.editors.find((e) => e.id === ctx.settings.user().editor) ?? found.editors[0]
    if (!editor) throw new Error('No editor found. Install Visual Studio Code or another editor, or pick one in Settings.')
    tools.launch(editor, repoPath, typeof file === 'string' && file ? path.relative(repoPath, path.resolve(repoPath, file)) : undefined)
  })
  handle(Invoke.toolsOpenTerminal, async (repo) => {
    const repoPath = knownRepo(repo)
    const found = await detectedTools()
    const terminal = found.terminals.find((t) => t.id === ctx.settings.user().terminal) ?? found.terminals[0]
    if (!terminal) throw new Error('No terminal found.')
    tools.launch(terminal, repoPath)
  })
  handle(Invoke.toolsShowInFolder, (repo, file) => {
    const repoPath = knownRepo(repo)
    if (typeof file === 'string' && file) {
      shell.showItemInFolder(git.insideRepo(repoPath, file))
    } else {
      void shell.openPath(repoPath)
    }
  })
  handle(Invoke.toolsDiffTool, (repo, target) => tools.diffTool(knownRepo(repo), diffTarget(target), ctx.settings.user().diffTool))
  handle(Invoke.toolsMergeTool, (repo, file) => tools.mergeTool(knownRepo(repo), str(file, 'path'), ctx.settings.user().mergeTool))
  handle(Invoke.toolsRunCustomAction, async (repo, id, context) => {
    const repoPath = knownRepo(repo)
    const action = ctx.settings.user().customActions.find((a) => a.id === id)
    if (!action) throw new Error('That custom action doesn’t exist any more')
    // The renderer can change settings, so a new or edited command is confirmed here, by the main
    // process, before it first runs. The approval is for the program as found (a full path), so a
    // different program under the same name is asked about again.
    const program = tools.resolveProgram(action.command, repoPath)
    if (!program) return tools.runCustomAction(action, repoPath, actionContext(context))
    const hash = createHash('sha256').update([program, ...action.args].join('\0')).digest('hex')
    if (!ctx.settings.isActionApproved(hash)) {
      const window = ctx.getWindow()
      const options = {
        type: 'question' as const,
        buttons: ['Run', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Run a custom action',
        message: `Run “${action.name}” for the first time?`,
        detail: `${program} ${action.args.join(' ')}\n\nThis was set up in Settings → Custom actions. GitLantern asks once for each new or changed command.`
      }
      const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
      if (response !== 0) return { exitCode: null, output: 'Not run.' }
      ctx.settings.approveAction(hash)
    }
    return tools.runCustomAction(action, repoPath, actionContext(context))
  })
  handle(Invoke.toolsOpenUrl, (url) => {
    const link = str(url, 'address')
    // Issue links only: web pages, never files or other programs.
    if (!/^https?:\/\//i.test(link)) throw new Error('Only web addresses can be opened')
    void shell.openExternal(link)
  })

  handle(Invoke.aiCommitMessage, async (repo) => {
    const repoPath = knownRepo(repo)
    const settings = ctx.settings.user().ai
    const saved = savedAiKey()
    const origin = aiOrigin(settings)
    // A key saved for one service is never sent to another, whatever the settings say now.
    if (saved && saved.origin !== origin) {
      throw new Error(
        `Your saved API key is for ${saved.origin || 'another service'}, not ${origin || 'this address'}. Save a key for this service under ` +
          'Settings → AI, or remove the saved one to use a server that needs none.'
      )
    }
    if (!saved && settings.provider === 'anthropic') throw new Error('Add your Anthropic API key in Settings → AI first.')
    return ai.commitMessage({ ...(await ai.stagedContext(repoPath)), settings, apiKey: saved?.key ?? '' })
  })

  handle(Invoke.commandLogList, () => commandLog.list())
  handle(Invoke.commandLogClear, () => commandLog.clear())

  /** The saved AI key and the origin it may go to; null when none is saved, or it can't be read. */
  function savedAiKey(): SavedAiKey | null {
    const stored = ctx.secrets.get(AI_KEY)
    if (!stored) return null
    try {
      const parsed = JSON.parse(stored) as Partial<SavedAiKey>
      return typeof parsed.key === 'string' && typeof parsed.origin === 'string' ? { key: parsed.key, origin: parsed.origin } : null
    } catch {
      return null
    }
  }

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

  handle(Invoke.updateState, () => ctx.updater.state())
  handle(Invoke.updateInstall, () => ctx.updater.install())
}
