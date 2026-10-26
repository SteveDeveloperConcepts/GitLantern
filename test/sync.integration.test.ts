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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-sync-'))
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
    expect(await commands.push(ours)).toEqual({ outcome: 'pushed' })
    expect(await head(ours, 'origin/main')).toBe(await head(ours))
  })

  /** Ours pushes a commit, then rewords it: the server keeps the old copy. */
  async function rewritten(): Promise<{ ours: string; theirs: string }> {
    const repos = await setup()
    write(repos.ours, 'c.txt', 'ours\n')
    await commitAt(repos.ours, 'our work', 1_700_000_100)
    await git(repos.ours, 'push', '-q')
    await git(repos.ours, 'commit', '-q', '--amend', '-m', 'our work, reworded')
    return repos
  }

  it('offers a force push for pushed commits that were rewritten since', async () => {
    const { ours } = await rewritten()
    const old = await head(ours, 'origin/main')

    expect(await commands.push(ours)).toEqual({ outcome: 'needs-force', upstream: 'origin/main', expected: old, replaced: 1 })
    await expect(commands.pull(ours)).rejects.toThrow(/^Nothing to pull: origin\/main still has the old copies .*Click Push/)

    await commands.forcePush(ours, old)
    expect(await head(ours, 'origin/main')).toBe(await head(ours))
    const server = (await git(ours, 'ls-remote', 'origin', 'refs/heads/main')).split('\t')[0]
    expect(server).toBe(await head(ours))
  })

  it('refuses the force push when someone pushed in the meantime', async () => {
    const { ours, theirs } = await rewritten()
    const { outcome, expected } = (await commands.push(ours)) as { outcome: string; expected: string }
    expect(outcome).toBe('needs-force')

    await git(theirs, 'pull', '-q', '--no-rebase')
    write(theirs, 'd.txt', 'theirs\n')
    await commitAt(theirs, 'their work', 1_700_000_300)
    await git(theirs, 'push', '-q')
    // Even after fetching their commit, the lease is the commit the user was shown.
    await commands.fetch(ours)

    await expect(commands.forcePush(ours, expected)).rejects.toThrow(/^Force push refused: someone pushed to origin\/main/)
    const server = (await git(ours, 'ls-remote', 'origin', 'refs/heads/main')).split('\t')[0]
    expect(server).toBe(await head(theirs))
  })

  it('needs a branch with an upstream to pull', async () => {
    const { ours } = await setup()
    await git(ours, 'switch', '-q', '-c', 'local-only')
    await expect(commands.pull(ours)).rejects.toThrow(/local-only isn’t linked to a remote branch yet/)
  })
})
