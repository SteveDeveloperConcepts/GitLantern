import { useState } from 'react'

interface Props {
  title: string
  label: string
  placeholder?: string
  confirm: string
  onSubmit(value: string): void
  onCancel(): void
}

export function PromptDialog({ title, label, placeholder, confirm, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState('')
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim()) onSubmit(value.trim())
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      >
        <h2>{title}</h2>
        <p className="prompt-text">{label}</p>
        <input autoFocus value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} />
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!value.trim()}>
            {confirm}
          </button>
        </div>
      </form>
    </div>
  )
}
