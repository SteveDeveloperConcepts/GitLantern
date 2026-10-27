import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import type { Branch, Stash, Submodule, Tag, Worktree } from '../../../shared/types'
import { formatRelative } from '../format'
import { Icon } from './Icon'

const api = window.api

interface Props {
  branches: Branch[]
  onCheckout(branch: Branch): void
  /** Single click: jump to the branch's commit in the graph. */
  onSelect(branch: Branch): void
  onContextMenu(branch: Branch, position: { x: number; y: number }): void
}

interface StashProps {
  stashes: Stash[]
  /** The stash whose changes are open below the graph. */
  selectedStash: string | null
  onSelectStash(stash: Stash): void
  /** Double-click: apply it. */
  onApplyStash(stash: Stash): void
  onStashMenu(stash: Stash, position: { x: number; y: number }): void
}

type Position = { x: number; y: number }

/** Tags, worktrees and submodules: each listed with what can be done to it. */
interface StructureProps {
  tags: Tag[]
  onSelectTag(tag: Tag): void
  onTagMenu(tag: Tag, position: Position): void
  worktrees: Worktree[]
  onOpenWorktree(worktree: Worktree): void
  onWorktreeMenu(worktree: Worktree, position: Position): void
  onNewWorktree(): void
  submodules: Submodule[]
  onOpenSubmodule(submodule: Submodule): void
  onSubmoduleMenu(submodule: Submodule, position: Position): void
  onNewSubmodule(): void
  onUpdateSubmodules(): void
}

const contextMenu = (handler: (position: Position) => void) => (event: MouseEvent) => {
  event.preventDefault()
  handler({ x: event.clientX, y: event.clientY })
}

/** A section that folds away; the folded ones are remembered while the app runs. */
const folded = new Set<string>(['tags'])
function Section({ id, title, actions, children }: { id: string; title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(!folded.has(id))
  return (
    <section className="panel-section">
      <h3 className="section-head">
        <button
          className="section-toggle"
          aria-expanded={open}
          onClick={() => {
            if (open) folded.add(id)
            else folded.delete(id)
            setOpen(!open)
          }}
        >
          <Icon name="chevron" size={12} className={open ? '' : 'rotated'} />
          {title}
        </button>
        {actions}
      </h3>
      {open && children}
    </section>
  )
}

function groupRemotes(branches: Branch[]): Map<string, Branch[]> {
  const groups = new Map<string, Branch[]>()
  for (const branch of branches) {
    if (branch.kind !== 'remote') continue
    const remote = branch.name.slice(0, branch.name.indexOf('/'))
    groups.set(remote, [...(groups.get(remote) ?? []), branch])
  }
  return groups
}

function BranchItem({ branch, label, onCheckout, onSelect, onContextMenu }: { branch: Branch; label: string } & Omit<Props, 'branches'>) {
  return (
    <li
      className={`branch-item${branch.isCurrent ? ' current' : ''}`}
      title={`${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ''}\nDouble-click to check out, right-click to merge or rebase`}
      onClick={() => onSelect(branch)}
      onDoubleClick={() => onCheckout(branch)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(branch, { x: event.clientX, y: event.clientY })
      }}
    >
      <span className="branch-dot" aria-hidden="true" />
      {label}
    </li>
  )
}

export function BranchesPanel({ branches, onCheckout, onSelect, onContextMenu, ...rest }: Props & StashProps & StructureProps) {
  const { tags, onSelectTag, onTagMenu, worktrees, onOpenWorktree, onWorktreeMenu, onNewWorktree } = rest
  const { submodules, onOpenSubmodule, onSubmoduleMenu, onNewSubmodule, onUpdateSubmodules, ...stashProps } = rest
  const local = branches.filter((b) => b.kind === 'local')
  const remotes = groupRemotes(branches)

  return (
    <div className="branches-panel">
      <section>
        <h3>Local · {local.length}</h3>
        <ul>
          {local.map((branch) => (
            <BranchItem
              key={branch.fullName}
              branch={branch}
              label={branch.name}
              onCheckout={onCheckout}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </ul>
      </section>
      {[...remotes].map(([remote, list]) => (
        <section key={remote}>
          <h3>
            {remote} · {list.length}
          </h3>
          <ul>
            {list.map((branch) => (
              <BranchItem
                key={branch.fullName}
                branch={branch}
                label={branch.name.slice(remote.length + 1)}
                onCheckout={onCheckout}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
              />
            ))}
          </ul>
        </section>
      ))}
      <p className="hint">Double-click a branch to check it out. Right-click to merge, rebase, rename or delete it.</p>
      <Section id="tags" title={`Tags · ${tags.length}`}>
        {tags.length === 0 ? (
          <p className="hint">No tags yet. Right-click a commit in the graph to tag it.</p>
        ) : (
          <ul>
            {tags.map((tag) => (
              <li
                key={tag.name}
                className="branch-item tag-item"
                title={`${tag.name}${tag.message ? `
${tag.message}` : ''}
Click to show it in the graph, right-click to push or delete it`}
                onClick={() => onSelectTag(tag)}
                onContextMenu={contextMenu((position) => onTagMenu(tag, position))}
              >
                <Icon name="tag" size={12} className="dim" />
                <span className="ellipsis">{tag.name}</span>
                <span className="item-meta">{tag.annotated ? formatRelative(tag.date) : 'lightweight'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        id="worktrees"
        title={`Worktrees · ${worktrees.length}`}
        actions={
          <button className="link" onClick={onNewWorktree}>
            New…
          </button>
        }
      >
        <ul>
          {worktrees.map((worktree) => (
            <li
              key={worktree.path}
              className={`branch-item${worktree.isCurrent ? ' current' : ''}`}
              title={`${worktree.path}
${worktree.isCurrent ? 'Open in this tab' : 'Double-click to open it in a new tab'}`}
              onDoubleClick={() => !worktree.isCurrent && onOpenWorktree(worktree)}
              onContextMenu={contextMenu((position) => onWorktreeMenu(worktree, position))}
            >
              <span className="branch-dot" aria-hidden="true" />
              <span className="ellipsis">{worktree.branch ?? `detached ${worktree.head?.slice(0, 7) ?? ''}`}</span>
              <span className="item-meta ellipsis">
                {worktree.isMain ? 'main · ' : ''}
                {worktree.locked ? 'locked · ' : ''}
                {worktree.prunable ? 'missing · ' : ''}
                {worktree.path.split(/[\\/]/).at(-1)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section
        id="submodules"
        title={`Submodules · ${submodules.length}`}
        actions={
          <span>
            {submodules.length > 0 && (
              <button className="link" onClick={onUpdateSubmodules} title="git submodule update --init --recursive">
                Update all
              </button>
            )}
            <button className="link" onClick={onNewSubmodule}>
              Add…
            </button>
          </span>
        }
      >
        {submodules.length === 0 ? (
          <p className="hint">None. A submodule is another repository kept inside this one.</p>
        ) : (
          <ul>
            {submodules.map((submodule) => (
              <li
                key={submodule.path}
                className="branch-item"
                title={`${submodule.url}
Double-click to open it in a new tab`}
                onDoubleClick={() => submodule.state !== 'uninitialized' && onOpenSubmodule(submodule)}
                onContextMenu={contextMenu((position) => onSubmoduleMenu(submodule, position))}
              >
                <Icon name="box" size={12} className="dim" />
                <span className="ellipsis">{submodule.path}</span>
                <span className={`item-meta state-${submodule.state}`}>
                  {submodule.state === 'ok' ? submodule.hash.slice(0, 7) : submodule.state === 'uninitialized' ? 'not cloned' : submodule.state}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Stashes {...stashProps} />
      <SavedCredentials />
    </div>
  )
}

function Stashes({ stashes, selectedStash, onSelectStash, onApplyStash, onStashMenu }: StashProps) {
  if (stashes.length === 0) return null
  return (
    <section className="stashes">
      <h3>Stashes · {stashes.length}</h3>
      <ul>
        {stashes.map((stash) => (
          <li
            key={stash.hash}
            className={`stash-item${stash.hash === selectedStash ? ' selected' : ''}`}
            title={`${stash.message}
Double-click to apply, right-click for more`}
            onClick={() => onSelectStash(stash)}
            onDoubleClick={() => onApplyStash(stash)}
            onContextMenu={(event) => {
              event.preventDefault()
              onStashMenu(stash, { x: event.clientX, y: event.clientY })
            }}
          >
            <span className="ellipsis">{stash.message}</span>
            <span className="stash-meta">
              {stash.branch ? `${stash.branch} · ` : ''}
              {formatRelative(stash.date)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SavedCredentials() {
  const [available, setAvailable] = useState(true)
  const [count, setCount] = useState(0)

  const reload = () => {
    void api.secrets.available().then(setAvailable)
    void api.secrets.count().then(setCount)
  }
  useEffect(reload, [])

  return (
    <footer className="credentials">
      {available ? (
        <>
          <span>
            {count} saved credential{count === 1 ? '' : 's'}
          </span>
          <button className="link" disabled={count === 0} onClick={() => void api.secrets.clear().then(reload)}>
            Forget all
          </button>
        </>
      ) : (
        <span title="OS-backed encryption (safeStorage) is not available, so nothing is saved">
          Credential saving unavailable
        </span>
      )}
    </footer>
  )
}
