import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as bisect from '../src/main/git/bisect'
import * as commands from '../src/main/git/commands'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()

const HASH = 'a'.repeat(40)

describe('parseBisectOutput', () => {
  it('reads the next step, the first bad commit and the dead end of only skipped commits', () => {
    expect(bisect.parseBisectOutput(`Bisecting: 3 revisions left to test after this (roughly 2 steps)\n[${HASH}] c4\n`)).toEqual({
      done: false,
      message: 'Bisecting: 3 revisions left to test after this (roughly 2 steps)'
    })
    const found = `${HASH} is the first 'bad' commit\ncommit ${HASH}\nAuthor: T <t@e>\n\n    c3\n`
    expect(bisect.parseBisectOutput(found)).toEqual({ done: true, firstBad: HASH, message: `${HASH} is the first 'bad' commit` })
    // Older versions of git don't quote the term.
    expect(bisect.parseBisectOutput(`${HASH} is the first bad commit\n`)).toMatchObject({ done: true, firstBad: HASH })

    const skipped = [
      "There are only 'skip'ped commits left to test.",
      "The first 'bad' commit could be any of:",
      HASH,
      'We cannot bisect more!'
    ].join('\n')
    expect(bisect.parseBisectOutput(`${skipped}\n`)).toEqual({ done: false, message: skipped })
  })
})

describe('bisect', () => {
  /** Eight commits; the fifth breaks things. Returns the repository and the hashes, oldest first. */
  async function history(): Promise<{ repo: string; hashes: string[] }> {
    const repo = await makeRepo()
    const hashes: string[] = []
    for (let i = 1; i <= 8; i++) {
      write(repo, 'app.txt', i >= 5 ? `broken ${i}\n` : `works ${i}\n`)
      await commitAt(repo, `commit ${i}`, 1_700_000_000 + i * 100)
      hashes.push(await head(repo))
    }
    return { repo, hashes }
  }

  it('narrows the range down to the first bad commit, then goes back to the branch', async () => {
    const { repo, hashes } = await history()
    let step = await bisect.bisectStart(repo, 'main', hashes[0]!)
    expect(step.done).toBe(false)
    expect(step.message).toMatch(/^Bisecting: \d+ revisions? left to test/)
    expect(await commands.bisectState(repo)).toEqual({ bad: hashes[7], good: [hashes[0]], skipped: [] })

    for (let steps = 0; !step.done && steps < 10; steps++) {
      const broken = fs.readFileSync(path.join(repo, 'app.txt'), 'utf8').startsWith('broken')
      step = await bisect.bisectMark(repo, broken ? 'bad' : 'good')
    }
    expect(step).toMatchObject({ done: true, firstBad: hashes[4] })

    await bisect.bisectReset(repo)
    expect(await commands.bisectState(repo)).toBeNull()
    expect((await git(repo, 'symbolic-ref', '--short', 'HEAD')).trim()).toBe('main')
    expect(await head(repo)).toBe(hashes[7])
  })

  it('says so when only skipped commits are left', async () => {
    const { repo, hashes } = await history()
    // Between commit 6 (good) and 8 (bad), only commit 7 is left to test.
    expect(await bisect.bisectStart(repo, hashes[7]!, hashes[5]!)).toMatchObject({ done: false })
    expect(await head(repo)).toBe(hashes[6])
    const step = await bisect.bisectMark(repo, 'skip')
    expect(step.done).toBe(false)
    expect(step.message).toContain('could be any of')
    expect((await commands.bisectState(repo))?.skipped).toEqual([hashes[6]])
    await bisect.bisectReset(repo)
  })

  it('names the first bad commit straight away when the range has nothing between', async () => {
    const { repo, hashes } = await history()
    expect(await bisect.bisectStart(repo, hashes[4]!, hashes[3]!)).toMatchObject({ done: true, firstBad: hashes[4] })
    await bisect.bisectReset(repo)
  })

  it('refuses a second bisect, marking without one, other operations and bad revisions', async () => {
    const { repo, hashes } = await history()
    await expect(bisect.bisectMark(repo, 'good')).rejects.toThrow('No bisect is in progress')
    await expect(bisect.bisectStart(repo, '--no-checkout', hashes[0]!)).rejects.toThrow('Not a branch or commit')
    await expect(bisect.bisectStart(repo, 'main', `${hashes[0]}..main`)).rejects.toThrow('Not a branch or commit')

    await bisect.bisectStart(repo, 'main', hashes[0]!)
    await expect(bisect.bisectStart(repo, 'main', hashes[0]!)).rejects.toThrow(/already in progress/)
    await bisect.bisectReset(repo)

    // A merge stopped on conflicts.
    await git(repo, 'switch', '-q', '-c', 'side', hashes[3]!)
    write(repo, 'app.txt', 'side\n')
    await commitAt(repo, 'side change', 1_700_001_000)
    expect(await commands.merge(repo, 'main')).toEqual({ conflicted: true })
    await expect(bisect.bisectStart(repo, 'main', hashes[0]!)).rejects.toThrow('Finish the merge first')
  })
})
