/**
 * Commit graph lane layout.
 *
 * Commits arrive newest first, with every commit before its parents (git log --date-order or
 * --topo-order). We walk them once, keeping a list of lanes. Each lane holds the hash of the
 * commit it is waiting for. A commit takes the leftmost lane waiting for it, or a free lane if
 * it is a branch tip. Its first parent inherits that lane, and further (merge) parents join a
 * lane already waiting for them or open a new one. Lanes free up when they reach their commit,
 * so lines stay vertical except where branches fork or merge.
 */

export interface GraphNode {
  hash: string
  parents: string[]
}

/** A line arriving at a row: from column `from` on the row above to column `to` on this row. */
export interface GraphEdge {
  from: number
  to: number
  color: number
}

export interface GraphRow {
  /** Column of this commit's dot. */
  column: number
  color: number
  /** Lines that end at this row, coming from the row above. */
  edges: GraphEdge[]
}

export interface GraphLayout {
  rows: GraphRow[]
  /** Widest point of the graph, in lanes. */
  columns: number
}

interface PendingEdge {
  /** Column the line leaves from on the current row. */
  from: number
  /** Lane it continues in on the next row. */
  lane: number
}

export function layoutGraph(commits: readonly GraphNode[]): GraphLayout {
  const lanes: (string | null)[] = []
  const laneColors: number[] = []
  let nextColor = 0
  let pending: PendingEdge[] = []
  let columns = 0
  const rows: GraphRow[] = []

  const freeLane = (): number => {
    const index = lanes.indexOf(null)
    return index === -1 ? lanes.length : index
  }
  const openLane = (hash: string): number => {
    const lane = freeLane()
    lanes[lane] = hash
    laneColors[lane] = nextColor++
    return lane
  }

  for (const commit of commits) {
    let column = lanes.indexOf(commit.hash)
    if (column === -1) column = openLane(commit.hash)
    const color = laneColors[column] ?? 0

    // Every lane waiting for this commit converges on its dot; the rest carry straight on.
    const edges = pending.map(({ from, lane }) => ({
      from,
      to: lanes[lane] === commit.hash ? column : lane,
      color: laneColors[lane] ?? 0
    }))

    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.hash) lanes[i] = null

    const startsHere = new Set<number>()
    const mergesInto: number[] = []
    const [firstParent, ...otherParents] = commit.parents
    if (firstParent !== undefined) {
      lanes[column] = firstParent
      startsHere.add(column)
    }
    for (const parent of new Set(otherParents)) {
      if (parent === firstParent) continue
      const existing = lanes.indexOf(parent)
      if (existing === -1) startsHere.add(openLane(parent))
      else mergesInto.push(existing)
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    pending = []
    lanes.forEach((hash, lane) => {
      if (hash !== null) pending.push({ from: startsHere.has(lane) ? column : lane, lane })
    })
    for (const lane of mergesInto) pending.push({ from: column, lane })

    columns = Math.max(columns, column + 1, lanes.length)
    rows.push({ column, color, edges })
  }

  return { rows, columns }
}
