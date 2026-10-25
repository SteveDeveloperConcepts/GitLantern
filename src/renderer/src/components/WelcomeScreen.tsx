import { useEffect, useState } from 'react'
import type { RepoInfo } from '../../../shared/types'
import { Icon } from './Icon'

const api = window.api
const SERVICES = ['GitHub', 'GitLab', 'Bitbucket', 'Azure DevOps', 'Gitea / Forgejo', 'Any server over HTTPS or SSH']

interface Props {
  onPick(): void
  onOpen(path: string): void
  onClone(): void
  onConnect(): void
}

export function WelcomeScreen({ onPick, onOpen, onClone, onConnect }: Props) {
  const [recent, setRecent] = useState<RepoInfo[]>([])

  useEffect(() => {
    api.repo.recent().then(setRecent, () => setRecent([]))
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <span className="brand-mark large" aria-hidden="true" />
          <div>
            <h1>Git Steve</h1>
            <p className="dim">Open a project, clone one from any Git service, or connect your accounts.</p>
          </div>
        </div>

        <div className="action-cards">
          <button className="action-card primary-card" onClick={onPick}>
            <span className="action-icon tone-amber">
              <Icon name="folder" size={18} />
            </span>
            <span className="action-title">Open a repository</span>
            <span className="dim">Pick a folder on this computer that already has a Git project in it.</span>
          </button>
          <button className="action-card" onClick={onClone}>
            <span className="action-icon tone-blue">
              <Icon name="clone" size={18} />
            </span>
            <span className="action-title">Clone a repository</span>
            <span className="dim">Paste an HTTPS or SSH address, or pick from one of your connected accounts.</span>
          </button>
          <button className="action-card" onClick={onConnect}>
            <span className="action-icon tone-green">
              <Icon name="link" size={18} />
            </span>
            <span className="action-title">Connect a Git service</span>
            <span className="dim">Sign in once with a token or SSH key so pushes and pulls just work.</span>
          </button>
        </div>

        {recent.length > 0 && (
          <section className="recent">
            <h3>Recent</h3>
            <ul className="recent-list">
              {recent.map((repo) => (
                <li key={repo.path}>
                  <button className="recent-item" onClick={() => onOpen(repo.path)}>
                    <span className="recent-letter" aria-hidden="true">
                      {repo.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="recent-text">
                      <span className="recent-name">{repo.name}</span>
                      <span className="recent-path">{repo.path}</span>
                    </span>
                    {repo.service && <span className="chip">{repo.service}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="works-with">
          <span className="dim">Works with</span>
          {SERVICES.map((service) => (
            <span key={service} className="pill">
              {service}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
