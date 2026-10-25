import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import { runGit } from '../src/main/git/runGit'
import { commitAt, git, isolateGit, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()

/** A bare "server" repository with one commit on main, and two clones of it: ours and someone else's. */
async function setup(): Promise<{ ours: string; theirs: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsteve-sync-'))
  const server = path.join(dir, 'server.git')
  await runGit(['init', '-q', '--bare', '-b', 'main', server], { cwd: dir })
  const ours = path.join(dir, 'ours')
  const theirs = path.join(dir, 'theirs')
  await runGit(['clone', '-q', server, ours], { cwd: dir })
  write(ours, 'a.txt', 'base\n')
  await commitAt(ours, 'base', 1_700_000_000)
  await git(ours, 'push', '-q', '-u', 'origin', 'main')
  await runGit(['clone', '-q', server, theirs], { cwd: dir })
  return { ours, theirs }
}

describe('pull and push', () => {
  it('fast-forwards, and says when there is nothing to pull', async () => {
    const { ours, theirs } = await setup()
    expect(await commands.pull(ours)).toEqual({ outcome: 'up-to-date', upstream: 'origin/main' })

    write(theirs, 'b.txt', 'theirs\n')
    await commitAt(theirs, 'their work', 1_700_000_100)
    await git(theirs, 'push', '-q')
    expect(await commands.pull(ours)).toEqual({ outcome: 'fast-forward', upstream: 'origin/main' })
    expect(await head(ours)).toBe(await head(theirs))
  })

  it('leaves diverged branches alone for the user to merge or rebase', async () => {
    const { ours, theirs } = await setup()
    write(theirs, 'b.txt', 'theirs\n')
    await commitAt(theirs, 'their work', 1_700_000_100)
    await git(theirs, 'push', '-q')
    write(ours, 'c.txt', 'ours\n')
    await commitAt(ours, 'our work', 1_700_000_200)
    const before = await head(ours)

    // Push first: it fetches to explain the refusal.
    await expect(commands.push(ours)).rejects.toThrow(
      /^Push refused: origin\/main has 1 commit that main doesn’t, and pushing would throw it away\. Click Pull/
    )
    expect(await commands.pull(ours)).toEqual({ outcome: 'diverged', upstream: 'origin/main' })
    expect(await head(ours)).toBe(before)

    expect(await commands.merge(ours, 'origin/main')).toEqual({ conflicted: false })
    await commands.push(ours)
    expect(await head(ours, 'origin/main')).toBe(await head(ours))
  })

  it('recognises pushed commits that were rewritten since', async () => {
    const { ours } = await setup()
    write(ours, 'c.txt', 'ours\n')
    await commitAt(ours, 'our work', 1_700_000_100)
    await git(ours, 'push', '-q')
    await git(ours, 'commit', '-q', '--amend', '-m', 'our work, reworded')

    await expect(commands.push(ours)).rejects.toThrow(/^Push refused: origin\/main still has the old copies .*--force-with-lease/)
    await expect(commands.pull(ours)).rejects.toThrow(/^Nothing to pull: origin\/main still has the old copies/)
  })

  it('needs a branch with an upstream to pull', async () => {
    const { ours } = await setup()
    await git(ours, 'switch', '-q', '-c', 'local-only')
    await expect(commands.pull(ours)).rejects.toThrow(/local-only isn’t linked to a remote branch yet/)
  })
})
