import { useCallback, useEffect, useRef, useState } from 'react'
import type { RepoInfo, UpdateState, UserSettings, Workspace } from '../../shared/types'
import { AskPassDialog } from './components/AskPassDialog'
import { CloneDialog } from './components/CloneDialog'
import { CommandLogDialog } from './components/CommandLogDialog'
import { ConnectionsDialog } from './components/ConnectionsDialog'
import { Errors, type AppError } from './components/Errors'
import { SettingsDialog } from './components/SettingsDialog'
import { TabBar } from './components/TabBar'
import { UpdateBanner } from './components/UpdateBanner'
import { WelcomeScreen } from './components/WelcomeScreen'
import { errorMessage } from './format'
import { RepoView } from './RepoView'
import { applyAppearance } from './theme'

const api = window.api
let errorId = 0

type Dialog = 'clone' | 'accounts' | 'settings' | 'workspaces' | 'log' | null

/** The window: a tab per open repository (or the start screen), and what's shared between them. */
export function App() {
  const [tabs, setTabs] = useState<RepoInfo[]>([])
  /** The repository on show, or null for the start screen. */
  const [active, setActive] = useState<string | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [errors, setErrors] = useState<AppError[]>([])
  const [accountCount, setAccountCount] = useState(0)
  /** Bumped when accounts change, so pull request lists reload. */
  const [accountsVersion, setAccountsVersion] = useState(0)
  /** Bumped when Settings closes: Settings → Git may have changed git's own config. */
  const [configVersion, setConfigVersion] = useState(0)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  /** The version the user put off with "Later". A newer one shows again. */
  const [updateLater, setUpdateLater] = useState<string | null>(null)
  /** Tabs are saved once the ones from last time are back, not before. */
  const restored = useRef(false)

  const reportError = useCallback((text: string) => {
    setErrors((current) => [...current.filter((e) => e.message !== text), { id: ++errorId, message: text }])
  }, [])

  const reloadAccounts = useCallback(() => void api.accounts.list().then((list) => setAccountCount(list.length)), [])
  useEffect(reloadAccounts, [reloadAccounts])

  // The update may have been found before this window loaded, so ask as well as listen.
  useEffect(() => {
    void api.update.state().then((state) => setUpdate((current) => current ?? state))
    return api.update.onChanged(setUpdate)
  }, [])

  // Settings, and the tabs open when GitLantern last closed.
  useEffect(() => {
    void api.settings.get().then(async (loaded) => {
      setSettings(loaded)
      try {
        const reopened = await api.repo.openKnown(loaded.openTabs)
        setTabs(reopened)
        setActive(reopened.find((info) => info.path === loaded.activeTab)?.path ?? reopened[0]?.path ?? null)
      } finally {
        restored.current = true
      }
    })
    return api.settings.onChanged(setSettings)
  }, [])

  useEffect(() => {
    if (settings) applyAppearance(settings)
  }, [settings])

  useEffect(() => {
    if (!restored.current) return
    void api.settings.set({ openTabs: tabs.map((tab) => tab.path), activeTab: active })
  }, [tabs, active])

  const changeSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      setSettings((current) => (current ? { ...current, ...patch } : current))
      api.settings.set(patch).then(setSettings, (err: unknown) => reportError(errorMessage(err)))
    },
    [reportError]
  )

  /** Show a repository in its tab, opening one if it isn't open yet. */
  const showRepo = useCallback((info: RepoInfo) => {
    setTabs((list) => (list.some((tab) => tab.path === info.path) ? list : [...list, info]))
    setActive(info.path)
  }, [])

  const openRepo = useCallback(
    async (open: () => Promise<RepoInfo | null>) => {
      try {
        const info = await open()
        if (info) showRepo(info)
      } catch (err) {
        reportError(errorMessage(err))
      }
    },
    [reportError, showRepo]
  )

  const closeTab = (path: string) => {
    const index = tabs.findIndex((tab) => tab.path === path)
    const rest = tabs.filter((tab) => tab.path !== path)
    setTabs(rest)
    if (active === path) setActive(rest[Math.min(index, rest.length - 1)]?.path ?? null)
    void api.repo.close(path)
  }

  const openWorkspace = (workspace: Workspace) =>
    void api.repo.openKnown(workspace.repos).then((opened) => {
      if (opened.length === 0) {
        reportError(`None of the repositories in “${workspace.name}” could be opened. They may have moved.`)
        return
      }
      setTabs((list) => [...list, ...opened.filter((info) => !list.some((tab) => tab.path === info.path))])
      setActive(opened[0]?.path ?? null)
    }, (err: unknown) => reportError(errorMessage(err)))

  const saveWorkspace = () => {
    if (!settings) return
    const name = `Workspace ${settings.workspaces.length + 1}`
    changeSettings({ workspaces: [...settings.workspaces, { id: crypto.randomUUID(), name, repos: tabs.map((tab) => tab.path) }] })
    setDialog('workspaces')
  }

  const updateBanner = update && update.version !== updateLater && (
    <UpdateBanner
      update={update}
      busy={false}
      onLater={() => setUpdateLater(update.version)}
      onInstall={() => void api.update.install().catch((err: unknown) => reportError(errorMessage(err)))}
    />
  )

  const dialogs = (
    <>
      {dialog === 'clone' && (
        <CloneDialog
          onClose={() => setDialog(null)}
          onManageAccounts={() => setDialog('accounts')}
          onCloned={(info) => {
            setDialog(null)
            showRepo(info)
          }}
        />
      )}
      {dialog === 'accounts' && (
        <ConnectionsDialog
          onClose={() => setDialog(null)}
          onChanged={() => {
            reloadAccounts()
            setAccountsVersion((n) => n + 1)
          }}
        />
      )}
      {(dialog === 'settings' || dialog === 'workspaces') && settings && (
        <SettingsDialog
          settings={settings}
          onChange={changeSettings}
          repoPath={active}
          openTabs={tabs.map((tab) => tab.path)}
          initialSection={dialog === 'workspaces' ? 'workspaces' : 'appearance'}
          onClose={() => {
            setDialog(null)
            setConfigVersion((n) => n + 1)
          }}
        />
      )}
      {dialog === 'log' && <CommandLogDialog onClose={() => setDialog(null)} />}
      <AskPassDialog />
    </>
  )

  return (
    <div className={`app${active === null ? ' app-welcome' : ''}`}>
      {tabs.length > 0 && settings && (
        <TabBar
          tabs={tabs}
          active={active}
          workspaces={settings.workspaces}
          onSelect={setActive}
          onClose={closeTab}
          onOpenWorkspace={openWorkspace}
          onSaveWorkspace={saveWorkspace}
          onManageWorkspaces={() => setDialog('workspaces')}
        />
      )}
      <div className="notices">
        {updateBanner}
        <Errors errors={errors} onDismiss={(id) => setErrors((list) => list.filter((e) => e.id !== id))} />
      </div>
      {active === null && (
        <WelcomeScreen
          onPick={() => openRepo(() => api.repo.pick())}
          onOpen={(path) => openRepo(() => api.repo.open(path))}
          onClone={() => setDialog('clone')}
          onConnect={() => setDialog('accounts')}
          onSettings={() => setDialog('settings')}
          workspaces={settings?.workspaces ?? []}
          onOpenWorkspace={openWorkspace}
        />
      )}
      {settings &&
        tabs.map((tab) => (
          <RepoView
            key={tab.path}
            repo={tab}
            active={tab.path === active}
            settings={settings}
            accountCount={accountCount}
            accountsVersion={accountsVersion}
            configVersion={configVersion}
            onOpenRepo={() => openRepo(() => api.repo.pick())}
            onOpenRecent={(path) => openRepo(() => api.repo.open(path))}
            onClone={() => setDialog('clone')}
            onAccounts={() => setDialog('accounts')}
            onSettings={() => setDialog('settings')}
            onCommandLog={() => setDialog('log')}
            onOpenRelated={(path) => openRepo(() => api.repo.openRelated(tab.path, path))}
          />
        ))}
      {dialogs}
    </div>
  )
}
