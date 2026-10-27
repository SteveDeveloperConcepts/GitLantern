import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Events, Invoke } from '../shared/ipc'
import type {
  AskPassRequest,
  CloneProgress,
  GitLanternApi,
  IpcResult,
  RepoChangedEvent,
  SignInProgress,
  UpdateState,
  UserSettings
} from '../shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: GitLanternApi = {
  repo: {
    pick: () => call(Invoke.repoPick),
    open: (path) => call(Invoke.repoOpen, path),
    recent: () => call(Invoke.repoRecent),
    onChanged: (callback) => subscribe<RepoChangedEvent>(Events.repoChanged, callback),
    pickFolder: () => call(Invoke.repoPickFolder),
    defaultCloneFolder: () => call(Invoke.repoDefaultCloneFolder),
    clone: (url, parentFolder) => call(Invoke.repoClone, url, parentFolder),
    onCloneProgress: (callback) => subscribe<CloneProgress>(Events.cloneProgress, callback),
    openRelated: (repo, path) => call(Invoke.repoOpenRelated, repo, path),
    openKnown: (paths) => call(Invoke.repoOpenKnown, paths),
    close: (repo) => call(Invoke.repoClose, repo),
    pickSaveFolder: (title) => call(Invoke.repoPickSaveFolder, title)
  },
  remotes: {
    list: (repo) => call(Invoke.remotesList, repo),
    add: (repo, name, url) => call(Invoke.remotesAdd, repo, name, url),
    setUrl: (repo, name, url) => call(Invoke.remotesSetUrl, repo, name, url),
    remove: (repo, name) => call(Invoke.remotesRemove, repo, name),
    test: (url) => call(Invoke.remotesTest, url)
  },
  accounts: {
    list: () => call(Invoke.accountsList),
    connect: (input) => call(Invoke.accountsConnect, input),
    remove: (id) => call(Invoke.accountsRemove, id),
    repos: (id) => call(Invoke.accountsRepos, id),
    browserSignInHosts: () => call(Invoke.accountsBrowserSignInHosts),
    signIn: (provider, host) => call(Invoke.accountsSignIn, provider, host),
    cancelSignIn: () => call(Invoke.accountsCancelSignIn),
    onSignInProgress: (callback) => subscribe<SignInProgress>(Events.signInProgress, callback)
  },
  pullRequests: {
    list: (repo) => call(Invoke.pullRequestsList, repo),
    create: (repo, input) => call(Invoke.pullRequestsCreate, repo, input),
    checkout: (repo, number) => call(Invoke.pullRequestsCheckout, repo, number),
    detail: (repo, number) => call(Invoke.pullRequestsDetail, repo, number),
    comments: (repo, number) => call(Invoke.pullRequestsComments, repo, number),
    submitReview: (repo, number, head, review) => call(Invoke.pullRequestsSubmitReview, repo, number, head, review)
  },
  ssh: {
    key: () => call(Invoke.sshKey),
    generate: (comment) => call(Invoke.sshGenerate, comment),
    test: (host) => call(Invoke.sshTest, host)
  },
  clipboard: {
    write: (text) => call(Invoke.clipboardWrite, text)
  },
  git: {
    status: (repo) => call(Invoke.gitStatus, repo),
    log: (repo, filter) => call(Invoke.gitLog, repo, filter),
    branches: (repo) => call(Invoke.gitBranches, repo),
    show: (repo, hash) => call(Invoke.gitShow, repo, hash),
    diff: (repo, target) => call(Invoke.gitDiff, repo, target),
    stage: (repo, paths) => call(Invoke.gitStage, repo, paths),
    unstage: (repo, paths) => call(Invoke.gitUnstage, repo, paths),
    discard: (repo, paths) => call(Invoke.gitDiscard, repo, paths),
    applyPatch: (repo, path, patch, action) => call(Invoke.gitApplyPatch, repo, path, patch, action),
    resolveConflict: (repo, path, pick) => call(Invoke.gitResolveConflict, repo, path, pick),
    resolveFile: (repo, path, side) => call(Invoke.gitResolveFile, repo, path, side),
    commit: (repo, message) => call(Invoke.gitCommit, repo, message),
    checkout: (repo, branch) => call(Invoke.gitCheckout, repo, { name: branch.name, kind: branch.kind }),
    createBranch: (repo, name, startPoint) => call(Invoke.gitCreateBranch, repo, name, startPoint),
    compare: (repo, ref) => call(Invoke.gitCompare, repo, ref),
    merge: (repo, ref, options) => call(Invoke.gitMerge, repo, ref, options),
    rebase: (repo, onto) => call(Invoke.gitRebase, repo, onto),
    cherryPick: (repo, hash) => call(Invoke.gitCherryPick, repo, hash),
    continueOperation: (repo) => call(Invoke.gitContinue, repo),
    skipOperation: (repo) => call(Invoke.gitSkip, repo),
    abortOperation: (repo) => call(Invoke.gitAbort, repo),
    fetch: (repo) => call(Invoke.gitFetch, repo),
    pull: (repo) => call(Invoke.gitPull, repo),
    push: (repo) => call(Invoke.gitPush, repo),
    forcePush: (repo, expected) => call(Invoke.gitForcePush, repo, expected),
    stashes: (repo) => call(Invoke.gitStashes, repo),
    stash: (repo, message) => call(Invoke.gitStash, repo, message),
    applyStash: (repo, hash, options) => call(Invoke.gitApplyStash, repo, hash, options),
    dropStash: (repo, hash) => call(Invoke.gitDropStash, repo, hash),
    showStash: (repo, hash) => call(Invoke.gitShowStash, repo, hash),
    diffWith: (repo, target, options) => call(Invoke.gitDiffWith, repo, target, options),
    imagePair: (repo, target) => call(Invoke.gitImagePair, repo, target),
    compareFiles: (repo, from, to) => call(Invoke.gitCompareFiles, repo, from, to),
    blame: (repo, path, revision) => call(Invoke.gitBlame, repo, path, revision),
    fileHistory: (repo, path) => call(Invoke.gitFileHistory, repo, path),
    amend: (repo, message) => call(Invoke.gitAmend, repo, message),
    headMessage: (repo) => call(Invoke.gitHeadMessage, repo),
    reword: (repo, hash, message) => call(Invoke.gitReword, repo, hash, message),
    revert: (repo, hash) => call(Invoke.gitRevert, repo, hash),
    reset: (repo, hash, mode) => call(Invoke.gitReset, repo, hash, mode),
    rebaseCommits: (repo, base) => call(Invoke.gitRebaseCommits, repo, base),
    interactiveRebase: (repo, base, steps) => call(Invoke.gitInteractiveRebase, repo, base, steps),
    deleteBranch: (repo, name, force) => call(Invoke.gitDeleteBranch, repo, name, force),
    deleteRemoteBranch: (repo, remoteBranch) => call(Invoke.gitDeleteRemoteBranch, repo, remoteBranch),
    renameBranch: (repo, name, newName) => call(Invoke.gitRenameBranch, repo, name, newName),
    setUpstream: (repo, name, upstream) => call(Invoke.gitSetUpstream, repo, name, upstream),
    pushBranch: (repo, name, remote) => call(Invoke.gitPushBranch, repo, name, remote),
    tags: (repo) => call(Invoke.gitTags, repo),
    createTag: (repo, tag) => call(Invoke.gitCreateTag, repo, tag),
    deleteTag: (repo, name) => call(Invoke.gitDeleteTag, repo, name),
    pushTag: (repo, name, remote) => call(Invoke.gitPushTag, repo, name, remote),
    deleteRemoteTag: (repo, name, remote) => call(Invoke.gitDeleteRemoteTag, repo, name, remote),
    submodules: (repo) => call(Invoke.gitSubmodules, repo),
    updateSubmodules: (repo, paths) => call(Invoke.gitUpdateSubmodules, repo, paths),
    addSubmodule: (repo, url, path) => call(Invoke.gitAddSubmodule, repo, url, path),
    removeSubmodule: (repo, path) => call(Invoke.gitRemoveSubmodule, repo, path),
    worktrees: (repo) => call(Invoke.gitWorktrees, repo),
    addWorktree: (repo, worktree) => call(Invoke.gitAddWorktree, repo, worktree),
    removeWorktree: (repo, path, force) => call(Invoke.gitRemoveWorktree, repo, path, force),
    pruneWorktrees: (repo) => call(Invoke.gitPruneWorktrees, repo),
    lockWorktree: (repo, path, locked) => call(Invoke.gitLockWorktree, repo, path, locked),
    lfs: (repo) => call(Invoke.gitLfs, repo),
    lfsInstall: (repo) => call(Invoke.gitLfsInstall, repo),
    lfsTrack: (repo, pattern) => call(Invoke.gitLfsTrack, repo, pattern),
    lfsUntrack: (repo, pattern) => call(Invoke.gitLfsUntrack, repo, pattern),
    lfsPull: (repo) => call(Invoke.gitLfsPull, repo),
    lfsPush: (repo) => call(Invoke.gitLfsPush, repo),
    lfsLocks: (repo) => call(Invoke.gitLfsLocks, repo),
    lfsLock: (repo, path) => call(Invoke.gitLfsLock, repo, path),
    lfsUnlock: (repo, path, force) => call(Invoke.gitLfsUnlock, repo, path, force),
    flowConfig: (repo) => call(Invoke.gitFlowConfig, repo),
    flowInit: (repo, config) => call(Invoke.gitFlowInit, repo, config),
    flowStart: (repo, kind, name) => call(Invoke.gitFlowStart, repo, kind, name),
    flowFinish: (repo, kind, name, options) => call(Invoke.gitFlowFinish, repo, kind, name, options),
    bisectStart: (repo, bad, good) => call(Invoke.gitBisectStart, repo, bad, good),
    bisectMark: (repo, verdict) => call(Invoke.gitBisectMark, repo, verdict),
    bisectReset: (repo) => call(Invoke.gitBisectReset, repo),
    archive: (repo, revision) => call(Invoke.gitArchive, repo, revision),
    savePatch: (repo, hashes) => call(Invoke.gitSavePatch, repo, hashes),
    applyPatchFile: (repo) => call(Invoke.gitApplyPatchFile, repo),
    cleanPreview: (repo, ignored) => call(Invoke.gitCleanPreview, repo, ignored),
    clean: (repo, paths) => call(Invoke.gitClean, repo, paths),
    ignore: (repo, pattern, where) => call(Invoke.gitIgnore, repo, pattern, where),
    identity: (repo) => call(Invoke.gitIdentity, repo),
    setConfig: (repo, key, value) => call(Invoke.gitSetConfig, repo, key, value)
  },
  settings: {
    get: () => call(Invoke.settingsGet),
    set: (patch) => call(Invoke.settingsSet, patch),
    onChanged: (callback) => subscribe<UserSettings>(Events.settingsChanged, callback),
    aiKeyOrigin: () => call(Invoke.settingsAiKeyOrigin),
    setAiKey: (key) => call(Invoke.settingsSetAiKey, key),
    chooseGit: (reset) => call(Invoke.settingsChooseGit, reset)
  },
  tools: {
    list: () => call(Invoke.toolsList),
    openInEditor: (repo, file) => call(Invoke.toolsOpenInEditor, repo, file),
    openTerminal: (repo) => call(Invoke.toolsOpenTerminal, repo),
    showInFolder: (repo, file) => call(Invoke.toolsShowInFolder, repo, file),
    diffTool: (repo, target) => call(Invoke.toolsDiffTool, repo, target),
    mergeTool: (repo, path) => call(Invoke.toolsMergeTool, repo, path),
    runCustomAction: (repo, actionId, context) => call(Invoke.toolsRunCustomAction, repo, actionId, context),
    openUrl: (url) => call(Invoke.toolsOpenUrl, url)
  },
  ai: {
    commitMessage: (repo) => call(Invoke.aiCommitMessage, repo)
  },
  commandLog: {
    list: () => call(Invoke.commandLogList),
    clear: () => call(Invoke.commandLogClear)
  },
  askpass: {
    onRequest: (callback) => subscribe<AskPassRequest>(Events.askpassRequest, callback),
    respond: (id, answer) => call(Invoke.askpassRespond, id, answer)
  },
  secrets: {
    available: () => call(Invoke.secretsAvailable),
    count: () => call(Invoke.secretsCount),
    clear: () => call(Invoke.secretsClear)
  },
  update: {
    state: () => call(Invoke.updateState),
    onChanged: (callback) => subscribe<UpdateState>(Events.updateChanged, callback),
    install: () => call(Invoke.updateInstall)
  }
}

contextBridge.exposeInMainWorld('api', api)
