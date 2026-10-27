import { useEffect, useMemo, useState } from 'react'
import type { ChangedFile, DiffTarget } from '../../../shared/types'
import type { RefTarget } from '../branchMenus'
import { errorMessage } from '../format'
import { DiffView } from './DiffView'
import { FileList } from './FileList'
import { Icon } from './Icon'

const api = window.api

interface Props {
  repoPath: string
  from: RefTarget
  to: RefTarget
  onSwap(): void
  onInspect(path: string, view: 'history' | 'blame'): void
  onError(message: string): void
}

/** Every file that differs between two commits or branches, and the diff of the one picked. */
export function CompareView({ repoPath, from, to, onSwap, onInspect, onError }: Props) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<ChangedFile | null>(null)

  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setError(null)
    setOpen(null)
    api.git.compareFiles(repoPath, from.ref, to.ref).then(
      (list) => {
        if (cancelled) return
        setFiles(list)
        setOpen(list[0] ?? null)
      },
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, from.ref, to.ref])

  const additions = files?.reduce((sum, file) => sum + (file.additions ?? 0), 0) ?? 0
  const deletions = files?.reduce((sum, file) => sum + (file.deletions ?? 0), 0) ?? 0
  // One object per file: DiffView reloads whenever its target changes.
  const target = useMemo<DiffTarget | null>(
    () => (open ? { kind: 'range', from: from.ref, to: to.ref, path: open.path, ...(open.origPath ? { origPath: open.origPath } : {}) } : null),
    [open, from.ref, to.ref]
  )

  return (
    <div className="detail-split">
      <div className="commit-details">
        <div className="compare-heading">
          <span className="chip mono">{from.label}</span>
          <button className="icon-button small" onClick={onSwap} title="Swap the sides" aria-label="Swap the sides">
            <Icon name="swap" size={14} />
          </button>
          <span className="chip mono">{to.label}</span>
        </div>
        {error && <div className="panel-error">{error}</div>}
        {!files && !error && <div className="panel-loading">Comparing…</div>}
        {files && (
          <>
            <h3 className="files-heading">
              {files.length} file{files.length === 1 ? '' : 's'} differ
              <span className="file-counts">
                <span className="add">+{additions}</span> <span className="del">−{deletions}</span>
              </span>
            </h3>
            {files.length === 0 && <p className="dim">They have the same files.</p>}
            <FileList
              items={files.map((file) => ({
                key: file.path,
                path: file.path,
                ...(file.origPath ? { origPath: file.origPath } : {}),
                status: file.status,
                additions: file.additions ?? null,
                deletions: file.deletions ?? null
              }))}
              selectedKey={open?.path ?? null}
              onOpen={(item) => setOpen(files.find((file) => file.path === item.path) ?? null)}
            />
          </>
        )}
      </div>
      {target ? <DiffView repoPath={repoPath} target={target} onInspect={onInspect} onError={onError} /> : <div className="empty">Pick a file to see how it differs.</div>}
    </div>
  )
}
