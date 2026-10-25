import type { ProviderId } from './providers'
import type { RemoteProtocol } from './remoteUrl'

/** One-letter change codes as reported by `git status --porcelain=v2`. */
export type FileStatusCode = 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U'

export interface StatusEntry {
  path: string
  /** Original path for renames and copies. */
  origPath?: string
  /** Change recorded in the index (staged), or null. */
  index: FileStatusCode | null
  /** Change in the working tree (unstaged), or null. */
  worktree: FileStatusCode | null
  untracked: boolean
  conflicted: boolean
}

export interface BranchStatus {
  /** Current branch name, or null when HEAD is detached. */
  head: string | null
  /** HEAD commit, or null on an unborn branch. */
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export interface RepoStatus {
  branch: BranchStatus
  entries: StatusEntry[]
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

export interface RefLabel {
  name: string
  kind: RefKind
  /** True for the branch HEAD points at. */
  isCurrent?: boolean
}

export interface Commit {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  /** Author date in unix seconds. */
  authorDate: number
  subject: string
  refs: RefLabel[]
}

export interface ChangedFile {
  /** A, M, D, R, C, T or U. */
  status: string
  path: string
  origPath?: string
  /** Lines added and removed; null for binary files. */
  additions?: number | null
  deletions?: number | null
}

export interface CommitDetail extends Commit {
  body: string
  files: ChangedFile[]
}

export interface Branch {
  /** Short name, e.g. `main` or `origin/main`. */
  name: string
  fullName: string
  kind: 'local' | 'remote'
  hash: string
  upstream: string | null
  isCurrent: boolean
}

export interface RepoInfo {
  path: string
  name: string
  /** Where `origin` is hosted (GitHub, a host name…), when known. */
  service?: string
}

/** A connected Git hosting account. The token itself never leaves the main process. */
export interface Account {
  id: string
  provider: ProviderId
  /** Server the account belongs to, e.g. `github.com` or `git.example.com`. */
  host: string
  /** Name shown in the UI. */
  login: string
  /** Username git sends over HTTPS together with the token. */
  gitUsername: string
  organization?: string
  email?: string
}

export interface AccountInput {
  provider: ProviderId
  host: string
  token: string
  username?: string
  organization?: string
  email?: string
}

/** A repository listed from a connected account, ready to clone. */
export interface HostedRepo {
  id: string
  owner: string
  name: string
  description: string
  private: boolean
  /** Last update in unix milliseconds, if the service reports it. */
  updatedAt: number | null
  cloneUrl: string
  sshUrl?: string
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
  protocol: RemoteProtocol | 'unknown'
  /** GitHub, GitLab, a host name… */
  service: string
  /** Login of the connected account used for this remote over HTTPS, if any. */
  accountLogin: string | null
}

export interface ConnectionTest {
  ok: boolean
  message: string
}

export interface SshKeyInfo {
  path: string
  /** One-line OpenSSH public key, ready to paste into a service. */
  publicKey: string
  type: string
  /** Set when the key needs attention, e.g. it was made with PuTTY. */
  warning?: string
}

export interface CloneProgress {
  phase: string
  percent: number | null
}

export type DiffTarget =
  | { kind: 'worktree'; path: string; untracked?: boolean }
  | { kind: 'index'; path: string }
  | { kind: 'commit'; hash: string; path: string }

export interface AskPassRequest {
  id: string
  prompt: string
  /** Whether the answer should be masked (passwords, passphrases, tokens). */
  secret: boolean
}

export interface AskPassAnswer {
  value: string
  remember: boolean
}

export type ChangeKind = 'worktree' | 'refs'

export interface RepoChangedEvent {
  repoPath: string
  kinds: ChangeKind[]
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The API the preload script exposes to the renderer as `window.api`. */
export interface GitSteveApi {
  repo: {
    pick(): Promise<RepoInfo | null>
    open(path: string): Promise<RepoInfo>
    recent(): Promise<RepoInfo[]>
    onChanged(callback: (event: RepoChangedEvent) => void): () => void
    /** Folder picker for the clone destination. */
    pickFolder(): Promise<string | null>
    defaultCloneFolder(): Promise<string>
    /** Clone `url` into a new folder inside `parentFolder` and open it. */
    clone(url: string, parentFolder: string): Promise<RepoInfo>
    onCloneProgress(callback: (progress: CloneProgress) => void): () => void
  }
  remotes: {
    list(repo: string): Promise<RemoteInfo[]>
    add(repo: string, name: string, url: string): Promise<void>
    setUrl(repo: string, name: string, url: string): Promise<void>
    remove(repo: string, name: string): Promise<void>
    /** Check that an address is reachable with the current credentials. */
    test(url: string): Promise<ConnectionTest>
  }
  accounts: {
    list(): Promise<Account[]>
    /** Verify the token with the service, then store it encrypted. */
    connect(input: AccountInput): Promise<Account>
    remove(id: string): Promise<void>
    repos(id: string): Promise<HostedRepo[]>
  }
  ssh: {
    key(): Promise<SshKeyInfo | null>
    generate(comment: string): Promise<SshKeyInfo>
    test(host: string): Promise<ConnectionTest>
  }
  clipboard: {
    write(text: string): Promise<void>
  }
  git: {
    status(repo: string): Promise<RepoStatus>
    log(repo: string, maxCount?: number): Promise<Commit[]>
    branches(repo: string): Promise<Branch[]>
    show(repo: string, hash: string): Promise<CommitDetail>
    diff(repo: string, target: DiffTarget): Promise<string>
    stage(repo: string, paths: string[]): Promise<void>
    unstage(repo: string, paths: string[]): Promise<void>
    commit(repo: string, message: string): Promise<void>
    checkout(repo: string, branch: Pick<Branch, 'name' | 'kind'>): Promise<void>
    createBranch(repo: string, name: string, startPoint?: string): Promise<void>
    fetch(repo: string): Promise<void>
    pull(repo: string): Promise<void>
    push(repo: string): Promise<void>
  }
  askpass: {
    onRequest(callback: (request: AskPassRequest) => void): () => void
    respond(id: string, answer: AskPassAnswer | null): Promise<void>
  }
  secrets: {
    available(): Promise<boolean>
    count(): Promise<number>
    clear(): Promise<void>
  }
}
