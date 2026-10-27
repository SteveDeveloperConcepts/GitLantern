import { spawn } from 'node:child_process'

export interface GitOptions {
  cwd: string
  /** Written to git's stdin, which is then closed. */
  stdin?: string
  env?: Record<string, string>
  /** Exit codes that count as success. Defaults to [0]. */
  allowedExitCodes?: number[]
  signal?: AbortSignal
  /** Kill git and fail once stdout grows past this many bytes. */
  maxOutputBytes?: number
  /** Called with stderr as it arrives (git reports progress there). */
  onStderr?: (chunk: string) => void
}

export interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Like {@link GitResult}, with stdout as bytes: file contents, images, archives. */
export interface GitRawResult {
  stdout: Buffer
  stderr: string
  exitCode: number
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    message?: string
  ) {
    super(message ?? (stderr.trim() || `git ${args[0] ?? ''} exited with code ${exitCode}`))
    this.name = 'GitError'
  }
}

interface GitConfig {
  gitPath: string
  env: () => Record<string, string>
}

const config: GitConfig = { gitPath: 'git', env: () => ({}) }

/** Set the git executable and extra environment (askpass, test isolation) for every call. */
export function configureGit(options: Partial<GitConfig>): void {
  Object.assign(config, options)
}

/** The git executable every call runs: a full path once resolved, else `git` from PATH. */
export function gitExecutable(): string {
  return config.gitPath
}

/** Told about every git command: once when it starts, once when it ends (for the command log). */
export interface CommandListener {
  started(args: string[], cwd: string): number
  finished(id: number, exitCode: number | null, stderr: string): void
}

let listener: CommandListener | null = null

export function setCommandListener(next: CommandListener | null): void {
  listener = next
}

const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024
// Machine-readable output regardless of the user's config.
const GLOBAL_ARGS = ['-c', 'color.ui=false', '-c', 'core.quotepath=false']

export async function runGit(args: string[], options: GitOptions): Promise<GitResult> {
  const result = await runGitRaw(args, options)
  return { ...result, stdout: result.stdout.toString('utf8') }
}

export function runGitRaw(args: string[], options: GitOptions): Promise<GitRawResult> {
  const allowed = options.allowedExitCodes ?? [0]
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
  const logId = listener?.started(args, options.cwd)
  const logged = (exitCode: number | null, stderr: string): void => {
    if (logId !== undefined) listener?.finished(logId, exitCode, stderr)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
        logged(error instanceof GitError ? error.exitCode : null, error instanceof GitError ? error.stderr || error.message : error.message)
        reject(error)
      }
    }

    const child = spawn(config.gitPath, [...GLOBAL_ARGS, ...args], {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...config.env(), ...options.env },
      signal: options.signal,
      windowsHide: true
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > maxOutput) {
        child.kill()
        fail(new GitError(args, null, '', `git ${args[0] ?? ''} produced more than ${maxOutput} bytes of output`))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
      options.onStderr?.(chunk.toString('utf8'))
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        fail(new GitError(args, null, '', `Git was not found at "${config.gitPath}". Install Git or set its path.`))
      } else {
        fail(error)
      }
    })

    child.on('close', (code) => {
      if (settled) return
      const out = Buffer.concat(stdout)
      const err = Buffer.concat(stderr).toString('utf8')
      if (code !== null && allowed.includes(code)) {
        settled = true
        logged(code, '')
        resolve({ stdout: out, stderr: err, exitCode: code })
      } else {
        fail(new GitError(args, code, err))
      }
    })

    // A failed spawn has no stdin to write to; the 'error' handler reports it.
    child.stdin.on('error', () => {})
    child.stdin.end(options.stdin ?? '')
  })
}
