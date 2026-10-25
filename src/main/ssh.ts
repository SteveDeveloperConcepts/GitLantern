import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hostName } from '../shared/remoteUrl'
import type { ConnectionTest, SshKeyInfo } from '../shared/types'

const KEY_NAMES = ['id_ed25519', 'id_ecdsa', 'id_rsa']
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i

const sshDir = (): string => path.join(os.homedir(), '.ssh')

const SSH2_HEADER = '---- BEGIN SSH2 PUBLIC KEY ----'

/** The user's default public key file and its raw contents, if they have one. */
function findKeyFile(): { file: string; contents: string } | null {
  for (const name of KEY_NAMES) {
    const file = path.join(sshDir(), `${name}.pub`)
    try {
      return { file, contents: fs.readFileSync(file, 'utf8').trim() }
    } catch {
      // Try the next name.
    }
  }
  return null
}

/**
 * The user's default public key in OpenSSH one-line form. Keys saved by PuTTYgen use the
 * multi-line SSH2 format, which services reject, so those are converted with `ssh-keygen -i`.
 */
export async function loadKey(sshKeygen: string): Promise<SshKeyInfo | null> {
  const found = findKeyFile()
  if (!found) return null
  if (!found.contents.startsWith(SSH2_HEADER)) {
    return { path: found.file, publicKey: found.contents, type: found.contents.split(' ')[0] ?? 'ssh' }
  }
  const { code, output } = await run(sshKeygen, ['-i', '-f', found.file.replace(/\\/g, '/')], {}, 15_000)
  const converted = output.split(/\r?\n/).find((line) => /^(ssh|ecdsa)-/.test(line.trim()))?.trim()
  return {
    path: found.file,
    publicKey: code === 0 && converted ? converted : found.contents,
    type: converted?.split(' ')[0] ?? 'ssh2',
    warning:
      code === 0 && converted
        ? 'This key was saved by PuTTY, so it’s shown converted to the format services expect. Git’s SSH needs the matching private key in OpenSSH format too: export it from PuTTYgen if pushes fail.'
        : 'This key was saved by PuTTY in a format services don’t accept. Export it from PuTTYgen as an OpenSSH key.'
  }
}

/**
 * Locate ssh / ssh-keygen. On Windows prefer the copies shipped with Git for Windows,
 * since that is the ssh git itself runs.
 */
export function resolveSshTool(tool: 'ssh' | 'ssh-keygen', gitPath: string): string {
  if (process.platform !== 'win32') return tool
  let dir = path.dirname(gitPath)
  for (let depth = 0; depth < 3; depth++) {
    const candidate = path.join(dir, 'usr', 'bin', `${tool}.exe`)
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  return `${tool}.exe`
}

function run(command: string, args: string[], env: Record<string, string>, timeoutMs: number) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      windowsHide: true,
      signal: AbortSignal.timeout(timeoutMs)
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.on('error', (error) => resolve({ code: null, output: error.message }))
    child.on('close', (code) => resolve({ code, output }))
    child.stdin.end()
  })
}

/** Create ~/.ssh/id_ed25519 (no passphrase). Never overwrites an existing key. */
export async function generateKey(sshKeygen: string, comment: string): Promise<SshKeyInfo> {
  if (findKeyFile()) throw new Error('You already have an SSH key, so Git Steve won’t create another one.')
  fs.mkdirSync(sshDir(), { recursive: true, mode: 0o700 })
  const keyPath = path.join(sshDir(), 'id_ed25519').replace(/\\/g, '/')
  const { code, output } = await run(sshKeygen, ['-q', '-t', 'ed25519', '-C', comment || 'git-steve', '-f', keyPath, '-N', ''], {}, 30_000)
  if (code !== 0) throw new Error(output.trim() || 'ssh-keygen failed')
  const key = await loadKey(sshKeygen)
  if (!key) throw new Error('The key was created but couldn’t be read back')
  return key
}

const SUCCESS = /successfully authenticated|welcome to gitlab|authenticated via ssh key|shell access is not supported|does not provide shell access/i

/** `ssh -T git@host`: services answer with a greeting (and often a non-zero exit) when the key is accepted. */
export async function testSsh(ssh: string, host: string, env: Record<string, string>): Promise<ConnectionTest> {
  if (!HOST.test(host)) throw new Error(`Not a host name: ${host}`)
  const port = /:(\d+)$/.exec(host)?.[1]
  const args = ['-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', ...(port ? ['-p', port] : [])]
  const { output } = await run(ssh, [...args, `git@${hostName(host)}`], env, 30_000)
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const greeting = lines.find((line) => SUCCESS.test(line))
  if (greeting) return { ok: true, message: greeting.replace(/^remote:\s*/i, '') }
  if (/permission denied/i.test(output)) {
    return { ok: false, message: `${hostName(host)} didn’t accept your SSH key. Add your public key to your account there first.` }
  }
  return { ok: false, message: lines.at(-1) ?? 'No response from the server' }
}
