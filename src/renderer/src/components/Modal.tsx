import { useId, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
  /** Extra class on the dialog panel, for wider layouts. */
  className?: string
}

/** Dialog shell: dimmed backdrop, title row with a close button, Escape to close. */
export function Modal({ title, onClose, children, className }: Props) {
  const titleId = useId()
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="modal-title">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
