import type { RepoInfo, Workspace } from '../../../shared/types'
import { Icon } from './Icon'
import { Menu } from './Menu'

interface Props {
  tabs: RepoInfo[]
  /** The repository shown, or null for the start screen (the + tab). */
  active: string | null
  workspaces: Workspace[]
  onSelect(path: string | null): void
  onClose(path: string): void
  onOpenWorkspace(workspace: Workspace): void
  onSaveWorkspace(): void
  onManageWorkspaces(): void
}

/** One tab per open repository, a + tab for the start screen, and the workspaces menu. */
export function TabBar({ tabs, active, workspaces, onSelect, onClose, onOpenWorkspace, onSaveWorkspace, onManageWorkspaces }: Props) {
  return (
    <nav className="tabbar" aria-label="Open repositories">
      <div className="tabbar-tabs" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.path}
            role="tab"
            aria-selected={tab.path === active}
            className={`repo-tab${tab.path === active ? ' active' : ''}`}
            title={tab.path}
            tabIndex={0}
            onClick={() => onSelect(tab.path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(tab.path)
            }}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(tab.path)
            }}
          >
            <span className="repo-tab-letter" aria-hidden="true">
              {tab.name.charAt(0).toUpperCase()}
            </span>
            <span className="ellipsis">{tab.name}</span>
            <button
              className="repo-tab-close"
              aria-label={`Close ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.path)
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button className={`repo-tab new${active === null ? ' active' : ''}`} aria-label="Open another repository" title="Open another repository" onClick={() => onSelect(null)}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <Menu
        label="Workspaces"
        triggerClassName="bar-button plain small"
        trigger={
          <>
            <Icon name="layers" size={14} /> Workspaces
          </>
        }
        groups={[
          workspaces.map((workspace) => ({
            key: workspace.id,
            label: workspace.name,
            hint: `${workspace.repos.length} repo${workspace.repos.length === 1 ? '' : 's'}`,
            onSelect: () => onOpenWorkspace(workspace)
          })),
          [
            { key: 'save', label: 'Save open tabs as a workspace', disabled: tabs.length === 0, onSelect: onSaveWorkspace },
            { key: 'manage', label: 'Manage workspaces…', onSelect: onManageWorkspaces }
          ]
        ]}
      />
    </nav>
  )
}
