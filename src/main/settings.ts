import fs from 'node:fs'
import path from 'node:path'
import type {
  AiSettings,
  CommitTemplate,
  CustomAction,
  CustomActionScope,
  IssueLinkRule,
  ThemeMode,
  UserSettings,
  Workspace
} from '../shared/types'
import { DEFAULT_ENDPOINT, DEFAULT_MODELS } from './ai'

/** What the Settings screen edits, apart from gitPath (kept at the top level, where it always was). */
export type StoredUserSettings = Partial<Omit<UserSettings, 'gitPath'>>

export interface AppSettings {
  recentRepos: string[]
  /** Explicit git executable; otherwise PATH and common install locations are searched. */
  gitPath?: string
  /** Folder the clone dialog last cloned into. */
  cloneFolder?: string
  /** OAuth applications for servers GitLantern has none for, such as a company GitLab: host → client ID. */
  oauthClients?: Record<string, string>
  /** Everything else the Settings screen changes. */
  user?: StoredUserSettings
  /**
   * Custom action commands the user agreed to run, as hashes of program and arguments. Kept apart
   * from `user`, which the renderer writes: only the main process's own prompt adds to it.
   */
  approvedActions?: string[]
  /** Every repository opened through a dialog, a clone or Recent; written by the main process only. */
  knownRepos?: string[]
}

const MAX_RECENT = 12
const MAX_KNOWN = 500

export const DEFAULT_AI: AiSettings = { provider: 'anthropic', endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODELS.anthropic, instructions: '' }

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  accent: '',
  colors: {},
  zoom: 100,
  autoFetchMinutes: 0,
  gitPath: '',
  editor: '',
  terminal: '',
  diffTool: '',
  mergeTool: '',
  customActions: [],
  issueLinks: [],
  commitTemplates: [],
  conventionalCommits: false,
  ai: DEFAULT_AI,
  workspaces: [],
  openTabs: [],
  activeTab: null
}

const isStringMap = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && Object.values(value).every((v) => typeof v === 'string')

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max = 500): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
const COLOR = /^#[0-9a-f]{6}$/i
// Theme variables a user may override: names only, values are colours.
const CSS_VARIABLE = /^--[a-z][a-z-]{1,40}$/
const SCOPES: CustomActionScope[] = ['repository', 'commit', 'branch', 'file']
const THEMES: ThemeMode[] = ['system', 'light', 'dark']

/** Items of a list setting that have the right shape; the rest are dropped. */
function listOf<T>(value: unknown, item: (entry: Record<string, unknown>) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    const parsed = isRecord(entry) ? item(entry) : undefined
    return parsed ? [parsed] : []
  })
}

const customAction = (entry: Record<string, unknown>): CustomAction | undefined => {
  const id = text(entry.id, 64)
  const name = text(entry.name, 100)
  const command = text(entry.command, 1000)
  const scope = SCOPES.find((s) => s === entry.scope)
  if (!id || !name?.trim() || !command?.trim() || !scope) return undefined
  return { id, name, scope, command, args: strings(entry.args) ?? [], confirm: entry.confirm === true }
}

const issueLink = (entry: Record<string, unknown>): IssueLinkRule | undefined => {
  const id = text(entry.id, 64)
  const pattern = text(entry.pattern, 300)
  const url = text(entry.url, 500)
  if (!id || !pattern || !url) return undefined
  try {
    new RegExp(pattern)
  } catch {
    return undefined
  }
  return { id, name: text(entry.name, 100) ?? '', pattern, url, remoteContains: text(entry.remoteContains, 200) ?? '' }
}

const commitTemplate = (entry: Record<string, unknown>): CommitTemplate | undefined => {
  const id = text(entry.id, 64)
  const name = text(entry.name, 100)
  const body = text(entry.text, 10_000)
  return id && name && body !== undefined ? { id, name, text: body } : undefined
}

const workspace = (entry: Record<string, unknown>): Workspace | undefined => {
  const id = text(entry.id, 64)
  const name = text(entry.name, 100)
  return id && name ? { id, name, repos: strings(entry.repos) ?? [] } : undefined
}

function aiSettings(value: unknown): AiSettings | undefined {
  if (!isRecord(value)) return undefined
  const provider = value.provider === 'openai' ? 'openai' : value.provider === 'anthropic' ? 'anthropic' : undefined
  if (!provider) return undefined
  return {
    provider,
    endpoint: text(value.endpoint, 500) ?? DEFAULT_ENDPOINT,
    model: text(value.model, 200) ?? DEFAULT_MODELS[provider],
    instructions: text(value.instructions, 4000) ?? ''
  }
}

/**
 * The settings in `value` that are valid, each checked on its own: from the renderer (Settings
 * screen) or from settings.json. Anything malformed is left out rather than stored.
 */
export function sanitizeSettings(value: unknown): Partial<UserSettings> {
  if (!isRecord(value)) return {}
  const result: Partial<UserSettings> = {}
  const theme = THEMES.find((t) => t === value.theme)
  if (theme) result.theme = theme
  if (typeof value.accent === 'string' && (value.accent === '' || COLOR.test(value.accent))) result.accent = value.accent
  if (isStringMap(value.colors)) {
    result.colors = Object.fromEntries(Object.entries(value.colors).filter(([name, color]) => CSS_VARIABLE.test(name) && COLOR.test(color)))
  }
  if (typeof value.zoom === 'number' && Number.isFinite(value.zoom)) result.zoom = Math.min(150, Math.max(80, Math.round(value.zoom)))
  if (typeof value.autoFetchMinutes === 'number' && Number.isFinite(value.autoFetchMinutes)) {
    result.autoFetchMinutes = Math.min(1440, Math.max(0, Math.round(value.autoFetchMinutes)))
  }
  // gitPath isn't taken from here: it names a program GitLantern runs, so only the main process's own
  // file picker sets it (Settings.setGitPath).
  for (const key of ['editor', 'terminal'] as const) {
    const entry = text(value[key], 1000)
    if (entry !== undefined) result[key] = entry
  }
  // Tool names go to git as --tool=<name>.
  for (const key of ['diffTool', 'mergeTool'] as const) {
    if (typeof value[key] === 'string' && /^[\w.-]{0,64}$/.test(value[key])) result[key] = value[key]
  }
  const actions = listOf(value.customActions, customAction)
  if (actions) result.customActions = actions
  const links = listOf(value.issueLinks, issueLink)
  if (links) result.issueLinks = links
  const templates = listOf(value.commitTemplates, commitTemplate)
  if (templates) result.commitTemplates = templates
  if (typeof value.conventionalCommits === 'boolean') result.conventionalCommits = value.conventionalCommits
  const ai = aiSettings(value.ai)
  if (ai) result.ai = ai
  const workspaces = listOf(value.workspaces, workspace)
  if (workspaces) result.workspaces = workspaces
  const tabs = strings(value.openTabs)
  if (tabs) result.openTabs = tabs
  if (value.activeTab === null || typeof value.activeTab === 'string') result.activeTab = value.activeTab
  return result
}

/**
 * GitLantern was called Git Steve, and its data folder was named after it. On the first start
 * after the rename, copy the old settings (recent repositories, clone folder, gitPath) across.
 * Accounts and remembered answers stay behind: their tokens are encrypted with a key that belongs
 * to the old app, so they're connected again. Returns whether anything was copied.
 */
export function adoptOldSettings(oldFolder: string, file: string): boolean {
  const old = path.join(oldFolder, 'settings.json')
  if (fs.existsSync(file) || !fs.existsSync(old)) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(old, file)
  return true
}

export class Settings {
  private data: AppSettings

  constructor(private readonly file: string) {
    this.data = this.load()
  }

  get(): Readonly<AppSettings> {
    return this.data
  }

  /** The Settings screen's values, with defaults for anything never set. */
  user(): UserSettings {
    return { ...DEFAULT_USER_SETTINGS, ...this.data.user, gitPath: this.data.gitPath ?? '' }
  }

  /** Change some of the Settings screen's values (never gitPath: see setGitPath); returns all of them. */
  setUser(patch: Partial<UserSettings>): UserSettings {
    const { gitPath: _ignored, ...rest } = patch
    this.data = { ...this.data, user: { ...this.data.user, ...rest } }
    this.save()
    return this.user()
  }

  /** The git executable to use from the next start, or null for the one on PATH. */
  setGitPath(file: string | null): UserSettings {
    const next: AppSettings = { ...this.data }
    if (file) next.gitPath = file
    else delete next.gitPath
    this.data = next
    this.save()
    return this.user()
  }

  /** Repositories the user opened through a dialog (or before), which tabs and workspaces may reopen. */
  knownRepos(): ReadonlySet<string> {
    return new Set([...(this.data.knownRepos ?? []), ...this.data.recentRepos])
  }

  isActionApproved(hash: string): boolean {
    return this.data.approvedActions?.includes(hash) ?? false
  }

  approveAction(hash: string): void {
    this.data = { ...this.data, approvedActions: [...(this.data.approvedActions ?? []), hash].slice(-200) }
    this.save()
  }

  addRecentRepo(repoPath: string): void {
    const rest = this.data.recentRepos.filter((p) => p !== repoPath)
    // Recent shows the last few; known keeps them all, so tabs and workspaces beyond those still reopen.
    const known = (this.data.knownRepos ?? []).filter((p) => p !== repoPath)
    this.data = { ...this.data, recentRepos: [repoPath, ...rest].slice(0, MAX_RECENT), knownRepos: [repoPath, ...known].slice(0, MAX_KNOWN) }
    this.save()
  }

  setCloneFolder(folder: string): void {
    this.data = { ...this.data, cloneFolder: folder }
    this.save()
  }

  private load(): AppSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<AppSettings>
      const user = sanitizeSettings(parsed.user)
      delete user.gitPath
      return {
        recentRepos: Array.isArray(parsed.recentRepos)
          ? parsed.recentRepos.filter((p): p is string => typeof p === 'string')
          : [],
        ...(typeof parsed.gitPath === 'string' ? { gitPath: parsed.gitPath } : {}),
        ...(typeof parsed.cloneFolder === 'string' ? { cloneFolder: parsed.cloneFolder } : {}),
        ...(isStringMap(parsed.oauthClients)
          ? { oauthClients: Object.fromEntries(Object.entries(parsed.oauthClients).map(([host, id]) => [host.trim().toLowerCase(), id])) }
          : {}),
        ...(Object.keys(user).length > 0 ? { user } : {}),
        ...(Array.isArray(parsed.approvedActions)
          ? { approvedActions: parsed.approvedActions.filter((h): h is string => typeof h === 'string') }
          : {}),
        ...(Array.isArray(parsed.knownRepos) ? { knownRepos: parsed.knownRepos.filter((p): p is string => typeof p === 'string') } : {})
      }
    } catch {
      return { recentRepos: [] }
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }
}
