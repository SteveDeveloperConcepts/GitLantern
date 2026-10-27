import path from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { AccountStore } from './accounts/store'
import { setupAskPass, type AskPass } from './askpass'
import { setAccountHosts } from './git/commands'
import { resolveGitPath } from './git/resolveGit'
import { configureGit } from './git/runGit'
import { registerIpc } from './ipc'
import { SecretStore } from './secrets'
import { adoptOldSettings, Settings } from './settings'
import { resolveSshTool } from './ssh'
import { setupUpdater } from './updater'

let mainWindow: BrowserWindow | null = null
let askpass: AskPass | undefined

/** `zoom`: the interface size from Settings, in percent. */
function createWindow(zoom: number): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'GitLantern',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141518' : '#f4f2ee',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.webContents.on('did-finish-load', () => mainWindow?.webContents.setZoomFactor(zoom / 100))
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // No in-app navigation or new windows; https links open in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// A separate data folder, for running a second copy with other settings (scripts/screenshots.mjs uses it).
if (process.env.GITLANTERN_USER_DATA) app.setPath('userData', path.resolve(process.env.GITLANTERN_USER_DATA))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    adoptOldSettings(path.join(app.getPath('appData'), 'Git Steve'), path.join(userData, 'settings.json'))
    const settings = new Settings(path.join(userData, 'settings.json'))
    const secrets = new SecretStore(path.join(userData, 'secrets.json'))
    const accounts = new AccountStore(path.join(userData, 'accounts.json'), secrets, () => settings.get().oauthClients ?? {})

    askpass = await setupAskPass({ secrets, accounts, getWindow: () => mainWindow })
    const askpassEnv = askpass.env
    const gitPath = resolveGitPath(settings.get().gitPath)
    configureGit({ gitPath, env: () => askpassEnv })
    setAccountHosts(() => accounts.hosts())

    registerIpc({
      settings,
      secrets,
      accounts,
      askpass,
      updater: setupUpdater(() => mainWindow),
      sshTools: { ssh: resolveSshTool('ssh', gitPath), keygen: resolveSshTool('ssh-keygen', gitPath) },
      getWindow: () => mainWindow
    })
    createWindow(settings.user().zoom)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.user().zoom)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    void askpass?.close()
  })
}
