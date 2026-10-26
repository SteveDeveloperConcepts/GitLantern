import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangedFile, CommitDetail, DiffTarget } from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { Avatar } from './Avatar'
import { FileList } from './FileList'

const api = window.api

interface Props {
  repoPath: string
  hash: string
  /** The commit is a stash: list the untracked files it saved too. */
  stash?: boolean
  /** File whose diff is open, to highlight it. */
  openPath: string | null
  onOpenDiff(target: DiffTarget): void
}

function diffTarget(hash: string, file: ChangedFile, stash: boolean): DiffTarget {
  return stash ? { kind: 'stash', hash, path: file.path, untracked: file.untracked === true } : { kind: 'commit', hash, path: file.path }
}

export function CommitDetails({ repoPath, hash, stash = false, openPath, onOpenDiff }: Props) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Kept in a ref so a new callback identity doesn't reload the commit.
  const openDiff = useRef(onOpenDiff)
  useLayoutEffect(() => {
    openDiff.current = onOpenDiff
  })

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    ;(stash ? api.git.showStash(repoPath, hash) : api.git.show(repoPath, hash)).then(
      (result) => {
        if (cancelled) return
        setDetail(result)
        // Open the first file straight away so the diff pane isn't empty.
        const first = result.files[0]
        if (first) openDiff.current(diffTarget(result.hash, first, stash))
      },
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, hash, stash])

  if (error) return <div className="panel-error">{error}</div>
  if (!detail) return <div className="panel-loading">Loading…</div>

  const tags = detail.refs.filter((r) => r.kind === 'tag')

  return (
    <div className="commit-details">
      <div className="commit-heading">
        <Avatar name={detail.authorName} email={detail.authorEmail} size={34} />
        <div className="commit-heading-text">
          <p className="commit-summary">{detail.subject}</p>
          <p className="dim" title={`${detail.authorEmail} · ${new Date(detail.authorDate * 1000).toLocaleString()}`}>
            {detail.authorName} · {formatRelative(detail.authorDate)}
          </p>
        </div>
      </div>
      {detail.body && <pre className="commit-body">{detail.body}</pre>}
      <div className="chips">
        <button className="chip mono" title="Copy full hash" onClick={() => void api.clipboard.write(detail.hash)}>
          {detail.hash.slice(0, 7)}
        </button>
        {stash ? (
          <span className="chip">Stashed on {detail.parents[0]?.slice(0, 7)}</span>
        ) : (
          detail.parents.length > 0 && (
            <span className="chip">
              Parent{detail.parents.length > 1 ? 's' : ''} {detail.parents.map((p) => p.slice(0, 7)).join(' · ')}
            </span>
          )
        )}
        {tags.map((tag) => (
          <span key={tag.name} className="chip chip-ok">
            # {tag.name}
          </span>
        ))}
      </div>
      <h3 className="files-heading">
        {detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed
      </h3>
      <FileList
        items={detail.files.map((file) => ({
          key: file.path,
          path: file.path,
          ...(file.origPath ? { origPath: file.origPath } : {}),
          // Untracked files a stash saved show as new, like they would once applied.
          status: file.untracked ? '?' : file.status,
          additions: file.additions ?? null,
          deletions: file.deletions ?? null
        }))}
        selectedKey={openPath}
        onOpen={(item) => {
          const file = detail.files.find((f) => f.path === item.path)
          if (file) onOpenDiff(diffTarget(detail.hash, file, stash))
        }}
      />
    </div>
  )
}
