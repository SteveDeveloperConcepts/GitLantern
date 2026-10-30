import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/** What the askpass helper sends: one JSON line per connection. */
export interface AskPassWireRequest {
  token: string
  prompt: string
}

export type AskPassWireReply = { ok: true; value: string } | { ok: false }

export interface AskPassServer {
  /** Named pipe (Windows) or Unix socket path: what the helper connects to. */
  address: string
  /** Per-run secret the helper must present, so other local processes can't fetch answers. */
  token: string
  close(): Promise<void>
}

const MAX_REQUEST_BYTES = 64 * 1024
/**
 * Longest Unix socket path macOS takes (104 bytes with the terminating zero; Linux allows 107). In the
 * Mac App Store build the temporary folder is deep inside the app's container, which is why the names
 * below are short.
 */
const MAX_SOCKET_PATH = 103

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Whether `address` is short enough to listen on as a Unix socket. */
export function fitsSocketPath(address: string): boolean {
  return Buffer.byteLength(address) <= MAX_SOCKET_PATH
}

/** Run `fn` in the folder `dir`, for a socket too deep to name by its whole path. */
function inFolder<T>(dir: string, fn: () => T): T {
  const previous = process.cwd()
  process.chdir(dir)
  try {
    return fn()
  } finally {
    process.chdir(previous)
  }
}

/**
 * Listen for prompts from the askpass helper. `onPrompt` resolves to the answer,
 * or null to cancel (git then fails the operation). Outside Windows it's a Unix socket in a private
 * folder. It's never a network port: the Mac App Store build has no entitlement to listen on one.
 */
export async function startAskPassServer(options: {
  onPrompt(prompt: string): Promise<string | null>
  /** Folder for the socket's private folder; the system's temporary folder unless a test picks one. */
  tempDir?: string
}): Promise<AskPassServer> {
  const token = randomBytes(32).toString('hex')
  let socketDir: string | undefined
  let address: string
  if (process.platform === 'win32') {
    address = `\\\\.\\pipe\\gitlantern-askpass-${process.pid}-${randomBytes(6).toString('hex')}`
  } else {
    socketDir = fs.mkdtempSync(path.join(options.tempDir ?? os.tmpdir(), 'gl-'))
    fs.chmodSync(socketDir, 0o700)
    address = path.join(socketDir, 's')
  }
  // A socket path too long to listen on is bound by its name from inside its folder. Closing happens
  // there too, because that's when libuv deletes the socket file, by the name it was bound with.
  const deepDir = socketDir !== undefined && !fitsSocketPath(address) ? socketDir : undefined
  const inSocketDir = <T>(fn: () => T): T => (deepDir ? inFolder(deepDir, fn) : fn())

  const server = net.createServer((socket) => {
    let buffer = ''
    let handled = false
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', (chunk: string) => {
      if (handled) return
      buffer += chunk
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy()
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      handled = true
      void answer(buffer.slice(0, newline)).then((reply) => socket.end(`${JSON.stringify(reply)}\n`))
    })
  })

  async function answer(line: string): Promise<AskPassWireReply> {
    try {
      const request = JSON.parse(line) as Partial<AskPassWireRequest>
      if (typeof request.token !== 'string' || typeof request.prompt !== 'string') return { ok: false }
      if (!sameToken(request.token, token)) return { ok: false }
      const value = await options.onPrompt(request.prompt)
      return value === null ? { ok: false } : { ok: true, value }
    } catch {
      return { ok: false }
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    const listening = (): void => {
      server.off('error', reject)
      resolve()
    }
    inSocketDir(() => server.listen(deepDir ? path.basename(address) : address, listening))
  })

  return {
    address,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        inSocketDir(() =>
          server.close(() => {
            if (socketDir) fs.rmSync(socketDir, { recursive: true, force: true })
            resolve()
          })
        )
      })
  }
}
