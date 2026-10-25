import { useState } from 'react'
import { parseRemoteUrl, serviceName } from '../../../shared/remoteUrl'
import type { ConnectionTest, RemoteInfo } from '../../../shared/types'
import { errorMessage } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const api = window.api

interface Props {
  /** Editing an existing remote; otherwise adding one. */
  remote?: RemoteInfo
  suggestedName: string
  onSubmit(name: string, url: string): void
  onCancel(): void
}

/** One line describing what an address is and how Git Steve will authenticate. */
export function describeAddress(url: string): string | null {
  const parsed = parseRemoteUrl(url)
  if (!url.trim()) return null
  if (!parsed) return 'That doesn’t look like a Git address. Try https://host/owner/repo.git or git@host:owner/repo.git.'
  if (parsed.protocol === 'file') return 'A folder on this computer'
  const how = parsed.protocol === 'ssh' ? 'SSH · uses your SSH key' : `${parsed.protocol.toUpperCase()}`
  return `${serviceName(url)} · ${how}`
}

export function RemoteDialog({ remote, suggestedName, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(remote?.name ?? suggestedName)
  const [url, setUrl] = useState(remote?.fetchUrl ?? '')
  const [test, setTest] = useState<ConnectionTest | 'running' | null>(null)
  const valid = name.trim().length > 0 && parseRemoteUrl(url) !== null

  const runTest = async () => {
    setTest('running')
    try {
      setTest(await api.remotes.test(url.trim()))
    } catch (error) {
      setTest({ ok: false, message: errorMessage(error) })
    }
  }

  return (
    <Modal title={remote ? `Edit ${remote.name}` : 'Add remote'} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) onSubmit(name.trim(), url.trim())
        }}
      >
        {!remote && (
          <div className="field">
            <label htmlFor="remote-name">Name</label>
            <input id="remote-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="remote-url">Address</label>
          <input
            id="remote-url"
            className="mono"
            autoFocus
            value={url}
            placeholder="https://github.com/owner/repo.git"
            onChange={(event) => {
              setUrl(event.target.value)
              setTest(null)
            }}
          />
          {describeAddress(url) && <span className="field-hint">{describeAddress(url)}</span>}
        </div>
        <div className="test-row">
          <button type="button" disabled={!valid || test === 'running'} onClick={() => void runTest()}>
            Test connection
          </button>
          {test === 'running' && (
            <span className="dim">
              <span className="spinner" /> Checking…
            </span>
          )}
          {test && test !== 'running' && (
            <span className={test.ok ? 'test-ok' : 'test-fail'}>
              <Icon name={test.ok ? 'check' : 'warning'} size={15} /> {test.message}
            </span>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            {remote ? 'Save' : 'Add remote'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
