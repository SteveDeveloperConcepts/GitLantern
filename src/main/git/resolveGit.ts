import fs from 'node:fs'
import path from 'node:path'

const WINDOWS_FALLBACKS = ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']
// Apps started from Finder get a minimal PATH, so look in the usual install locations too.
const MAC_FALLBACKS = ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git']

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** Find a git executable: an explicit override, then PATH, then common install locations. */
export function resolveGitPath(override?: string): string {
  if (override && isFile(override)) return override

  const exe = process.platform === 'win32' ? 'git.exe' : 'git'
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, exe)
    if (isFile(candidate)) return candidate
  }

  const fallbacks = process.platform === 'win32' ? WINDOWS_FALLBACKS : process.platform === 'darwin' ? MAC_FALLBACKS : []
  return fallbacks.find(isFile) ?? 'git'
}
