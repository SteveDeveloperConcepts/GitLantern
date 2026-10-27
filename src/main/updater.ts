import { app, shell, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { Events } from '../shared/ipc'
import type { UpdateState } from '../shared/types'

// Installed copies find new versions through `publish` in electron-builder.yml; this is only for the
// release page the macOS notice opens.
const RELEASES = 'https://github.com/SteveDeveloperConcepts/GitLantern/releases'
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/**
 * How this copy gets new versions from GitHub releases:
 * - `install`: download in the background, install on restart (the Windows installer).
 * - `notify`: say a new version is out and link to it. macOS only installs updates signed with a
 *   Developer ID, and the Mac builds have only an ad-hoc signature.
 * - null: none. Development runs, and Store copies, which their store updates.
 */
export function updateMode(env: { packaged: boolean; platform: NodeJS.Platform; store: boolean }): 'install' | 'notify' | null {
  if (!env.packaged || env.store) return null
  if (env.platform === 'win32') return 'install'
  if (env.platform === 'darwin') return 'notify'
  return null
}

export interface Updater {
  /** The newer version found since GitLantern started, or null. */
  state(): UpdateState | null
  /** `ready`: quit and install it. `available`: open its release page. */
  install(): void
}

/** Check GitHub for a newer GitLantern shortly after starting, then every few hours. */
export function setupUpdater(getWindow: () => BrowserWindow | null): Updater {
  const mode = updateMode({
    packaged: app.isPackaged,
    platform: process.platform,
    store: process.windowsStore || process.mas
  })
  if (!mode) return { state: () => null, install: () => {} }

  let current: UpdateState | null = null
  const announce = (state: UpdateState): void => {
    current = state
    getWindow()?.webContents.send(Events.updateChanged, state)
  }

  autoUpdater.autoDownload = mode === 'install'
  // electron-updater sends a random ID kept for this install, for staged rollouts. GitLantern doesn't
  // stage releases, and sends nothing that tells one user from another.
  autoUpdater.requestHeaders = { 'x-user-staging-id': '' }
  // Offline, or GitHub can't be reached: the next check tries again.
  autoUpdater.on('error', () => {})
  autoUpdater.on('update-available', (info) => {
    if (mode === 'notify') announce({ kind: 'available', version: info.version })
  })
  autoUpdater.on('update-downloaded', (info) => announce({ kind: 'ready', version: info.version }))

  // A download can outlast the interval; don't start a second one alongside it.
  let checking = false
  const check = async (): Promise<void> => {
    if (checking) return
    checking = true
    try {
      const result = await autoUpdater.checkForUpdates()
      await result?.downloadPromise
    } catch {
      // Reported through the error event.
    } finally {
      checking = false
    }
  }
  setTimeout(() => void check(), FIRST_CHECK_MS)
  setInterval(() => void check(), CHECK_EVERY_MS)

  return {
    state: () => current,
    install: () => {
      // Silent, then start the new version: the installer already knows where GitLantern is installed.
      if (current?.kind === 'ready') autoUpdater.quitAndInstall(true, true)
      else if (current?.kind === 'available') void shell.openExternal(`${RELEASES}/tag/v${current.version}`)
    }
  }
}
