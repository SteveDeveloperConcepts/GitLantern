import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { Branch, Commit, DiffTarget, RepoInfo } from '../../shared/types'
import { AskPassDialog } from './components/AskPassDialog'
import { BranchesPanel } from './components/BranchesPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { CloneDialog } from './components/CloneDialog'
import { CommitDetails } from './components/CommitDetails'
import { ConnectionsDialog } from './components/ConnectionsDialog'
import { DiffView } from './components/DiffView'
import { Errors, type AppError } from './components/Errors'
import { Icon } from './components/Icon'
import { PromptDialog } from './components/PromptDialog'
import { RemotesPanel } from './components/RemotesPanel'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { errorMessage } from './format'
import { CommitGraph, WORKING_COPY } from './graph/CommitGraph'
import { layoutGraph } from './graph/layout'
import { useRepo } from './useRepo'

const api = window.api
let errorId = 0

type Tab = 'changes' | 'branches' | 'remotes'
type Dialog = 'clone' | 'accounts' | 'new-branch' | null

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [tab, setTab] = useState<Tab>('changes')
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [errors, setErrors] = useState<AppError[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [accountCount, setAccountCount] = useState(0)
  const { status, commits, branches, remotes, error, refresh } = useRepo(repo)

  const reloadAccounts = useCallback(() => void api.accounts.list().then((list) => setAccountCount(list.length)), [])
  useEffect(reloadAccounts, [reloadAccounts])

  // Uncommitted changes appear as a row above the commit they are based on.
  const graphCommits = useMemo<Commit[]>(() => {
    const changed = status?.entries.length ?? 0
    if (changed === 0) return commits
    const working: Commit = {
      hash: WORKING_COPY,
      parents: status?.branch.oid ? [status.branch.oid] : [],
      authorName: '',
      authorEmail: '',
      authorDate: Date.now() / 1000,
      subject: `${changed} uncommitted change${changed === 1 ? '' : 's'}`,
      refs: []
    }
    return [working, ...commits]
  }, [commits, status])
  const layout = useMemo(() => layoutGraph(graphCommits), [graphCommits])

  const reportError = useCallback((text: string) => {
    setErrors((current) => [...current.filter((e) => e.message !== text), { id: ++errorId, message: text }])
  }, [])

  useEffect(() => {
    if (error) reportError(error)
  }, [error, reportError])

  const showRepo = useCallback((info: RepoInfo) => {
    setRepo(info)
    setSelectedHash(null)
    setDiffTarget(null)
    setLastSync(null)
    setMessage(`Opened ${info.name}`)
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

  /** Run a git action with a busy indicator, report the outcome and refresh afterwards. */
  const run = useCallback(
    async (label: string, action: (repoPath: string) => Promise<void>, success?: string, sync = false) => {
      if (!repo) return
      setBusy(label)
      setMessage(null)
      try {
        await action(repo.path)
        if (success) setMessage(success)
        if (sync) setLastSync(Date.now())
      } catch (err) {
        reportError(errorMessage(err))
      } finally {
        setBusy(null)
        await refresh()
      }
    },
    [repo, refresh, reportError]
  )

  const checkout = (branch: Branch) =>
    run(`Checking out ${branch.name}`, (path) => api.git.checkout(path, branch), `Checked out ${branch.name}`)

  const selectCommit = (hash: string | null) => {
    if (hash === WORKING_COPY) {
      setTab('changes')
      setSelectedHash(null)
      setDiffTarget(null)
      return
    }
    setSelectedHash(hash)
    setDiffTarget(null)
  }

  const dialogs = (
    <>
      {dialog === 'clone' && (
        <CloneDialog
          onClose={() => setDialog(null)}
          onManageAccounts={() => setDialog('accounts')}
          onCloned={(info) => {
            setDialog(null)
            showRepo(info)
            setMessage(`Cloned ${info.name}`)
          }}
        />
      )}
      {dialog === 'accounts' && (
        <ConnectionsDialog
          onClose={() => setDialog(null)}
          onChanged={() => {
            reloadAccounts()
            void refresh()
          }}
        />
      )}
      {dialog === 'new-branch' && (
        <PromptDialog
          title="New branch"
          label={`Branch off ${status?.branch.head ?? 'HEAD'} and switch to it.`}
          placeholder="feature/my-change"
          confirm="Create and switch"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null)
            void run('Creating branch', (path) => api.git.createBranch(path, name), `Switched to new branch ${name}`)
          }}
        />
      )}
      <AskPassDialog />
    </>
  )
  const errorBanner = <Errors errors={errors} onDismiss={(id) => setErrors((list) => list.filter((e) => e.id !== id))} />

  if (!repo) {
    return (
      <div className="app app-welcome">
        {errorBanner}
        <WelcomeScreen
          onPick={() => openRepo(() => api.repo.pick())}
          onOpen={(path) => openRepo(() => api.repo.open(path))}
          onClone={() => setDialog('clone')}
          onConnect={() => setDialog('accounts')}
        />
        {dialogs}
      </div>
    )
  }

  const changeCount = status?.entries.length ?? 0
  const localCount = branches.filter((b) => b.kind === 'local').length
  const showDetail = selectedHash !== null || diffTarget !== null
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'changes', label: 'Changes', count: changeCount },
    { id: 'branches', label: 'Branches', count: localCount },
    { id: 'remotes', label: 'Remotes', count: remotes.length }
  ]

  return (
    <div className="app">
      <TopBar
        repo={repo}
        status={status}
        branches={branches}
        busy={busy !== null}
        accountCount={accountCount}
        onOpen={() => openRepo(() => api.repo.pick())}
        onOpenRecent={(path) => openRepo(() => api.repo.open(path))}
        onClone={() => setDialog('clone')}
        onCheckout={checkout}
        onNewBranch={() => setDialog('new-branch')}
        onFetch={() => run('Fetching', api.git.fetch, 'Fetched all remotes', true)}
        onPull={() => run('Pulling', api.git.pull, 'Pulled (fast-forward)', true)}
        onPush={() => run('Pushing', api.git.push, 'Pushed', true)}
        onAccounts={() => setDialog('accounts')}
      />
      {errorBanner}
      <div className="workspace">
        <aside className="left-panel">
          <div className="tabs" role="tablist" aria-label="Panels">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
                {t.count > 0 && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'changes' && (
              <ChangesPanel
                status={status}
                busy={busy !== null}
                openTarget={selectedHash === null ? diffTarget : null}
                onOpenDiff={(target) => {
                  setSelectedHash(null)
                  setDiffTarget(target)
                }}
                onStage={(paths) => run('Staging', (path) => api.git.stage(path, paths))}
                onUnstage={(paths) => run('Unstaging', (path) => api.git.unstage(path, paths))}
                onCommit={(text) => run('Committing', (path) => api.git.commit(path, text), 'Committed')}
              />
            )}
            {tab === 'branches' && (
              <BranchesPanel branches={branches} onCheckout={checkout} onSelect={(branch) => selectCommit(branch.hash)} />
            )}
            {tab === 'remotes' && (
              <RemotesPanel
                remotes={remotes}
                busy={busy !== null}
                onConnectAccount={() => setDialog('accounts')}
                onAdd={(name, url) => run('Adding remote', (path) => api.remotes.add(path, name, url), `Added remote ${name}`)}
                onSetUrl={(name, url) => run('Updating remote', (path) => api.remotes.setUrl(path, name, url), `Updated ${name}`)}
                onRemove={(name) => run('Removing remote', (path) => api.remotes.remove(path, name), `Removed ${name}`)}
              />
            )}
          </div>
        </aside>
        <main className="center">
          <SplitPane
            top={
              graphCommits.length === 0 ? (
                <div className="empty-state centered">
                  <p className="empty-title">No commits yet</p>
                  <p>Stage some files on the Changes tab and make the first commit.</p>
                </div>
              ) : (
                <CommitGraph
                  commits={graphCommits}
                  layout={layout}
                  headHash={status?.branch.oid ?? null}
                  selectedHash={selectedHash}
                  onSelect={(hash) => selectCommit(hash === selectedHash ? null : hash)}
                />
              )
            }
            bottom={
              showDetail ? (
                <div className="detail-pane">
                  <button className="detail-close icon-button" onClick={() => selectCommit(null)} aria-label="Close details">
                    <Icon name="close" size={14} />
                  </button>
                  {selectedHash ? (
                    <div className="detail-split">
                      <CommitDetails
                        repoPath={repo.path}
                        hash={selectedHash}
                        openPath={diffTarget?.kind === 'commit' ? diffTarget.path : null}
                        onOpenDiff={setDiffTarget}
                      />
                      {diffTarget?.kind === 'commit' && diffTarget.hash === selectedHash ? (
                        <DiffView repoPath={repo.path} target={diffTarget} />
                      ) : (
                        <div className="empty">Pick a file to see what changed.</div>
                      )}
                    </div>
                  ) : (
                    diffTarget && <DiffView repoPath={repo.path} target={diffTarget} />
                  )}
                </div>
              ) : null
            }
          />
        </main>
      </div>
      <StatusBar status={status} remotes={remotes} busy={busy} message={message} lastSync={lastSync} />
      {dialogs}
    </div>
  )
}

/** Vertical split with a draggable divider; the bottom pane is hidden when empty. */
function SplitPane({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  const [bottomHeight, setBottomHeight] = useState(320)
  const container = useRef<HTMLDivElement>(null)

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !container.current) return
    const rect = container.current.getBoundingClientRect()
    setBottomHeight(Math.min(rect.height - 120, Math.max(140, rect.bottom - event.clientY)))
  }

  return (
    <div className="split" ref={container}>
      <div className="split-top">{top}</div>
      {bottom && (
        <>
          <div className="split-divider" role="separator" aria-orientation="horizontal" onPointerDown={startDrag} onPointerMove={drag} />
          <div className="split-bottom" style={{ height: bottomHeight }}>
            {bottom}
          </div>
        </>
      )}
    </div>
  )
}
