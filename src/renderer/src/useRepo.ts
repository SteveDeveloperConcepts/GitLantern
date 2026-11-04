import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Branch, Commit, FlowConfig, LogFilter, RemoteInfo, RepoInfo, RepoStatus, Stash, Submodule, Tag, Worktree } from '../../shared/types'
import { errorMessage } from './format'
import { oneAtATime } from './oneAtATime'

const api = window.api

export interface RepoData {
  status: RepoStatus | null
  commits: Commit[]
  branches: Branch[]
  remotes: RemoteInfo[]
  stashes: Stash[]
  tags: Tag[]
  worktrees: Worktree[]
  submodules: Submodule[]
  /** git-flow settings, or null when the repository doesn't use it. */
  flow: FlowConfig | null
  error: string | null
  /** Reload status, and history, branches and remotes too unless `statusOnly`. */
  refresh(statusOnly?: boolean): Promise<void>
}

/** Lists that are extras: a failure there (no git-lfs, an old git) mustn't stop the rest from showing. */
const orEmpty = <T,>(promise: Promise<T[]>): Promise<T[]> => promise.catch(() => [])

export function useRepo(repo: RepoInfo | null, filter: LogFilter = {}): RepoData {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [remotes, setRemotes] = useState<RemoteInfo[]>([])
  const [stashes, setStashes] = useState<Stash[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [submodules, setSubmodules] = useState<Submodule[]>([])
  const [flow, setFlow] = useState<FlowConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Numbers every load as it starts. */
  const generation = useRef(0)
  /** The load whose status is on show: loads can finish in any order, and what's shown only moves on. */
  const shownStatus = useRef(0)
  // Drop responses from full loads that a newer one has superseded. Status alone doesn't supersede them:
  // it comes in all the time while files change, and they'd never get to show the rest of what they found.
  const fullGeneration = useRef(0)
  const { branch, path } = filter

  /**
   * Tags, worktrees, submodules and git-flow come in behind the rest: submodule status alone can
   * take seconds, and nothing should wait for it.
   */
  const loadExtras = useMemo(
    () =>
      oneAtATime(async () => {
        if (!repo) return
        const [nextTags, nextWorktrees, nextSubmodules, nextFlow] = await Promise.all([
          orEmpty(api.git.tags(repo.path)),
          orEmpty(api.git.worktrees(repo.path)),
          orEmpty(api.git.submodules(repo.path)),
          api.git.flowConfig(repo.path).catch(() => null)
        ])
        setTags(nextTags)
        setWorktrees(nextWorktrees)
        setSubmodules(nextSubmodules)
        setFlow(nextFlow)
      }),
    [repo]
  )

  const showStatus = useCallback((id: number, nextStatus: RepoStatus) => {
    if (id < shownStatus.current) return
    shownStatus.current = id
    setStatus(nextStatus)
  }, [])

  /**
   * With a lot of changed files git status takes a while. Starting one per change would pile them up,
   * and each would throw away the one before it, so the list wouldn't move until the changes stopped.
   */
  const loadStatus = useMemo(
    () =>
      oneAtATime(async () => {
        if (!repo) return
        const id = ++generation.current
        try {
          showStatus(id, await api.git.status(repo.path))
          setError(null)
        } catch (err) {
          if (id === generation.current) setError(errorMessage(err))
        }
      }),
    [repo, showStatus]
  )

  const refresh = useCallback(
    async (statusOnly = false) => {
      if (!repo) return
      if (statusOnly) return loadStatus()
      const id = ++generation.current
      const fullId = ++fullGeneration.current
      try {
        void loadExtras()
        const [nextStatus, nextCommits, nextBranches, nextRemotes, nextStashes] = await Promise.all([
          api.git.status(repo.path),
          api.git.log(repo.path, { ...(branch ? { branch } : {}), ...(path ? { path } : {}) }),
          api.git.branches(repo.path),
          api.remotes.list(repo.path),
          api.git.stashes(repo.path)
        ])
        if (fullId !== fullGeneration.current) return
        showStatus(id, nextStatus)
        setCommits(nextCommits)
        setBranches(nextBranches)
        setRemotes(nextRemotes)
        setStashes(nextStashes)
        setError(null)
      } catch (err) {
        if (fullId === fullGeneration.current) setError(errorMessage(err))
      }
    },
    [repo, branch, path, loadExtras, loadStatus, showStatus]
  )

  // A new repository starts from nothing; a new filter keeps what's shown until the history arrives.
  useEffect(() => {
    setStatus(null)
    setCommits([])
    setBranches([])
    setRemotes([])
    setStashes([])
    setTags([])
    setWorktrees([])
    setSubmodules([])
    setFlow(null)
    setError(null)
  }, [repo])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!repo) return
    return api.repo.onChanged((event) => {
      if (event.repoPath === repo.path) void refresh(!event.kinds.includes('refs'))
    })
  }, [repo, refresh])

  return { status, commits, branches, remotes, stashes, tags, worktrees, submodules, flow, error, refresh }
}
