import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface MenuItem {
  key: string
  label: ReactNode
  hint?: string
  checked?: boolean
  disabled?: boolean
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

/** The items of a dropdown or context menu; `onPick` closes the menu before the item runs. */
function MenuGroups({ groups, onPick }: { groups: MenuItem[][]; onPick(item: MenuItem): void }) {
  return (
    <>
      {groups
        .filter((group) => group.length > 0)
        .map((group, index) => (
          <div key={index} className="menu-group">
            {group.map((item) => (
              <button
                key={item.key}
                role="menuitem"
                className={`menu-item${item.checked ? ' checked' : ''}`}
                disabled={item.disabled}
                onClick={() => onPick(item)}
              >
                <span className="menu-label">{item.label}</span>
                {item.hint && <span className="menu-hint">{item.hint}</span>}
              </button>
            ))}
          </div>
        ))}
    </>
  )
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
          <MenuGroups
            groups={groups}
            onPick={(item) => {
              setOpen(false)
              item.onSelect()
            }}
          />
        </div>
      )}
    </div>
  )
}

export interface ContextMenuProps {
  /** Where the pointer was, in window coordinates. */
  x: number
  y: number
  groups: MenuItem[][]
  onClose(): void
}

/**
 * A menu at the pointer, for right-clicks. Arrow keys move between items. Closes on selection,
 * a click elsewhere, Escape, scrolling or resizing.
 */
export function ContextMenu({ x, y, groups, onClose }: ContextMenuProps) {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Keep the whole menu inside the window, and focus the first item for the keyboard.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4))
    })
    element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [x, y])

  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('scroll', closeOutside, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('scroll', closeOutside, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
  }

  return (
    <div
      ref={root}
      className="menu-list context-menu"
      role="menu"
      style={position}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuGroups
        groups={groups}
        onPick={(item) => {
          onClose()
          item.onSelect()
        }}
      />
    </div>
  )
}
