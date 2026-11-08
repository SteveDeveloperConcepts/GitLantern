import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appStore } from './sandbox'

/*
 * Apps opened from the Dock, Finder or a desktop launcher don't get the PATH a terminal has: the folders
 * that the user's shell startup files add (Homebrew, ~/.local/bin, nvm, …) are missing. Git starts other
 * programs by name from PATH: git-lfs for LFS files, gpg for signing, credential helpers, and whatever a
 * hook runs, such as node. Without those folders they fail ("git-lfs: command not found"). So GitLantern
 * adds the usual install folders at once, then asks the user's login shell for its PATH and puts that
 * first, the way a terminal has it.
 */

const MARKER = '__GITLANTERN_PATH__'
const SHELL_TIMEOUT_MS = 10_000
// Shells that take -i -l -c alike. Any other (csh, tcsh, nushell, …) gets the usual folders only.
const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'mksh'])

/** Folders that programs are often installed in and that a short PATH leaves out. */
export function usualDirs(platform: NodeJS.Platform, home: string): string[] {
  const nix = [path.join(home, '.nix-profile', 'bin'), '/nix/var/nix/profiles/default/bin']
  if (platform === 'darwin') {
    return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', path.join(home, '.local', 'bin'), ...nix]
  }
  return ['/usr/local/bin', path.join(home, '.local', 'bin'), '/home/linuxbrew/.linuxbrew/bin', ...nix, '/snap/bin']
}

/**
 * Join PATH values into one, earlier ones first, each folder once. Relative entries are dropped: they
 * would find programs in whatever folder a command runs in, which is often a repository.
 */
export function mergePaths(...values: (string | undefined)[]): string {
  const dirs = values.flatMap((value) => (value ?? '').split(':')).filter((dir) => path.posix.isAbsolute(dir))
  return [...new Set(dirs)].join(':')
}

/** The PATH between the two markers in what the shell printed, or null if it didn't get that far. */
export function parseShellOutput(output: string): string | null {
  const parts = output.split(MARKER)
  if (parts.length < 3) return null
  const value = (parts[1] ?? '').trim()
  return value && !value.includes('\n') ? value : null
}

/**
 * Ask `shell` for the PATH its startup files set up: started as a login shell (which reads .zprofile,
 * .bash_profile) and an interactive one (.zshrc, .bashrc, where nvm and the like usually go). Null when
 * it fails or takes longer than `timeoutMs`.
 */
export function readShellPath(shell: string, timeoutMs = SHELL_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    // printenv rather than echo $PATH, which fish would print with spaces.
    const command = `echo ${MARKER}; printenv PATH; echo ${MARKER}`
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('ELECTRON_')))
    let output = ''
    let settled = false
    // A session of its own, without the terminal GitLantern may have been started from: an interactive
    // shell would try to take that terminal over.
    const child = spawn(shell, ['-i', '-l', '-c', command], { cwd: os.homedir(), env, stdio: ['ignore', 'pipe', 'ignore'], detached: true })
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Programs the startup files left running, like an agent, may keep the output open: don't wait for them.
      child.stdout?.destroy()
      child.unref()
      resolve(value)
    }
    const timer = setTimeout(() => {
      // The whole group: startup files that hang are often waiting on a program they started.
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // It's gone already.
      }
      finish(null)
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      const found = parseShellOutput(output)
      if (found) finish(found)
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(parseShellOutput(output)))
  })
}

/** The user's login shell, if it's one that {@link readShellPath} knows how to ask. */
function loginShell(): string | null {
  let shell: string | undefined
  try {
    shell = os.userInfo().shell ?? undefined
  } catch {
    // No entry in the user database.
  }
  shell ||= process.env.SHELL
  if (!shell || !path.isAbsolute(shell) || !SHELLS.has(path.basename(shell))) return null
  return fs.existsSync(shell) ? shell : null
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/**
 * Give every program GitLantern starts the PATH a terminal would have: the usual install folders right
 * away, then the login shell's PATH in front once the shell answers. Programs started in between get the
 * usual folders only. Nothing changes on Windows, where apps get the full PATH, or in the Mac App Store
 * build, whose sandbox keeps it to its own Git and Git LFS.
 */
export async function adoptShellPath(): Promise<void> {
  if (appStore || process.platform === 'win32') return
  const usual = usualDirs(process.platform, os.homedir()).filter(isDirectory)
  process.env.PATH = mergePaths(process.env.PATH, usual.join(':'))
  const shell = loginShell()
  const shellPath = shell ? await readShellPath(shell) : null
  if (shellPath) process.env.PATH = mergePaths(shellPath, process.env.PATH)
}
