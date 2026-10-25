import { useState } from 'react'
import type { Branch, RepoInfo, RepoStatus } from '../../../shared/types'
import { Icon } from './Icon'
import { Menu } from './Menu'

const api = window.api

interface Props {
  repo: RepoInfo
  status: RepoStatus | null
  branches: Branch[]
  busy: boolean
  accountCount: number
  onOpen(): void
  onOpenRecent(path: string): void
  onClone(): void
  onCheckout(branch: Branch): void
  onNewBranch(): void
  onFetch(): void
  onPull(): void
  onPush(): void
  onAccounts(): void
}

export function TopBar(props: Props) {
  const { repo, status, branches, busy, accountCount } = props
  const [recent, setRecent] = useState<RepoInfo[]>([])
  const head = status?.branch.head ?? (status?.branch.oid ? `detached ${status.branch.oid.slice(0, 7)}` : '…')
  const ahead = status?.branch.ahead ?? 0
  const behind = status?.branch.behind ?? 0

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Git Steve
      </div>
      <span className="divider" aria-hidden="true" />

      <Menu
        label={`Repository ${repo.name}`}
        triggerClassName="bar-button plain strong"
        trigger={
          <>
            <Icon name="folder" className="dim" />
            {repo.name}
            <Icon name="chevron" size={12} className="dim" />
          </>
        }
        onOpen={() => {
          api.repo.recent().then(setRecent, () => setRecent([]))
        }}
        groups={[
          [
            { key: 'open', label: 'Open repository…', onSelect: props.onOpen },
            { key: 'clone', label: 'Clone repository…', onSelect: props.onClone }
          ],
          recent
            .filter((r) => r.path !== repo.path)
            .slice(0, 8)
            .map((r) => ({ key: r.path, label: r.name, hint: r.service ?? '', onSelect: () => props.onOpenRecent(r.path) }))
        ]}
      />

      <Menu
        label={`Branch ${head}`}
        triggerClassName="bar-button"
        trigger={
          <>
            <Icon name="branch" className="accent" />
            {head}
            <Icon name="chevron" size={12} className="dim" />
          </>
        }
        groups={[
          branches
            .filter((b) => b.kind === 'local')
            .map((b) => ({ key: b.fullName, label: b.name, checked: b.isCurrent, onSelect: () => !b.isCurrent && props.onCheckout(b) })),
          [{ key: 'new', label: 'New branch…', onSelect: props.onNewBranch }]
        ]}
      />

      <div className="spacer" />

      <div className="segmented" role="group" aria-label="Sync">
        <button onClick={props.onFetch} disabled={busy} title="Download new commits from every remote">
          <Icon name="fetch" size={15} /> Fetch
        </button>
        <button onClick={props.onPull} disabled={busy} title="Fast-forward to the remote branch">
          <Icon name="pull" size={15} /> Pull
          {behind > 0 && <span className="badge info">{behind}</span>}
        </button>
        <button onClick={props.onPush} disabled={busy} title="Upload your commits">
          <Icon name="push" size={15} /> Push
          {ahead > 0 && <span className="badge accent">{ahead}</span>}
        </button>
      </div>
      <button className="bar-button" onClick={props.onNewBranch} disabled={busy}>
        <Icon name="plus" size={15} /> Branch
      </button>
      <span className="divider" aria-hidden="true" />
      <button className="bar-button plain" onClick={props.onAccounts} title="Git services and accounts">
        <Icon name="link" /> Accounts
        {accountCount > 0 && <span className="dot ok" aria-label={`${accountCount} connected`} />}
      </button>
    </header>
  )
}
