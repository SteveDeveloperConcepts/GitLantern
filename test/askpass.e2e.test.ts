import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startAskPassServer, type AskPassServer } from '../src/main/askpass/server'
import { askPassEnv, writeTrampoline } from '../src/main/askpass/trampoline'
import { runGit } from '../src/main/git/runGit'
import { isolateGit } from './helpers'

// The helper must be the built single-file script, exactly as git runs it in the app.
const helper = path.resolve(import.meta.dirname, '../out/main/askpass.js')

describe.skipIf(!fs.existsSync(helper))('askpass round trip (needs `npm run build`)', () => {
  let server: AskPassServer
  const prompts: string[] = []
  let env: Record<string, string>

  beforeAll(async () => {
    isolateGit()
    server = await startAskPassServer({
      onPrompt: async (prompt) => {
        prompts.push(prompt)
        if (prompt.startsWith('Username')) return 'alice'
        if (prompt.startsWith('Password')) return 's3cret'
        return null
      }
    })
    // A folder with a space, like "Application Support" on macOS or a Windows profile "John Smith".
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git lantern-'))
    env = askPassEnv({
      trampoline: writeTrampoline(dir),
      nodePath: process.execPath,
      scriptPath: helper,
      address: server.address,
      token: server.token
    })
  })

  afterAll(async () => {
    await server.close()
  })

  async function credentialFill(extraEnv: Record<string, string>): Promise<string> {
    const { stdout } = await runGit(['-c', 'credential.helper=', 'credential', 'fill'], {
      cwd: os.tmpdir(),
      env: extraEnv,
      stdin: 'protocol=https\nhost=example.com\n\n'
    })
    return stdout
  }

  it('answers git credential prompts through the app', async () => {
    const stdout = await credentialFill(env)
    expect(stdout).toContain('username=alice')
    expect(stdout).toContain('password=s3cret')
    expect(prompts).toEqual(["Username for 'https://example.com': ", "Password for 'https://alice@example.com': "])
  })

  it('rejects a helper that presents the wrong token', async () => {
    prompts.length = 0
    await expect(credentialFill({ ...env, GITLANTERN_ASKPASS_TOKEN: 'wrong' })).rejects.toThrow()
    expect(prompts).toEqual([])
  })
})
