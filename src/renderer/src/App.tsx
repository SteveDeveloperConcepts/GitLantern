import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type {
  Branch,
  Commit,
  ConflictPick,
  DiffTarget,
  LogFilter,
  OperationResult,
  PatchAction,
  PullRequest,
  PushResult,
  RefKind,
  RepoInfo,
  Stash,
  UpdateState
} from '../../shared/types'
import {
  branchesForRefs,
  commitMenu,
  type IntegrateKind,
  type MenuActions,
  type MenuContext,
  type RefTarget
} from './branchMenus'
import { AskPassDialog } from './components/AskPassDialog'
import { BranchesPanel } from './components/BranchesPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { CloneDialog } from './components/CloneDialog'
import { CommitDetails } from './components/CommitDetails'
import { ConnectionsDialog } from './components/ConnectionsDialog'
import { DiffView } from './components/DiffView'
import { Errors, type AppError } from './components/Errors'
import { ForcePushDialog } from './components/ForcePushDialog'
import { HistoryToolbar } from './components/HistoryToolbar'
import { Icon } from './components/Icon'
import { IntegrateDialog } from './components/IntegrateDialog'
import { ContextMenu, type MenuItem } from './components/Menu'
import { nameFor, OperationBanner } from './components/OperationBanner'
import { PromptDialog } from './components/PromptDialog'
import { PullRequestsPanel } from './components/PullRequestsPanel'
import { RemotesPanel } from './components/RemotesPanel'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { UpdateBanner } from './components/UpdateBanner'
import { WelcomeScreen } from './components/WelcomeScreen'
import { errorMessage } from './format'
import { CommitGraph, WORKING_COPY } from './graph/CommitGraph'
import { commitBranches } from './graph/branches'
import { layoutGraph } from './graph/layout'
import { refPills } from './graph/refs'
import { linkedWithin, matchesSearch, searchTerms } from './graph/search'
import { useRepo } from './useRepo'

const api = window.api
let errorId = 0

type Tab = 'changes' | 'branches' | 'remotes' | 'pulls'
type Dialog = 'clone' | 'accounts' | 'new-branch' | 'stash' | null
type NeedsForce = Extract<PushResult, { outcome: 'needs-force' }>

const PATCH_VERBS: Record<PatchAction, [string, string]> = {
  stage: ['Staging', 'Staged'],
  unstage: ['Unstaging', 'Unstaged'],
  discard: ['Discarding', 'Discarded']
}
const lineCount = (count: number): string => `${count} line${count === 1 ? '' : 's'}`

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [tab, setTab] = useState<Tab>('changes')
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  /** A stash whose changes are open below the graph, instead of a commit. */
  const [selectedStash, setSelectedStash] = useState<string | null>(null)
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [errors, setErrors] = useState<AppError[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [accountCount, setAccountCount] = useState(0)
  /** Where "New branch" starts from; null for the checked-out commit. */
  const [branchFrom, setBranchFrom] = useState<RefTarget | null>(null)
  const [integrate, setIntegrate] = useState<{ kind: IntegrateKind; target: RefTarget; pull?: boolean } | null>(null)
  const [forcePush, setForcePush] = useState<NeedsForce | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; groups: MenuItem[][] } | null>(null)
  const [historyFilter, setHistoryFilter] = useState<LogFilter>({})
  const [search, setSearch] = useState('')
  const [matchesOnly, setMatchesOnly] = useState(false)
  /** Bumped after a push or a new pull request, so the pull request list reloads. */
  const [pullsVersion, setPullsVersion] = useState(0)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  /** The version the user put off with "Later". A newer one shows again. */
  const [updateLater, setUpdateLater] = useState<string | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const { status, commits, branches, remotes, stashes, error, refresh } = useRepo(repo, historyFilter)

  const reloadAccounts = useCallback(() => void api.accounts.list().then((list) => setAccountCount(list.length)), [])
  useEffect(reloadAccounts, [reloadAccounts])

  // The update may have been found before this window loaded, so ask as well as listen.
  useEffect(() => {
    void api.update.state().then((state) => setUpdate((current) => current ?? state))
    return api.update.onChanged(setUpdate)
  }, [])

  const commitBranchNames = useMemo(() => commitBranches(commits), [commits])
  const terms = useMemo(() => searchTerms(search), [search])
  /** Commits matching the search box, or null when it's empty. */
  const matches = useMemo(
    () =>
      terms.length === 0
        ? null
        : new Set(commits.filter((commit) => matchesSearch(commit, commitBranchNames.get(commit.hash), terms)).map((c) => c.hash)),
    [commits, commitBranchNames, terms]
  )
  const filtering = matches !== null && matchesOnly

  // Uncommitted changes appear as a row above the commit they are based on.
  const graphCommits = useMemo<Commit[]>(() => {
    const shown = filtering ? commits.filter((commit) => matches.has(commit.hash)) : commits
    const changed = status?.entries.length ?? 0
    if (changed === 0 || filtering) return shown
    const working: Commit = {
      hash: WORKING_COPY,
      parents: status?.branch.oid ? [status.branch.oid] : [],
      authorName: '',
      authorEmail: '',
      authorDate: Date.now() / 1000,
      subject: `${changed} uncommitted change${changed === 1 ? '' : 's'}`,
      refs: []
    }
    return [working, ...shown]
  }, [commits, status, filtering, matches])
  // With only the matches shown, lines join the commits that are left rather than run off to hidden ones.
  const layout = useMemo(() => layoutGraph(filtering ? linkedWithin(graphCommits) : graphCommits), [graphCommits, filtering])
  const matchList = useMemo(() => commits.filter((commit) => matches?.has(commit.hash)), [commits, matches])

  /** Commits the checked-out branch has, as far as the loaded history reaches. */
  const onCurrent = useMemo(() => {
    const byHash = new Map(commits.map((commit) => [commit.hash, commit]))
    const reached = new Set<string>()
    const queue = status?.branch.oid ? [status.branch.oid] : []
    for (let hash = queue.pop(); hash !== undefined; hash = queue.pop()) {
      if (reached.has(hash)) continue
      reached.add(hash)
      queue.push(...(byHash.get(hash)?.parents ?? []))
    }
    return reached
  }, [commits, status?.branch.oid])

  const reportError = useCallback((text: string) => {
    setErrors((current) => [...current.filter((e) => e.message !== text), { id: ++errorId, message: text }])
  }, [])

  useEffect(() => {
    if (error) reportError(error)
  }, [error, reportError])

  const showRepo = useCallback((info: RepoInfo) => {
    setRepo(info)
    setSelectedHash(null)
    setSelectedStash(null)
    setDiffTarget(null)
    setLastSync(null)
    setIntegrate(null)
    setForcePush(null)
    setContextMenu(null)
    setHistoryFilter({})
    setSearch('')
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
        // Stay busy until the new state is loaded, so menus and buttons never act on the old one.
        await refresh()
        setBusy(null)
      }
    },
    [repo, refresh, reportError]
  )

  /** Like `run`, for commands that can stop on conflicts: those open the Changes tab instead of reporting success. */
  const runOperation = (label: string, action: (repoPath: string) => Promise<OperationResult>, success: string, conflicted?: string) =>
    run(label, async (repoPath) => {
      const result = await action(repoPath)
      setMessage(result.conflicted ? (conflicted ?? 'Stopped on conflicts. Resolve them, then continue.') : success)
      if (result.conflicted) setTab('changes')
    })

  const pull = () =>
    run(
      'Pulling',
      async (repoPath) => {
        const { outcome, upstream } = await api.git.pull(repoPath)
        if (outcome === 'diverged') {
          setMessage(`${upstream} and your branch have both changed`)
          setIntegrate({ kind: 'merge', target: { ref: upstream, label: upstream }, pull: true })
        } else {
          setMessage(outcome === 'up-to-date' ? `Already up to date with ${upstream}` : `Pulled from ${upstream}`)
        }
      },
      undefined,
      true
    )

  const push = () =>
    run(
      'Pushing',
      async (repoPath) => {
        const result = await api.git.push(repoPath)
        if (result.outcome === 'needs-force') {
          setMessage(`${result.upstream} has old copies of your commits`)
          setForcePush(result)
        } else {
          setMessage('Pushed')
          setPullsVersion((n) => n + 1)
        }
      },
      undefined,
      true
    )

  const checkout = (branch: Branch) =>
    run(`Checking out ${branch.name}`, (path) => api.git.checkout(path, branch), `Checked out ${branch.name}`)

  const applyStash = (stash: Stash, pop: boolean) =>
    runOperation(
      pop ? 'Popping the stash' : 'Applying the stash',
      (path) => api.git.applyStash(path, stash.hash, { pop }),
      pop ? 'Popped the stash' : 'Applied the stash. It’s still in the list.',
      'The stash clashed with your changes. Pick a side for each conflict on the Changes tab. The stash was kept.'
    )

  const dropStash = (stash: Stash) => {
    if (!window.confirm(`Delete the stash “${stash.message}”? Its changes are gone for good.`)) return
    if (selectedStash === stash.hash) selectCommit(null)
    void run('Deleting the stash', (path) => api.git.dropStash(path, stash.hash), 'Deleted the stash')
  }

  const openStashMenu = (stash: Stash, position: { x: number; y: number }) =>
    setContextMenu({
      ...position,
      groups: [
        [
          { key: 'apply', label: 'Apply', hint: 'keep the stash', disabled: busy !== null, onSelect: () => void applyStash(stash, false) },
          { key: 'pop', label: 'Pop', hint: 'apply, then delete', disabled: busy !== null, onSelect: () => void applyStash(stash, true) }
        ],
        [{ key: 'drop', label: 'Delete stash…', disabled: busy !== null, onSelect: () => dropStash(stash) }]
      ]
    })

  const menuContext: MenuContext = {
    current: status?.branch.head ?? null,
    headHash: status?.branch.oid ?? null,
    operation: status?.operation,
    onCurrent
  }
  const menuActions: MenuActions = {
    checkout: (branch) => void checkout(branch),
    integrate: (kind, target) => setIntegrate({ kind, target }),
    createBranchAt: (target) => {
      setBranchFrom(target)
      setDialog('new-branch')
    },
    copyHash: (hash) =>
      void api.clipboard.write(hash).then(
        () => setMessage(`Copied ${hash.slice(0, 7)}`),
        (err: unknown) => reportError(errorMessage(err))
      ),
    cherryPick: (hash) =>
      void runOperation(
        `Cherry-picking ${hash.slice(0, 7)}`,
        (path) => api.git.cherryPick(path, hash),
        `Cherry-picked ${hash.slice(0, 7)} onto ${status?.branch.head ?? 'HEAD'}`
      )
  }

  const openCommitMenu = (commit: Commit, ref: { name: string; kind: RefKind } | null, position: { x: number; y: number }) => {
    selectCommit(commit.hash)
    // A label that stands for a local branch and its remote twin offers the local branch only.
    const labels = ref ? [ref] : refPills(commit.refs).map((pill) => ({ name: pill.label, kind: pill.kind }))
    setContextMenu({ ...position, groups: commitMenu(commit.hash, branchesForRefs(labels, branches), menuContext, menuActions) })
  }
  const openBranchMenu = (branch: Branch, position: { x: number; y: number }) =>
    setContextMenu({ ...position, groups: commitMenu(branch.hash, [branch], menuContext, menuActions) })

  const selectCommit = (hash: string | null) => {
    setSelectedStash(null)
    if (hash === WORKING_COPY) {
      setTab('changes')
      setSelectedHash(null)
      setDiffTarget(null)
      return
    }
    setSelectedHash(hash)
    setDiffTarget(null)
  }

  const selectStash = (stash: Stash) => {
    setSelectedHash(null)
    setDiffTarget(null)
    setSelectedStash(stash.hash === selectedStash ? null : stash.hash)
  }

  /** Step through the search matches, newest first, wrapping around at either end. */
  const stepMatch = (direction: 1 | -1) => {
    if (matchList.length === 0) return
    const index = matchList.findIndex((commit) => commit.hash === selectedHash)
    const next = index === -1 ? (direction === 1 ? 0 : matchList.length - 1) : (index + direction + matchList.length) % matchList.length
    selectCommit(matchList[next]?.hash ?? null)
  }

  const discard = (paths: string[]) => {
    if (paths.length === 0) return
    const untracked = new Set(status?.entries.filter((e) => e.untracked).map((e) => e.path))
    const files = paths.length === 1 ? paths[0] : `${paths.length} files`
    const note = paths.some((p) => untracked.has(p)) ? ' New files go to the trash.' : ''
    if (!window.confirm(`Discard your changes to ${files}? This can’t be undone.${note}`)) return
    if (diffTarget?.kind === 'worktree' && paths.includes(diffTarget.path)) setDiffTarget(null)
    void run('Discarding', (path) => api.git.discard(path, paths), `Discarded changes to ${files}`)
  }

  /** After a diff's file changed under it, show it again (as staged, once it's no longer conflicted). */
  const reloadDiff = (target: DiffTarget, staged = false) =>
    setDiffTarget((current) => (current === target ? (staged ? { kind: 'index', path: target.path } : { ...target }) : current))

  const applyLines = (target: DiffTarget, action: PatchAction, patch: string, count: number) => {
    if (action === 'discard' && !window.confirm(`Discard ${lineCount(count)} in ${target.path}? This can’t be undone.`)) return
    const [doing, done] = PATCH_VERBS[action]
    void run(`${doing} ${lineCount(count)}`, (path) => api.git.applyPatch(path, target.path, patch, action), `${done} ${lineCount(count)}`).then(
      () => reloadDiff(target)
    )
  }

  const pickConflict = (target: DiffTarget, pick: ConflictPick) => {
    let remaining = pick.conflicts
    void run(
      'Resolving',
      async (path) => {
        remaining = (await api.git.resolveConflict(path, target.path, pick)).remaining
        setMessage(remaining === 0 ? `${target.path} resolved and staged` : `${remaining} conflict${remaining === 1 ? '' : 's'} left in ${target.path}`)
      }
    ).then(() => reloadDiff(target, remaining === 0))
  }

  const pickFile = (target: DiffTarget, side: 'ours' | 'theirs') =>
    void run('Resolving', (path) => api.git.resolveFile(path, target.path, side), `${target.path} resolved and staged`).then(() =>
      reloadDiff(target, true)
    )

  const markResolved = (target: DiffTarget) =>
    void run('Staging', (path) => api.git.stage(path, [target.path]), `${target.path} marked resolved`).then(() => reloadDiff(target, true))

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
            setPullsVersion((n) => n + 1)
            void refresh()
          }}
        />
      )}
      {dialog === 'new-branch' && (
        <PromptDialog
          title="New branch"
          label={`Branch off ${branchFrom?.label ?? status?.branch.head ?? 'HEAD'} and switch to it.`}
          placeholder="feature/my-change"
          confirm="Create and switch"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null)
            const startPoint = branchFrom?.ref
            void run('Creating branch', (path) => api.git.createBranch(path, name, startPoint), `Switched to new branch ${name}`)
          }}
        />
      )}
      {dialog === 'stash' && (
        <PromptDialog
          title="Stash changes"
          label="Puts every uncommitted change aside, new files included, and leaves a clean working copy. Pop the stash to bring them back."
          placeholder="What you were doing (optional)"
          confirm="Stash"
          optional
          onCancel={() => setDialog(null)}
          onSubmit={(text) => {
            setDialog(null)
            void run('Stashing', (path) => api.git.stash(path, text), 'Stashed your changes')
          }}
        />
      )}
      {integrate && repo && status && (
        <IntegrateDialog
          kind={integrate.kind}
          target={integrate.target}
          current={status.branch.head ?? 'HEAD'}
          upstream={status.branch.upstream}
          repoPath={repo.path}
          dirty={status.entries.some((e) => !e.untracked && (e.index !== null || e.worktree !== null))}
          {...(integrate.pull ? { pull: true } : {})}
          onCancel={() => setIntegrate(null)}
          onConfirm={({ kind, noFastForward }) => {
            const { target } = integrate
            const current = status.branch.head ?? 'HEAD'
            setIntegrate(null)
            void (kind === 'merge'
              ? runOperation(
                  `Merging ${target.label}`,
                  (path) => api.git.merge(path, target.ref, { noFastForward }),
                  `Merged ${target.label} into ${current}`
                )
              : runOperation(`Rebasing onto ${target.label}`, (path) => api.git.rebase(path, target.ref), `Rebased ${current} onto ${target.label}`))
          }}
        />
      )}
      {forcePush && status && (
        <ForcePushDialog
          branch={status.branch.head ?? 'HEAD'}
          upstream={forcePush.upstream}
          expected={forcePush.expected}
          replaced={forcePush.replaced}
          ahead={status.branch.ahead}
          onCancel={() => setForcePush(null)}
          onConfirm={() => {
            const { upstream, expected } = forcePush
            setForcePush(null)
            void run('Force pushing', (path) => api.git.forcePush(path, expected), `Replaced ${upstream} with your branch`, true)
          }}
        />
      )}
      <AskPassDialog />
    </>
  )
  const errorBanner = <Errors errors={errors} onDismiss={(id) => setErrors((list) => list.filter((e) => e.id !== id))} />
  const updateBanner = update && update.version !== updateLater && (
    <UpdateBanner
      update={update}
      busy={busy !== null}
      onLater={() => setUpdateLater(update.version)}
      onInstall={() => void api.update.install().catch((err: unknown) => reportError(errorMessage(err)))}
    />
  )

  if (!repo) {
    return (
      <div className="app app-welcome">
        <div className="notices">
          {updateBanner}
          {errorBanner}
        </div>
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
  const operation = status?.operation
  const operationBanner = operation && (
    <OperationBanner
      operation={operation}
      current={status.branch.head}
      conflicts={status.entries.filter((e) => e.conflicted).length}
      branches={branches}
      busy={busy !== null}
      onShowChanges={() => setTab('changes')}
      onContinue={() =>
        runOperation(
          `Continuing the ${operation.kind}`,
          api.git.continueOperation,
          operation.kind === 'merge' ? 'Merge committed' : `Finished the ${operation.kind}`
        )
      }
      onSkip={() => runOperation('Skipping the commit', api.git.skipOperation, `Finished the ${operation.kind}`)}
      onAbort={() => run(`Aborting the ${operation.kind}`, api.git.abortOperation, `Aborted the ${operation.kind}`)}
    />
  )
  // In a conflict, HEAD's side is the checked-out branch, except in a rebase: there it's the branch
  // being rebased onto, with the commits replayed so far.
  const headSide =
    operation?.kind === 'rebase' && operation.onto ? nameFor(operation.onto, branches) : (status?.branch.head ?? 'HEAD')
  const localCount = branches.filter((b) => b.kind === 'local').length
  const showDetail = selectedHash !== null || selectedStash !== null || diffTarget !== null
  const detailHash = selectedStash ?? selectedHash
  // GitLab calls them merge requests; everyone else, pull requests.
  const gitlab = (remotes.find((r) => r.name === 'origin') ?? remotes[0])?.service === 'GitLab'
  const tabs: { id: Tab; label: string; count: number; title?: string }[] = [
    { id: 'changes', label: 'Changes', count: changeCount },
    { id: 'branches', label: 'Branches', count: localCount, title: 'Branches and stashes' },
    { id: 'remotes', label: 'Remotes', count: remotes.length },
    { id: 'pulls', label: gitlab ? 'MRs' : 'PRs', count: 0, title: gitlab ? 'Merge requests' : 'Pull requests' }
  ]

  return (
    <div className="app">
      <TopBar
        repo={repo}
        status={status}
        branches={branches}
        busy={busy !== null}
        accountCount={accountCount}
        canStash={changeCount > 0 && !operation}
        stashCount={stashes.length}
        onOpen={() => openRepo(() => api.repo.pick())}
        onOpenRecent={(path) => openRepo(() => api.repo.open(path))}
        onClone={() => setDialog('clone')}
        onCheckout={checkout}
        onNewBranch={() => {
          setBranchFrom(null)
          setDialog('new-branch')
        }}
        onFetch={() => run('Fetching', api.git.fetch, 'Fetched all remotes', true)}
        onPull={() => void pull()}
        onPush={() => void push()}
        onStash={() => setDialog('stash')}
        onPop={() => {
          const latest = stashes[0]
          if (latest) void applyStash(latest, true)
        }}
        onAccounts={() => setDialog('accounts')}
      />
      <div className="notices">
        {updateBanner}
        {operationBanner}
        {errorBanner}
      </div>
      <div className="workspace">
        <aside className="left-panel">
          <div className="tabs" role="tablist" aria-label="Panels">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'active' : ''}
                title={t.title}
                onClick={() => setTab(t.id)}
              >
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
                openTarget={selectedHash === null && selectedStash === null ? diffTarget : null}
                onOpenDiff={(target) => {
                  setSelectedHash(null)
                  setSelectedStash(null)
                  setDiffTarget(target)
                }}
                onStage={(paths) => run('Staging', (path) => api.git.stage(path, paths))}
                onUnstage={(paths) => run('Unstaging', (path) => api.git.unstage(path, paths))}
                onDiscard={discard}
                onCommit={(text) => run('Committing', (path) => api.git.commit(path, text), 'Committed')}
              />
            )}
            {tab === 'branches' && (
              <BranchesPanel
                branches={branches}
                onCheckout={checkout}
                onSelect={(branch) => selectCommit(branch.hash)}
                onContextMenu={openBranchMenu}
                stashes={stashes}
                selectedStash={selectedStash}
                onSelectStash={selectStash}
                onApplyStash={(stash) => void applyStash(stash, false)}
                onStashMenu={openStashMenu}
              />
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
            {tab === 'pulls' && (
              <PullRequestsPanel
                repoPath={repo.path}
                status={status}
                branches={branches}
                commits={commits}
                busy={busy !== null}
                reloadKey={pullsVersion}
                onConnectAccount={() => setDialog('accounts')}
                onPush={() => void push()}
                onCheckout={(pr: PullRequest) =>
                  void run(`Checking out #${pr.number}`, async (path) => {
                    setMessage(`Checked out ${await api.pullRequests.checkout(path, pr.number)} for #${pr.number}`)
                  })
                }
                onCreated={(pr, noun) => setMessage(`Opened ${noun} #${pr.number}`)}
              />
            )}
          </div>
        </aside>
        <main className="center">
          <SplitPane
            top={
              <div className="history">
                <HistoryToolbar
                  query={search}
                  onQuery={setSearch}
                  matches={matchList.length}
                  current={matchList.findIndex((commit) => commit.hash === selectedHash)}
                  onStep={stepMatch}
                  matchesOnly={matchesOnly}
                  onMatchesOnly={setMatchesOnly}
                  filter={historyFilter}
                  onFilter={setHistoryFilter}
                  branches={branches}
                />
                {graphCommits.length === 0 ? (
                  <div className="empty-state centered">
                    {historyFilter.branch || historyFilter.path || filtering ? (
                      <>
                        <p className="empty-title">No commits match</p>
                        <p>Change the search or the filters above.</p>
                      </>
                    ) : (
                      <>
                        <p className="empty-title">No commits yet</p>
                        <p>Stage some files on the Changes tab and make the first commit.</p>
                      </>
                    )}
                  </div>
                ) : (
                  <CommitGraph
                    commits={graphCommits}
                    layout={layout}
                    branches={commitBranchNames}
                    headHash={status?.branch.oid ?? null}
                    selectedHash={selectedHash}
                    matches={filtering ? null : matches}
                    onSelect={(hash) => selectCommit(hash === selectedHash ? null : hash)}
                    onContextMenu={openCommitMenu}
                  />
                )}
              </div>
            }
            bottom={
              showDetail ? (
                <div className="detail-pane">
                  <button className="detail-close icon-button" onClick={() => selectCommit(null)} aria-label="Close details">
                    <Icon name="close" size={14} />
                  </button>
                  {detailHash ? (
                    <div className="detail-split">
                      <CommitDetails
                        key={detailHash}
                        repoPath={repo.path}
                        hash={detailHash}
                        stash={selectedStash !== null}
                        openPath={diffTarget?.kind === 'commit' || diffTarget?.kind === 'stash' ? diffTarget.path : null}
                        onOpenDiff={setDiffTarget}
                      />
                      {(diffTarget?.kind === 'commit' || diffTarget?.kind === 'stash') && diffTarget.hash === detailHash ? (
                        <DiffView repoPath={repo.path} target={diffTarget} />
                      ) : (
                        <div className="empty">Pick a file to see what changed.</div>
                      )}
                    </div>
                  ) : (
                    diffTarget && (
                      <DiffView
                        repoPath={repo.path}
                        target={diffTarget}
                        busy={busy !== null}
                        onLines={(action, patch, count) => applyLines(diffTarget, action, patch, count)}
                        conflicts={{
                          head: headSide,
                          onPick: (pick) => pickConflict(diffTarget, pick),
                          onPickFile: (side) => pickFile(diffTarget, side),
                          onMarkResolved: () => markResolved(diffTarget)
                        }}
                      />
                    )
                  )}
                </div>
              ) : null
            }
          />
        </main>
      </div>
      <StatusBar status={status} remotes={remotes} busy={busy} message={message} lastSync={lastSync} />
      {dialogs}
      {contextMenu && <ContextMenu {...contextMenu} onClose={closeContextMenu} />}
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
