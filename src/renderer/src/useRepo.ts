import { useCallback, useEffect, useRef, useState } from 'react'
import type { Branch, Commit, LogFilter, RemoteInfo, RepoInfo, RepoStatus, Stash } from '../../shared/types'
import { errorMessage } from './format'

const api = window.api

export interface RepoData {
  status: RepoStatus | null
  commits: Commit[]
  branches: Branch[]
  remotes: RemoteInfo[]
  stashes: Stash[]
  error: string | null
  /** Reload status, and history, branches and remotes too unless `statusOnly`. */
  refresh(statusOnly?: boolean): Promise<void>
}

export function useRepo(repo: RepoInfo | null, filter: LogFilter = {}): RepoData {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [remotes, setRemotes] = useState<RemoteInfo[]>([])
  const [stashes, setStashes] = useState<Stash[]>([])
  const [error, setError] = useState<string | null>(null)
  // Drop responses from requests that a newer refresh has superseded.
  const generation = useRef(0)
  const { branch, path } = filter

  const refresh = useCallback(
    async (statusOnly = false) => {
      if (!repo) return
      const id = ++generation.current
      try {
        if (statusOnly) {
          const nextStatus = await api.git.status(repo.path)
          if (id === generation.current) setStatus(nextStatus)
        } else {
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
    [repo, branch, path]
  )

  // A new repository starts from nothing; a new filter keeps what's shown until the history arrives.
  useEffect(() => {
    setStatus(null)
    setCommits([])
    setBranches([])
    setRemotes([])
    setStashes([])
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

  return { status, commits, branches, remotes, stashes, error, refresh }
}
