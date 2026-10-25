import { describe, expect, it } from 'vitest'
import { layoutGraph, type GraphNode } from './layout'

const node = (hash: string, ...parents: string[]): GraphNode => ({ hash, parents })

describe('layoutGraph', () => {
  it('keeps a linear history in one straight lane', () => {
    const { rows, columns } = layoutGraph([node('c', 'b'), node('b', 'a'), node('a')])
    expect(columns).toBe(1)
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(rows[0]?.edges).toEqual([])
    expect(rows[1]?.edges).toEqual([{ from: 0, to: 0, color: 0 }])
    expect(rows[2]?.edges).toEqual([{ from: 0, to: 0, color: 0 }])
  })

  it('opens a lane for a merged branch and closes it where the branch forked', () => {
    // m merges feature f into a; both lines meet again at a.
    const { rows, columns } = layoutGraph([node('m', 'a', 'f'), node('f', 'a'), node('a', 'r'), node('r')])
    expect(columns).toBe(2)
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0, 0])
    // From m: one line straight down, one curving out to the feature lane.
    expect(rows[1]?.edges.map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [0, 1]
    ])
    // At a: the feature lane converges back into lane 0.
    expect(rows[2]?.edges.map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [1, 0]
    ])
    expect(rows[3]?.edges.map(({ from, to }) => [from, to])).toEqual([[0, 0]])
  })

  it('gives each branch its own color', () => {
    const { rows } = layoutGraph([node('m', 'a', 'f'), node('f', 'a'), node('a')])
    expect(rows[0]?.color).not.toBe(rows[1]?.color)
    expect(rows[2]?.color).toBe(rows[0]?.color)
  })

  it('shows two branch tips that share a parent side by side', () => {
    const { rows } = layoutGraph([node('x', 'base'), node('y', 'base'), node('base')])
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0])
    expect(rows[2]?.edges.map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [1, 0]
    ])
  })

  it('merges into a lane that is already waiting for the parent', () => {
    // b is wanted by both the main line (via c) and the merge m.
    const { rows } = layoutGraph([node('m', 'c', 'b'), node('c', 'b'), node('b')])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    // m opens a lane for b; c then also waits for b in lane 0, and both meet at b.
    expect(rows[2]?.edges.map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [1, 0]
    ])
  })

  it('reuses freed lanes and copes with parents missing from a truncated log', () => {
    const { rows, columns } = layoutGraph([node('t1', 'p1'), node('p1'), node('t2', 'missing')])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(columns).toBe(1)
  })

  it('handles octopus merges', () => {
    const { rows, columns } = layoutGraph([node('o', 'a', 'b', 'c'), node('a'), node('b'), node('c')])
    expect(columns).toBe(3)
    expect(rows[1]?.edges.map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2]
    ])
  })
})
