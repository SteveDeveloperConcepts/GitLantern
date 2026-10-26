import { useState } from 'react'
import type { PullRequest } from '../../../shared/types'
import { errorMessage } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const api = window.api

interface Props {
  repoPath: string
  noun: string
  service: string
  remote: string
  /** The checked-out branch. */
  branch: string
  /** Its branch on the remote, or null when it hasn't been pushed there. */
  source: string | null
  /** Commits on the branch that aren't on the remote yet. */
  ahead: number
  /** Branches on the remote it could go into. */
  targets: string[]
  defaultTarget: string | null
  suggestedTitle: string
  onPush(): void
  onCreated(pr: PullRequest): void
  onCancel(): void
}

const commits = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`

export function NewPullRequestDialog(props: Props) {
  const { noun, service, remote, branch, source, ahead } = props
  const targets = props.targets.filter((name) => name !== source && name !== 'HEAD')
  const [title, setTitle] = useState(props.suggestedTitle)
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState(
    props.defaultTarget && targets.includes(props.defaultTarget) ? props.defaultTarget : (targets[0] ?? '')
  )
  const [state, setState] = useState<'idle' | 'creating' | { error: string }>('idle')
  const ready = source !== null && target !== '' && title.trim() !== '' && state !== 'creating'

  const create = async () => {
    if (!source) return
    setState('creating')
    try {
      props.onCreated(await api.pullRequests.create(props.repoPath, { title, description, source, target }))
    } catch (error) {
      setState({ error: errorMessage(error) })
    }
  }

  return (
    <Modal title={`New ${noun}`} onClose={props.onCancel} className="modal-wide">
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) void create()
        }}
      >
        <p className="dialog-text">
          Asks for <strong>{source ?? branch}</strong> to be merged into the branch you pick, on {service}.
        </p>
        {source === null ? (
          <div className="notice warning">
            <Icon name="warning" size={16} />
            <p>
              {branch} isn’t on {remote} yet, so {service} can’t see it. Push it first.{' '}
              <button type="button" className="link" onClick={props.onPush}>
                Push {branch}
              </button>
            </p>
          </div>
        ) : (
          ahead > 0 && (
            <div className="notice warning">
              <Icon name="warning" size={16} />
              <p>
                {commits(ahead)} on {branch} {ahead === 1 ? 'isn’t' : 'aren’t'} pushed yet, so the {noun} won’t include{' '}
                {ahead === 1 ? 'it' : 'them'} until you push.{' '}
                <button type="button" className="link" onClick={props.onPush}>
                  Push now
                </button>
              </p>
            </div>
          )
        )}
        <div className="field">
          <label htmlFor="pr-target">Merge into</label>
          <select id="pr-target" value={target} onChange={(event) => setTarget(event.target.value)}>
            {targets.length === 0 && <option value="">No other branches on {remote}</option>}
            {targets.map((name) => (
              <option key={name} value={name}>
                {name}
                {name === props.defaultTarget ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pr-title">Title</label>
          <input id="pr-title" value={title} autoFocus onChange={(event) => setTitle(event.target.value)} maxLength={250} />
        </div>
        <div className="field">
          <label htmlFor="pr-description">Description</label>
          <textarea
            id="pr-description"
            rows={6}
            value={description}
            placeholder="What changes, and why (optional)"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {typeof state === 'object' && <p className="panel-error">{state.error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ready}>
            {state === 'creating' ? 'Creating…' : `Create ${noun}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
