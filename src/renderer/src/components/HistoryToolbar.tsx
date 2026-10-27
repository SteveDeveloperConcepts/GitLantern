import { useEffect, useRef, useState } from 'react'
import type { Branch, LogFilter } from '../../../shared/types'
import { Icon } from './Icon'

interface Props {
  query: string
  onQuery(query: string): void
  /** Matching commits, and which of them is selected (-1 for none). */
  matches: number
  current: number
  onStep(direction: 1 | -1): void
  matchesOnly: boolean
  onMatchesOnly(value: boolean): void
  filter: LogFilter
  onFilter(filter: LogFilter): void
  branches: Branch[]
}

/** Search box and filters above the commit graph. Ctrl/⌘+F jumps to the search box. */
export function HistoryToolbar(props: Props) {
  const { query, matches, current, filter, branches } = props
  const input = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState(filter.path ?? '')

  useEffect(() => setPath(filter.path ?? ''), [filter.path])

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      // Every open tab has a toolbar; only the one on show takes the shortcut.
      if (!input.current?.offsetParent) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', focus)
    return () => window.removeEventListener('keydown', focus)
  }, [])

  const applyPath = () => {
    const value = path.trim()
    if (value !== (filter.path ?? '')) props.onFilter({ ...filter, path: value || undefined })
  }
  const local = branches.filter((b) => b.kind === 'local')
  const remote = branches.filter((b) => b.kind === 'remote')
  const searching = query.trim() !== ''

  return (
    <div className="history-toolbar">
      <div className="search-box">
        <Icon name="search" size={14} className="dim" />
        <input
          ref={input}
          value={query}
          placeholder="Search commits: message, author, hash, branch"
          aria-label="Search commits"
          onChange={(event) => props.onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onStep(event.shiftKey ? -1 : 1)
            if (event.key === 'Escape') props.onQuery('')
          }}
        />
        {searching && (
          <span className="search-count" aria-live="polite">
            {matches === 0 ? 'No matches' : current >= 0 ? `${current + 1} of ${matches}` : `${matches} match${matches === 1 ? '' : 'es'}`}
          </span>
        )}
        {searching && (
          <>
            <button className="icon-button small" disabled={matches === 0} onClick={() => props.onStep(-1)} aria-label="Previous match" title="Previous (Shift+Enter)">
              <Icon name="up" size={14} />
            </button>
            <button className="icon-button small" disabled={matches === 0} onClick={() => props.onStep(1)} aria-label="Next match" title="Next (Enter)">
              <Icon name="down" size={14} />
            </button>
          </>
        )}
      </div>
      <label className="checkbox compact" title="Hide the commits that don’t match the search">
        <input type="checkbox" checked={props.matchesOnly} disabled={!searching} onChange={(event) => props.onMatchesOnly(event.target.checked)} />
        Matches only
      </label>
      <span className="spacer" />
      <select
        aria-label="Branches shown"
        className={filter.branch ? 'active-filter' : ''}
        value={filter.branch ?? ''}
        onChange={(event) => props.onFilter({ ...filter, branch: event.target.value || undefined })}
      >
        <option value="">All branches</option>
        <optgroup label="Local">
          {local.map((b) => (
            <option key={b.fullName} value={b.name}>
              {b.name}
              {b.isCurrent ? ' (checked out)' : ''}
            </option>
          ))}
        </optgroup>
        {remote.length > 0 && (
          <optgroup label="Remote">
            {remote.map((b) => (
              <option key={b.fullName} value={b.name}>
                {b.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <input
        className={`path-filter${filter.path ? ' active-filter' : ''}`}
        value={path}
        placeholder="Only changes to a path"
        aria-label="Only commits that changed this file or folder"
        title="Show only commits that changed this file or folder, e.g. src/ or README.md. Press Enter."
        onChange={(event) => setPath(event.target.value)}
        onBlur={applyPath}
        onKeyDown={(event) => {
          if (event.key === 'Enter') applyPath()
          if (event.key === 'Escape') {
            setPath('')
            props.onFilter({ ...filter, path: undefined })
          }
        }}
      />
      {(filter.branch || filter.path) && (
        <button className="link" onClick={() => props.onFilter({})}>
          Clear filters
        </button>
      )}
    </div>
  )
}
