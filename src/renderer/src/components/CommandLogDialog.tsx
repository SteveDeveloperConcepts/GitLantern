import { useEffect, useMemo, useState } from 'react'
import type { CommandLogEntry } from '../../../shared/types'
import { Modal } from './Modal'

const api = window.api

// Commands GitLantern runs on every refresh to read the repository; they change nothing.
const READS = new Set([
  'status',
  'log',
  'for-each-ref',
  'rev-parse',
  'cat-file',
  'show',
  'diff',
  'diff-tree',
  'rev-list',
  'ls-files',
  'symbolic-ref',
  'blame',
  'check-ref-format',
  'reflog',
  'merge-base',
  'version'
])
const READ_SUBCOMMANDS: Record<string, string[]> = { stash: ['list'], worktree: ['list'], submodule: ['status'], lfs: ['version', 'ls-files', 'locks'] }

/** The git subcommand and what follows it, without the `-c key=value` settings in front. */
export function commandParts(args: string[]): { command: string; rest: string[] } {
  let index = 0
  while (args[index] === '-c') index += 2
  return { command: args[index] ?? '', rest: args.slice(index + 1) }
}

function isRead(args: string[]): boolean {
  const { command, rest } = commandParts(args)
  if (READS.has(command)) return true
  // `remote -v` and `config --get` read; `remote add` and `config user.name …` change things.
  if (command === 'remote') return ['', 'show', 'get-url'].includes(rest.find((arg) => !arg.startsWith('-')) ?? '')
  if (command === 'config') return rest.some((arg) => /^(--get(-all|-regexp|-urlmatch)?|--list|-l)$/.test(arg))
  return READ_SUBCOMMANDS[command]?.includes(rest.find((arg) => !arg.startsWith('-')) ?? '') ?? false
}

const quote = (arg: string): string => (/^[\w./:=@%+,-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`)

/** Every git command GitLantern ran this session, newest first, with how long it took and how it ended. */
export function CommandLogDialog({ onClose }: { onClose(): void }) {
  const [entries, setEntries] = useState<CommandLogEntry[]>([])
  const [changesOnly, setChangesOnly] = useState(true)
  const [failedOnly, setFailedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  // Read the log while the dialog is open; nothing streams from the main process otherwise.
  useEffect(() => {
    const load = () => void api.commandLog.list().then(setEntries)
    load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [])

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase()
    return entries
      .filter((entry) => !changesOnly || !isRead(entry.args))
      .filter((entry) => !failedOnly || (entry.exitCode !== 0 && entry.duration !== null))
      .filter((entry) => !text || entry.args.join(' ').toLowerCase().includes(text))
      .reverse()
  }, [entries, changesOnly, failedOnly, query])

  return (
    <Modal title="Git command log" onClose={onClose} className="modal-full">
      <div className="command-log">
        <div className="command-log-toolbar">
          <input value={query} placeholder="Filter commands" onChange={(event) => setQuery(event.target.value)} aria-label="Filter commands" />
          <label className="checkbox compact" title="Hide the status, log and other reads GitLantern runs to show the repository">
            <input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} />
            Hide reads
          </label>
          <label className="checkbox compact">
            <input type="checkbox" checked={failedOnly} onChange={(event) => setFailedOnly(event.target.checked)} />
            Failed only
          </label>
          <span className="spacer" />
          <span className="dim">
            {shown.length} of {entries.length}
          </span>
          <button className="link" onClick={() => void api.commandLog.clear().then(() => setEntries([]))}>
            Clear
          </button>
        </div>
        <p className="hint">What GitLantern ran, as you’d type it in a terminal. Anything sent on standard input, like commit messages, isn’t kept.</p>
        <ul className="command-list">
          {shown.length === 0 && <li className="dim empty">Nothing yet.</li>}
          {shown.map((entry) => {
            const failed = entry.duration !== null && entry.exitCode !== 0
            return (
              <li key={entry.id} className={`command-entry${failed ? ' failed' : ''}${entry.duration === null ? ' running' : ''}`}>
                <button className="command-row" onClick={() => setOpen(open === entry.id ? null : entry.id)}>
                  <span className="dim nowrap">{new Date(entry.startedAt).toLocaleTimeString()}</span>
                  <span className="mono command-text selectable">git {entry.args.map(quote).join(' ')}</span>
                  <span className="dim nowrap">{entry.duration === null ? 'running…' : `${entry.duration} ms`}</span>
                  <span className={`chip ${failed ? 'chip-danger' : entry.duration === null ? '' : 'chip-ok'}`}>
                    {entry.duration === null ? '…' : entry.exitCode === null ? 'error' : `exit ${entry.exitCode}`}
                  </span>
                </button>
                {open === entry.id && (
                  <div className="command-detail selectable">
                    <div className="dim">in {entry.cwd}</div>
                    {entry.error && <pre>{entry.error}</pre>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
