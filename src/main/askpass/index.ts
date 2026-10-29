import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { Events } from '../../shared/ipc'
import type { AskPassAnswer, AskPassRequest } from '../../shared/types'
import type { AccountStore } from '../accounts/store'
import { appStore } from '../sandbox'
import type { SecretStore } from '../secrets'
import { parseCredentialPrompt } from './prompts'
import { startAskPassServer } from './server'
import { askPassEnv, trampolinePath } from './trampoline'

const PROMPT_TIMEOUT_MS = 5 * 60 * 1000
const SECRET_PROMPT = /password|passphrase|token|\bpin\b/i
export const REMEMBERED_PREFIX = 'askpass:'

export interface AskPass {
  /** Environment to add to every git invocation. */
  env: Record<string, string>
  respond(id: string, answer: AskPassAnswer | null): void
  close(): Promise<void>
}

/** Inside a packaged app, git can't read files from the asar archive. */
function unpacked(file: string): string {
  return file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
}

/**
 * The program that runs the helper as plain Node. In the Mac App Store build it's Electron's helper
 * app, which is signed to inherit the App Sandbox: the app's own binary would try to start a sandbox
 * of its own, and macOS stops a sandboxed program's child that does.
 */
function nodeRunner(): string {
  if (!appStore) return process.execPath
  const name = path.basename(process.execPath)
  const helper = path.resolve(process.execPath, '../../Frameworks', `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`)
  return fs.existsSync(helper) ? helper : process.execPath
}

export async function setupAskPass(options: {
  secrets: SecretStore
  accounts: AccountStore
  getWindow(): BrowserWindow | null
}): Promise<AskPass> {
  const pending = new Map<string, (answer: AskPassAnswer | null) => void>()

  async function askRenderer(prompt: string): Promise<AskPassAnswer | null> {
    const window = options.getWindow()
    if (!window || window.isDestroyed()) return null
    const request: AskPassRequest = { id: randomUUID(), prompt: prompt.trim(), secret: SECRET_PROMPT.test(prompt) }
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), PROMPT_TIMEOUT_MS)
      function finish(answer: AskPassAnswer | null): void {
        clearTimeout(timer)
        pending.delete(request.id)
        resolve(answer)
      }
      pending.set(request.id, finish)
      if (window.isMinimized()) window.restore()
      window.focus()
      window.webContents.send(Events.askpassRequest, request)
    })
  }

  const server = await startAskPassServer({
    onPrompt: async (prompt) => {
      // A connected account for this server answers HTTPS prompts without asking.
      const credential = parseCredentialPrompt(prompt)
      const account = credential ? options.accounts.findByHost(credential.host) : undefined
      if (credential && account) {
        const answer = credential.kind === 'username' ? account.gitUsername : await options.accounts.freshToken(account.id)
        if (answer) return answer
      }

      const key = REMEMBERED_PREFIX + prompt.trim()
      const remembered = options.secrets.get(key)
      if (remembered !== null) return remembered
      const answer = await askRenderer(prompt)
      if (!answer) return null
      if (answer.remember) options.secrets.set(key, answer.value)
      return answer.value
    }
  })

  const env = askPassEnv({
    trampoline: trampolinePath(app.getPath('userData')),
    nodePath: nodeRunner(),
    scriptPath: unpacked(path.join(__dirname, 'askpass.js')),
    address: server.address,
    token: server.token
  })

  return {
    env,
    respond: (id, answer) => pending.get(id)?.(answer),
    close: () => server.close()
  }
}
