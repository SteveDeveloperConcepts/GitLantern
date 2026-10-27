import { beforeAll, describe, expect, it } from 'vitest'
import { commitAt, git, isolateGit, makeRepo, write } from '../../test/helpers'
import type { AiSettings } from '../shared/types'
import { capDiff, cleanMessage, commitMessage, DEFAULT_ENDPOINT, DEFAULT_MODELS, stagedContext } from './ai'

const staged = {
  diff: 'diff --git a/greet.txt b/greet.txt\n+hello\n',
  stat: ' greet.txt | 1 +\n',
  recentSubjects: ['Add the readme', 'Fix the build']
}
const anthropic: AiSettings = { provider: 'anthropic', endpoint: DEFAULT_ENDPOINT, model: '', instructions: 'Use Conventional Commits.' }
const local: AiSettings = { provider: 'openai', endpoint: 'http://localhost:11434/v1/', model: 'llama3.2', instructions: '' }

interface Call {
  url: string
  method?: string
  headers: Record<string, string>
  body: Record<string, unknown>
  signal?: AbortSignal | null
}

/** A fetch that records the request and answers with `status` and `body`, or fails with `error`. */
function mockFetch(status: number, body: unknown, error?: unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      signal: init?.signal
    })
    if (error) throw error
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const claudeAnswer = (text: string) => ({
  content: [
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text }
  ],
  stop_reason: 'end_turn'
})

describe('commitMessage with Anthropic', () => {
  it('calls the Messages API with the key, version, prompt and default model, and returns the text', async () => {
    const { fetchImpl, calls } = mockFetch(200, claudeAnswer('feat: add a greeting\n\nSays hello to new users.\n'))
    const message = await commitMessage({ ...staged, settings: anthropic, apiKey: 'sk-ant-test', fetchImpl })
    expect(message).toBe('feat: add a greeting\n\nSays hello to new users.')

    const [call] = calls
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call?.method).toBe('POST')
    expect(call?.signal).toBeInstanceOf(AbortSignal)
    expect(call?.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    })
    const body = call!.body
    expect(body.model).toBe(DEFAULT_MODELS.anthropic)
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.max_tokens).toBeGreaterThan(1000)
    expect(body.output_config).toEqual({ effort: 'low' })
    expect(body.fallbacks).toBe('default')
    expect(body).not.toHaveProperty('temperature')
    expect(body.system).toContain('72 characters')
    expect(body.system).toContain('Use Conventional Commits.')
    const messages = body.messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.content).toContain('+hello')
    expect(messages[0]!.content).toContain('greet.txt | 1 +')
    expect(messages[0]!.content).toContain('- Add the readme\n- Fix the build')
  })

  it('leaves out effort and fallbacks for models that don’t take them', async () => {
    const { fetchImpl, calls } = mockFetch(200, claudeAnswer('Add a greeting'))
    await commitMessage({ ...staged, settings: { ...anthropic, model: 'claude-haiku-4-5' }, apiKey: 'k', fetchImpl })
    expect(calls[0]!.body.model).toBe('claude-haiku-4-5')
    expect(calls[0]!.body).not.toHaveProperty('output_config')
    expect(calls[0]!.body).not.toHaveProperty('fallbacks')
    expect(calls[0]!.headers).not.toHaveProperty('anthropic-beta')
  })

  it('says when Claude declines', async () => {
    const { fetchImpl } = mockFetch(200, { content: [], stop_reason: 'refusal' })
    await expect(commitMessage({ ...staged, settings: anthropic, apiKey: 'k', fetchImpl })).rejects.toThrow(/Claude declined/)
  })

  it('explains failed requests in plain words', async () => {
    const error = (message: string) => ({ type: 'error', error: { type: 'x', message } })
    const cases: Array<[number, unknown, RegExp]> = [
      [401, error('invalid x-api-key'), /Anthropic didn’t accept the API key \(invalid x-api-key\)\. Check the key in Settings → AI/],
      [403, error('forbidden'), /didn’t accept the API key/],
      [404, error('model: claude-opus-5-5'), /Anthropic doesn’t have a model called “claude-opus-5-5”/],
      [429, error('rate limited'), /limiting requests right now \(rate limited\)/],
      [400, error('Your credit balance is too low'), /Anthropic turned the request down \(Your credit balance is too low\)/],
      [529, error('Overloaded'), /Anthropic is having trouble right now \(error 529\)/],
      [413, 'too large', /too big for Anthropic/]
    ]
    for (const [status, body, expected] of cases) {
      const { fetchImpl } = mockFetch(status, body)
      await expect(commitMessage({ ...staged, settings: anthropic, apiKey: 'k', fetchImpl })).rejects.toThrow(expected)
    }
  })
})

describe('commitMessage with an OpenAI-compatible server', () => {
  const answer = (content: unknown) => ({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] })

  it('posts to <endpoint>/chat/completions without a key for a local server', async () => {
    const { fetchImpl, calls } = mockFetch(200, answer('Add a greeting'))
    expect(await commitMessage({ ...staged, settings: local, apiKey: '', fetchImpl })).toBe('Add a greeting')
    const [call] = calls
    expect(call?.url).toBe('http://localhost:11434/v1/chat/completions')
    expect(call?.headers).toEqual({ 'content-type': 'application/json' })
    expect(call?.body.model).toBe('llama3.2')
    expect(call?.body).not.toHaveProperty('temperature')
    const messages = call?.body.messages as Array<{ role: string; content: string }>
    expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(messages[1]!.content).toContain('+hello')
  })

  it('sends the key as a bearer token, and falls back to the default address and model', async () => {
    const { fetchImpl, calls } = mockFetch(200, answer([{ type: 'text', text: 'Add a greeting' }]))
    const settings: AiSettings = { provider: 'openai', endpoint: '', model: ' ', instructions: '' }
    expect(await commitMessage({ ...staged, settings, apiKey: 'sk-test', fetchImpl })).toBe('Add a greeting')
    expect(calls[0]!.url).toBe(`${DEFAULT_ENDPOINT}/chat/completions`)
    expect(calls[0]!.headers.authorization).toBe('Bearer sk-test')
    expect(calls[0]!.body.model).toBe(DEFAULT_MODELS.openai)
  })

  it('cleans up the answer', async () => {
    const { fetchImpl } = mockFetch(200, answer('<think>Short diff.</think>\n```text\nAdd a greeting\n\nSays hello.\n```'))
    expect(await commitMessage({ ...staged, settings: local, apiKey: '', fetchImpl })).toBe('Add a greeting\n\nSays hello.')
  })

  it('explains failures in plain words', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' } })
    const unknownHost = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' } })
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const notFound = { error: 'model "llama3.2" not found, try pulling it first' }
    const cases: Array<[number, unknown, unknown, RegExp]> = [
      [404, notFound, undefined, /localhost:11434 has no model called “llama3\.2”, or the address is wrong/],
      [401, { error: { message: 'Missing bearer' } }, undefined, /localhost:11434 needs an API key \(Missing bearer\)/],
      [500, '<html>Bad gateway</html>', undefined, /localhost:11434 is having trouble right now \(error 500\)/],
      [200, '<html>not an API</html>', undefined, /wasn’t in the format GitLantern expected/],
      [200, answer('   '), undefined, /didn’t write a message/],
      [200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }, undefined, /declined/],
      [0, null, refused, /Nothing is answering at http:\/\/localhost:11434\. If it’s a server on this computer/],
      [0, null, unknownHost, /Couldn’t find localhost:11434\. Check your internet connection/],
      [0, null, timeout, /localhost:11434 didn’t answer within 90 seconds/]
    ]
    for (const [status, body, error, expected] of cases) {
      const { fetchImpl } = mockFetch(status || 200, body, error)
      await expect(commitMessage({ ...staged, settings: local, apiKey: '', fetchImpl })).rejects.toThrow(expected)
    }
  })

  it('refuses an address that isn’t a web address', async () => {
    const { fetchImpl, calls } = mockFetch(200, answer('x'))
    const settings: AiSettings = { ...local, endpoint: 'file:///etc' }
    await expect(commitMessage({ ...staged, settings, apiKey: '', fetchImpl })).rejects.toThrow(/isn’t a web address/)
    expect(calls).toHaveLength(0)
  })
})

describe('cleanMessage', () => {
  it('takes the message out of code fences, quotes and reasoning', () => {
    expect(cleanMessage('```\nFix the build\n```')).toBe('Fix the build')
    expect(cleanMessage('Here is the commit message:\n\n```git\nFix the build\n\nThe cache was stale.\n```')).toBe(
      'Fix the build\n\nThe cache was stale.'
    )
    expect(cleanMessage('"Fix the build"')).toBe('Fix the build')
    expect(cleanMessage('“Fix the build”')).toBe('Fix the build')
    expect(cleanMessage('<think>\nhmm\n</think>\n\nFix the build')).toBe('Fix the build')
    expect(cleanMessage('  Fix the build\n\n')).toBe('Fix the build')
  })

  it('keeps quotes that belong to the message', () => {
    expect(cleanMessage('Fix "quoted" paths')).toBe('Fix "quoted" paths')
    expect(cleanMessage('"a" and "b" are swapped')).toBe('"a" and "b" are swapped')
    expect(cleanMessage('`npm ci` instead of `npm install`')).toBe('`npm ci` instead of `npm install`')
  })
})

describe('capDiff', () => {
  const fileDiff = (name: string, lines: number): string =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${lines} @@\n${'+line\n'.repeat(lines)}`

  it('leaves a small diff alone', () => {
    const diff = fileDiff('a.txt', 3)
    expect(capDiff(diff)).toBe(diff)
  })

  it('cuts big files and keeps every small one whole', () => {
    const small = fileDiff('small.txt', 5)
    const diff = fileDiff('big.txt', 1000) + small + fileDiff('huge.txt', 5000)
    const capped = capDiff(diff, 2000)
    expect(capped.length).toBeLessThan(2400)
    expect(capped).toContain(small)
    expect(capped).toContain('diff --git a/big.txt b/big.txt')
    expect(capped).toContain('diff --git a/huge.txt b/huge.txt')
    expect(capped).toMatch(/… \d+ more lines of this file left out\n/)
    expect(capped.indexOf('big.txt')).toBeLessThan(capped.indexOf('small.txt'))
  })

  it('says how many files are missing when not even their names fit', () => {
    const diff = Array.from({ length: 200 }, (_, i) => fileDiff(`file-${i}.txt`, 2)).join('')
    const capped = capDiff(diff, 1000)
    expect(capped.length).toBeLessThan(1300)
    expect(capped).toMatch(/… and \d+ more files\n$/)
  })
})

describe('stagedContext', () => {
  beforeAll(() => {
    isolateGit()
  })

  it('asks for staged changes first', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'unstaged\n')
    await expect(stagedContext(repo)).rejects.toThrow('Stage some changes first, then ask for a message.')
  })

  it('works in a new repository, which has no subjects yet', async () => {
    const repo = await makeRepo()
    write(repo, 'greet.txt', 'hello\n')
    await git(repo, 'add', 'greet.txt')
    const context = await stagedContext(repo)
    expect(context.recentSubjects).toEqual([])
    expect(context.diff).toContain('+hello')
    expect(context.stat).toContain('greet.txt')
  })

  it('has only the staged changes, and the latest subjects newest first', async () => {
    const repo = await makeRepo()
    for (let i = 1; i <= 12; i++) {
      write(repo, 'a.txt', `${i}\n`)
      await commitAt(repo, `Commit ${i}`, 1_700_000_000 + i)
    }
    write(repo, 'a.txt', 'staged\n')
    await git(repo, 'add', 'a.txt')
    write(repo, 'b.txt', 'not staged\n')
    const context = await stagedContext(repo)
    expect(context.recentSubjects).toEqual(Array.from({ length: 10 }, (_, i) => `Commit ${12 - i}`))
    expect(context.diff).toContain('+staged')
    expect(context.diff).not.toContain('b.txt')
  })

  it('cuts a huge file rather than leaving out the files after it', async () => {
    const repo = await makeRepo()
    write(repo, 'a-huge.txt', 'generated line\n'.repeat(20_000))
    write(repo, 'z-small.txt', 'small change\n')
    await git(repo, 'add', '-A')
    const context = await stagedContext(repo)
    expect(context.diff.length).toBeLessThan(70_000)
    expect(context.diff).toContain('+small change')
    expect(context.diff).toContain('of this file left out')
  })
})
