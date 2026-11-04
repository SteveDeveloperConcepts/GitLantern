import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { splitPath } from '../format'
import { visibleRows, type RowRange } from '../visibleRows'

/** Every row's height, which .file-open's min-height in styles.css has to match. */
const ROW_HEIGHT = 32
/** Drawn before the list has been measured, which happens before it's shown. */
const FIRST_ROWS = 40

export interface FileListItem {
  key: string
  path: string
  origPath?: string
  /** One-letter status shown in the badge. */
  status: string
  additions?: number | null
  deletions?: number | null
}

export interface FileAction {
  label: ReactNode
  title: string
  run(item: FileListItem): void
  /** Leave it out for some items. */
  hidden?(item: FileListItem): boolean
}

interface Props {
  items: FileListItem[]
  selectedKey?: string | null
  onOpen(item: FileListItem): void
  /** Right-click on a file. */
  onContextMenu?(item: FileListItem, position: { x: number; y: number }): void
  /** Buttons that appear on hover, right to left in reverse order. */
  actions?: FileAction[]
}

/** The nearest element around this one that can scroll. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return null
}

/** Which rows of the list are in view of whatever scrolls it, which other content can share with it. */
function useVisibleRows(list: RefObject<HTMLElement | null>, count: number): RowRange {
  const [range, setRange] = useState<RowRange>({ first: 0, last: FIRST_ROWS })
  const view = useRef<HTMLElement | null>(null)

  const measure = useCallback(() => {
    if (!list.current) return
    // With nothing to scroll it, the whole list is on show.
    const next = view.current
      ? visibleRows(count, ROW_HEIGHT, list.current.getBoundingClientRect().top - view.current.getBoundingClientRect().top, view.current.clientHeight)
      : { first: 0, last: count }
    setRange((shown) => (shown.first === next.first && shown.last === next.last ? shown : next))
  }, [list, count])

  useLayoutEffect(() => {
    const scroller = list.current && scrollParent(list.current)
    view.current = scroller
    if (!scroller) return
    scroller.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    // What's above the list can change size on its own, moving the list without any scrolling.
    for (const child of scroller.children) observer.observe(child)
    return () => {
      scroller.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [list, measure])

  // After every render too: a list above this one in the same scroller moves it without any scrolling.
  useLayoutEffect(measure)

  return range
}

/** A list of files. Only the rows in view are drawn, so a change to tens of thousands of files stays quick. */
export function FileList({ items, selectedKey, onOpen, onContextMenu, actions = [] }: Props) {
  const list = useRef<HTMLUListElement>(null)
  const { first, last } = useVisibleRows(list, items.length)

  return (
    <ul className="file-list" ref={list} style={{ height: items.length * ROW_HEIGHT, paddingTop: first * ROW_HEIGHT }}>
      {items.slice(first, last).map((item, offset) => {
        const { dir, base } = splitPath(item.path)
        const hasCounts = item.additions !== undefined || item.deletions !== undefined
        return (
          <li
            key={item.key}
            className={`file-item${item.key === selectedKey ? ' selected' : ''}`}
            style={{ height: ROW_HEIGHT }}
            aria-setsize={items.length}
            aria-posinset={first + offset + 1}
            onContextMenu={(event) => {
              if (!onContextMenu) return
              event.preventDefault()
              onContextMenu(item, { x: event.clientX, y: event.clientY })
            }}
          >
            <button
              className="file-open"
              onClick={() => onOpen(item)}
              title={item.origPath ? `${item.origPath} → ${item.path}` : item.path}
            >
              <span className={`file-status status-${item.status === '?' ? 'untracked' : item.status}`}>{item.status}</span>
              <span className="file-path">
                <span className="file-dir">{dir}</span>
                {base}
              </span>
              {hasCounts &&
                (item.additions === null ? (
                  <span className="file-counts dim">binary</span>
                ) : (
                  <span className="file-counts">
                    {(item.additions ?? 0) > 0 && <span className="add">+{item.additions}</span>}
                    {(item.deletions ?? 0) > 0 && <span className="del">−{item.deletions}</span>}
                  </span>
                ))}
            </button>
            {actions.length > 0 && (
              <span className="file-actions">
                {actions
                  .filter((action) => !action.hidden?.(item))
                  .map((action) => (
                    <button
                      key={action.title}
                      className="file-action"
                      title={`${action.title} ${base}`}
                      aria-label={`${action.title} ${item.path}`}
                      onClick={() => action.run(item)}
                    >
                      {action.label}
                    </button>
                  ))}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
