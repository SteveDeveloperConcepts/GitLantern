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
  /** A bisect in progress (`git bisect start` until `git bisect reset`). */
  bisect?: BisectState
}

/** Where a bisect has got to, read from refs/bisect/. */
export interface BisectState {
  /** The commit marked bad, once there is one. */
  bad: string | null
  /** Commits marked good. */
  good: string[]
  /** Commits skipped. */
  skipped: string[]
}

/** What a bisect step found. `done`: git named the first bad commit. */
export interface BisectStep {
  done: boolean
  /** The first bad commit, when `done`. */
  firstBad?: string
  /** git's own summary line, e.g. "Bisecting: 3 revisions left to test after this (roughly 2 steps)". */
  message: string
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
  /** Set when the commit is signed. */
  signature?: CommitSignature
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

/**
 * A pull request opened for review: its description, and the two commits its diff is between. Both
 * were fetched into the repository, so the diff and its files come from git.
 */
export interface PullRequestDetail extends PullRequest {
  body: string
  state: 'open' | 'closed' | 'merged'
  /** Where the pull request's changes start: the merge base of the target branch and `head`. */
  base: string
  /** The pull request's newest commit. */
  head: string
  /** The connected account's login, to tell your own comments apart. */
  viewer: string
}

/** What a review says overall. */
export type ReviewVerdict = 'comment' | 'approve' | 'request-changes'

/** A comment already on the pull request: on a line of a file, or on the pull request as a whole. */
export interface ReviewComment {
  id: string
  author: string
  body: string
  /** Unix milliseconds. */
  createdAt: number | null
  /** The file it's on, or null for a comment on the whole pull request (or a review's summary). */
  path: string | null
  /** The line it's on, in the new file (side 'new') or the old one ('old'); null when it isn't on a line. */
  line: number | null
  side: 'old' | 'new'
  /** A review's summary carries its verdict. */
  verdict?: ReviewVerdict
  /** The line has changed since: the comment was made on an older version. */
  outdated?: boolean
  /** The comment it answers, in a thread. */
  inReplyTo?: string
}

/** A comment written during a review, sent when the review is submitted. */
export interface DraftComment {
  path: string
  line: number
  side: 'old' | 'new'
  body: string
}

export interface SubmitReview {
  verdict: ReviewVerdict
  /** The review's summary; may be empty for an approval. */
  body: string
  comments: DraftComment[]
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
  /** `origPath`: the file's name before the commit renamed it, so the diff shows a rename. */
  | { kind: 'commit'; hash: string; path: string; origPath?: string }
  /** `untracked`: a file the stash saved from outside git's tracking. */
  | { kind: 'stash'; hash: string; path: string; untracked?: boolean }
  /** One file between any two commits or branches (`git diff from to`). */
  | { kind: 'range'; from: string; to: string; path: string; origPath?: string }

/** How a diff is produced. Ignoring whitespace turns off line staging: the patch wouldn't apply. */
export interface DiffOptions {
  ignoreWhitespace?: boolean
}

/** Both versions of an image a diff is about, as data URLs; null where the file doesn't exist on that side. */
export interface ImagePair {
  before: string | null
  after: string | null
  /** Bytes on each side, null where the file doesn't exist. */
  beforeSize: number | null
  afterSize: number | null
}

/** One step of an interactive rebase, oldest commit first. */
export interface RebaseStep {
  hash: string
  /** `reword`: keep the changes and replace the message. `squash` / `fixup`: fold into the commit before it, keeping or dropping this message. */
  action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'
  /** The new message for `reword`, or for the combined commit a `squash` makes. */
  message?: string
}

/** A commit an interactive rebase can change, with its whole message. */
export interface RebaseCommit {
  hash: string
  subject: string
  /** The full message: subject, blank line, body. */
  message: string
  authorName: string
  authorDate: number
  /** Merge commits can't be rebased interactively here; the dialog refuses ranges that contain one. */
  isMerge: boolean
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface Tag {
  name: string
  /** The commit it points at (peeled for annotated tags). */
  hash: string
  annotated: boolean
  /** Annotated tags: the tag message's first line. */
  message: string
  /** Unix seconds: when an annotated tag was made, or the commit's date for a lightweight one. */
  date: number
  tagger: string
}

export interface NewTag {
  name: string
  /** Commit or branch to tag. */
  target: string
  /** A message makes an annotated tag; without one it's lightweight. */
  message?: string
  /** Sign with GPG (`git tag -s`); needs a message. */
  sign?: boolean
}

/** Result of deleting a local branch: `not-merged` means git refused and a forced delete would lose commits. */
export type DeleteBranchResult = 'deleted' | 'not-merged'

/** One line of `git blame`. */
export interface BlameLine {
  /** Line number in the file as it is at the blamed revision, from 1. */
  number: number
  text: string
  hash: string
}

/** The commits blame lines point at. */
export interface BlameCommit {
  hash: string
  authorName: string
  authorEmail: string
  authorDate: number
  summary: string
  /** Not committed yet (git's all-zero hash). */
  uncommitted: boolean
}

export interface BlameResult {
  lines: BlameLine[]
  commits: Record<string, BlameCommit>
  /** The file is binary; no lines. */
  binary: boolean
}

/** A commit in a file's history (followed across renames). */
export interface FileHistoryEntry {
  commit: Commit
  /** A, M, D, R, C or T for this file in this commit. */
  status: string
  /** The file's path in this commit. */
  path: string
  /** For a rename: the path it had before. */
  origPath?: string
}

export interface Submodule {
  /** Path inside the repository. */
  path: string
  url: string
  /** The commit the parent repository records for it. */
  hash: string
  /** `uninitialized`: not cloned yet. `modified`: checked out at a different commit than recorded. */
  state: 'ok' | 'uninitialized' | 'modified' | 'conflict'
}

export interface Worktree {
  /** Absolute path. */
  path: string
  /** Checked-out commit, or null for a bare repository. */
  head: string | null
  /** Checked-out branch, or null when detached. */
  branch: string | null
  /** The repository's main working tree (the one the others were made from). */
  isMain: boolean
  /** The worktree this window has open. */
  isCurrent: boolean
  locked: boolean
  /** Its folder is gone; `prune` removes the record. */
  prunable: boolean
}

export type NewWorktree =
  /** Check out an existing local branch there. */
  | { path: string; branch: string }
  /** Make a new branch there, from `startPoint` (or HEAD). */
  | { path: string; newBranch: string; startPoint?: string }

export interface LfsFile {
  path: string
  /** Short object ID. */
  oid: string
  /** False when only the pointer is checked out. */
  downloaded: boolean
}

export interface LfsLock {
  id: string
  path: string
  owner: string
  /** Unix seconds. */
  lockedAt: number
}

export interface LfsInfo {
  /** `git lfs` is installed. */
  installed: boolean
  version: string | null
  /** Patterns in .gitattributes with filter=lfs. */
  patterns: string[]
  files: LfsFile[]
}

export type FlowKind = 'feature' | 'release' | 'hotfix'

/** git-flow settings, in the same config keys the git-flow tools use (gitflow.branch.*, gitflow.prefix.*). */
export interface FlowConfig {
  master: string
  develop: string
  prefixes: Record<FlowKind, string>
  /** Put before the version in release and hotfix tags, e.g. "v". */
  versionTagPrefix: string
}

export interface FinishFlowOptions {
  /** Release and hotfix: the tag's message (the tag is named after the version). */
  tagMessage?: string
  /** Keep the branch after finishing. */
  keepBranch?: boolean
}

/** One git command GitLantern ran, for the command log. */
export interface CommandLogEntry {
  id: number
  /** Arguments after `git`. */
  args: string[]
  cwd: string
  /** Unix milliseconds. */
  startedAt: number
  /** Milliseconds; null while it's still running. */
  duration: number | null
  /** null while running, or when git couldn't be started. */
  exitCode: number | null
  /** The first part of stderr when it failed. */
  error?: string
}

/** An editor, terminal or file manager GitLantern found on this computer. */
export interface ExternalTool {
  id: string
  name: string
}

export interface ExternalTools {
  editors: ExternalTool[]
  terminals: ExternalTool[]
}

/** Where a custom action shows up, and what it's given. */
export type CustomActionScope = 'repository' | 'commit' | 'branch' | 'file'

/**
 * A command the user set up in Settings. Placeholders in `args`: ${REPO} (the repository folder),
 * ${SHA} (commit), ${BRANCH}, ${FILE} (path inside the repository).
 */
export interface CustomAction {
  id: string
  name: string
  scope: CustomActionScope
  /** The program to run. */
  command: string
  /** Its arguments, one per line in the settings form. */
  args: string[]
  /** Ask before running it. */
  confirm: boolean
}

export interface CustomActionContext {
  sha?: string
  branch?: string
  file?: string
}

export interface CustomActionResult {
  exitCode: number | null
  output: string
}

/** Turns text in commit messages into links, e.g. `#(\d+)` → `https://github.com/o/r/issues/$1`. */
export interface IssueLinkRule {
  id: string
  name: string
  /** A regular expression; $1, $2… in `url` stand for its groups. */
  pattern: string
  url: string
  /** Only for repositories whose `origin` contains this text; empty for every repository. */
  remoteContains: string
}

export interface CommitTemplate {
  id: string
  name: string
  text: string
}

/** A named set of repositories that open together as tabs. */
export interface Workspace {
  id: string
  name: string
  repos: string[]
}

export type ThemeMode = 'system' | 'light' | 'dark'

export type AiProvider = 'anthropic' | 'openai'

export interface AiSettings {
  provider: AiProvider
  /** OpenAI-compatible only: the API's base URL, e.g. https://api.openai.com/v1 or http://localhost:11434/v1 for Ollama. */
  endpoint: string
  model: string
  /** Extra instructions added to the prompt, e.g. "Use Conventional Commits". */
  instructions: string
}

/** Everything the Settings screen edits. Stored in settings.json; the AI key goes in the SecretStore. */
export interface UserSettings {
  theme: ThemeMode
  /** Accent colour (#rrggbb), or empty for the theme's own. */
  accent: string
  /** Overrides for the theme's CSS variables, e.g. { "--bg": "#101010" }. */
  colors: Record<string, string>
  /** Interface size in percent (80–150). */
  zoom: number
  /** Fetch every remote this often while a repository is open; 0 turns it off. */
  autoFetchMinutes: number
  /** Explicit git executable, used after a restart. Read-only here: `settings.chooseGit` sets it. */
  gitPath: string
  /** Editor and terminal ids from `tools.list()`, or empty for the first one found. */
  editor: string
  terminal: string
  /** Passed to `git difftool --tool=` / `git mergetool --tool=`; empty uses git's own config. */
  diffTool: string
  mergeTool: string
  customActions: CustomAction[]
  issueLinks: IssueLinkRule[]
  commitTemplates: CommitTemplate[]
  /** Show the Conventional Commits helper above the commit message. */
  conventionalCommits: boolean
  ai: AiSettings
  workspaces: Workspace[]
  /** Repositories open as tabs, restored on the next start. */
  openTabs: string[]
  activeTab: string | null
}

/** Git settings the Settings screen and the commit form change, for one repository or globally. */
export interface GitIdentity {
  userName: string
  userEmail: string
  /** commit.gpgsign */
  signCommits: boolean
  /** tag.gpgsign */
  signTags: boolean
  /** The file commit.template points at, read in; empty when there's none. */
  commitTemplate: string
}

export type GitConfigKey = 'user.name' | 'user.email' | 'commit.gpgsign' | 'tag.gpgsign'

/** A signature on a commit, from `%G?`: G good, B bad, U good but untrusted, N none, E can't check… */
export interface CommitSignature {
  status: string
  signer: string
}

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

/**
 * A newer GitLantern on GitHub. `ready`: downloaded, and installed when GitLantern restarts or quits
 * (Windows). `available`: the user downloads it from its release page (macOS, until the app is signed
 * with a Developer ID).
 */
export interface UpdateState {
  kind: 'ready' | 'available'
  version: string
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
    /** Open a submodule or worktree of an open repository: a path inside it, or one of its worktrees. */
    openRelated(repo: string, path: string): Promise<RepoInfo>
    /** Open a repository from a workspace or a restored tab: one opened before. */
    openKnown(paths: string[]): Promise<RepoInfo[]>
    /** Stop watching a repository whose tab was closed. */
    close(repo: string): Promise<void>
    /** Pick a folder for a new worktree or an archive. */
    pickSaveFolder(title: string): Promise<string | null>
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
    /** Open a pull request for review: fetch its commits and read its description. */
    detail(repo: string, number: number): Promise<PullRequestDetail>
    /** Comments and reviews already on it, oldest first. */
    comments(repo: string, number: number): Promise<ReviewComment[]>
    /** Send a review: its verdict, summary and line comments. `head` is the commit the comments were written against. */
    submitReview(repo: string, number: number, head: string, review: SubmitReview): Promise<void>
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

    /** Diff with options (whitespace). `diff` is the same with none. */
    diffWith(repo: string, target: DiffTarget, options: DiffOptions): Promise<string>
    /** Both sides of an image file for the image diff. */
    imagePair(repo: string, target: DiffTarget): Promise<ImagePair>
    /** Files changed between two commits or branches. */
    compareFiles(repo: string, from: string, to: string): Promise<ChangedFile[]>
    blame(repo: string, path: string, revision?: string): Promise<BlameResult>
    /** Commits that changed a file, newest first, followed across renames. */
    fileHistory(repo: string, path: string): Promise<FileHistoryEntry[]>

    /** Add the staged changes to the last commit, and replace its message when `message` isn't null. */
    amend(repo: string, message: string | null): Promise<void>
    /** The last commit's whole message, for amending. */
    headMessage(repo: string): Promise<string>
    /** Replace a commit's message: HEAD is amended, an older commit is reworded by a rebase. */
    reword(repo: string, hash: string, message: string): Promise<OperationResult>
    /** Make a new commit that undoes one. */
    revert(repo: string, hash: string): Promise<OperationResult>
    /** Move the current branch to a commit. */
    reset(repo: string, hash: string, mode: ResetMode): Promise<void>
    /** Commits after `base` on the current branch, oldest first; `base` null for the whole branch. */
    rebaseCommits(repo: string, base: string | null): Promise<RebaseCommit[]>
    /** Rewrite the commits after `base` as `steps` says (in that order). */
    interactiveRebase(repo: string, base: string | null, steps: RebaseStep[]): Promise<OperationResult>

    deleteBranch(repo: string, name: string, force: boolean): Promise<DeleteBranchResult>
    /** Delete a branch on its remote: `origin/feature`. */
    deleteRemoteBranch(repo: string, remoteBranch: string): Promise<void>
    renameBranch(repo: string, name: string, newName: string): Promise<void>
    /** Link a local branch to a remote branch (`origin/main`), or unlink it with null. */
    setUpstream(repo: string, name: string, upstream: string | null): Promise<void>
    /** Push a local branch that isn't checked out, setting its upstream the first time. */
    pushBranch(repo: string, name: string, remote: string): Promise<void>

    tags(repo: string): Promise<Tag[]>
    createTag(repo: string, tag: NewTag): Promise<void>
    deleteTag(repo: string, name: string): Promise<void>
    pushTag(repo: string, name: string, remote: string): Promise<void>
    deleteRemoteTag(repo: string, name: string, remote: string): Promise<void>

    submodules(repo: string): Promise<Submodule[]>
    /** `git submodule update --init --recursive`, for these paths or all of them. */
    updateSubmodules(repo: string, paths: string[]): Promise<void>
    addSubmodule(repo: string, url: string, path: string): Promise<void>
    removeSubmodule(repo: string, path: string): Promise<void>

    worktrees(repo: string): Promise<Worktree[]>
    addWorktree(repo: string, worktree: NewWorktree): Promise<void>
    removeWorktree(repo: string, path: string, force: boolean): Promise<void>
    pruneWorktrees(repo: string): Promise<void>
    lockWorktree(repo: string, path: string, locked: boolean): Promise<void>

    lfs(repo: string): Promise<LfsInfo>
    lfsInstall(repo: string): Promise<void>
    lfsTrack(repo: string, pattern: string): Promise<void>
    lfsUntrack(repo: string, pattern: string): Promise<void>
    lfsPull(repo: string): Promise<void>
    lfsPush(repo: string): Promise<void>
    lfsLocks(repo: string): Promise<LfsLock[]>
    lfsLock(repo: string, path: string): Promise<void>
    lfsUnlock(repo: string, path: string, force: boolean): Promise<void>

    /** git-flow settings, or null when the repository hasn't been set up for it. */
    flowConfig(repo: string): Promise<FlowConfig | null>
    flowInit(repo: string, config: FlowConfig): Promise<void>
    /** Make the branch (feature/x from develop, hotfix/x from master…) and switch to it. */
    flowStart(repo: string, kind: FlowKind, name: string): Promise<void>
    /** Merge it where git-flow says (and tag releases and hotfixes); stops on conflicts. Run again after resolving them. */
    flowFinish(repo: string, kind: FlowKind, name: string, options: FinishFlowOptions): Promise<OperationResult>

    bisectStart(repo: string, bad: string, good: string): Promise<BisectStep>
    bisectMark(repo: string, verdict: 'good' | 'bad' | 'skip'): Promise<BisectStep>
    bisectReset(repo: string): Promise<void>

    /** Save a commit as a zip of its files; asks where. Returns the saved file, or null when cancelled. */
    archive(repo: string, revision: string): Promise<string | null>
    /** Save commits (oldest first) as a patch file, or the uncommitted changes when `hashes` is empty. */
    savePatch(repo: string, hashes: string[]): Promise<string | null>
    /** Pick a .patch file and apply it: `git am` for mailbox patches, `git apply --3way` otherwise. */
    applyPatchFile(repo: string): Promise<OperationResult | null>
    /** Untracked files `clean` would remove; with `ignored`, ignored files too. */
    cleanPreview(repo: string, ignored: boolean): Promise<string[]>
    /** Move these untracked (or ignored) files and folders to the trash. */
    clean(repo: string, paths: string[]): Promise<void>
    /** Add a pattern to .gitignore, or to .git/info/exclude for this copy only. */
    ignore(repo: string, pattern: string, where: 'gitignore' | 'exclude'): Promise<void>

    identity(repo: string): Promise<{ local: Partial<GitIdentity>; global: GitIdentity }>
    setConfig(repo: string | null, key: GitConfigKey, value: string | null): Promise<void>
  }
  settings: {
    get(): Promise<UserSettings>
    /** Save some settings; returns all of them. */
    set(patch: Partial<UserSettings>): Promise<UserSettings>
    onChanged(callback: (settings: UserSettings) => void): () => void
    /** Where the saved AI API key may be sent (e.g. https://api.anthropic.com), or null when none is saved. */
    aiKeyOrigin(): Promise<string | null>
    /** Save the key for the AI service set now, or remove it with null. */
    setAiKey(key: string | null): Promise<void>
    /** Pick the git program in a file dialog (or go back to the one on PATH with `reset`); used from the next start. */
    chooseGit(reset: boolean): Promise<UserSettings>
  }
  tools: {
    /** Editors and terminals found on this computer. */
    list(): Promise<ExternalTools>
    openInEditor(repo: string, file?: string): Promise<void>
    openTerminal(repo: string): Promise<void>
    /** Show the repository, or a file in it, in Explorer / Finder. */
    showInFolder(repo: string, file?: string): Promise<void>
    /** `git difftool` on one file of a diff. */
    diffTool(repo: string, target: DiffTarget): Promise<void>
    /** `git mergetool` on a conflicted file. */
    mergeTool(repo: string, path: string): Promise<void>
    runCustomAction(repo: string, actionId: string, context: CustomActionContext): Promise<CustomActionResult>
    openUrl(url: string): Promise<void>
  }
  ai: {
    /** Write a commit message for the staged changes. */
    commitMessage(repo: string): Promise<string>
  }
  commandLog: {
    list(): Promise<CommandLogEntry[]>
    clear(): Promise<void>
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
  update: {
    /** The newer version found since GitLantern started, or null. */
    state(): Promise<UpdateState | null>
    onChanged(callback: (state: UpdateState) => void): () => void
    /** `ready`: quit and install it now. `available`: open its release page in the browser. */
    install(): Promise<void>
  }
}
