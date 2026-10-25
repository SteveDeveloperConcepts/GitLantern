import { useEffect, useState } from 'react'
import type { Branch } from '../../../shared/types'

const api = window.api

interface Props {
  branches: Branch[]
  onCheckout(branch: Branch): void
  /** Single click: jump to the branch's commit in the graph. */
  onSelect(branch: Branch): void
  onContextMenu(branch: Branch, position: { x: number; y: number }): void
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

export function BranchesPanel({ branches, onCheckout, onSelect, onContextMenu }: Props) {
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
      <p className="hint">Double-click a branch to check it out. Right-click to merge or rebase.</p>
      <SavedCredentials />
    </div>
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
