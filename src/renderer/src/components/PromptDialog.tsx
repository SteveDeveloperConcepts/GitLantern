import { useState } from 'react'

interface Props {
  title: string
  label: string
  placeholder?: string
  confirm: string
  /** The value may be left empty. */
  optional?: boolean
  /** What the field starts with, e.g. a branch's current name when renaming it. */
  initial?: string
  /** A checkbox under the field, e.g. "Delete it from the remote too". */
  option?: { label: string; initial?: boolean }
  onSubmit(value: string, option: boolean): void
  onCancel(): void
}

export function PromptDialog({ title, label, placeholder, confirm, optional, initial = '', option, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial)
  const [checked, setChecked] = useState(option?.initial ?? false)
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim() || optional) onSubmit(value.trim(), checked)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      >
        <h2>{title}</h2>
        <p className="dialog-text">{label}</p>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
        {option && (
          <label className="checkbox">
            <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            {option.label}
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={(!value.trim() && !optional) || (initial !== '' && value.trim() === initial)}>
            {confirm}
          </button>
        </div>
      </form>
    </div>
  )
}
