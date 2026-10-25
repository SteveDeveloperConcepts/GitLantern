import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Commit, RefKind } from '../../../shared/types'
import { Avatar } from '../components/Avatar'
import { formatRelative } from '../format'
import type { GraphLayout } from './layout'
import { refPills } from './refs'

export const ROW_HEIGHT = 30
/** Hash of the pseudo-commit that stands for uncommitted changes at the top of the graph. */
export const WORKING_COPY = 'WORKING_COPY'
const LANE_WIDTH = 18
const GRAPH_PADDING = 11
const NODE_RADIUS = 5
const MAX_GRAPH_WIDTH = 280
const OVERSCAN = 4
// Readable on both the dark and light themes; amber first to match the app accent.
export const LANE_COLORS = ['#e8a33d', '#4cc38a', '#6aa9ff', '#e5649a', '#a78bfa', '#2fb8b8', '#f07c4a', '#8fb339']

const laneColor = (index: number): string => LANE_COLORS[index % LANE_COLORS.length] ?? '#888'
const laneX = (column: number): number => GRAPH_PADDING + column * LANE_WIDTH

interface Props {
  commits: Commit[]
  layout: GraphLayout
  /** Commit HEAD points at; drawn with an outer ring. */
  headHash: string | null
  selectedHash: string | null
  onSelect(hash: string): void
  /** Right-click (or the menu key) on a commit; `ref` is set when it was on one of its labels. */
  onContextMenu(commit: Commit, ref: { name: string; kind: RefKind } | null, position: { x: number; y: number }): void
}

/**
 * Virtualised commit list. Only visible rows are rendered. A canvas pinned to the viewport
 * draws the lanes for those rows and is redrawn on scroll.
 */
export function CommitGraph({ commits, layout, headHash, selectedHash, onSelect, onContextMenu }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const graphWidth = Math.min(MAX_GRAPH_WIDTH, Math.max(64, GRAPH_PADDING * 2 + (layout.columns - 1) * LANE_WIDTH + 12))
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(commits.length - 1, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  const hasWorkingCopy = commits[0]?.hash === WORKING_COPY

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight))
    observer.observe(element)
    setViewportHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(graphWidth * dpr)
    canvas.height = Math.round(viewportHeight * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, graphWidth, viewportHeight)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'

    const rowY = (row: number): number => row * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollTop
    const background = getComputedStyle(canvas).getPropertyValue('--bg').trim() || '#000'

    // Lines into each visible row come from the row above, so draw one row past the viewport too.
    for (let row = Math.max(1, first); row <= Math.min(layout.rows.length - 1, last + 1); row++) {
      // The line from the working copy to its base commit is dashed.
      ctx.setLineDash(hasWorkingCopy && row === 1 ? [3, 3] : [])
      for (const edge of layout.rows[row]?.edges ?? []) {
        const x1 = laneX(edge.from)
        const y1 = rowY(row - 1)
        const x2 = laneX(edge.to)
        const y2 = rowY(row)
        ctx.strokeStyle = laneColor(edge.color)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        if (x1 === x2) {
          ctx.lineTo(x2, y2)
        } else {
          const midY = (y1 + y2) / 2
          ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2)
        }
        ctx.stroke()
      }
    }
    ctx.setLineDash([])

    for (let row = first; row <= last; row++) {
      const graphRow = layout.rows[row]
      const commit = commits[row]
      if (!graphRow || !commit) continue
      const x = laneX(graphRow.column)
      const y = rowY(row)
      const color = laneColor(graphRow.color)
      const hollow = commit.parents.length > 1 || commit.hash === WORKING_COPY
      ctx.setLineDash(commit.hash === WORKING_COPY ? [2, 2] : [])
      ctx.beginPath()
      ctx.arc(x, y, hollow ? NODE_RADIUS - 1 : NODE_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = hollow ? background : color
      ctx.fill()
      ctx.lineWidth = hollow ? 2.5 : 2
      ctx.strokeStyle = hollow ? color : background
      ctx.stroke()
      ctx.setLineDash([])
      if (commit.hash === headHash) {
        ctx.beginPath()
        ctx.arc(x, y, NODE_RADIUS + 3.5, 0, Math.PI * 2)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = color
        ctx.stroke()
      }
      ctx.lineWidth = 2
    }
  }, [commits, layout, headHash, hasWorkingCopy, first, last, scrollTop, viewportHeight, graphWidth])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const commit = commits.find((c) => c.hash === selectedHash)
      const row = scrollRef.current?.querySelector('.commit-row.selected')?.getBoundingClientRect()
      if (commit && commit.hash !== WORKING_COPY && row) {
        event.preventDefault()
        onContextMenu(commit, null, { x: row.left + graphWidth, y: row.bottom })
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = commits.findIndex((c) => c.hash === selectedHash)
    const next = commits[Math.min(commits.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    onSelect(next.hash)
    const element = scrollRef.current
    const top = commits.indexOf(next) * ROW_HEIGHT
    if (element && (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight)) {
      element.scrollTop = top - element.clientHeight / 2
    }
  }

  const visible = commits.slice(first, last + 1)

  return (
    <div className="graph">
      <div className="graph-header" aria-hidden="true">
        <span style={{ width: graphWidth }}>Graph</span>
        <span className="col-subject">Description</span>
        <span className="col-author">Author</span>
        <span className="col-date">Date</span>
        <span className="col-hash">Commit</span>
      </div>
      <div
        className="graph-scroll"
        ref={scrollRef}
        tabIndex={0}
        aria-label="Commit history"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        <div className="graph-inner" style={{ height: commits.length * ROW_HEIGHT }}>
          <canvas ref={canvasRef} className="graph-canvas" style={{ width: graphWidth, height: viewportHeight }} />
          {visible.map((commit, offset) => {
            const index = first + offset
            const working = commit.hash === WORKING_COPY
            return (
              <div
                key={commit.hash}
                className={`commit-row${commit.hash === selectedHash ? ' selected' : ''}${working ? ' working' : ''}`}
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: graphWidth }}
                onClick={() => onSelect(commit.hash)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (working) return
                  const pill = (event.target as HTMLElement).closest<HTMLElement>('[data-ref-kind]')
                  const ref = pill ? { name: pill.dataset.refName ?? '', kind: pill.dataset.refKind as RefKind } : null
                  onContextMenu(commit, ref, { x: event.clientX, y: event.clientY })
                }}
              >
                <span className="col-subject">
                  {refPills(commit.refs).map((pill) => (
                    <span
                      key={pill.key}
                      className={`ref ref-${pill.kind}${pill.isCurrent ? ' ref-current' : ''}`}
                      title={pill.label}
                      data-ref-name={pill.label}
                      data-ref-kind={pill.kind}
                    >
                      {pill.kind === 'tag' ? `# ${pill.label}` : pill.label}
                      {pill.remotes.length > 0 && <span className="ref-remotes"> · {pill.remotes.join(', ')}</span>}
                    </span>
                  ))}
                  <span className="commit-subject" title={commit.subject}>
                    {commit.subject}
                  </span>
                </span>
                <span className="col-author" title={commit.authorEmail}>
                  {!working && <Avatar name={commit.authorName} email={commit.authorEmail} />}
                  <span className="ellipsis">{commit.authorName}</span>
                </span>
                <span className="col-date" title={working ? '' : new Date(commit.authorDate * 1000).toLocaleString()}>
                  {working ? '' : formatRelative(commit.authorDate)}
                </span>
                <span className="col-hash">{working ? '' : commit.hash.slice(0, 7)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
