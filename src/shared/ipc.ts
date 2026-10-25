/** Renderer → main request channels (ipcRenderer.invoke / ipcMain.handle). */
export const Invoke = {
  repoPick: 'repo:pick',
  repoOpen: 'repo:open',
  repoRecent: 'repo:recent',
  repoPickFolder: 'repo:pick-folder',
  repoDefaultCloneFolder: 'repo:default-clone-folder',
  repoClone: 'repo:clone',
  remotesList: 'remotes:list',
  remotesAdd: 'remotes:add',
  remotesSetUrl: 'remotes:set-url',
  remotesRemove: 'remotes:remove',
  remotesTest: 'remotes:test',
  accountsList: 'accounts:list',
  accountsConnect: 'accounts:connect',
  accountsRemove: 'accounts:remove',
  accountsRepos: 'accounts:repos',
  sshKey: 'ssh:key',
  sshGenerate: 'ssh:generate',
  sshTest: 'ssh:test',
  clipboardWrite: 'clipboard:write',
  gitStatus: 'git:status',
  gitLog: 'git:log',
  gitBranches: 'git:branches',
  gitShow: 'git:show',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  gitCheckout: 'git:checkout',
  gitCreateBranch: 'git:create-branch',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  askpassRespond: 'askpass:respond',
  secretsAvailable: 'secrets:available',
  secretsCount: 'secrets:count',
  secretsClear: 'secrets:clear'
} as const

/** Main → renderer events (webContents.send / ipcRenderer.on). */
export const Events = {
  repoChanged: 'repo:changed',
  cloneProgress: 'repo:clone-progress',
  askpassRequest: 'askpass:request'
} as const
