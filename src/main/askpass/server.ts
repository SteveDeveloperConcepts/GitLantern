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
  /** Named pipe (Windows) or Unix socket path the helper connects to. */
  address: string
  /** Per-run secret the helper must present, so other local processes can't fetch answers. */
  token: string
  close(): Promise<void>
}

const MAX_REQUEST_BYTES = 64 * 1024

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Listen for prompts from the askpass helper. `onPrompt` resolves to the answer,
 * or null to cancel (git then fails the operation).
 */
export async function startAskPassServer(options: {
  onPrompt(prompt: string): Promise<string | null>
}): Promise<AskPassServer> {
  const token = randomBytes(32).toString('hex')
  let socketDir: string | undefined
  let address: string
  if (process.platform === 'win32') {
    address = `\\\\.\\pipe\\gitlantern-askpass-${process.pid}-${randomBytes(6).toString('hex')}`
  } else {
    socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-'))
    fs.chmodSync(socketDir, 0o700)
    address = path.join(socketDir, 'askpass.sock')
  }

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
    server.listen(address, () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    address,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          if (socketDir) fs.rmSync(socketDir, { recursive: true, force: true })
          resolve()
        })
      })
  }
}
