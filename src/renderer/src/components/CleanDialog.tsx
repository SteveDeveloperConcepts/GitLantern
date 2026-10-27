import { useEffect, useState } from 'react'
import { errorMessage } from '../format'
import { Modal } from './Modal'

const api = window.api

interface Props {
  repoPath: string
  onConfirm(paths: string[]): void
  onCancel(): void
}

/** Move untracked files (and, if asked, ignored ones such as build output) to the trash. */
export function CleanDialog({ repoPath, onConfirm, onCancel }: Props) {
  const [ignored, setIgnored] = useState(false)
  const [paths, setPaths] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPaths(null)
    setError(null)
    api.git.cleanPreview(repoPath, ignored).then(
      (list) => {
        setPaths(list)
        setPicked(new Set(list))
      },
      (err: unknown) => setError(errorMessage(err))
    )
  }, [repoPath, ignored])

  const toggle = (path: string) => {
    const next = new Set(picked)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setPicked(next)
  }

  return (
    <Modal title="Clean up untracked files" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (picked.size > 0) onConfirm([...picked])
        }}
      >
        <p className="dialog-text">Files Git doesn’t track go to the trash, so you can still get one back.</p>
        <label className="checkbox">
          <input type="checkbox" checked={ignored} onChange={(event) => setIgnored(event.target.checked)} />
          Ignored files too (build output, node_modules and the like)
        </label>
        {error && <p className="test-fail">{error}</p>}
        {!paths && !error && (
          <p className="dim">
            <span className="spinner" /> Looking for files…
          </p>
        )}
        {paths?.length === 0 && <p className="dim">Nothing to clean up.</p>}
        {paths && paths.length > 0 && (
          <ul className="plain-list scroll">
            {paths.map((path) => (
              <li key={path}>
                <label className="checkbox compact">
                  <input type="checkbox" checked={picked.has(path)} onChange={() => toggle(path)} />
                  <span className="mono">{path}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary danger-fill" disabled={picked.size === 0}>
            Move {picked.size} to the trash
          </button>
        </div>
      </form>
    </Modal>
  )
}
