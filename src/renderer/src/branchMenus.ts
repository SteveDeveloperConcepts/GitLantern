import type { Branch, RefLabel, RepoOperation } from '../../shared/types'
import type { MenuItem } from './components/Menu'

/** A branch or commit to merge, rebase onto or branch from: `ref` goes to git, `label` is shown. */
export interface RefTarget {
  ref: string
  label: string
}

export type IntegrateKind = 'merge' | 'rebase'

export interface MenuContext {
  /** The checked-out branch, or null when HEAD is detached. */
  current: string | null
  headHash: string | null
  operation: RepoOperation | undefined
}

export interface MenuActions {
  checkout(branch: Branch): void
  integrate(kind: IntegrateKind, target: RefTarget): void
  createBranchAt(target: RefTarget): void
  copyHash(hash: string): void
}

export const OPERATION_NAMES: Record<RepoOperation['kind'], string> = {
  merge: 'merge',
  rebase: 'rebase',
  'cherry-pick': 'cherry-pick',
  revert: 'revert'
}

/** Why merging and rebasing aren't possible right now, if they aren't. */
function blockedReason(ctx: MenuContext): string | undefined {
  if (ctx.operation) return `Finish the ${OPERATION_NAMES[ctx.operation.kind]} first`
  if (ctx.current === null) return 'Check out a branch first'
  return undefined
}

function integrateItems(target: RefTarget, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  const blocked = blockedReason(ctx)
  const current = ctx.current ?? 'HEAD'
  return [
    {
      key: 'merge',
      label: `Merge ${target.label} into ${current}`,
      disabled: blocked !== undefined,
      ...(blocked ? { hint: blocked } : {}),
      onSelect: () => actions.integrate('merge', target)
    },
    {
      key: 'rebase',
      label: `Rebase ${current} onto ${target.label}`,
      disabled: blocked !== undefined,
      onSelect: () => actions.integrate('rebase', target)
    }
  ]
}

/** Merge, rebase and check out for one branch; nothing for the checked-out branch itself. */
export function branchItems(branch: Branch, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  if (branch.isCurrent) return []
  return [
    ...integrateItems({ ref: branch.name, label: branch.name }, ctx, actions),
    {
      key: 'checkout',
      label: `Check out ${branch.name}`,
      disabled: ctx.operation !== undefined,
      onSelect: () => actions.checkout(branch)
    }
  ]
}

function commitItems(hash: string, actions: MenuActions): MenuItem[] {
  const short = hash.slice(0, 7)
  return [
    { key: 'branch', label: 'Create branch here…', onSelect: () => actions.createBranchAt({ ref: hash, label: `commit ${short}` }) },
    { key: 'copy', label: 'Copy commit hash', hint: short, onSelect: () => actions.copyHash(hash) }
  ]
}

/** The branches a commit's labels stand for, in label order. Tags and HEAD are left out. */
export function branchesForRefs(refs: RefLabel[], branches: Branch[]): Branch[] {
  return refs.flatMap((ref) => {
    const branch = branches.find((b) => b.kind === ref.kind && b.name === ref.name)
    return branch ? [branch] : []
  })
}

/**
 * Menu for a commit in the graph: a group per branch on it (or, with none, merge and rebase onto the
 * commit itself), then actions on the commit.
 */
export function commitMenu(hash: string, branchesHere: Branch[], ctx: MenuContext, actions: MenuActions): MenuItem[][] {
  const groups = branchesHere.map((branch) => branchItems(branch, ctx, actions)).filter((group) => group.length > 0)
  if (groups.length === 0 && hash !== ctx.headHash) {
    groups.push(integrateItems({ ref: hash, label: `commit ${hash.slice(0, 7)}` }, ctx, actions))
  }
  return [...groups, commitItems(hash, actions)]
}
