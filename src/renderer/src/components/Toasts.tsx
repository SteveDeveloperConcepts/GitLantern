import { useEffect, useState } from 'react'
import { toastDuration, type Toast } from '../toasts'
import { Icon } from './Icon'

const ICONS = { ok: 'check', info: 'warning', error: 'warning' } as const

/** Toasts in the corner: how a fetch, pull or push went. Each goes by itself after a few seconds. */
export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(id: number): void }) {
  // Pointing at a toast keeps it, so there's time to read it.
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const timer = setTimeout(() => onDismiss(toast.id), toastDuration(toast.tone))
    return () => clearTimeout(timer)
  }, [held, toast.id, toast.tone, onDismiss])

  return (
    <div className={`toast ${toast.tone}`} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      <Icon name={ICONS[toast.tone]} size={16} className="toast-icon" />
      <div className="toast-text">
        <strong>{toast.title}</strong>
        {toast.detail && <span>{toast.detail}</span>}
      </div>
      <button className="icon-button small" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}
