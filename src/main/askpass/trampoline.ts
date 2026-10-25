import fs from 'node:fs'
import path from 'node:path'

/** Windows trampoline. `resources/askpass.cmd` is the copy packaged builds ship (a test keeps them equal). */
export const TRAMPOLINE_CMD = [
  '@echo off',
  'setlocal',
  'set ELECTRON_RUN_AS_NODE=1',
  '"%GITSTEVE_ASKPASS_NODE%" "%GITSTEVE_ASKPASS_SCRIPT%" %*',
  ''
].join('\r\n')

const TRAMPOLINE_SH = '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$GITSTEVE_ASKPASS_NODE" "$GITSTEVE_ASKPASS_SCRIPT" "$@"\n'

/**
 * Write the small script git and ssh run as GIT_ASKPASS / SSH_ASKPASS. It starts the app's own
 * binary as plain Node on the helper script. ELECTRON_RUN_AS_NODE is set inside the trampoline only,
 * so it never leaks into other programs git starts (hooks, editors).
 */
export function writeTrampoline(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  if (process.platform === 'win32') {
    const file = path.join(dir, 'askpass.cmd')
    fs.writeFileSync(file, TRAMPOLINE_CMD)
    return file
  }
  const file = path.join(dir, 'askpass.sh')
  fs.writeFileSync(file, TRAMPOLINE_SH, { mode: 0o755 })
  fs.chmodSync(file, 0o755)
  return file
}

/**
 * Where git finds the trampoline. Packaged Windows builds use the read-only copy shipped with the app:
 * inside a Microsoft Store (MSIX) package, files the app creates in AppData are redirected to a private
 * folder that other programs can't always see.
 */
export function trampolinePath(userData: string): string {
  const shipped = path.join(process.resourcesPath, 'askpass.cmd')
  return process.platform === 'win32' && fs.existsSync(shipped) ? shipped : writeTrampoline(path.join(userData, 'askpass'))
}

export interface AskPassEnvOptions {
  trampoline: string
  /** Executable that runs the helper: the Electron binary in the app, `node` in tests. */
  nodePath: string
  scriptPath: string
  address: string
  token: string
}

/** Environment that routes git's and ssh's credential prompts to the app. */
export function askPassEnv(options: AskPassEnvOptions): Record<string, string> {
  return {
    GIT_ASKPASS: options.trampoline,
    SSH_ASKPASS: options.trampoline,
    SSH_ASKPASS_REQUIRE: 'force',
    // Older OpenSSH only uses SSH_ASKPASS when DISPLAY is set.
    DISPLAY: process.env.DISPLAY ?? ':0',
    GITSTEVE_ASKPASS_NODE: options.nodePath,
    GITSTEVE_ASKPASS_SCRIPT: options.scriptPath,
    GITSTEVE_ASKPASS_ADDRESS: options.address,
    GITSTEVE_ASKPASS_TOKEN: options.token
  }
}
