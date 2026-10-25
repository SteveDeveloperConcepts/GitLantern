import { useCallback, useEffect, useRef, useState } from 'react'
import type { Branch, Commit, RemoteInfo, RepoInfo, RepoStatus } from '../../shared/types'
import { errorMessage } from './format'

const api = window.api

export interface RepoData {
  status: RepoStatus | null
  commits: Commit[]
  branches: Branch[]
  remotes: RemoteInfo[]
  error: string | null
  /** Reload status, and history, branches and remotes too unless `statusOnly`. */
  refresh(statusOnly?: boolean): Promise<void>
}

export function useRepo(repo: RepoInfo | null): RepoData {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [remotes, setRemotes] = useState<RemoteInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  // Drop responses from requests that a newer refresh has superseded.
  const generation = useRef(0)

  const refresh = useCallback(
    async (statusOnly = false) => {
      if (!repo) return
      const id = ++generation.current
      try {
        if (statusOnly) {
          const nextStatus = await api.git.status(repo.path)
          if (id === generation.current) setStatus(nextStatus)
        } else {
          const [nextStatus, nextCommits, nextBranches, nextRemotes] = await Promise.all([
            api.git.status(repo.path),
            api.git.log(repo.path),
            api.git.branches(repo.path),
            api.remotes.list(repo.path)
          ])
          if (id !== generation.current) return
          setStatus(nextStatus)
          setCommits(nextCommits)
          setBranches(nextBranches)
          setRemotes(nextRemotes)
        }
        setError(null)
      } catch (err) {
        if (id === generation.current) setError(errorMessage(err))
      }
    },
    [repo]
  )

  useEffect(() => {
    setStatus(null)
    setCommits([])
    setBranches([])
    setRemotes([])
    setError(null)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!repo) return
    return api.repo.onChanged((event) => {
      if (event.repoPath === repo.path) void refresh(!event.kinds.includes('refs'))
    })
  }, [repo, refresh])

  return { status, commits, branches, remotes, error, refresh }
}
