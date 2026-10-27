import { useCallback, useEffect, useRef, useState } from 'react'
import type { Branch, Commit, FlowConfig, LogFilter, RemoteInfo, RepoInfo, RepoStatus, Stash, Submodule, Tag, Worktree } from '../../shared/types'
import { errorMessage } from './format'

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
  // Drop responses from requests that a newer refresh has superseded.
  const generation = useRef(0)
  /** Extras are loading, and whether another load was asked for meanwhile. */
  const extras = useRef({ running: false, again: false })
  const { branch, path } = filter

  /**
   * Tags, worktrees, submodules and git-flow come in behind the rest: submodule status alone can
   * take seconds, and nothing should wait for it. One load at a time; refreshes that ask meanwhile
   * get one more load once it's done, not one each.
   */
  const loadExtras = useCallback((repoPath: string) => {
    if (extras.current.running) {
      extras.current.again = true
      return
    }
    extras.current = { running: true, again: false }
    void Promise.all([
      orEmpty(api.git.tags(repoPath)),
      orEmpty(api.git.worktrees(repoPath)),
      orEmpty(api.git.submodules(repoPath)),
      api.git.flowConfig(repoPath).catch(() => null)
    ]).then(([nextTags, nextWorktrees, nextSubmodules, nextFlow]) => {
      setTags(nextTags)
      setWorktrees(nextWorktrees)
      setSubmodules(nextSubmodules)
      setFlow(nextFlow)
      const again = extras.current.again
      extras.current = { running: false, again: false }
      if (again) loadExtras(repoPath)
    })
  }, [])

  const refresh = useCallback(
    async (statusOnly = false) => {
      if (!repo) return
      const id = ++generation.current
      try {
        if (statusOnly) {
          const nextStatus = await api.git.status(repo.path)
          if (id === generation.current) setStatus(nextStatus)
        } else {
          loadExtras(repo.path)
          const [nextStatus, nextCommits, nextBranches, nextRemotes, nextStashes] = await Promise.all([
            api.git.status(repo.path),
            api.git.log(repo.path, { ...(branch ? { branch } : {}), ...(path ? { path } : {}) }),
            api.git.branches(repo.path),
            api.remotes.list(repo.path),
            api.git.stashes(repo.path)
          ])
          if (id !== generation.current) return
          setStatus(nextStatus)
          setCommits(nextCommits)
          setBranches(nextBranches)
          setRemotes(nextRemotes)
          setStashes(nextStashes)
        }
        setError(null)
      } catch (err) {
        if (id === generation.current) setError(errorMessage(err))
      }
    },
    [repo, branch, path, loadExtras]
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
