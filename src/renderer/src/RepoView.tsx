import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type {
  Branch,
  Commit,
  ConflictPick,
  CustomAction,
  CustomActionContext,
  CustomActionResult,
  DiffTarget,
  GitIdentity,
  LogFilter,
  OperationResult,
  PatchAction,
  PullRequest,
  PushResult,
  RebaseStep,
  RefKind,
  RepoInfo,
  Stash,
  Submodule,
  Tag,
  UserSettings,
  Worktree
} from '../../shared/types'
import {
  branchesForRefs,
  commitMenu,
  tagMenu,
  type IntegrateKind,
  type MenuActions,
  type MenuContext,
  type RefTarget
} from './branchMenus'
import { BisectBanner } from './components/BisectBanner'
import { BranchesPanel } from './components/BranchesPanel'
import { ChangesPanel, type ChangeList } from './components/ChangesPanel'
import { CleanDialog } from './components/CleanDialog'
import { CommitDetails } from './components/CommitDetails'
import { CompareView } from './components/CompareView'
import { DiffView } from './components/DiffView'
import { Errors, type AppError } from './components/Errors'
import { FileInspector, type InspectView } from './components/FileInspector'
import { FlowDialog, type FlowMode } from './components/FlowDialog'
import { ForcePushDialog } from './components/ForcePushDialog'
import { HistoryToolbar } from './components/HistoryToolbar'
import { MessageDialog, RebaseDialog, ResetDialog } from './components/HistoryDialogs'
import { Icon } from './components/Icon'
import { IntegrateDialog } from './components/IntegrateDialog'
import { ContextMenu, type MenuItem } from './components/Menu'
import { nameFor, OperationBanner } from './components/OperationBanner'
import { OutputDialog } from './components/OutputDialog'
import { PromptDialog } from './components/PromptDialog'
import { PullRequestReview } from './components/PullRequestReview'
import { PullRequestsPanel } from './components/PullRequestsPanel'
import { TagDialog, UpstreamDialog } from './components/RefDialogs'
import { RemotesPanel } from './components/RemotesPanel'
import { StatusBar } from './components/StatusBar'
import { LfsDialog, SubmoduleDialog, WorktreeDialog } from './components/StructureDialogs'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { errorMessage } from './format'
import { CommitGraph, WORKING_COPY } from './graph/CommitGraph'
import { commitBranches } from './graph/branches'
import { layoutGraph } from './graph/layout'
import { refPills } from './graph/refs'
import { linkedWithin, matchesSearch, searchTerms } from './graph/search'
import { rulesFor } from './issueLinks'
import { addToast, toastDetail, type Toast } from './toasts'
import { useRepo } from './useRepo'

const api = window.api
let errorId = 0

type Tab = 'changes' | 'branches' | 'remotes' | 'pulls'
type NeedsForce = Extract<PushResult, { outcome: 'needs-force' }>
type Position = { x: number; y: number }

/** The dialog open over this repository, with what it's about. */
type RepoDialog =
  | { kind: 'new-branch'; from: RefTarget | null }
  | { kind: 'stash' }
  | { kind: 'reset'; hash: string }
  | { kind: 'reword'; hash: string; message: string }
  | { kind: 'rebase'; base: string | null; preset?: { hash: string; action: RebaseStep['action'] } }
  | { kind: 'tag'; target: RefTarget }
  | { kind: 'rename'; branch: Branch }
  | { kind: 'upstream'; branch: Branch }
  | { kind: 'worktree' }
  | { kind: 'submodule' }
  | { kind: 'lfs' }
  | { kind: 'flow'; flow: FlowMode }
  | { kind: 'clean' }
  | { kind: 'output'; title: string; result: CustomActionResult }

const PATCH_VERBS: Record<PatchAction, [string, string]> = {
  stage: ['Staging', 'Staged'],
  unstage: ['Unstaging', 'Unstaged'],
  discard: ['Discarding', 'Discarded']
}
const lineCount = (count: number): string => `${count} line${count === 1 ? '' : 's'}`
const short = (hash: string): string => hash.slice(0, 7)
const FOLDER_APP = navigator.userAgent.includes('Mac') ? 'Finder' : navigator.userAgent.includes('Windows') ? 'Explorer' : 'the file manager'

interface Props {
  repo: RepoInfo
  /** The tab on show; hidden tabs keep their state but don't take keyboard shortcuts. */
  active: boolean
  settings: UserSettings
  accountCount: number
  /** Bumped when accounts change, so pull requests reload. */
  accountsVersion: number
  /** Bumped when the Settings screen closes, so git's own settings (name, signing) are read again. */
  configVersion: number
  onOpenRepo(): void
  onOpenRecent(path: string): void
  onClone(): void
  onAccounts(): void
  onSettings(): void
  onCommandLog(): void
  /** Open a submodule or worktree in a tab of its own. */
  onOpenRelated(path: string): void
}

export function RepoView({ repo, active, settings, accountCount, accountsVersion, configVersion, ...app }: Props) {
  const [tab, setTab] = useState<Tab>('changes')
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  /** A stash whose changes are open below the graph, instead of a commit. */
  const [selectedStash, setSelectedStash] = useState<string | null>(null)
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null)
  /** Two commits or branches compared below the graph. */
  const [compare, setCompare] = useState<{ from: RefTarget; to: RefTarget } | null>(null)
  const [inspect, setInspect] = useState<{ path: string; view: InspectView } | null>(null)
  /** A pull request open in review mode, in place of the history. */
  const [reviewing, setReviewing] = useState<{ pr: PullRequest; noun: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setStatusMessage] = useState<string | null>(null)
  /** The status bar's last message: a fetch, pull or push's toast repeats how it went. */
  const lastMessage = useRef<string | null>(null)
  /** Set by an action whose outcome needs a look (push needs a force push, pull needs a merge or rebase). */
  const needsLook = useRef(false)
  const setMessage = useCallback((text: string | null) => {
    lastMessage.current = text
    setStatusMessage(text)
  }, [])
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const showToast = useCallback((toast: Omit<Toast, 'id'>) => setToasts((list) => addToast(list, { ...toast, id: ++toastId.current })), [])
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [errors, setErrors] = useState<AppError[]>([])
  const [dialog, setDialog] = useState<RepoDialog | null>(null)
  const [integrate, setIntegrate] = useState<{ kind: IntegrateKind; target: RefTarget; pull?: boolean } | null>(null)
  const [forcePush, setForcePush] = useState<NeedsForce | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; groups: MenuItem[][] } | null>(null)
  const [historyFilter, setHistoryFilter] = useState<LogFilter>({})
  const [search, setSearch] = useState('')
  const [matchesOnly, setMatchesOnly] = useState(false)
  /** Bumped after a push or a new pull request, so the pull request list reloads. */
  const [pullsVersion, setPullsVersion] = useState(0)
  /** git's last bisect report: steps left, or the first bad commit. */
  const [bisectStep, setBisectStep] = useState<{ message: string; firstBad: string | null } | null>(null)
  const [identity, setIdentity] = useState<{ local: Partial<GitIdentity>; global: GitIdentity } | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const { status, commits, branches, remotes, stashes, tags, worktrees, submodules, flow, error, refresh } = useRepo(repo, historyFilter)
  const busyRef = useRef(busy)
  busyRef.current = busy

  // Read again after the Settings screen closes: Settings → Git writes git's own config, not settings.
  useEffect(() => {
    api.git.identity(repo.path).then(setIdentity, () => setIdentity(null))
  }, [repo.path, configVersion])

  // A bisect that ended (here or in a terminal) leaves nothing to report.
  useEffect(() => {
    if (status && !status.bisect) setBisectStep(null)
  }, [status])

  const commitBranchNames = useMemo(() => commitBranches(commits), [commits])
  const byHash = useMemo(() => new Map(commits.map((commit) => [commit.hash, commit])), [commits])
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
    const reached = new Set<string>()
    const queue = status?.branch.oid ? [status.branch.oid] : []
    for (let hash = queue.pop(); hash !== undefined; hash = queue.pop()) {
      if (reached.has(hash)) continue
      reached.add(hash)
      queue.push(...(byHash.get(hash)?.parents ?? []))
    }
    return reached
  }, [byHash, status?.branch.oid])

  const origin = (remotes.find((r) => r.name === 'origin') ?? remotes[0])?.fetchUrl ?? null
  const linkRules = useMemo(() => rulesFor(origin, settings.issueLinks), [origin, settings.issueLinks])

  const reportError = useCallback((text: string) => {
    setErrors((current) => [...current.filter((e) => e.message !== text), { id: ++errorId, message: text }])
  }, [])

  useEffect(() => {
    if (error) reportError(error)
  }, [error, reportError])

  /**
   * Run a git action with a busy indicator, report the outcome and refresh afterwards. `sync` marks a
   * trip to a remote (fetch, pull, push…): it ends with a toast saying how it went.
   */
  const run = useCallback(
    async (label: string, action: (repoPath: string) => Promise<void>, success?: string, sync = false) => {
      setBusy(label)
      setMessage(null)
      needsLook.current = false
      try {
        await action(repo.path)
        if (success) setMessage(success)
        if (sync) {
          setLastSync(Date.now())
          showToast({ tone: needsLook.current ? 'info' : 'ok', title: lastMessage.current ?? `${label} finished` })
        }
      } catch (err) {
        const text = errorMessage(err)
        reportError(text)
        if (sync) showToast({ tone: 'error', title: `${label} failed`, detail: toastDetail(text) })
      } finally {
        // Stay busy until the new state is loaded, so menus and buttons never act on the old one.
        await refresh()
        setBusy(null)
      }
    },
    [repo.path, refresh, reportError, setMessage, showToast]
  )

  /** Like `run`, for commands that can stop on conflicts: those open the Changes tab instead of reporting success. */
  const runOperation = (label: string, action: (repoPath: string) => Promise<OperationResult>, success: string, conflicted?: string) =>
    run(label, async (repoPath) => {
      const result = await action(repoPath)
      setMessage(result.conflicted ? (conflicted ?? 'Stopped on conflicts. Resolve them, then continue.') : success)
      if (result.conflicted) setTab('changes')
    })

  // Fetch in the background every few minutes, if Settings says so. A failure only shows in the status bar.
  useEffect(() => {
    const minutes = settings.autoFetchMinutes
    if (minutes <= 0) return
    const timer = setInterval(() => {
      if (busyRef.current) return
      api.git.fetch(repo.path).then(
        () => {
          setLastSync(Date.now())
          void refresh()
        },
        (err: unknown) => setMessage(`Automatic fetch failed: ${errorMessage(err).split('\n')[0] ?? ''}`)
      )
    }, minutes * 60_000)
    return () => clearInterval(timer)
  }, [settings.autoFetchMinutes, repo.path, refresh])

  const pull = () =>
    run(
      'Pulling',
      async (repoPath) => {
        const { outcome, upstream } = await api.git.pull(repoPath)
        if (outcome === 'diverged') {
          needsLook.current = true
          setMessage(`${upstream} and your branch have both changed: merge or rebase`)
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
          needsLook.current = true
          setMessage(`${result.upstream} has old copies of your commits`)
          setForcePush(result)
        } else {
          const where = status?.branch.upstream ?? remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name
          setMessage(`Pushed ${status?.branch.head ?? 'HEAD'}${where ? ` to ${where}` : ''}`)
          setPullsVersion((n) => n + 1)
        }
      },
      undefined,
      true
    )

  const checkout = (branch: Branch) => run(`Checking out ${branch.name}`, (path) => api.git.checkout(path, branch), `Checked out ${branch.name}`)

  const checkoutPullRequest = (pr: PullRequest) =>
    void run(
      `Checking out #${pr.number}`,
      async (path) => {
        setMessage(`Checked out ${await api.pullRequests.checkout(path, pr.number)} for #${pr.number}`)
      },
      undefined,
      true
    )

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

  const openStashMenu = (stash: Stash, position: Position) =>
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

  const runCustom = (action: CustomAction, context: CustomActionContext) => {
    if (action.confirm && !window.confirm(`Run “${action.name}”?`)) return
    void run(`Running ${action.name}`, async (path) => {
      const result = await api.tools.runCustomAction(path, action.id, context)
      setDialog({ kind: 'output', title: action.name, result })
      setMessage(result.exitCode === 0 ? `${action.name} finished` : `${action.name} failed`)
    })
  }

  const current = status?.branch.head ?? null
  const headHash = status?.branch.oid ?? null
  const remoteNames = remotes.map((r) => r.name)

  /** Open the interactive rebase dialog for the commits after `base`. */
  const rewrite = (hash: string, preset?: RebaseStep['action']) => {
    const commit = byHash.get(hash)
    if (!commit) return
    let base: string | null = commit.parents[0] ?? null
    if (preset === 'squash') {
      // Squashing into the parent rewrites from the parent on.
      const parent = commit.parents[0] ? byHash.get(commit.parents[0]) : undefined
      if (!parent) {
        reportError('Its parent isn’t in the loaded history. Use Edit history from an older commit instead.')
        return
      }
      base = parent.parents[0] ?? null
    }
    setDialog({ kind: 'rebase', base, ...(preset ? { preset: { hash, action: preset } } : {}) })
  }

  const deleteBranch = (branch: Branch) => {
    if (branch.kind === 'remote') {
      const slash = branch.name.indexOf('/')
      if (!window.confirm(`Delete ${branch.name.slice(slash + 1)} on ${branch.name.slice(0, slash)}? Anyone who uses it there loses it too.`)) return
      void run(`Deleting ${branch.name}`, (path) => api.git.deleteRemoteBranch(path, branch.name), `Deleted ${branch.name}`, true)
      return
    }
    if (!window.confirm(`Delete the branch ${branch.name}? Its commits stay if another branch has them.`)) return
    void run(`Deleting ${branch.name}`, async (path) => {
      if ((await api.git.deleteBranch(path, branch.name, false)) === 'deleted') {
        setMessage(`Deleted ${branch.name}`)
        return
      }
      const where = branch.upstream ? `${current ?? 'HEAD'} or ${branch.upstream}` : (current ?? 'HEAD')
      if (!window.confirm(`${branch.name} has commits that ${where} doesn’t have. Delete it anyway? Those commits are lost.`)) return
      await api.git.deleteBranch(path, branch.name, true)
      setMessage(`Deleted ${branch.name}`)
    })
  }

  const menuContext: MenuContext = {
    current,
    headHash,
    operation: status?.operation,
    onCurrent,
    bisecting: status?.bisect !== undefined,
    flow,
    remotes: remoteNames,
    customActions: settings.customActions
  }
  const menuActions: MenuActions = {
    checkout: (branch) => void checkout(branch),
    integrate: (kind, target) => setIntegrate({ kind, target }),
    createBranchAt: (target) => setDialog({ kind: 'new-branch', from: target }),
    copyHash: (hash) =>
      void api.clipboard.write(hash).then(
        () => setMessage(`Copied ${short(hash)}`),
        (err: unknown) => reportError(errorMessage(err))
      ),
    cherryPick: (hash) =>
      void runOperation(`Cherry-picking ${short(hash)}`, (path) => api.git.cherryPick(path, hash), `Cherry-picked ${short(hash)} onto ${current ?? 'HEAD'}`),
    revert: (hash) => {
      const commit = byHash.get(hash)
      if (!window.confirm(`Revert “${commit?.subject ?? short(hash)}”? A new commit on ${current ?? 'HEAD'} undoes its changes.`)) return
      void runOperation(`Reverting ${short(hash)}`, (path) => api.git.revert(path, hash), `Reverted ${short(hash)}`)
    },
    reset: (hash) => setDialog({ kind: 'reset', hash }),
    reword: (hash) =>
      void (hash === headHash ? api.git.headMessage(repo.path) : api.git.show(repo.path, hash).then((d) => (d.body ? `${d.subject}\n\n${d.body}` : d.subject))).then(
        (text) => setDialog({ kind: 'reword', hash, message: text }),
        (err: unknown) => reportError(errorMessage(err))
      ),
    squash: (hash) => rewrite(hash, 'squash'),
    drop: (hash) => rewrite(hash, 'drop'),
    editHistory: (hash) => rewrite(hash),
    tag: (target) => setDialog({ kind: 'tag', target }),
    compare: (target) => {
      setSelectedHash(null)
      setSelectedStash(null)
      setDiffTarget(null)
      // What the other side has that the checked-out commit doesn't: removals and additions read from here to there.
      setCompare({ from: { ref: headHash ?? 'HEAD', label: current ?? 'HEAD' }, to: target })
    },
    savePatch: (hash) =>
      void run('Saving the patch', async (path) => {
        const file = await api.git.savePatch(path, [hash])
        if (file) setMessage(`Saved ${file}`)
      }),
    archive: (target) =>
      void run('Saving the zip', async (path) => {
        const file = await api.git.archive(path, target.ref)
        if (file) setMessage(`Saved ${file}`)
      }),
    bisectFrom: (hash) => {
      if (
        !window.confirm(
          `Find the commit that brought a bug in, between ${short(hash)} (good) and ${current ?? 'HEAD'} (bad)? GitLantern checks out commits in between one at a time; you test each and mark it good or bad.`
        )
      )
        return
      void run('Starting the bisect', async (path) => {
        const step = await api.git.bisectStart(path, headHash ?? 'HEAD', hash)
        setBisectStep({ message: step.message, firstBad: step.firstBad ?? null })
      })
    },
    renameBranch: (branch) => setDialog({ kind: 'rename', branch }),
    deleteBranch,
    setUpstream: (branch) => setDialog({ kind: 'upstream', branch }),
    pushBranch: (branch, remote) =>
      void run(`Pushing ${branch.name}`, (path) => api.git.pushBranch(path, branch.name, remote), `Pushed ${branch.name} to ${remote}`, true),
    flowFinish: (kind, name) => setDialog({ kind: 'flow', flow: { mode: 'finish', kind, name } }),
    deleteTag: (name) => {
      if (!window.confirm(`Delete the tag ${name} here? It stays on remotes it was pushed to.`)) return
      void run(`Deleting ${name}`, (path) => api.git.deleteTag(path, name), `Deleted the tag ${name}`)
    },
    pushTag: (name, remote) => void run(`Pushing ${name}`, (path) => api.git.pushTag(path, name, remote), `Pushed the tag ${name} to ${remote}`, true),
    deleteRemoteTag: (name, remote) => {
      if (!window.confirm(`Delete the tag ${name} on ${remote}?`)) return
      void run(`Deleting ${name} on ${remote}`, (path) => api.git.deleteRemoteTag(path, name, remote), `Deleted the tag ${name} on ${remote}`, true)
    },
    customAction: runCustom
  }

  const openCommitMenu = (commit: Commit, ref: { name: string; kind: RefKind } | null, position: Position) => {
    selectCommit(commit.hash)
    if (ref?.kind === 'tag') {
      setContextMenu({ ...position, groups: tagMenu(ref.name, menuContext, menuActions) })
      return
    }
    // A label that stands for a local branch and its remote twin offers the local branch only.
    const labels = ref ? [ref] : refPills(commit.refs).map((pill) => ({ name: pill.label, kind: pill.kind }))
    setContextMenu({ ...position, groups: commitMenu(commit, branchesForRefs(labels, branches), menuContext, menuActions) })
  }
  const openBranchMenu = (branch: Branch, position: Position) =>
    setContextMenu({ ...position, groups: commitMenu(byHash.get(branch.hash) ?? branch.hash, [branch], menuContext, menuActions) })

  const openWorktreeMenu = (worktree: Worktree, position: Position) =>
    setContextMenu({
      ...position,
      groups: [
        [
          {
            key: 'open',
            label: 'Open in a new tab',
            disabled: worktree.isCurrent,
            ...(worktree.isCurrent ? { hint: 'open here' } : {}),
            onSelect: () => app.onOpenRelated(worktree.path)
          },
          { key: 'copy', label: 'Copy folder path', onSelect: () => void api.clipboard.write(worktree.path) }
        ],
        worktree.isMain || worktree.isCurrent
          ? []
          : [
              {
                key: 'lock',
                label: worktree.locked ? 'Unlock' : 'Lock',
                hint: worktree.locked ? '' : 'keep prune from removing it',
                onSelect: () =>
                  void run('Updating the worktree', (path) => api.git.lockWorktree(path, worktree.path, !worktree.locked), worktree.locked ? 'Unlocked' : 'Locked')
              },
              {
                key: 'remove',
                label: 'Remove worktree…',
                onSelect: () => {
                  if (!window.confirm(`Remove the worktree at ${worktree.path}? The folder is deleted; its branch stays.`)) return
                  void run('Removing the worktree', async (path) => {
                    try {
                      await api.git.removeWorktree(path, worktree.path, false)
                    } catch (err) {
                      if (!window.confirm(`${errorMessage(err)}\n\nRemove it anyway, with its uncommitted changes?`)) return
                      await api.git.removeWorktree(path, worktree.path, true)
                    }
                    setMessage('Removed the worktree')
                  })
                }
              }
            ],
        worktrees.some((w) => w.prunable)
          ? [{ key: 'prune', label: 'Forget missing worktrees', onSelect: () => void run('Pruning', api.git.pruneWorktrees, 'Forgot the missing worktrees') }]
          : []
      ]
    })

  const openSubmoduleMenu = (submodule: Submodule, position: Position) =>
    setContextMenu({
      ...position,
      groups: [
        [
          {
            key: 'open',
            label: 'Open in a new tab',
            disabled: submodule.state === 'uninitialized',
            ...(submodule.state === 'uninitialized' ? { hint: 'update it first' } : {}),
            onSelect: () => app.onOpenRelated(submodule.path)
          },
          {
            key: 'update',
            label: submodule.state === 'uninitialized' ? 'Clone it (update)' : 'Update to the recorded commit',
            onSelect: () => void run(`Updating ${submodule.path}`, (path) => api.git.updateSubmodules(path, [submodule.path]), `Updated ${submodule.path}`, true)
          },
          { key: 'copy', label: 'Copy address', hint: submodule.url, onSelect: () => void api.clipboard.write(submodule.url) }
        ],
        [
          {
            key: 'remove',
            label: 'Remove submodule…',
            onSelect: () => {
              if (!window.confirm(`Remove the submodule ${submodule.path}? Its folder is deleted; commit to record the removal.`)) return
              void run(`Removing ${submodule.path}`, (path) => api.git.removeSubmodule(path, submodule.path), `Removed ${submodule.path}. Commit to record it.`)
            }
          }
        ]
      ]
    })

  const ignoreItems = (file: string): MenuItem[] => {
    const slash = file.lastIndexOf('/')
    const dot = file.lastIndexOf('.')
    const ext = dot > slash + 1 ? file.slice(dot) : null
    const ignore = (pattern: string, where: 'gitignore' | 'exclude') =>
      void run('Ignoring', (path) => api.git.ignore(path, pattern, where), where === 'gitignore' ? `Added ${pattern} to .gitignore` : `Ignoring ${pattern} in this copy`)
    return [
      { key: 'ignore', label: 'Ignore this file', hint: '.gitignore', onSelect: () => ignore(`/${file}`, 'gitignore') },
      ...(ext ? [{ key: 'ignore-ext', label: `Ignore all ${ext} files`, hint: '.gitignore', onSelect: () => ignore(`*${ext}`, 'gitignore') }] : []),
      ...(slash > 0 ? [{ key: 'ignore-dir', label: `Ignore ${file.slice(0, slash + 1)}`, hint: '.gitignore', onSelect: () => ignore(`/${file.slice(0, slash + 1)}`, 'gitignore') }] : []),
      { key: 'exclude', label: 'Ignore here only', hint: '.git/info/exclude', onSelect: () => ignore(`/${file}`, 'exclude') }
    ]
  }

  const fileItems = (file: string, context: CustomActionContext, history: boolean): MenuItem[][] => [
    [
      { key: 'editor', label: 'Open in editor', onSelect: () => void api.tools.openInEditor(repo.path, file).catch((err: unknown) => reportError(errorMessage(err))) },
      { key: 'folder', label: `Show in ${FOLDER_APP}`, onSelect: () => void api.tools.showInFolder(repo.path, file).catch((err: unknown) => reportError(errorMessage(err))) },
      { key: 'copy', label: 'Copy path', onSelect: () => void api.clipboard.write(file) }
    ],
    history
      ? [
          { key: 'history', label: 'File history', onSelect: () => setInspect({ path: file, view: 'history' }) },
          { key: 'blame', label: 'Blame', onSelect: () => setInspect({ path: file, view: 'blame' }) },
          { key: 'filter', label: 'Show only its commits in the graph', onSelect: () => setHistoryFilter({ ...historyFilter, path: file }) }
        ]
      : [],
    settings.customActions
      .filter((action) => action.scope === 'file')
      .map((action) => ({ key: `custom:${action.id}`, label: action.name, hint: 'custom', onSelect: () => runCustom(action, context) }))
  ]

  const openChangeMenu = (file: string, list: ChangeList, untracked: boolean, position: Position) => {
    const entry = status?.entries.find((e) => e.path === file)
    const groups = fileItems(file, { file }, !untracked)
    if (untracked) groups.splice(1, 0, ignoreItems(file))
    if (entry?.conflicted && !api.appStore) {
      groups.splice(1, 0, [
        { key: 'mergetool', label: 'Resolve in merge tool', onSelect: () => void api.tools.mergeTool(repo.path, file).catch((err: unknown) => reportError(errorMessage(err))) }
      ])
    }
    if (list === 'unstaged' && !entry?.conflicted) {
      groups.push([{ key: 'discard', label: 'Discard changes…', onSelect: () => discard([file]) }])
    }
    setContextMenu({ ...position, groups })
  }

  const openCommitFileMenu = (file: string, hash: string, position: Position) => setContextMenu({ ...position, groups: fileItems(file, { file, sha: hash }, true) })

  const selectCommit = (hash: string | null, options?: { compare: boolean }) => {
    if (options?.compare && hash && hash !== WORKING_COPY && selectedHash && hash !== selectedHash) {
      setCompare({ from: { ref: selectedHash, label: short(selectedHash) }, to: { ref: hash, label: short(hash) } })
      setDiffTarget(null)
      return
    }
    setCompare(null)
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
    setCompare(null)
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
    setDiffTarget((shown) => (shown === target ? (staged ? { kind: 'index', path: target.path } : { ...target }) : shown))

  const applyLines = (target: DiffTarget, action: PatchAction, patch: string, count: number) => {
    if (action === 'discard' && !window.confirm(`Discard ${lineCount(count)} in ${target.path}? This can’t be undone.`)) return
    const [doing, done] = PATCH_VERBS[action]
    void run(`${doing} ${lineCount(count)}`, (path) => api.git.applyPatch(path, target.path, patch, action), `${done} ${lineCount(count)}`).then(() =>
      reloadDiff(target)
    )
  }

  const pickConflict = (target: DiffTarget, pick: ConflictPick) => {
    let remaining = pick.conflicts
    void run('Resolving', async (path) => {
      remaining = (await api.git.resolveConflict(path, target.path, pick)).remaining
      setMessage(remaining === 0 ? `${target.path} resolved and staged` : `${remaining} conflict${remaining === 1 ? '' : 's'} left in ${target.path}`)
    }).then(() => reloadDiff(target, remaining === 0))
  }

  const pickFile = (target: DiffTarget, side: 'ours' | 'theirs') =>
    void run('Resolving', (path) => api.git.resolveFile(path, target.path, side), `${target.path} resolved and staged`).then(() => reloadDiff(target, true))

  const markResolved = (target: DiffTarget) =>
    void run('Staging', (path) => api.git.stage(path, [target.path]), `${target.path} marked resolved`).then(() => reloadDiff(target, true))

  const showCommit = (hash: string) => {
    setInspect(null)
    if (!byHash.has(hash)) setHistoryFilter({})
    selectCommit(hash)
  }

  const onInspect = (path: string, view: InspectView) => setInspect({ path, view })

  const toolGroups: MenuItem[][] = [
    [
      { key: 'editor', label: 'Open in editor', onSelect: () => void api.tools.openInEditor(repo.path).catch((err: unknown) => reportError(errorMessage(err))) },
      { key: 'terminal', label: 'Open a terminal here', onSelect: () => void api.tools.openTerminal(repo.path).catch((err: unknown) => reportError(errorMessage(err))) },
      { key: 'folder', label: `Show in ${FOLDER_APP}`, onSelect: () => void api.tools.showInFolder(repo.path) }
    ],
    flow
      ? [
          { key: 'feature', label: 'Start a feature…', hint: 'git-flow', onSelect: () => setDialog({ kind: 'flow', flow: { mode: 'start', kind: 'feature' } }) },
          { key: 'release', label: 'Start a release…', hint: 'git-flow', onSelect: () => setDialog({ kind: 'flow', flow: { mode: 'start', kind: 'release' } }) },
          { key: 'hotfix', label: 'Start a hotfix…', hint: 'git-flow', onSelect: () => setDialog({ kind: 'flow', flow: { mode: 'start', kind: 'hotfix' } }) },
          { key: 'flow-settings', label: 'git-flow settings…', onSelect: () => setDialog({ kind: 'flow', flow: { mode: 'init' } }) }
        ]
      : [{ key: 'flow-init', label: 'Set up git-flow…', onSelect: () => setDialog({ kind: 'flow', flow: { mode: 'init' } }) }],
    [
      { key: 'lfs', label: 'Git LFS…', onSelect: () => setDialog({ kind: 'lfs' }) },
      { key: 'worktree', label: 'New worktree…', onSelect: () => setDialog({ kind: 'worktree' }) },
      { key: 'submodule', label: 'Add submodule…', onSelect: () => setDialog({ kind: 'submodule' }) }
    ],
    [
      {
        key: 'apply-patch',
        label: 'Apply a patch…',
        disabled: busy !== null,
        onSelect: () =>
          void runOperation(
            'Applying the patch',
            async (path) => (await api.git.applyPatchFile(path)) ?? { conflicted: false },
            'Applied the patch',
            'The patch didn’t apply cleanly. Pick a side for each conflict on the Changes tab.'
          )
      },
      {
        key: 'save-patch',
        label: 'Save changes as a patch…',
        disabled: (status?.entries.length ?? 0) === 0,
        onSelect: () =>
          void run('Saving the patch', async (path) => {
            const file = await api.git.savePatch(path, [])
            if (file) setMessage(`Saved ${file}`)
          })
      },
      { key: 'archive', label: `Save ${current ?? 'HEAD'} as zip…`, disabled: !headHash, onSelect: () => menuActions.archive?.({ ref: headHash ?? 'HEAD', label: current ?? 'HEAD' }) },
      { key: 'clean', label: 'Clean up untracked files…', onSelect: () => setDialog({ kind: 'clean' }) }
    ],
    settings.customActions
      .filter((action) => action.scope === 'repository')
      .map((action) => ({ key: `custom:${action.id}`, label: action.name, hint: 'custom', onSelect: () => runCustom(action, {}) })),
    [
      { key: 'log', label: 'Git command log', onSelect: app.onCommandLog },
      { key: 'settings', label: 'Settings…', onSelect: app.onSettings }
    ]
  ]

  const signTags = identity ? (identity.local.signTags ?? identity.global.signTags) : false
  const resetCommit = dialog?.kind === 'reset' ? byHash.get(dialog.hash) : undefined

  const dialogs = (
    <>
      {dialog?.kind === 'new-branch' && (
        <PromptDialog
          title="New branch"
          label={`Branch off ${dialog.from?.label ?? current ?? 'HEAD'} and switch to it.`}
          placeholder="feature/my-change"
          confirm="Create and switch"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            const startPoint = dialog.from?.ref
            setDialog(null)
            void run('Creating branch', (path) => api.git.createBranch(path, name, startPoint), `Switched to new branch ${name}`)
          }}
        />
      )}
      {dialog?.kind === 'stash' && (
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
      {dialog?.kind === 'reset' && status && (
        <ResetDialog
          repoPath={repo.path}
          hash={dialog.hash}
          subject={resetCommit?.subject ?? ''}
          current={current ?? 'HEAD'}
          upstream={status.branch.upstream}
          onCancel={() => setDialog(null)}
          onConfirm={(mode) => {
            const { hash } = dialog
            setDialog(null)
            void run(`Resetting to ${short(hash)}`, (path) => api.git.reset(path, hash, mode), `${current ?? 'HEAD'} is now at ${short(hash)}`)
          }}
        />
      )}
      {dialog?.kind === 'reword' && (
        <MessageDialog
          title={`Edit the message of ${short(dialog.hash)}`}
          intro={
            dialog.hash === headHash
              ? 'Replaces the last commit’s message. Staged changes stay staged and out of it.'
              : 'Replaces the message by rewriting this commit and the ones after it, which get new IDs.'
          }
          initial={dialog.message}
          confirm="Save message"
          onCancel={() => setDialog(null)}
          onConfirm={(text) => {
            const { hash } = dialog
            setDialog(null)
            void runOperation('Rewording', (path) => api.git.reword(path, hash, text), `Changed the message of ${short(hash)}`)
          }}
        />
      )}
      {dialog?.kind === 'rebase' && status && (
        <RebaseDialog
          repoPath={repo.path}
          base={dialog.base}
          current={current ?? 'HEAD'}
          {...(dialog.preset ? { preset: dialog.preset } : {})}
          upstream={status.branch.upstream}
          onCancel={() => setDialog(null)}
          onConfirm={(steps) => {
            const { base } = dialog
            setDialog(null)
            void runOperation('Rewriting history', (path) => api.git.interactiveRebase(path, base, steps), `Rewrote ${current ?? 'HEAD'}`)
          }}
        />
      )}
      {dialog?.kind === 'tag' && (
        <TagDialog
          target={dialog.target}
          remotes={remoteNames}
          signByDefault={signTags}
          onCancel={() => setDialog(null)}
          onConfirm={(tag, pushTo) => {
            setDialog(null)
            void run(
              `Tagging ${dialog.target.label}`,
              async (path) => {
                await api.git.createTag(path, tag)
                if (pushTo) await api.git.pushTag(path, tag.name, pushTo)
              },
              pushTo ? `Tagged ${dialog.target.label} as ${tag.name} and pushed it` : `Tagged ${dialog.target.label} as ${tag.name}`,
              pushTo !== null
            )
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title={`Rename ${dialog.branch.name}`}
          label={dialog.branch.upstream ? `It stays linked to ${dialog.branch.upstream}; the remote branch keeps its name.` : 'Only the local branch is renamed.'}
          initial={dialog.branch.name}
          confirm="Rename"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            const old = dialog.branch.name
            setDialog(null)
            void run(`Renaming ${old}`, (path) => api.git.renameBranch(path, old, name), `Renamed ${old} to ${name}`)
          }}
        />
      )}
      {dialog?.kind === 'upstream' && (
        <UpstreamDialog
          branch={dialog.branch}
          branches={branches}
          onCancel={() => setDialog(null)}
          onConfirm={(upstream) => {
            const { name } = dialog.branch
            setDialog(null)
            void run('Setting the upstream', (path) => api.git.setUpstream(path, name, upstream), upstream ? `${name} now tracks ${upstream}` : `${name} isn’t linked any more`)
          }}
        />
      )}
      {dialog?.kind === 'worktree' && (
        <WorktreeDialog
          repoPath={repo.path}
          repoName={repo.name}
          branches={branches}
          busyBranches={worktrees.flatMap((w) => (w.branch ? [w.branch] : []))}
          onCancel={() => setDialog(null)}
          onConfirm={(worktree) => {
            setDialog(null)
            void run('Creating the worktree', async (path) => {
              await api.git.addWorktree(path, worktree)
              setMessage(`Created the worktree at ${worktree.path}`)
              if (window.confirm('Open the new worktree in a tab?')) app.onOpenRelated(worktree.path)
            })
          }}
        />
      )}
      {dialog?.kind === 'submodule' && (
        <SubmoduleDialog
          onCancel={() => setDialog(null)}
          onConfirm={(url, file) => {
            setDialog(null)
            void run(`Adding ${file}`, (path) => api.git.addSubmodule(path, url, file), `Added the submodule ${file}. Commit to record it.`)
          }}
        />
      )}
      {dialog?.kind === 'lfs' && <LfsDialog repoPath={repo.path} onClose={() => setDialog(null)} run={(label, action, success) => run(label, action, success, true)} />}
      {dialog?.kind === 'flow' && (
        <FlowDialog
          flow={dialog.flow}
          config={flow}
          branches={branches}
          onCancel={() => setDialog(null)}
          onInit={(config) => {
            setDialog(null)
            void run('Setting up git-flow', (path) => api.git.flowInit(path, config), `git-flow is set up: ${config.develop} for work, ${config.master} for releases`)
          }}
          onStart={(kind, name) => {
            setDialog(null)
            void run(`Starting ${kind} ${name}`, (path) => api.git.flowStart(path, kind, name), `Started ${kind} ${name}`)
          }}
          onFinish={(kind, name, options) => {
            setDialog(null)
            void runOperation(
              `Finishing ${kind} ${name}`,
              (path) => api.git.flowFinish(path, kind, name, options),
              `Finished ${kind} ${name}`,
              `A merge stopped on conflicts. Resolve them and finish the merge, then finish the ${kind} again to carry on.`
            )
          }}
        />
      )}
      {dialog?.kind === 'clean' && (
        <CleanDialog
          repoPath={repo.path}
          onCancel={() => setDialog(null)}
          onConfirm={(paths) => {
            setDialog(null)
            void run('Cleaning up', (path) => api.git.clean(path, paths), `Moved ${paths.length} item${paths.length === 1 ? '' : 's'} to the trash`)
          }}
        />
      )}
      {dialog?.kind === 'output' && <OutputDialog title={dialog.title} result={dialog.result} onClose={() => setDialog(null)} />}
      {inspect && (
        <FileInspector
          repoPath={repo.path}
          path={inspect.path}
          view={inspect.view}
          onView={(view) => setInspect({ ...inspect, view })}
          onShowCommit={showCommit}
          onError={reportError}
          onClose={() => setInspect(null)}
        />
      )}
      {integrate && status && (
        <IntegrateDialog
          kind={integrate.kind}
          target={integrate.target}
          current={current ?? 'HEAD'}
          upstream={status.branch.upstream}
          repoPath={repo.path}
          dirty={status.entries.some((e) => !e.untracked && (e.index !== null || e.worktree !== null))}
          {...(integrate.pull ? { pull: true } : {})}
          onCancel={() => setIntegrate(null)}
          onConfirm={({ kind, noFastForward }) => {
            const { target } = integrate
            const into = current ?? 'HEAD'
            setIntegrate(null)
            void (kind === 'merge'
              ? runOperation(`Merging ${target.label}`, (path) => api.git.merge(path, target.ref, { noFastForward }), `Merged ${target.label} into ${into}`)
              : runOperation(`Rebasing onto ${target.label}`, (path) => api.git.rebase(path, target.ref), `Rebased ${into} onto ${target.label}`))
          }}
        />
      )}
      {forcePush && status && (
        <ForcePushDialog
          branch={current ?? 'HEAD'}
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
    </>
  )

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
        runOperation(`Continuing the ${operation.kind}`, api.git.continueOperation, operation.kind === 'merge' ? 'Merge committed' : `Finished the ${operation.kind}`)
      }
      onSkip={() => runOperation('Skipping the commit', api.git.skipOperation, `Finished the ${operation.kind}`)}
      onAbort={() => run(`Aborting the ${operation.kind}`, api.git.abortOperation, `Aborted the ${operation.kind}`)}
    />
  )
  const bisectBanner = status?.bisect && (
    <BisectBanner
      state={status.bisect}
      head={headHash}
      message={bisectStep?.message ?? null}
      firstBad={bisectStep?.firstBad ?? null}
      busy={busy !== null}
      onMark={(verdict) =>
        void run(`Marking ${headHash ? short(headHash) : 'it'} ${verdict}`, async (path) => {
          const step = await api.git.bisectMark(path, verdict)
          setBisectStep({ message: step.message, firstBad: step.firstBad ?? null })
          if (step.firstBad) setMessage(`The first bad commit is ${short(step.firstBad)}`)
        })
      }
      onShowCommit={showCommit}
      onReset={() =>
        void run('Stopping the bisect', async (path) => {
          await api.git.bisectReset(path)
          setBisectStep(null)
        }, 'Stopped bisecting')
      }
    />
  )
  // In a conflict, HEAD's side is the checked-out branch, except in a rebase: there it's the branch
  // being rebased onto, with the commits replayed so far.
  const headSide = operation?.kind === 'rebase' && operation.onto ? nameFor(operation.onto, branches) : (current ?? 'HEAD')
  const localCount = branches.filter((b) => b.kind === 'local').length
  const showDetail = selectedHash !== null || selectedStash !== null || diffTarget !== null || compare !== null
  const detailHash = selectedStash ?? selectedHash
  // GitLab calls them merge requests; everyone else, pull requests.
  const gitlab = (remotes.find((r) => r.name === 'origin') ?? remotes[0])?.service === 'GitLab'
  const tabs: { id: Tab; label: string; count: number; title?: string }[] = [
    { id: 'changes', label: 'Changes', count: changeCount },
    { id: 'branches', label: 'Branches', count: localCount, title: 'Branches, tags, worktrees, submodules and stashes' },
    { id: 'remotes', label: 'Remotes', count: remotes.length },
    { id: 'pulls', label: gitlab ? 'MRs' : 'PRs', count: 0, title: gitlab ? 'Merge requests' : 'Pull requests' }
  ]
  const bisectMarks = useMemo(() => (status?.bisect ? { good: new Set(status.bisect.good), bad: status.bisect.bad } : null), [status?.bisect])

  return (
    <div className={`repo-view${active ? '' : ' hidden'}`} aria-hidden={!active}>
      <TopBar
        repo={repo}
        status={status}
        branches={branches}
        busy={busy !== null}
        accountCount={accountCount}
        canStash={changeCount > 0 && !operation}
        stashCount={stashes.length}
        onOpen={app.onOpenRepo}
        onOpenRecent={app.onOpenRecent}
        onClone={app.onClone}
        onCheckout={(branch) => void checkout(branch)}
        onNewBranch={() => setDialog({ kind: 'new-branch', from: null })}
        onFetch={() => void run('Fetching', api.git.fetch, 'Fetched all remotes', true)}
        onPull={() => void pull()}
        onPush={() => void push()}
        onStash={() => setDialog({ kind: 'stash' })}
        onPop={() => {
          const latest = stashes[0]
          if (latest) void applyStash(latest, true)
        }}
        onAccounts={app.onAccounts}
        toolGroups={toolGroups}
        onSettings={app.onSettings}
      />
      <div className="notices">
        {operationBanner}
        {bisectBanner}
        <Errors errors={errors} onDismiss={(id) => setErrors((list) => list.filter((e) => e.id !== id))} />
      </div>
      <div className="workspace">
        <aside className="left-panel">
          <div className="tabs" role="tablist" aria-label="Panels">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} title={t.title} onClick={() => setTab(t.id)}>
                {t.label}
                {t.count > 0 && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'changes' && (
              <ChangesPanel
                repoPath={repo.path}
                status={status}
                busy={busy !== null}
                openTarget={selectedHash === null && selectedStash === null && compare === null ? diffTarget : null}
                onOpenDiff={(target) => {
                  setSelectedHash(null)
                  setSelectedStash(null)
                  setCompare(null)
                  setDiffTarget(target)
                }}
                onStage={(paths) => void run('Staging', (path) => api.git.stage(path, paths))}
                onUnstage={(paths) => void run('Unstaging', (path) => api.git.unstage(path, paths))}
                onDiscard={discard}
                onCommit={(text) => void run('Committing', (path) => api.git.commit(path, text), 'Committed')}
                onAmend={(text) => void run('Amending', (path) => api.git.amend(path, text), 'Amended the last commit')}
                onFileMenu={openChangeMenu}
                onError={reportError}
                templates={settings.commitTemplates}
                gitTemplate={identity?.global.commitTemplate ?? ''}
                conventionalCommits={settings.conventionalCommits}
                canAmend={headHash !== null}
              />
            )}
            {tab === 'branches' && (
              <BranchesPanel
                branches={branches}
                onCheckout={(branch) => void checkout(branch)}
                onSelect={(branch) => selectCommit(branch.hash)}
                onContextMenu={openBranchMenu}
                tags={tags}
                onSelectTag={(tag: Tag) => showCommit(tag.hash)}
                onTagMenu={(tag, position) => setContextMenu({ ...position, groups: tagMenu(tag.name, menuContext, menuActions) })}
                worktrees={worktrees}
                onOpenWorktree={(worktree) => app.onOpenRelated(worktree.path)}
                onWorktreeMenu={openWorktreeMenu}
                onNewWorktree={() => setDialog({ kind: 'worktree' })}
                submodules={submodules}
                onOpenSubmodule={(submodule) => app.onOpenRelated(submodule.path)}
                onSubmoduleMenu={openSubmoduleMenu}
                onNewSubmodule={() => setDialog({ kind: 'submodule' })}
                onUpdateSubmodules={() => void run('Updating submodules', (path) => api.git.updateSubmodules(path, []), 'Updated the submodules', true)}
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
                onConnectAccount={app.onAccounts}
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
                reloadKey={pullsVersion + accountsVersion}
                onConnectAccount={app.onAccounts}
                onPush={() => void push()}
                onCheckout={checkoutPullRequest}
                onReview={(pr, noun) => setReviewing({ pr, noun })}
                onCreated={(pr, noun) => setMessage(`Opened ${noun} #${pr.number}`)}
              />
            )}
          </div>
        </aside>
        <main className="center">
          {reviewing ? (
            <PullRequestReview
              key={reviewing.pr.number}
              repoPath={repo.path}
              pr={reviewing.pr}
              noun={reviewing.noun}
              rules={linkRules}
              busy={busy !== null}
              onClose={() => setReviewing(null)}
              onCheckout={checkoutPullRequest}
              onShowCommit={(hash) => {
                setReviewing(null)
                showCommit(hash)
              }}
              onError={reportError}
              onSubmitted={(text) => {
                setMessage(text)
                setPullsVersion((n) => n + 1)
              }}
            />
          ) : (
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
                    headHash={headHash}
                    selectedHash={compare ? compare.from.ref : selectedHash}
                    compareHash={compare?.to.ref ?? null}
                    bisect={bisectMarks}
                    matches={filtering ? null : matches}
                    onSelect={(hash, options) => selectCommit(hash === selectedHash && !options?.compare && !compare ? null : hash, options)}
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
                  {compare ? (
                    <CompareView
                      repoPath={repo.path}
                      from={compare.from}
                      to={compare.to}
                      onSwap={() => setCompare({ from: compare.to, to: compare.from })}
                      onInspect={onInspect}
                      onError={reportError}
                    />
                  ) : detailHash ? (
                    <div className="detail-split">
                      <CommitDetails
                        key={detailHash}
                        repoPath={repo.path}
                        hash={detailHash}
                        stash={selectedStash !== null}
                        openPath={diffTarget?.kind === 'commit' || diffTarget?.kind === 'stash' ? diffTarget.path : null}
                        onOpenDiff={setDiffTarget}
                        linkRules={linkRules}
                        onFileMenu={openCommitFileMenu}
                        onShowCommit={showCommit}
                      />
                      {(diffTarget?.kind === 'commit' || diffTarget?.kind === 'stash') && diffTarget.hash === detailHash ? (
                        <DiffView repoPath={repo.path} target={diffTarget} onInspect={onInspect} onError={reportError} />
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
                        onInspect={onInspect}
                        onError={reportError}
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
          )}
        </main>
      </div>
      <StatusBar status={status} remotes={remotes} busy={busy} message={message} lastSync={lastSync} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
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
