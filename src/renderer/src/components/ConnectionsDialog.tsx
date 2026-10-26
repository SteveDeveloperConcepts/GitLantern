import { useEffect, useState } from 'react'
import { PROVIDERS, providerInfo, normalizeHost, type ProviderId } from '../../../shared/providers'
import type { Account, ConnectionTest, SignInProgress, SshKeyInfo } from '../../../shared/types'
import { errorMessage } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const api = window.api
const SSH_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'ssh.dev.azure.com']

const SHORT: Record<ProviderId, string> = { github: 'GH', gitlab: 'GL', bitbucket: 'BB', azure: 'AZ', gitea: 'GT', generic: 'G' }

interface Props {
  onClose(): void
  /** Accounts were added or removed. */
  onChanged(): void
  /** Open the connect form for this service straight away. */
  initialProvider?: ProviderId
}

export function ConnectionsDialog({ onClose, onChanged, initialProvider }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [provider, setProvider] = useState<ProviderId | null>(initialProvider ?? null)
  const [browserHosts, setBrowserHosts] = useState<string[]>([])
  const reload = () => void api.accounts.list().then(setAccounts)
  useEffect(reload, [])
  useEffect(() => {
    void api.accounts.browserSignInHosts().then(setBrowserHosts)
  }, [])

  return (
    <Modal title="Git services" onClose={onClose} className="modal-split">
      <div className="connections">
        <section className="connections-main">
          <p className="dim intro">Connect an account once and GitLantern answers sign-in prompts for that server automatically.</p>

          {accounts.length > 0 && (
            <div className="stack">
              <h3>Connected</h3>
              {accounts.map((account) => (
                <div key={account.id} className="account-row">
                  <span className={`account-badge provider-${account.provider}`}>{SHORT[account.provider]}</span>
                  <span className="account-text">
                    <strong>{account.login}</strong>
                    <span className="dim">
                      {providerInfo(account.provider).name} · {account.host}
                      {account.organization ? ` · ${account.organization}` : ''}
                      {account.oauth ? ' · signed in with the browser' : ''}
                    </span>
                  </span>
                  <span className="status-ok">
                    <span className="dot ok" /> Connected
                  </span>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Disconnect ${account.login} on ${account.host}? Its token is deleted from this computer.`)) return
                      void api.accounts.remove(account.id).then(() => {
                        reload()
                        onChanged()
                      })
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="stack">
            <h3>Add a service</h3>
            <div className="provider-grid">
              {PROVIDERS.map((p) => (
                <button key={p.id} className={`provider-tile${provider === p.id ? ' selected' : ''}`} onClick={() => setProvider(p.id)}>
                  <strong>{p.name}</strong>
                  <span className="dim">{p.note}</span>
                </button>
              ))}
            </div>
          </div>

          <SshKeyCard accountHosts={accounts.map((a) => a.host)} />
        </section>

        <aside className="connections-side">
          {provider ? (
            <ConnectForm
              key={provider}
              provider={provider}
              browserHosts={browserHosts}
              onCancel={() => setProvider(null)}
              onConnected={() => {
                setProvider(null)
                reload()
                onChanged()
              }}
            />
          ) : (
            <div className="connect-intro">
              <h3>How it works</h3>
              <p>
                <strong>HTTPS addresses</strong> (https://…) sign in with an access token. Pick your service on the left, create a token
                there and paste it in. GitLantern stores it encrypted with your system keychain and uses it only for that server.
              </p>
              <p>
                <strong>SSH addresses</strong> (git@…) use your SSH key. Add the public key to each service once and every push and pull
                just works.
              </p>
              <p className="dim">Any Git server works. Use “Other Git server” if yours isn’t listed.</p>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  )
}

interface ConnectFormProps {
  provider: ProviderId
  /** Servers with browser sign-in. */
  browserHosts: string[]
  onCancel(): void
  onConnected(): void
}

function ConnectForm({ provider, browserHosts, onCancel, onConnected }: ConnectFormProps) {
  const info = providerInfo(provider)
  const [host, setHost] = useState(info.defaultHost)
  const [token, setToken] = useState('')
  const [organization, setOrganization] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'browser' | { error: string }>('idle')
  const [progress, setProgress] = useState<SignInProgress | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => api.accounts.onSignInProgress(setProgress), [])
  // Leaving the form gives up on a sign-in still waiting for the browser.
  useEffect(() => () => void api.accounts.cancelSignIn(), [])
  const browserSignIn = info.browserSignIn !== undefined && browserHosts.includes(normalizeHost(host))

  const tokenUrl = info.tokenUrl(normalizeHost(host), organization.trim() || undefined)
  const ready =
    token.trim() !== '' &&
    normalizeHost(host) !== '' &&
    (!info.needs.organization || organization.trim() !== '') &&
    (!info.needs.email || email.trim() !== '') &&
    (!info.needs.username || username.trim() !== '')

  const connect = async () => {
    setState('checking')
    try {
      await api.accounts.connect({ provider, host, token, organization, email, username })
      onConnected()
    } catch (error) {
      setState({ error: errorMessage(error) })
    }
  }

  const signIn = async () => {
    setState('browser')
    setProgress(null)
    setCopied(false)
    try {
      await api.accounts.signIn(provider, host)
      onConnected()
    } catch (error) {
      const message = errorMessage(error)
      setState(message === 'Sign-in cancelled' ? 'idle' : { error: message })
    }
  }

  if (state === 'browser') {
    return (
      <div className="form">
        <h3 className="form-title">Sign in to {info.name}</h3>
        {progress?.userCode ? (
          <>
            <p className="dialog-text">Your browser opened {new URL(progress.url).host}. Enter this code there, then approve GitLantern:</p>
            <div className="user-code mono selectable">{progress.userCode}</div>
            <div className="row-wrap">
              <button onClick={() => void api.clipboard.write(progress.userCode ?? '').then(() => setCopied(true))}>
                <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy code'}
              </button>
              <a href={progress.url} target="_blank" rel="noreferrer">
                Open the page again
              </a>
            </div>
          </>
        ) : (
          <p className="dialog-text">
            <span className="spinner" /> Finish signing in in your browser, then come back here.{' '}
            {progress && (
              <a href={progress.url} target="_blank" rel="noreferrer">
                Open the page again
              </a>
            )}
          </p>
        )}
        <p className="field-hint">GitLantern waits for {info.name} to confirm. The token it gets is encrypted with your system keychain.</p>
        <div className="modal-actions">
          <button type="button" onClick={() => void api.accounts.cancelSignIn()}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) void connect()
      }}
    >
      <h3 className="form-title">Connect {info.name}</h3>
      {browserSignIn && (
        <>
          <button type="button" className="primary large" onClick={() => void signIn()}>
            Sign in with {info.name} in your browser
          </button>
          <div className="or-divider">or use an access token</div>
        </>
      )}
      {info.hostEditable && (
        <div className="field">
          <label htmlFor="connect-host">Server</label>
          <input id="connect-host" value={host} placeholder="git.example.com" onChange={(event) => setHost(event.target.value)} />
          {info.hostHint && <span className="field-hint">{info.hostHint}</span>}
        </div>
      )}
      {info.needs.organization && (
        <div className="field">
          <label htmlFor="connect-org">Organization</label>
          <input id="connect-org" value={organization} placeholder="contoso" onChange={(event) => setOrganization(event.target.value)} />
          <span className="field-hint">The name after dev.azure.com/ in your project addresses.</span>
        </div>
      )}
      {info.needs.email && (
        <div className="field">
          <label htmlFor="connect-email">Atlassian account email</label>
          <input id="connect-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
      )}
      {info.needs.username && (
        <div className="field">
          <label htmlFor="connect-user">Username</label>
          <input id="connect-user" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="connect-token">{info.tokenLabel}</label>
        <input
          id="connect-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => {
            setToken(event.target.value)
            setState('idle')
          }}
        />
      </div>

      <ol className="steps">
        <li>
          {tokenUrl ? (
            <a href={tokenUrl} target="_blank" rel="noreferrer">
              Open the token page on {new URL(tokenUrl).host}
            </a>
          ) : info.needs.organization ? (
            'Enter your organization, then open its token page.'
          ) : provider === 'generic' ? (
            'Find the access-token or password settings on your server.'
          ) : (
            'Enter your server address to get a link to its token page.'
          )}
        </li>
        <li>Give it these permissions: {info.scopes}.</li>
        <li>Create it, copy it and paste it above.</li>
      </ol>

      {typeof state === 'object' && <p className="panel-error">{state.error}</p>}
      <p className="field-hint">The token is encrypted with your system keychain and only used for {normalizeHost(host) || 'this server'}.</p>

      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!ready || state === 'checking'}>
          {state === 'checking' ? 'Checking…' : 'Connect'}
        </button>
      </div>
    </form>
  )
}

function SshKeyCard({ accountHosts }: { accountHosts: string[] }) {
  const [key, setKey] = useState<SshKeyInfo | null | undefined>(undefined)
  const [host, setHost] = useState('github.com')
  const [result, setResult] = useState<ConnectionTest | 'running' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const hosts = [...new Set([...SSH_HOSTS, ...accountHosts.filter((h) => h !== 'dev.azure.com')])]

  useEffect(() => {
    void api.ssh.key().then(setKey)
  }, [])

  const generate = async () => {
    try {
      setKey(await api.ssh.generate('git-steve'))
      setNotice('Key created. Copy it and add it to each service’s SSH key settings.')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  const test = async () => {
    setResult('running')
    try {
      setResult(await api.ssh.test(host))
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error) })
    }
  }

  return (
    <div className="ssh-card">
      <div className="ssh-head">
        <Icon name="key" size={18} className="accent" />
        <h3 className="plain">SSH key</h3>
        {key !== undefined && <span className={`chip ${key ? 'chip-ok' : ''}`}>{key ? 'Found' : 'None yet'}</span>}
      </div>
      <p className="dim">
        For remotes that start with <span className="mono">git@</span>. Add the public key to each service once.
      </p>
      {key ? (
        <>
          <div className="key-box mono selectable" title={key.path}>
            {key.publicKey}
          </div>
          {key.warning && (
            <span className="test-fail">
              <Icon name="warning" size={15} /> {key.warning}
            </span>
          )}
          <div className="row-wrap">
            <button
              onClick={() => void api.clipboard.write(key.publicKey).then(() => setNotice('Public key copied.'))}
            >
              <Icon name="copy" size={15} /> Copy public key
            </button>
            <select aria-label="Server to test" value={host} onChange={(event) => setHost(event.target.value)}>
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <button onClick={() => void test()} disabled={result === 'running'}>
              Test
            </button>
          </div>
        </>
      ) : (
        key === null && (
          <div className="row-wrap">
            <button onClick={() => void generate()}>
              <Icon name="key" size={15} /> Create an SSH key
            </button>
            <span className="dim">Saved as ~/.ssh/id_ed25519, without a passphrase.</span>
          </div>
        )
      )}
      {result === 'running' && (
        <span className="dim">
          <span className="spinner" /> Connecting to {host}…
        </span>
      )}
      {result && result !== 'running' && (
        <span className={result.ok ? 'test-ok' : 'test-fail'}>
          <Icon name={result.ok ? 'check' : 'warning'} size={15} /> {result.message}
        </span>
      )}
      {notice && <span className="dim">{notice}</span>}
    </div>
  )
}
