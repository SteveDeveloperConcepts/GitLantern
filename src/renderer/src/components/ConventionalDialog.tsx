import { useState } from 'react'
import { COMMIT_TYPES, conventionalMessage, type ConventionalMessage } from '../conventional'
import { Modal } from './Modal'

interface Props {
  onConfirm(message: { summary: string; description: string }): void
  onCancel(): void
}

/** Build a Conventional Commits message (type(scope): description) and put it in the commit form. */
export function ConventionalDialog({ onConfirm, onCancel }: Props) {
  const [message, setMessage] = useState<ConventionalMessage>({
    type: 'feat',
    scope: '',
    breaking: false,
    description: '',
    body: '',
    breakingNote: '',
    footer: ''
  })
  const set = (change: Partial<ConventionalMessage>) => setMessage({ ...message, ...change })
  const preview = conventionalMessage(message)

  return (
    <Modal title="Conventional commit" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (message.description.trim()) onConfirm(preview)
        }}
      >
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Type</span>
            <select value={message.type} onChange={(event) => set({ type: event.target.value })}>
              {COMMIT_TYPES.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.type}: {option.description}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Scope</span>
            <input value={message.scope} placeholder="Optional, e.g. auth" onChange={(event) => set({ scope: event.target.value })} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Description</span>
          <input autoFocus value={message.description} placeholder="add sign-in with GitHub" onChange={(event) => set({ description: event.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Body</span>
          <textarea rows={3} value={message.body} placeholder="Optional: what changed and why" onChange={(event) => set({ body: event.target.value })} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={message.breaking} onChange={(event) => set({ breaking: event.target.checked })} />
          Breaking change
        </label>
        {message.breaking && (
          <label className="field">
            <span className="field-label">What breaks</span>
            <input value={message.breakingNote} placeholder="How to update" onChange={(event) => set({ breakingNote: event.target.value })} />
          </label>
        )}
        <label className="field">
          <span className="field-label">Footer</span>
          <input value={message.footer} placeholder="Optional, e.g. Closes #12" onChange={(event) => set({ footer: event.target.value })} />
        </label>
        <pre className="message-preview">
          {preview.summary}
          {preview.description ? `\n\n${preview.description}` : ''}
        </pre>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!message.description.trim()}>
            Use message
          </button>
        </div>
      </form>
    </Modal>
  )
}
