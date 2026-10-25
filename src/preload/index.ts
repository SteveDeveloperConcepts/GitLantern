import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Events, Invoke } from '../shared/ipc'
import type { AskPassRequest, CloneProgress, GitSteveApi, IpcResult, RepoChangedEvent } from '../shared/types'

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

const api: GitSteveApi = {
  repo: {
    pick: () => call(Invoke.repoPick),
    open: (path) => call(Invoke.repoOpen, path),
    recent: () => call(Invoke.repoRecent),
    onChanged: (callback) => subscribe<RepoChangedEvent>(Events.repoChanged, callback),
    pickFolder: () => call(Invoke.repoPickFolder),
    defaultCloneFolder: () => call(Invoke.repoDefaultCloneFolder),
    clone: (url, parentFolder) => call(Invoke.repoClone, url, parentFolder),
    onCloneProgress: (callback) => subscribe<CloneProgress>(Events.cloneProgress, callback)
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
    repos: (id) => call(Invoke.accountsRepos, id)
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
    log: (repo, maxCount) => call(Invoke.gitLog, repo, maxCount),
    branches: (repo) => call(Invoke.gitBranches, repo),
    show: (repo, hash) => call(Invoke.gitShow, repo, hash),
    diff: (repo, target) => call(Invoke.gitDiff, repo, target),
    stage: (repo, paths) => call(Invoke.gitStage, repo, paths),
    unstage: (repo, paths) => call(Invoke.gitUnstage, repo, paths),
    commit: (repo, message) => call(Invoke.gitCommit, repo, message),
    checkout: (repo, branch) => call(Invoke.gitCheckout, repo, { name: branch.name, kind: branch.kind }),
    createBranch: (repo, name, startPoint) => call(Invoke.gitCreateBranch, repo, name, startPoint),
    compare: (repo, ref) => call(Invoke.gitCompare, repo, ref),
    merge: (repo, ref, options) => call(Invoke.gitMerge, repo, ref, options),
    rebase: (repo, onto) => call(Invoke.gitRebase, repo, onto),
    continueOperation: (repo) => call(Invoke.gitContinue, repo),
    skipOperation: (repo) => call(Invoke.gitSkip, repo),
    abortOperation: (repo) => call(Invoke.gitAbort, repo),
    fetch: (repo) => call(Invoke.gitFetch, repo),
    pull: (repo) => call(Invoke.gitPull, repo),
    push: (repo) => call(Invoke.gitPush, repo)
  },
  askpass: {
    onRequest: (callback) => subscribe<AskPassRequest>(Events.askpassRequest, callback),
    respond: (id, answer) => call(Invoke.askpassRespond, id, answer)
  },
  secrets: {
    available: () => call(Invoke.secretsAvailable),
    count: () => call(Invoke.secretsCount),
    clear: () => call(Invoke.secretsClear)
  }
}

contextBridge.exposeInMainWorld('api', api)
