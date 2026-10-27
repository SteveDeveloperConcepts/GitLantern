import type { CommandLogEntry } from '../shared/types'
import { setCommandListener } from './git/runGit'

const MAX_ENTRIES = 500
const MAX_ERROR = 2000

/**
 * The git commands GitLantern ran this session, newest last, for the command log. Arguments are
 * kept as git got them; nothing sent on stdin (commit messages, passwords) is recorded. The log
 * dialog reads it while it's open, so nothing is sent anywhere otherwise.
 */
export class CommandLog {
  private entries: CommandLogEntry[] = []
  private nextId = 1

  list(): CommandLogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  started(args: string[], cwd: string): number {
    const entry: CommandLogEntry = { id: this.nextId++, args: [...args], cwd, startedAt: Date.now(), duration: null, exitCode: null }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    return entry.id
  }

  finished(id: number, exitCode: number | null, stderr: string): void {
    // Newest last, and a command usually finishes soon after it starts: look from the end.
    const index = this.entries.findLastIndex((entry) => entry.id === id)
    const entry = this.entries[index]
    if (!entry) return
    const error = exitCode === 0 ? undefined : stderr.trim().slice(0, MAX_ERROR)
    this.entries[index] = { ...entry, duration: Date.now() - entry.startedAt, exitCode, ...(error ? { error } : {}) }
  }
}

export const commandLog = new CommandLog()
setCommandListener(commandLog)
