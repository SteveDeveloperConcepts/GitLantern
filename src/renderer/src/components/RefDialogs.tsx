import { useState } from 'react'
import type { Branch, NewTag } from '../../../shared/types'
import type { RefTarget } from '../branchMenus'
import { Modal } from './Modal'

interface TagProps {
  target: RefTarget
  /** Remotes the tag can be pushed to straight away. */
  remotes: string[]
  /** commit.gpgsign / tag.gpgsign is on, so signing starts ticked. */
  signByDefault: boolean
  onConfirm(tag: NewTag, pushTo: string | null): void
  onCancel(): void
}

/** Name a commit with a tag: annotated when there's a message, signed if asked, pushed if asked. */
export function TagDialog({ target, remotes, signByDefault, onConfirm, onCancel }: TagProps) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [sign, setSign] = useState(signByDefault)
  const [push, setPush] = useState(false)
  const remote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)
  const valid = name.trim() !== '' && !/[\s~^:?*[\\]/.test(name) && (!sign || message.trim() !== '')

  return (
    <Modal title={`Tag ${target.label}`} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          const text = message.trim()
          onConfirm({ name: name.trim(), target: target.ref, ...(text ? { message: text } : {}), sign: sign && text !== '' }, push ? remote : null)
        }}
      >
        <label className="field">
          <span className="field-label">Tag name</span>
          <input autoFocus value={name} placeholder="v1.2.0" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Message</span>
          <textarea
            rows={3}
            value={message}
            placeholder="Optional. With a message the tag is annotated: it records who made it and when."
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={sign} onChange={(event) => setSign(event.target.checked)} />
          Sign it with your GPG or SSH key {sign && !message.trim() && <span className="dim">(needs a message)</span>}
        </label>
        {remote && (
          <label className="checkbox">
            <input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} />
            Push it to {remote}
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Create tag
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface UpstreamProps {
  branch: Branch
  branches: Branch[]
  onConfirm(upstream: string | null): void
  onCancel(): void
}

/** Link a local branch to the remote branch it pulls from and pushes to, or unlink it. */
export function UpstreamDialog({ branch, branches, onConfirm, onCancel }: UpstreamProps) {
  const remote = branches.filter((b) => b.kind === 'remote')
  const guess = branch.upstream ?? remote.find((b) => b.name.slice(b.name.indexOf('/') + 1) === branch.name)?.name ?? ''
  const [upstream, setUpstream] = useState(guess)
  return (
    <Modal title={`Upstream of ${branch.name}`} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm(upstream || null)
        }}
      >
        <p className="dialog-text">
          The upstream is the remote branch {branch.name} pulls from and pushes to, and compares with for the ahead and behind counts.
        </p>
        <select value={upstream} onChange={(event) => setUpstream(event.target.value)} aria-label="Remote branch" autoFocus>
          <option value="">None: not linked to a remote branch</option>
          {remote.map((b) => (
            <option key={b.fullName} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={(upstream || null) === branch.upstream}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
