/** The rows of a list worth drawing: from `first` up to, but not including, `last`. */
export interface RowRange {
  first: number
  last: number
}

/** Rows drawn past each edge of the view, so a quick scroll doesn't show a gap. */
const OVERSCAN = 8

/**
 * Which rows of a list are in view, and a few either side. `listTop` is where the list starts,
 * measured from the top of the view: negative once it has scrolled up past it.
 */
export function visibleRows(count: number, rowHeight: number, listTop: number, viewHeight: number): RowRange {
  const first = Math.max(0, Math.floor(-listTop / rowHeight) - OVERSCAN)
  const last = Math.min(count, Math.ceil((viewHeight - listTop) / rowHeight) + OVERSCAN)
  return first < last ? { first, last } : { first: 0, last: 0 }
}
