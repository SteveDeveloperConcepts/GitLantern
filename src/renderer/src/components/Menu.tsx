import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  key: string
  label: ReactNode
  hint?: string
  checked?: boolean
  onSelect(): void
}

interface Props {
  /** Contents of the button that opens the menu. */
  trigger: ReactNode
  triggerClassName?: string
  label: string
  /** Groups are separated by a divider. */
  groups: MenuItem[][]
  onOpen?(): void
}

/** A button with a dropdown list. Closes on selection, outside click or Escape. */
export function Menu({ trigger, triggerClassName, label, groups, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div
      className="menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      >
        {trigger}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {groups
            .filter((group) => group.length > 0)
            .map((group, index) => (
              <div key={index} className="menu-group">
                {group.map((item) => (
                  <button
                    key={item.key}
                    role="menuitem"
                    className={`menu-item${item.checked ? ' checked' : ''}`}
                    onClick={() => {
                      setOpen(false)
                      item.onSelect()
                    }}
                  >
                    <span className="menu-label">{item.label}</span>
                    {item.hint && <span className="menu-hint">{item.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
