// Askpass helper. Git or ssh runs this (via the trampoline) with the prompt as its argument.
// It forwards the prompt to the running app and prints the answer, which is the askpass contract.
// Keep it free of electron and app imports: it runs as plain Node and must stay a single file.
// (A named import also avoids the bundler's shared interop chunk.)
import { createConnection } from 'node:net'
import { basename, dirname } from 'node:path'

const address = process.env.GITLANTERN_ASKPASS_ADDRESS
const token = process.env.GITLANTERN_ASKPASS_TOKEN
const prompt = process.argv.slice(2).join(' ')

if (!address || !token) {
  process.stderr.write('gitlantern-askpass: GITLANTERN_ASKPASS_ADDRESS and GITLANTERN_ASKPASS_TOKEN must be set\n')
  process.exit(1)
}

let reply = ''
// A named pipe on Windows. A Unix socket is reached from inside its folder: its whole path can be too
// long to connect to (over 103 bytes, deep in the Mac App Store build's container).
let target = address
if (address.startsWith('/')) {
  try {
    process.chdir(dirname(address))
    target = basename(address)
  } catch {
    process.exit(1)
  }
}
const socket = createConnection(target)
socket.setEncoding('utf8')
socket.on('connect', () => socket.write(`${JSON.stringify({ token, prompt })}\n`))
socket.on('data', (chunk: string) => {
  reply += chunk
})
socket.on('end', () => {
  try {
    const parsed = JSON.parse(reply) as { ok?: boolean; value?: unknown }
    if (parsed.ok && typeof parsed.value === 'string') {
      process.stdout.write(`${parsed.value}\n`)
      process.exit(0)
    }
  } catch {
    // Fall through: anything unexpected cancels the prompt.
  }
  process.exit(1)
})
socket.on('error', () => process.exit(1))
