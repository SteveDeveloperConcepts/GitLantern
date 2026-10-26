import { describe, expect, it, vi } from 'vitest'
import type { Branch } from '../../shared/types'
import { branchesForRefs, commitMenu, type MenuActions, type MenuContext } from './branchMenus'

const branch = (name: string, kind: Branch['kind'], hash: string, isCurrent = false): Branch => ({
  name,
  fullName: kind === 'local' ? `refs/heads/${name}` : `refs/remotes/${name}`,
  kind,
  hash,
  upstream: null,
  isCurrent
})

const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const main = branch('main', 'local', HEAD, true)
const feature = branch('feature', 'local', OTHER)
const originFeature = branch('origin/feature', 'remote', OTHER)
const ctx: MenuContext = { current: 'main', headHash: HEAD, operation: undefined, onCurrent: new Set([HEAD]) }

function actions(): MenuActions {
  return { checkout: vi.fn(), integrate: vi.fn(), createBranchAt: vi.fn(), copyHash: vi.fn(), cherryPick: vi.fn() }
}

const labels = (groups: ReturnType<typeof commitMenu>) => groups.map((group) => group.map((item) => item.label))

describe('commit context menu', () => {
  it('offers merge, rebase and checkout for each branch on the commit', () => {
    const act = actions()
    const groups = commitMenu(OTHER, [feature, originFeature], ctx, act)
    expect(labels(groups)).toEqual([
      ['Merge feature into main', 'Rebase main onto feature', 'Check out feature'],
      ['Merge origin/feature into main', 'Rebase main onto origin/feature', 'Check out origin/feature'],
      ['Cherry-pick commit bbbbbbb onto main', 'Create branch here…', 'Copy commit hash']
    ])
    groups[0]?.[1]?.onSelect()
    expect(act.integrate).toHaveBeenCalledWith('rebase', { ref: 'feature', label: 'feature' })
    groups[2]?.[0]?.onSelect()
    expect(act.cherryPick).toHaveBeenCalledWith(OTHER)
  })

  it('merges a commit with no branch by its hash', () => {
    const act = actions()
    const groups = commitMenu(OTHER, [], ctx, act)
    expect(labels(groups)[0]).toEqual(['Merge commit bbbbbbb into main', 'Rebase main onto commit bbbbbbb'])
    groups[0]?.[0]?.onSelect()
    expect(act.integrate).toHaveBeenCalledWith('merge', { ref: OTHER, label: 'commit bbbbbbb' })
  })

  it('leaves out merging the checked-out branch into itself, and cherry-picking what it has', () => {
    const groups = commitMenu(HEAD, [main], ctx, actions())
    expect(labels(groups)).toEqual([['Cherry-pick commit aaaaaaa onto main', 'Create branch here…', 'Copy commit hash']])
    expect(groups[0]?.[0]).toMatchObject({ disabled: true, hint: 'Already on main' })
  })

  it('disables merge, rebase and checkout while a merge is unfinished', () => {
    const groups = commitMenu(OTHER, [feature], { ...ctx, operation: { kind: 'merge' } }, actions())
    expect(groups[0]?.map((item) => item.disabled)).toEqual([true, true, true])
    expect(groups[0]?.[0]?.hint).toBe('Finish the merge first')
    expect(groups[1]?.map((item) => item.disabled ?? false)).toEqual([true, false, false])
  })

  it('asks for a branch to be checked out when HEAD is detached', () => {
    const groups = commitMenu(OTHER, [feature], { ...ctx, current: null }, actions())
    expect(groups[0]?.[0]).toMatchObject({ label: 'Merge feature into HEAD', disabled: true, hint: 'Check out a branch first' })
    expect(groups[0]?.[2]?.disabled).toBe(false)
  })

  it('maps graph labels to branches, skipping tags', () => {
    const refs = [
      { name: 'feature', kind: 'local' as const },
      { name: 'v1', kind: 'tag' as const },
      { name: 'origin/feature', kind: 'remote' as const }
    ]
    expect(branchesForRefs(refs, [main, feature, originFeature])).toEqual([feature, originFeature])
  })
})
