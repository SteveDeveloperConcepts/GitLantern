import type { Branch, CustomAction, CustomActionContext, FlowConfig, FlowKind, RefLabel, RepoOperation } from '../../shared/types'
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
  /** Commits the checked-out branch already has, as far as the history goes. */
  onCurrent?: ReadonlySet<string>
  /** A bisect is in progress. */
  bisecting?: boolean
  /** git-flow settings, when the repository uses it. */
  flow?: FlowConfig | null
  /** The repository's remotes, for pushing tags and branches. */
  remotes?: string[]
  /** Custom actions from Settings. */
  customActions?: CustomAction[]
}

/** The commit a menu is for: its parents tell merges and root commits apart. */
export interface MenuCommit {
  hash: string
  parents: string[]
}

/** What the menu items do. Items whose action isn't given are left out. */
export interface MenuActions {
  checkout(branch: Branch): void
  integrate(kind: IntegrateKind, target: RefTarget): void
  createBranchAt(target: RefTarget): void
  copyHash(hash: string): void
  cherryPick(hash: string): void
  revert?(hash: string): void
  reset?(hash: string): void
  reword?(hash: string): void
  /** Fold the commit into its parent. */
  squash?(hash: string): void
  drop?(hash: string): void
  /** Interactive rebase of the commits from this one up to HEAD. */
  editHistory?(hash: string): void
  tag?(target: RefTarget): void
  /** Compare the target with the checked-out commit. */
  compare?(target: RefTarget): void
  savePatch?(hash: string): void
  archive?(target: RefTarget): void
  /** Start a bisect with this commit as the last good one and HEAD as bad. */
  bisectFrom?(hash: string): void
  renameBranch?(branch: Branch): void
  deleteBranch?(branch: Branch): void
  setUpstream?(branch: Branch): void
  pushBranch?(branch: Branch, remote: string): void
  flowFinish?(kind: FlowKind, name: string): void
  deleteTag?(name: string): void
  pushTag?(name: string, remote: string): void
  deleteRemoteTag?(name: string, remote: string): void
  customAction?(action: CustomAction, context: CustomActionContext): void
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

/** An item that's there only when its action is. */
function optional<A extends unknown[]>(action: ((...args: A) => void) | undefined, item: Omit<MenuItem, 'onSelect'>, ...args: A): MenuItem[] {
  return action ? [{ ...item, onSelect: () => action(...args) }] : []
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

/** The git-flow kind and name of a branch like feature/login, when the repository uses git-flow. */
export function flowBranch(name: string, flow: FlowConfig | null | undefined): { kind: FlowKind; name: string } | null {
  if (!flow) return null
  for (const kind of ['feature', 'release', 'hotfix'] as const) {
    const prefix = flow.prefixes[kind]
    if (prefix && name.startsWith(prefix) && name.length > prefix.length) return { kind, name: name.slice(prefix.length) }
  }
  return null
}

function customItems(scope: CustomAction['scope'], context: CustomActionContext, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  const run = actions.customAction
  if (!run) return []
  return (ctx.customActions ?? [])
    .filter((action) => action.scope === scope)
    .map((action) => ({ key: `custom:${action.id}`, label: action.name, hint: 'custom', onSelect: () => run(action, context) }))
}

/** Rename, delete, upstream, push and git-flow for one branch. */
function manageItems(branch: Branch, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  if (branch.kind === 'remote') {
    return optional(actions.deleteBranch, { key: 'delete-remote', label: `Delete ${branch.name} on its remote…` }, branch)
  }
  const flow = flowBranch(branch.name, ctx.flow)
  const remote = branch.upstream?.slice(0, branch.upstream.indexOf('/')) || ctx.remotes?.[0]
  const busy = ctx.operation !== undefined
  return [
    ...(flow && actions.flowFinish
      ? [
          {
            key: 'flow-finish',
            label: `Finish ${flow.kind} ${flow.name}`,
            hint: 'git-flow',
            disabled: busy,
            onSelect: () => actions.flowFinish?.(flow.kind, flow.name)
          }
        ]
      : []),
    ...(!branch.isCurrent && remote ? optional(actions.pushBranch, { key: 'push', label: `Push ${branch.name} to ${remote}` }, branch, remote) : []),
    ...optional(actions.setUpstream, { key: 'upstream', label: 'Set upstream…', ...(branch.upstream ? { hint: branch.upstream } : {}) }, branch),
    ...optional(actions.renameBranch, { key: 'rename', label: 'Rename…' }, branch),
    ...(branch.isCurrent ? [] : optional(actions.deleteBranch, { key: 'delete', label: `Delete ${branch.name}…` }, branch))
  ]
}

/** Merge, rebase, check out and compare for one branch, then managing it. */
export function branchItems(branch: Branch, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  const manage = [...manageItems(branch, ctx, actions), ...customItems('branch', { branch: branch.name, sha: branch.hash }, ctx, actions)]
  if (branch.isCurrent) return manage
  return [
    ...integrateItems({ ref: branch.name, label: branch.name }, ctx, actions),
    {
      key: 'checkout',
      label: `Check out ${branch.name}`,
      disabled: ctx.operation !== undefined,
      onSelect: () => actions.checkout(branch)
    },
    ...optional(actions.compare, { key: 'compare', label: `Compare with ${ctx.current ?? 'HEAD'}` }, { ref: branch.name, label: branch.name }),
    ...manage
  ]
}

/** Revert, reset, reword, squash, drop and interactive rebase: for commits on the checked-out branch. */
function rewriteItems(commit: MenuCommit, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  const short = commit.hash.slice(0, 7)
  const blocked = blockedReason(ctx)
  const onCurrent = ctx.onCurrent?.has(commit.hash) === true
  const merge = commit.parents.length > 1
  const current = ctx.current ?? 'HEAD'
  // Rewriting needs a branch, no operation in progress, and a commit the branch has.
  const rewrite = blocked ?? (onCurrent ? undefined : `Not on ${current}`)
  const hint = (reason: string | undefined) => (reason ? { hint: reason, disabled: true } : {})
  return [
    ...optional(actions.revert, { key: 'revert', label: `Revert commit ${short}`, ...hint(ctx.operation ? blocked : undefined) }, commit.hash),
    ...optional(
      actions.reset,
      { key: 'reset', label: `Reset ${current} to here…`, ...hint(ctx.operation ? blocked : commit.hash === ctx.headHash ? 'Already here' : undefined) },
      commit.hash
    ),
    ...optional(actions.reword, { key: 'reword', label: 'Edit commit message…', ...hint(rewrite ?? (merge ? 'Merge commit' : undefined)) }, commit.hash),
    ...optional(
      actions.squash,
      {
        key: 'squash',
        label: 'Squash into parent',
        ...hint(rewrite ?? (merge ? 'Merge commit' : commit.parents.length === 0 ? 'First commit' : undefined))
      },
      commit.hash
    ),
    ...optional(actions.drop, { key: 'drop', label: 'Drop commit…', ...hint(rewrite ?? (merge ? 'Merge commit' : undefined)) }, commit.hash),
    ...optional(actions.editHistory, { key: 'edit-history', label: 'Edit history from here…', ...hint(rewrite) }, commit.hash)
  ]
}

function commitItems(commit: MenuCommit, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  const short = commit.hash.slice(0, 7)
  const blocked = blockedReason(ctx) ?? (ctx.onCurrent?.has(commit.hash) ? `Already on ${ctx.current ?? 'HEAD'}` : undefined)
  const target = { ref: commit.hash, label: `commit ${short}` }
  return [
    {
      key: 'cherry-pick',
      label: `Cherry-pick commit ${short} onto ${ctx.current ?? 'HEAD'}`,
      disabled: blocked !== undefined,
      ...(blocked ? { hint: blocked } : {}),
      onSelect: () => actions.cherryPick(commit.hash)
    },
    { key: 'branch', label: 'Create branch here…', onSelect: () => actions.createBranchAt(target) },
    ...optional(actions.tag, { key: 'tag', label: 'Create tag here…' }, target)
  ]
}

function inspectItems(commit: MenuCommit, ctx: MenuContext, actions: MenuActions): MenuItem[] {
  const short = commit.hash.slice(0, 7)
  const target = { ref: commit.hash, label: `commit ${short}` }
  const bisectable = !ctx.bisecting && !ctx.operation && commit.hash !== ctx.headHash && ctx.onCurrent?.has(commit.hash) === true
  return [
    ...(commit.hash === ctx.headHash ? [] : optional(actions.compare, { key: 'compare', label: `Compare with ${ctx.current ?? 'HEAD'}` }, target)),
    ...optional(actions.savePatch, { key: 'patch', label: 'Save as patch…' }, commit.hash),
    ...optional(actions.archive, { key: 'archive', label: 'Save files as zip…' }, target),
    ...(bisectable
      ? optional(actions.bisectFrom, { key: 'bisect', label: 'Find a bug since here (bisect)…', hint: 'this one good, HEAD bad' }, commit.hash)
      : [])
  ]
}

/** Delete and push for a tag label in the graph. */
export function tagMenu(name: string, ctx: MenuContext, actions: MenuActions): MenuItem[][] {
  const remote = ctx.remotes?.includes('origin') ? 'origin' : ctx.remotes?.[0]
  return [
    [
      ...(remote ? optional(actions.pushTag, { key: 'push-tag', label: `Push tag ${name} to ${remote}` }, name, remote) : []),
      ...(remote ? optional(actions.deleteRemoteTag, { key: 'delete-remote-tag', label: `Delete tag from ${remote}…` }, name, remote) : []),
      ...optional(actions.deleteTag, { key: 'delete-tag', label: `Delete tag ${name}…` }, name)
    ]
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
 * commit itself), then actions on the commit, rewriting it, looking at it, and copying its hash.
 */
export function commitMenu(commit: MenuCommit | string, branchesHere: Branch[], ctx: MenuContext, actions: MenuActions): MenuItem[][] {
  const target: MenuCommit = typeof commit === 'string' ? { hash: commit, parents: [] } : commit
  const groups = branchesHere.map((branch) => branchItems(branch, ctx, actions)).filter((group) => group.length > 0)
  if (branchesHere.length === 0 && target.hash !== ctx.headHash) {
    groups.push(integrateItems({ ref: target.hash, label: `commit ${target.hash.slice(0, 7)}` }, ctx, actions))
  }
  return [
    ...groups,
    commitItems(target, ctx, actions),
    rewriteItems(target, ctx, actions),
    inspectItems(target, ctx, actions),
    [
      { key: 'copy', label: 'Copy commit hash', hint: target.hash.slice(0, 7), onSelect: () => actions.copyHash(target.hash) },
      ...customItems('commit', { sha: target.hash }, ctx, actions)
    ]
  ].filter((group) => group.length > 0)
}
