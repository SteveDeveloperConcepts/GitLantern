import type { ConflictChoice } from './conflicts'
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
  /** A merge, rebase, cherry-pick or revert that stopped (usually on conflicts) and waits to be finished. */
  operation?: RepoOperation
}

export interface RepoOperation {
  kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert'
  /** Merge: the commit being merged in. */
  incoming?: string
  /** Rebase: the branch being rebased, and the commit it's being rebased onto. */
  branch?: string
  onto?: string
  /** Rebase: which commit is being replayed, out of how many. */
  step?: number
  total?: number
}

/** Outcome of a merge, rebase or continue: either done, or stopped with conflicts to resolve. */
export interface OperationResult {
  conflicted: boolean
}

/**
 * What Pull did. `diverged`: both sides have new commits, so nothing changed and the user chooses
 * between merging and rebasing.
 */
export interface PullResult {
  outcome: 'up-to-date' | 'fast-forward' | 'diverged'
  /** The remote branch pulled from, e.g. `origin/main`. */
  upstream: string
}

/**
 * What Push did. `needs-force`: the remote branch only has old copies of commits that were rewritten
 * since (rebased, amended), so nothing was pushed. A force push would replace them.
 */
export type PushResult =
  | { outcome: 'pushed' }
  | {
      outcome: 'needs-force'
      /** The remote branch, e.g. `origin/main`. */
      upstream: string
      /** Where the remote branch is now. The force push goes ahead only while it's still there. */
      expected: string
      /** Commits on the remote branch that the force push would replace. */
      replaced: number
    }

/** A stashed set of changes. */
export interface Stash {
  hash: string
  /** The message given when stashing, or git's "WIP on main: …" when there was none. */
  message: string
  /** The branch it was made on, or null on a detached HEAD. */
  branch: string | null
  /** Unix seconds. */
  date: number
}

/** Narrows the history. Without one, every branch is shown. */
export interface LogFilter {
  /** Only commits on this branch. */
  branch?: string
  /** Only commits that changed this file or folder. */
  path?: string
}

/** Which part of a diff a patch from `selectLines` changes. */
export type PatchAction = 'stage' | 'unstage' | 'discard'

/** One conflict in a file, and the side to keep. */
export interface ConflictPick {
  /** Which conflict, counting from 0 at the top of the file. */
  index: number
  choice: ConflictChoice
  /** How many conflicts the file had when the user picked, to notice it changed on disk since. */
  conflicts: number
}

/** The current branch compared with another branch or commit, for the merge and rebase dialogs. */
export interface BranchComparison {
  /** Commits on the current branch that the other one doesn't have. */
  ahead: number
  /** Commits on the other branch that the current one doesn't have. */
  behind: number
  /** How many of the `ahead` commits are already on the current branch's upstream. */
  published: number
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

export interface RefLabel {
  name: string
  kind: RefKind
  /** True for the branch HEAD points at. */
  isCurrent?: boolean
  /** True for the remote branch its remote's HEAD points at: that remote's default branch. */
  isDefault?: boolean
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
  /** A stash only: a file that was untracked when it was stashed. */
  untracked?: boolean
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
  /** Signed in through the browser (OAuth) rather than with a pasted token. */
  oauth?: boolean
  /** OAuth only: when the token runs out, in unix milliseconds. It's renewed shortly before. */
  expiresAt?: number
}

/** Shown while a browser sign-in waits for the user. */
export interface SignInProgress {
  /** The page the browser was sent to. */
  url: string
  /** Device sign-in (GitHub): the code to enter on that page. */
  userCode?: string
}

/** An open pull request (merge request on GitLab). */
export interface PullRequest {
  number: number
  title: string
  author: string
  sourceBranch: string
  targetBranch: string
  /** False when it comes from a fork. */
  sameRepo: boolean
  draft: boolean
  /** Its page on the service. */
  url: string
  /** Unix milliseconds. */
  updatedAt: number | null
}

export interface PullRequestList {
  /** The remote they were looked up for, or null when the repository has none. */
  remote: string | null
  /** GitHub, GitLab… */
  service: string
  /** What the service calls them. */
  noun: 'pull request' | 'merge request'
  /** Why nothing could be listed: no account for the remote's server, or a server without a known API. */
  unavailable?: 'no-remote' | 'no-account' | 'unsupported'
  items: PullRequest[]
  /** The remote's default branch, the usual target for a new one. */
  defaultBranch: string | null
}

export interface NewPullRequest {
  title: string
  description: string
  /** Branch names on the remote. */
  source: string
  target: string
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
  /** `conflicted`: show the file itself with its conflict markers instead of a diff. */
  | { kind: 'worktree'; path: string; untracked?: boolean; conflicted?: boolean }
  | { kind: 'index'; path: string }
  | { kind: 'commit'; hash: string; path: string }
  /** `untracked`: a file the stash saved from outside git's tracking. */
  | { kind: 'stash'; hash: string; path: string; untracked?: boolean }

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
export interface GitLanternApi {
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
    /** Servers GitLantern can sign in to through the browser, instead of with a token. */
    browserSignInHosts(): Promise<string[]>
    /** Sign in through the browser; resolves once the user has approved GitLantern there. */
    signIn(provider: ProviderId, host: string): Promise<Account>
    cancelSignIn(): Promise<void>
    onSignInProgress(callback: (progress: SignInProgress) => void): () => void
  }
  pullRequests: {
    /** Open pull requests on the service that hosts the repository's remote. */
    list(repo: string): Promise<PullRequestList>
    create(repo: string, input: NewPullRequest): Promise<PullRequest>
    /** Check out a pull request's branch; returns the local branch's name. */
    checkout(repo: string, number: number): Promise<string>
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
    log(repo: string, filter?: LogFilter): Promise<Commit[]>
    branches(repo: string): Promise<Branch[]>
    show(repo: string, hash: string): Promise<CommitDetail>
    diff(repo: string, target: DiffTarget): Promise<string>
    stage(repo: string, paths: string[]): Promise<void>
    unstage(repo: string, paths: string[]): Promise<void>
    /** Throw away uncommitted changes to these files. Untracked ones go to the trash. */
    discard(repo: string, paths: string[]): Promise<void>
    /** Stage, unstage or discard some of a file's changes: a patch made by `selectLines` for that file. */
    applyPatch(repo: string, path: string, patch: string, action: PatchAction): Promise<void>
    /** Keep one side of a conflict in a file. The file is staged once no conflicts are left. */
    resolveConflict(repo: string, path: string, pick: ConflictPick): Promise<{ remaining: number }>
    /** Take one side's whole version of a conflicted file, and stage it. */
    resolveFile(repo: string, path: string, side: 'ours' | 'theirs'): Promise<void>
    commit(repo: string, message: string): Promise<void>
    checkout(repo: string, branch: Pick<Branch, 'name' | 'kind'>): Promise<void>
    createBranch(repo: string, name: string, startPoint?: string): Promise<void>
    compare(repo: string, ref: string): Promise<BranchComparison>
    /** Merge a branch or commit into the current branch. */
    merge(repo: string, ref: string, options?: { noFastForward?: boolean }): Promise<OperationResult>
    /** Replay the current branch's own commits on top of a branch or commit. */
    rebase(repo: string, onto: string): Promise<OperationResult>
    /** Copy a commit onto the current branch. */
    cherryPick(repo: string, hash: string): Promise<OperationResult>
    /** Finish the stopped merge, rebase, cherry-pick or revert once its conflicts are staged. */
    continueOperation(repo: string): Promise<OperationResult>
    /** Rebase, cherry-pick or revert only: drop the commit that conflicted and go on. */
    skipOperation(repo: string): Promise<OperationResult>
    abortOperation(repo: string): Promise<void>
    fetch(repo: string): Promise<void>
    pull(repo: string): Promise<PullResult>
    push(repo: string): Promise<PushResult>
    /** Replace the remote branch with the current one, as long as it's still at `expected`. */
    forcePush(repo: string, expected: string): Promise<void>
    /** Newest first. */
    stashes(repo: string): Promise<Stash[]>
    /** Stash every uncommitted change, untracked files included. */
    stash(repo: string, message: string): Promise<void>
    /** Bring a stash's changes back. `pop` also deletes it, unless it stops on conflicts. */
    applyStash(repo: string, hash: string, options: { pop: boolean }): Promise<OperationResult>
    dropStash(repo: string, hash: string): Promise<void>
    /** A stash's changes, like a commit's. */
    showStash(repo: string, hash: string): Promise<CommitDetail>
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
