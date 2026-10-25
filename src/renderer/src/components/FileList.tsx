import { splitPath } from '../format'

export interface FileListItem {
  key: string
  path: string
  origPath?: string
  /** One-letter status shown in the badge. */
  status: string
  additions?: number | null
  deletions?: number | null
}

interface Props {
  items: FileListItem[]
  selectedKey?: string | null
  onOpen(item: FileListItem): void
  action?: { label: string; title: string; run(item: FileListItem): void }
}

export function FileList({ items, selectedKey, onOpen, action }: Props) {
  return (
    <ul className="file-list">
      {items.map((item) => {
        const { dir, base } = splitPath(item.path)
        const hasCounts = item.additions !== undefined || item.deletions !== undefined
        return (
          <li key={item.key} className={`file-item${item.key === selectedKey ? ' selected' : ''}`}>
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
            {action && (
              <button className="file-action" title={`${action.title} ${base}`} aria-label={`${action.title} ${item.path}`} onClick={() => action.run(item)}>
                {action.label}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
