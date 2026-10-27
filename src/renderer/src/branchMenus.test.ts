import { describe, expect, it, vi } from 'vitest'
import type { Branch } from '../../shared/types'
import { branchesForRefs, commitMenu, flowBranch, tagMenu, type MenuActions, type MenuContext } from './branchMenus'

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
      ['Cherry-pick commit bbbbbbb onto main', 'Create branch here…'],
      ['Copy commit hash']
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
    expect(labels(groups)).toEqual([['Cherry-pick commit aaaaaaa onto main', 'Create branch here…'], ['Copy commit hash']])
    expect(groups[0]?.[0]).toMatchObject({ disabled: true, hint: 'Already on main' })
  })

  it('disables merge, rebase and checkout while a merge is unfinished', () => {
    const groups = commitMenu(OTHER, [feature], { ...ctx, operation: { kind: 'merge' } }, actions())
    expect(groups[0]?.map((item) => item.disabled)).toEqual([true, true, true])
    expect(groups[0]?.[0]?.hint).toBe('Finish the merge first')
    expect(groups[1]?.map((item) => item.disabled ?? false)).toEqual([true, false])
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

  it('offers rewriting only for commits on the checked-out branch, and never for merges', () => {
    const all: MenuActions = {
      ...actions(),
      revert: vi.fn(),
      reset: vi.fn(),
      reword: vi.fn(),
      squash: vi.fn(),
      drop: vi.fn(),
      editHistory: vi.fn(),
      tag: vi.fn(),
      compare: vi.fn(),
      savePatch: vi.fn()
    }
    const PARENT = 'c'.repeat(40)
    const onCurrent = { ...ctx, onCurrent: new Set([HEAD, OTHER, PARENT]) }
    const groups = commitMenu({ hash: OTHER, parents: [PARENT] }, [], onCurrent, all)
    expect(labels(groups)[2]).toEqual([
      'Revert commit bbbbbbb',
      'Reset main to here…',
      'Edit commit message…',
      'Squash into parent',
      'Drop commit…',
      'Edit history from here…'
    ])
    expect(groups[2]?.every((item) => !item.disabled)).toBe(true)

    const merge = commitMenu({ hash: OTHER, parents: [PARENT, HEAD] }, [], onCurrent, all)
    expect(merge[2]?.find((item) => item.key === 'squash')).toMatchObject({ disabled: true, hint: 'Merge commit' })

    const elsewhere = commitMenu({ hash: OTHER, parents: [PARENT] }, [], ctx, all)
    expect(elsewhere[2]?.find((item) => item.key === 'reword')).toMatchObject({ disabled: true, hint: 'Not on main' })
    expect(elsewhere[2]?.find((item) => item.key === 'revert')?.disabled).toBeFalsy()
  })

  it('manages branches: rename and upstream for the current one, delete and push for others', () => {
    const all: MenuActions = { ...actions(), renameBranch: vi.fn(), deleteBranch: vi.fn(), setUpstream: vi.fn(), pushBranch: vi.fn() }
    const withRemotes = { ...ctx, remotes: ['origin'] }
    expect(labels(commitMenu(HEAD, [main], withRemotes, all))[0]).toEqual(['Set upstream…', 'Rename…'])
    const groups = commitMenu(OTHER, [feature, originFeature], withRemotes, all)
    expect(labels(groups)[0]?.slice(3)).toEqual(['Push feature to origin', 'Set upstream…', 'Rename…', 'Delete feature…'])
    expect(labels(groups)[1]?.slice(3)).toEqual(['Delete origin/feature on its remote…'])
  })

  it('finishes git-flow branches', () => {
    const flow = { master: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' }, versionTagPrefix: 'v' }
    expect(flowBranch('feature/login', flow)).toEqual({ kind: 'feature', name: 'login' })
    expect(flowBranch('feature/', flow)).toBeNull()
    expect(flowBranch('main', flow)).toBeNull()
    const finish = vi.fn()
    const groups = commitMenu(OTHER, [branch('release/1.2', 'local', OTHER)], { ...ctx, flow }, { ...actions(), flowFinish: finish })
    const item = groups[0]?.find((i) => i.key === 'flow-finish')
    expect(item?.label).toBe('Finish release 1.2')
    item?.onSelect()
    expect(finish).toHaveBeenCalledWith('release', '1.2')
  })

  it('pushes and deletes tags', () => {
    const pushTag = vi.fn()
    const groups = tagMenu('v1', { ...ctx, remotes: ['upstream', 'origin'] }, { ...actions(), pushTag, deleteTag: vi.fn(), deleteRemoteTag: vi.fn() })
    expect(labels(groups)).toEqual([['Push tag v1 to origin', 'Delete tag from origin…', 'Delete tag v1…']])
    groups[0]?.[0]?.onSelect()
    expect(pushTag).toHaveBeenCalledWith('v1', 'origin')
  })

  it('adds custom actions for commits and branches', () => {
    const run = vi.fn()
    const action = { id: 'x', name: 'Deploy', scope: 'commit' as const, command: 'deploy', args: ['${SHA}'], confirm: false }
    const groups = commitMenu(OTHER, [], { ...ctx, customActions: [action] }, { ...actions(), customAction: run })
    const item = groups.at(-1)?.find((i) => i.key === 'custom:x')
    item?.onSelect()
    expect(run).toHaveBeenCalledWith(action, { sha: OTHER })
  })
})
