import { useState } from 'react'
import type { Branch, FinishFlowOptions, FlowConfig, FlowKind } from '../../../shared/types'
import { Modal } from './Modal'

const KINDS: { kind: FlowKind; label: string; from: 'develop' | 'master'; text: string }[] = [
  { kind: 'feature', label: 'Feature', from: 'develop', text: 'New work. Finishing merges it into the development branch.' },
  { kind: 'release', label: 'Release', from: 'develop', text: 'Getting a version ready. Finishing merges it into both branches and tags it.' },
  { kind: 'hotfix', label: 'Hotfix', from: 'master', text: 'An urgent fix to what’s released. Finishing merges it into both branches and tags it.' }
]

export type FlowMode = { mode: 'init' } | { mode: 'start'; kind?: FlowKind } | { mode: 'finish'; kind: FlowKind; name: string }

interface Props {
  flow: FlowMode
  config: FlowConfig | null
  branches: Branch[]
  onInit(config: FlowConfig): void
  onStart(kind: FlowKind, name: string): void
  onFinish(kind: FlowKind, name: string, options: FinishFlowOptions): void
  onCancel(): void
}

/** git-flow: set it up, start a feature, release or hotfix, or finish one. */
export function FlowDialog({ flow, config, branches, onInit, onStart, onFinish, onCancel }: Props) {
  if (flow.mode === 'init' || !config) return <FlowInit config={config} branches={branches} onInit={onInit} onCancel={onCancel} />
  if (flow.mode === 'start') return <FlowStart config={config} initial={flow.kind ?? 'feature'} onStart={onStart} onCancel={onCancel} />
  return <FlowFinish config={config} kind={flow.kind} name={flow.name} onFinish={onFinish} onCancel={onCancel} />
}

function FlowInit({ config, branches, onInit, onCancel }: { config: FlowConfig | null; branches: Branch[]; onInit(config: FlowConfig): void; onCancel(): void }) {
  const local = branches.filter((b) => b.kind === 'local').map((b) => b.name)
  const [master, setMaster] = useState(config?.master ?? (local.includes('main') ? 'main' : local.includes('master') ? 'master' : (local[0] ?? 'main')))
  const [develop, setDevelop] = useState(config?.develop ?? 'develop')
  const [prefixes, setPrefixes] = useState(config?.prefixes ?? { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' })
  const [tagPrefix, setTagPrefix] = useState(config?.versionTagPrefix ?? 'v')
  return (
    <Modal title="Set up git-flow" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          onInit({ master: master.trim(), develop: develop.trim(), prefixes, versionTagPrefix: tagPrefix.trim() })
        }}
      >
        <p className="dialog-text">
          git-flow keeps released code on one branch and ongoing work on another, with feature, release and hotfix branches between them. The
          settings are stored where the git-flow command-line tools look for them, so both work together.
        </p>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Released code</span>
            <input value={master} onChange={(event) => setMaster(event.target.value)} list="flow-branches" />
          </label>
          <label className="field">
            <span className="field-label">Development</span>
            <input value={develop} onChange={(event) => setDevelop(event.target.value)} list="flow-branches" />
            <span className="field-hint">Created from the released branch if it doesn’t exist.</span>
          </label>
          {KINDS.map(({ kind, label }) => (
            <label key={kind} className="field">
              <span className="field-label">{label} prefix</span>
              <input value={prefixes[kind]} onChange={(event) => setPrefixes({ ...prefixes, [kind]: event.target.value })} />
            </label>
          ))}
          <label className="field">
            <span className="field-label">Version tag prefix</span>
            <input value={tagPrefix} onChange={(event) => setTagPrefix(event.target.value)} placeholder="v" />
          </label>
        </div>
        <datalist id="flow-branches">
          {local.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!master.trim() || !develop.trim() || master.trim() === develop.trim()}>
            Set up
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FlowStart({ config, initial, onStart, onCancel }: { config: FlowConfig; initial: FlowKind; onStart(kind: FlowKind, name: string): void; onCancel(): void }) {
  const [kind, setKind] = useState<FlowKind>(initial)
  const [name, setName] = useState('')
  const info = KINDS.find((k) => k.kind === kind) ?? KINDS[0]
  const from = info?.from === 'master' ? config.master : config.develop
  return (
    <Modal title="Start with git-flow" onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) onStart(kind, name.trim())
        }}
      >
        <div className="segmented choice" role="group" aria-label="Kind">
          {KINDS.map((option) => (
            <button key={option.kind} type="button" aria-pressed={kind === option.kind} onClick={() => setKind(option.kind)}>
              {option.label}
            </button>
          ))}
        </div>
        <p className="dialog-text">{info?.text}</p>
        <label className="field">
          <span className="field-label">{kind === 'feature' ? 'Name' : 'Version'}</span>
          <span className="prefixed">
            <span className="mono dim">{config.prefixes[kind]}</span>
            <input autoFocus value={name} placeholder={kind === 'feature' ? 'login-page' : '1.4.0'} onChange={(event) => setName(event.target.value)} />
          </span>
          <span className="field-hint">Branches off {from} and switches to it.</span>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Start {kind}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FlowFinish({
  config,
  kind,
  name,
  onFinish,
  onCancel
}: {
  config: FlowConfig
  kind: FlowKind
  name: string
  onFinish(kind: FlowKind, name: string, options: FinishFlowOptions): void
  onCancel(): void
}) {
  const tagged = kind !== 'feature'
  const [tagMessage, setTagMessage] = useState(`${kind === 'release' ? 'Release' : 'Hotfix'} ${name}`)
  const [keepBranch, setKeepBranch] = useState(false)
  const branch = `${config.prefixes[kind]}${name}`
  return (
    <Modal title={`Finish ${kind} ${name}`} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          onFinish(kind, name, { ...(tagged && tagMessage.trim() ? { tagMessage: tagMessage.trim() } : {}), keepBranch })
        }}
      >
        <p className="dialog-text">
          {tagged
            ? `Merges ${branch} into ${config.master}, tags it ${config.versionTagPrefix}${name}, then merges it into ${config.develop}.`
            : `Merges ${branch} into ${config.develop} with a merge commit.`}{' '}
          If a merge conflicts it stops so you can fix it; finish again afterwards to carry on.
        </p>
        {tagged && (
          <label className="field">
            <span className="field-label">Tag message</span>
            <input value={tagMessage} onChange={(event) => setTagMessage(event.target.value)} />
          </label>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={keepBranch} onChange={(event) => setKeepBranch(event.target.checked)} />
          Keep {branch} afterwards
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Finish
          </button>
        </div>
      </form>
    </Modal>
  )
}
