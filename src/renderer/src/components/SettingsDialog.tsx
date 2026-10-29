import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  CommitTemplate,
  CustomAction,
  CustomActionScope,
  ExternalTools,
  GitConfigKey,
  GitIdentity,
  IssueLinkRule,
  ThemeMode,
  UserSettings,
  Workspace
} from '../../../shared/types'
import { errorMessage } from '../format'
import { Modal } from './Modal'

const api = window.api

type Section = 'appearance' | 'git' | 'commits' | 'ai' | 'tools' | 'actions' | 'links' | 'workspaces'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'git', label: 'Git' },
  { id: 'commits', label: 'Commits' },
  { id: 'ai', label: 'AI' },
  { id: 'tools', label: 'Tools' },
  { id: 'actions', label: 'Custom actions' },
  { id: 'links', label: 'Issue links' },
  { id: 'workspaces', label: 'Workspaces' }
]

const ACCENTS = ['#e8a33d', '#4cc38a', '#6aa9ff', '#e5649a', '#a78bfa', '#2fb8b8', '#f07c4a']
// The theme colours that can be overridden, with what they're used for.
const COLOR_VARIABLES: { name: string; label: string }[] = [
  { name: '--bg', label: 'Window' },
  { name: '--bg-panel', label: 'Panels' },
  { name: '--bg-side', label: 'Side panel' },
  { name: '--bg-elev', label: 'Buttons and dialogs' },
  { name: '--border', label: 'Borders' },
  { name: '--text', label: 'Text' },
  { name: '--text-dim', label: 'Secondary text' },
  { name: '--ok', label: 'Added / good' },
  { name: '--danger', label: 'Removed / danger' },
  { name: '--info', label: 'Information' }
]
const DIFF_TOOLS = ['vscode', 'meld', 'kdiff3', 'bc', 'p4merge', 'opendiff', 'winmerge', 'tortoisemerge', 'vimdiff']
const SCOPES: { scope: CustomActionScope; label: string }[] = [
  { scope: 'repository', label: 'Repository (Tools menu)' },
  { scope: 'commit', label: 'Commit (right-click in the graph)' },
  { scope: 'branch', label: 'Branch (right-click a branch)' },
  { scope: 'file', label: 'File (right-click a changed file)' }
]

const newId = (): string => crypto.randomUUID()

interface Props {
  settings: UserSettings
  /** Save some settings straight away. */
  onChange(patch: Partial<UserSettings>): void
  /** The repository in the active tab, for its own Git settings; null on the start screen. */
  repoPath: string | null
  /** Repositories open as tabs, to make a workspace from. */
  openTabs: string[]
  onClose(): void
  initialSection?: Section
}

/** Everything GitLantern lets you change, saved as you go. */
export function SettingsDialog({ settings, onChange, repoPath, openTabs, onClose, initialSection = 'appearance' }: Props) {
  const [section, setSection] = useState<Section>(initialSection)
  return (
    <Modal title="Settings" onClose={onClose} className="modal-full settings">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {section === 'appearance' && <Appearance settings={settings} onChange={onChange} />}
          {section === 'git' && <GitSection settings={settings} onChange={onChange} repoPath={repoPath} />}
          {section === 'commits' && <Commits settings={settings} onChange={onChange} />}
          {section === 'ai' && <Ai settings={settings} onChange={onChange} />}
          {section === 'tools' && <Tools settings={settings} onChange={onChange} />}
          {section === 'actions' && <Actions settings={settings} onChange={onChange} />}
          {section === 'links' && <Links settings={settings} onChange={onChange} />}
          {section === 'workspaces' && <Workspaces settings={settings} onChange={onChange} openTabs={openTabs} />}
        </div>
      </div>
    </Modal>
  )
}

type SectionProps = Pick<Props, 'settings' | 'onChange'>

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  )
}

/** A text field that saves when it loses focus (or on Enter), not on every key. */
function TextSetting({ value, onSave, ...rest }: { value: string; onSave(value: string): void; placeholder?: string; type?: string; className?: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      {...rest}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
      }}
    />
  )
}

function Appearance({ settings, onChange }: SectionProps) {
  return (
    <>
      <h3>Appearance</h3>
      <Row label="Theme" hint="System follows your computer’s light or dark setting.">
        <div className="segmented" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as ThemeMode[]).map((theme) => (
            <button key={theme} aria-pressed={settings.theme === theme} onClick={() => onChange({ theme })}>
              {theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Accent colour">
        <div className="swatches">
          {ACCENTS.map((color) => (
            <button
              key={color}
              className={`swatch${settings.accent === color ? ' selected' : ''}`}
              style={{ background: color }}
              aria-label={`Accent ${color}`}
              onClick={() => onChange({ accent: color })}
            />
          ))}
          <input type="color" value={settings.accent || '#e8a33d'} onChange={(event) => onChange({ accent: event.target.value })} aria-label="Custom accent" />
          <button className="link" disabled={!settings.accent} onClick={() => onChange({ accent: '' })}>
            Default
          </button>
        </div>
      </Row>
      <Row label="Interface size" hint={`${settings.zoom}%`}>
        <input type="range" min={80} max={150} step={5} value={settings.zoom} onChange={(event) => onChange({ zoom: Number(event.target.value) })} aria-label="Interface size" />
      </Row>
      <Row label="Custom colours" hint="Override the theme’s own colours. They apply to light and dark alike.">
        <div className="color-grid">
          {COLOR_VARIABLES.map(({ name, label }) => {
            const value = settings.colors[name]
            return (
              <label key={name} className={`color-setting${value ? ' set' : ''}`}>
                <input
                  type="color"
                  value={value ?? (getComputedStyle(document.documentElement).getPropertyValue(name).trim().slice(0, 7) || '#000000')}
                  onChange={(event) => onChange({ colors: { ...settings.colors, [name]: event.target.value } })}
                />
                <span>{label}</span>
                {value && (
                  <button
                    className="link"
                    onClick={(event) => {
                      event.preventDefault()
                      const { [name]: _removed, ...rest } = settings.colors
                      onChange({ colors: rest })
                    }}
                  >
                    Reset
                  </button>
                )}
              </label>
            )
          })}
        </div>
        {Object.keys(settings.colors).length > 0 && (
          <button className="link left" onClick={() => onChange({ colors: {} })}>
            Reset all colours
          </button>
        )}
      </Row>
    </>
  )
}

function GitSection({ settings, onChange, repoPath }: SectionProps & { repoPath: string | null }) {
  const [identity, setIdentity] = useState<{ local: Partial<GitIdentity>; global: GitIdentity } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = () => {
    if (repoPath) api.git.identity(repoPath).then(setIdentity, (err: unknown) => setError(errorMessage(err)))
  }
  useEffect(reload, [repoPath])
  const save = (scope: 'local' | 'global', key: GitConfigKey, value: string | null) =>
    void api.git
      .setConfig(scope === 'global' ? null : repoPath, key, value)
      .then(reload)
      .catch((err: unknown) => setError(errorMessage(err)))
  const importIdentity = () =>
    void api.git
      .importIdentity()
      .then(reload)
      .catch((err: unknown) => setError(errorMessage(err)))

  return (
    <>
      <h3>Git</h3>
      {api.appStore ? (
        <Row label="Git program" hint="This version of GitLantern comes with its own Git and Git LFS.">
          <span>Built in</span>
        </Row>
      ) : (
        <Row label="Git program" hint="Takes effect after a restart.">
          <span className="mono">{settings.gitPath || 'The git on your PATH'}</span>
          <span className="row-wrap">
            <button onClick={() => void api.settings.chooseGit(false).catch((err: unknown) => setError(errorMessage(err)))}>Choose…</button>
            {settings.gitPath && (
              <button className="link" onClick={() => void api.settings.chooseGit(true)}>
                Use the one on PATH
              </button>
            )}
          </span>
        </Row>
      )}
      <Row label="Fetch automatically" hint="Fetches every remote in the background while a repository is open.">
        <select value={settings.autoFetchMinutes} onChange={(event) => onChange({ autoFetchMinutes: Number(event.target.value) })}>
          <option value={0}>Off</option>
          {[5, 10, 15, 30, 60].map((minutes) => (
            <option key={minutes} value={minutes}>
              Every {minutes} minutes
            </option>
          ))}
        </select>
      </Row>
      {error && <p className="test-fail">{error}</p>}
      {!repoPath && <p className="dim">Open a repository to change your name, email and signing here.</p>}
      {identity && (
        <>
          <h4>Who commits</h4>
          {api.appStore && (
            <Row label="From your Git settings" hint="macOS keeps App Store apps out of ~/.gitconfig, so GitLantern’s Git has settings of its own.">
              <button onClick={importIdentity}>Copy name and email from ~/.gitconfig…</button>
            </Row>
          )}
          <Row label="Name" hint="Everywhere (global). A repository can use its own below.">
            <TextSetting value={identity.global.userName} placeholder="Your Name" onSave={(value) => save('global', 'user.name', value.trim() || null)} />
          </Row>
          <Row label="Email">
            <TextSetting value={identity.global.userEmail} placeholder="you@example.com" onSave={(value) => save('global', 'user.email', value.trim() || null)} />
          </Row>
          <Row label="Name in this repository" hint="Empty: the global one.">
            <TextSetting value={identity.local.userName ?? ''} placeholder={identity.global.userName} onSave={(value) => save('local', 'user.name', value.trim() || null)} />
          </Row>
          <Row label="Email in this repository">
            <TextSetting value={identity.local.userEmail ?? ''} placeholder={identity.global.userEmail} onSave={(value) => save('local', 'user.email', value.trim() || null)} />
          </Row>
          <h4>Signing</h4>
          <p className="hint">
            Git signs with the key in its own settings (user.signingkey, gpg.format), using GPG or SSH. GitLantern shows a signed badge on signed
            commits.
          </p>
          {(['commit.gpgsign', 'tag.gpgsign'] as const).map((key) => {
            const field = key === 'commit.gpgsign' ? 'signCommits' : 'signTags'
            const local = identity.local[field]
            return (
              <Row key={key} label={key === 'commit.gpgsign' ? 'Sign commits' : 'Sign tags'}>
                <label className="checkbox compact">
                  <input type="checkbox" checked={identity.global[field]} onChange={(event) => save('global', key, String(event.target.checked))} />
                  Everywhere
                </label>
                <select
                  value={local === undefined ? '' : String(local)}
                  onChange={(event) => save('local', key, event.target.value || null)}
                  aria-label={`${key} in this repository`}
                >
                  <option value="">This repository: as everywhere</option>
                  <option value="true">This repository: always</option>
                  <option value="false">This repository: never</option>
                </select>
              </Row>
            )
          })}
        </>
      )}
    </>
  )
}

function Commits({ settings, onChange }: SectionProps) {
  const templates = settings.commitTemplates
  const update = (id: string, change: Partial<CommitTemplate>) => onChange({ commitTemplates: templates.map((t) => (t.id === id ? { ...t, ...change } : t)) })
  return (
    <>
      <h3>Commits</h3>
      <Row label="Conventional Commits" hint="Adds a helper above the commit message for feat:, fix: and the other types.">
        <label className="checkbox compact">
          <input type="checkbox" checked={settings.conventionalCommits} onChange={(event) => onChange({ conventionalCommits: event.target.checked })} />
          Show the helper
        </label>
      </Row>
      <h4>Message templates</h4>
      <p className="hint">Pick one from the Templates menu under the commit message. A template from Git’s own commit.template setting is offered too.</p>
      {templates.map((template) => (
        <div key={template.id} className="list-card">
          <div className="row-wrap">
            <TextSetting className="grow" value={template.name} placeholder="Name" onSave={(name) => update(template.id, { name: name || 'Template' })} />
            <button className="link danger" onClick={() => onChange({ commitTemplates: templates.filter((t) => t.id !== template.id) })}>
              Remove
            </button>
          </div>
          <TemplateText value={template.text} onSave={(text) => update(template.id, { text })} />
        </div>
      ))}
      <button onClick={() => onChange({ commitTemplates: [...templates, { id: newId(), name: 'New template', text: 'Summary\n\nWhy:\n\nHow:\n' }] })}>
        Add template
      </button>
    </>
  )
}

function TemplateText({ value, onSave }: { value: string; onSave(value: string): void }) {
  const [draft, setDraft] = useState(value)
  return <textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== value && onSave(draft)} />
}

function Ai({ settings, onChange }: SectionProps) {
  const ai = settings.ai
  /** Where the saved key may go; null when there's none. */
  const [keyOrigin, setKeyOrigin] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void api.settings.aiKeyOrigin().then(setKeyOrigin), [])
  const hasKey = keyOrigin !== null
  const saveKey = (value: string | null) =>
    void api.settings
      .setAiKey(value)
      .then(() => {
        setKey('')
        setError(null)
        return api.settings.aiKeyOrigin().then(setKeyOrigin)
      })
      .catch((err: unknown) => setError(errorMessage(err)))

  return (
    <>
      <h3>AI commit messages</h3>
      <p className="hint">
        The sparkle button under the commit message sends the staged changes to the service below and fills in a message. Nothing is sent until
        you click it.
      </p>
      <Row label="Service">
        <div className="segmented" role="group" aria-label="Service">
          <button aria-pressed={ai.provider === 'anthropic'} onClick={() => onChange({ ai: { ...ai, provider: 'anthropic', model: '' } })}>
            Anthropic (Claude)
          </button>
          <button aria-pressed={ai.provider === 'openai'} onClick={() => onChange({ ai: { ...ai, provider: 'openai', model: '' } })}>
            OpenAI-compatible
          </button>
        </div>
      </Row>
      {ai.provider === 'openai' && (
        <Row label="Address" hint="OpenAI, or any compatible server: Ollama (http://localhost:11434/v1), LM Studio, OpenRouter…">
          <TextSetting value={ai.endpoint} placeholder="https://api.openai.com/v1" onSave={(endpoint) => onChange({ ai: { ...ai, endpoint } })} />
        </Row>
      )}
      <Row label="Model" hint="Empty: the default for the service.">
        <TextSetting value={ai.model} placeholder={ai.provider === 'anthropic' ? 'claude-opus-5-5' : 'gpt-5-mini'} onSave={(model) => onChange({ ai: { ...ai, model } })} />
      </Row>
      <Row
        label="API key"
        hint={
          hasKey
            ? `A key is saved for ${keyOrigin || 'another address'}, encrypted by your system’s keychain. It’s only ever sent there.`
            : 'Saved for the service above, encrypted by your system’s keychain. Local servers may not need one.'
        }
      >
        <form
          className="row-wrap"
          onSubmit={(event) => {
            event.preventDefault()
            if (key.trim()) saveKey(key.trim())
          }}
        >
          <input className="grow" type="password" value={key} placeholder={hasKey ? '••••••••' : 'Paste your key'} onChange={(event) => setKey(event.target.value)} />
          <button type="submit" disabled={!key.trim()}>
            Save key
          </button>
          {hasKey && (
            <button type="button" className="link danger" onClick={() => saveKey(null)}>
              Remove
            </button>
          )}
        </form>
        {error && <p className="test-fail">{error}</p>}
      </Row>
      <Row label="Extra instructions" hint="Added to the request, e.g. “Use Conventional Commits” or “Write in German”.">
        <TemplateText value={ai.instructions} onSave={(instructions) => onChange({ ai: { ...ai, instructions } })} />
      </Row>
    </>
  )
}

function Tools({ settings, onChange }: SectionProps) {
  const [tools, setTools] = useState<ExternalTools | null>(null)
  useEffect(() => void api.tools.list().then(setTools), [])
  return (
    <>
      <h3>Tools</h3>
      <Row label="Editor" hint="Open in editor, from the Tools menu and file menus.">
        <select value={settings.editor} onChange={(event) => onChange({ editor: event.target.value })}>
          <option value="">{tools?.editors[0] ? `First found (${tools.editors[0].name})` : 'None found'}</option>
          {tools?.editors.map((tool) => (
            <option key={tool.id} value={tool.id}>
              {tool.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Terminal">
        <select value={settings.terminal} onChange={(event) => onChange({ terminal: event.target.value })}>
          <option value="">{tools?.terminals[0] ? `First found (${tools.terminals[0].name})` : 'None found'}</option>
          {tools?.terminals.map((tool) => (
            <option key={tool.id} value={tool.id}>
              {tool.name}
            </option>
          ))}
        </select>
      </Row>
      {/* git difftool and mergetool would start the tool inside the App Sandbox, where none of them work. */}
      {!api.appStore && (
        <>
          <Row label="Diff tool" hint="Passed to git difftool --tool. Empty: Git’s own diff.tool setting.">
            <TextSetting value={settings.diffTool} placeholder="vscode, meld, bc…" onSave={(diffTool) => onChange({ diffTool: diffTool.trim() })} />
          </Row>
          <Row label="Merge tool" hint="Passed to git mergetool --tool. Empty: Git’s own merge.tool setting.">
            <TextSetting value={settings.mergeTool} placeholder="vscode, kdiff3, p4merge…" onSave={(mergeTool) => onChange({ mergeTool: mergeTool.trim() })} />
          </Row>
          <p className="hint">Tools Git knows by name: {DIFF_TOOLS.join(', ')}. Others need a difftool.&lt;name&gt;.cmd entry in your Git config.</p>
        </>
      )}
    </>
  )
}

function Actions({ settings, onChange }: SectionProps) {
  const actions = settings.customActions
  const update = (id: string, change: Partial<CustomAction>) => onChange({ customActions: actions.map((a) => (a.id === id ? { ...a, ...change } : a)) })
  return (
    <>
      <h3>Custom actions</h3>
      <p className="hint">
        Your own commands, run without a shell. In the arguments, <span className="mono">{'${REPO}'}</span> is the repository folder,{' '}
        <span className="mono">{'${SHA}'}</span> the commit, <span className="mono">{'${BRANCH}'}</span> the branch and{' '}
        <span className="mono">{'${FILE}'}</span> the file. Output is shown when it finishes.
      </p>
      {api.appStore && (
        <p className="hint">
          In this version they run inside GitLantern’s App Sandbox: they can use the repository and the programs that come with macOS, but
          programs that need more of your Mac may not work.
        </p>
      )}
      {actions.map((action) => (
        <div key={action.id} className="list-card">
          <div className="field-grid">
            <label className="field">
              <span className="field-label">Name</span>
              <TextSetting value={action.name} onSave={(name) => update(action.id, { name: name || 'Action' })} />
            </label>
            <label className="field">
              <span className="field-label">Where it shows</span>
              <select value={action.scope} onChange={(event) => update(action.id, { scope: event.target.value as CustomActionScope })}>
                {SCOPES.map((option) => (
                  <option key={option.scope} value={option.scope}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Program</span>
            <TextSetting value={action.command} placeholder="npm, python, C:\tools\deploy.exe…" onSave={(command) => update(action.id, { command })} />
          </label>
          <label className="field">
            <span className="field-label">Arguments, one per line</span>
            <TemplateText value={action.args.join('\n')} onSave={(text) => update(action.id, { args: text.split('\n').filter((line) => line !== '') })} />
          </label>
          <div className="row-wrap">
            <label className="checkbox compact">
              <input type="checkbox" checked={action.confirm} onChange={(event) => update(action.id, { confirm: event.target.checked })} />
              Ask before running
            </label>
            <span className="spacer" />
            <button className="link danger" onClick={() => onChange({ customActions: actions.filter((a) => a.id !== action.id) })}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({ customActions: [...actions, { id: newId(), name: 'New action', scope: 'repository', command: 'git', args: ['-C', '${REPO}', 'status'], confirm: false }] })
        }
      >
        Add action
      </button>
    </>
  )
}

function Links({ settings, onChange }: SectionProps) {
  const rules = settings.issueLinks
  const update = (id: string, change: Partial<IssueLinkRule>) => onChange({ issueLinks: rules.map((r) => (r.id === id ? { ...r, ...change } : r)) })
  return (
    <>
      <h3>Issue links</h3>
      <p className="hint">
        Turn issue numbers in commit messages into links. #123 already links to the issue on GitHub, GitLab, Gitea and Bitbucket. Add rules for
        Jira and other trackers: a regular expression, and an address where $1 is its first group.
      </p>
      {rules.map((rule) => (
        <div key={rule.id} className="list-card">
          <div className="field-grid">
            <label className="field">
              <span className="field-label">Name</span>
              <TextSetting value={rule.name} placeholder="Jira" onSave={(name) => update(rule.id, { name })} />
            </label>
            <label className="field">
              <span className="field-label">Only for remotes containing</span>
              <TextSetting value={rule.remoteContains} placeholder="Every repository" onSave={(remoteContains) => update(rule.id, { remoteContains })} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Pattern</span>
            <TextSetting className="mono" value={rule.pattern} placeholder="\b([A-Z]+-\d+)\b" onSave={(pattern) => update(rule.id, { pattern })} />
          </label>
          <label className="field">
            <span className="field-label">Address</span>
            <TextSetting className="mono" value={rule.url} placeholder="https://acme.atlassian.net/browse/$1" onSave={(url) => update(rule.id, { url })} />
          </label>
          <button className="link danger left" onClick={() => onChange({ issueLinks: rules.filter((r) => r.id !== rule.id) })}>
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({
            issueLinks: [...rules, { id: newId(), name: 'Jira', pattern: '\\b([A-Z][A-Z0-9]+-\\d+)\\b', url: 'https://your-site.atlassian.net/browse/$1', remoteContains: '' }]
          })
        }
      >
        Add rule
      </button>
    </>
  )
}

function Workspaces({ settings, onChange, openTabs }: SectionProps & { openTabs: string[] }) {
  const workspaces = settings.workspaces
  const update = (id: string, change: Partial<Workspace>) => onChange({ workspaces: workspaces.map((w) => (w.id === id ? { ...w, ...change } : w)) })
  const name = useRef(1)
  return (
    <>
      <h3>Workspaces</h3>
      <p className="hint">A workspace is a set of repositories that open together as tabs. Open one from the menu at the right of the tab bar.</p>
      {workspaces.map((workspace) => (
        <div key={workspace.id} className="list-card">
          <div className="row-wrap">
            <TextSetting className="grow" value={workspace.name} onSave={(value) => update(workspace.id, { name: value || 'Workspace' })} />
            <button onClick={() => update(workspace.id, { repos: [...new Set([...workspace.repos, ...openTabs])] })} disabled={openTabs.length === 0}>
              Add the open tabs
            </button>
            <button className="link danger" onClick={() => onChange({ workspaces: workspaces.filter((w) => w.id !== workspace.id) })}>
              Remove
            </button>
          </div>
          <ul className="plain-list">
            {workspace.repos.length === 0 && <li className="dim">No repositories yet.</li>}
            {workspace.repos.map((repo) => (
              <li key={repo}>
                <span className="mono ellipsis">{repo}</span>
                <button className="link" onClick={() => update(workspace.id, { repos: workspace.repos.filter((r) => r !== repo) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button onClick={() => onChange({ workspaces: [...workspaces, { id: newId(), name: `Workspace ${workspaces.length + name.current++}`, repos: [...openTabs] }] })}>
        New workspace from the open tabs
      </button>
    </>
  )
}
