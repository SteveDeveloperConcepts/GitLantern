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

const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024
// Machine-readable output regardless of the user's config.
const GLOBAL_ARGS = ['-c', 'color.ui=false', '-c', 'core.quotepath=false']

export function runGit(args: string[], options: GitOptions): Promise<GitResult> {
  const allowed = options.allowedExitCodes ?? [0]
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
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
      const out = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      if (code !== null && allowed.includes(code)) {
        settled = true
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
