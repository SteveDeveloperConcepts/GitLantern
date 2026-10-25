import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CommitDetail, DiffTarget } from '../../../shared/types'
import { errorMessage, formatRelative } from '../format'
import { Avatar } from './Avatar'
import { FileList } from './FileList'

const api = window.api

interface Props {
  repoPath: string
  hash: string
  /** File whose diff is open, to highlight it. */
  openPath: string | null
  onOpenDiff(target: DiffTarget): void
}

export function CommitDetails({ repoPath, hash, openPath, onOpenDiff }: Props) {
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
    api.git.show(repoPath, hash).then(
      (result) => {
        if (cancelled) return
        setDetail(result)
        // Open the first file straight away so the diff pane isn't empty.
        const first = result.files[0]
        if (first) openDiff.current({ kind: 'commit', hash: result.hash, path: first.path })
      },
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, hash])

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
        {detail.parents.length > 0 && (
          <span className="chip">
            Parent{detail.parents.length > 1 ? 's' : ''} {detail.parents.map((p) => p.slice(0, 7)).join(' · ')}
          </span>
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
          status: file.status,
          additions: file.additions ?? null,
          deletions: file.deletions ?? null
        }))}
        selectedKey={openPath}
        onOpen={(item) => onOpenDiff({ kind: 'commit', hash: detail.hash, path: item.path })}
      />
    </div>
  )
}
