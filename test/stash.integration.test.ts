import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()

async function repoWithBase(): Promise<string> {
  const repo = await makeRepo()
  write(repo, 'a.txt', 'base\n')
  await commitAt(repo, 'base', 1_700_000_000)
  return repo
}

describe('stash', () => {
  it('stashes tracked and untracked changes, lists them and shows what they hold', async () => {
    const repo = await repoWithBase()
    write(repo, 'a.txt', 'changed\n')
    write(repo, 'new.txt', 'untracked\n')
    await commands.stash(repo, 'half-done work')
    expect((await commands.status(repo)).entries).toEqual([])

    write(repo, 'a.txt', 'again\n')
    await commands.stash(repo, '')
    const list = await commands.stashes(repo)
    expect(list.map((s) => [s.message, s.branch])).toEqual([
      ['WIP on main: base', 'main'],
      ['half-done work', 'main']
    ])

    const detail = await commands.showStash(repo, list[1]!.hash)
    expect(detail.files.map((f) => [f.path, f.status, f.untracked ?? false])).toEqual([
      ['a.txt', 'M', false],
      ['new.txt', 'A', true]
    ])
    expect(await commands.diff(repo, { kind: 'stash', hash: list[1]!.hash, path: 'new.txt', untracked: true })).toContain('+untracked')
    expect(await commands.diff(repo, { kind: 'stash', hash: list[1]!.hash, path: 'a.txt' })).toContain('+changed')
  })

  it('says when there is nothing to stash', async () => {
    const repo = await repoWithBase()
    await expect(commands.stash(repo, '')).rejects.toThrow(/no changes to stash/)
  })

  it('applies, pops and drops by commit, whatever position the stash has moved to', async () => {
    const repo = await repoWithBase()
    write(repo, 'a.txt', 'first\n')
    await commands.stash(repo, 'first')
    write(repo, 'b.txt', 'second\n')
    await commands.stash(repo, 'second')
    const [second, first] = await commands.stashes(repo)

    expect(await commands.applyStash(repo, first!.hash, { pop: false })).toEqual({ conflicted: false })
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('first\n')
    expect(await commands.stashes(repo)).toHaveLength(2)
    await git(repo, 'checkout', '--', 'a.txt')

    expect(await commands.applyStash(repo, first!.hash, { pop: true })).toEqual({ conflicted: false })
    expect((await commands.stashes(repo)).map((s) => s.message)).toEqual(['second'])

    await commands.dropStash(repo, second!.hash)
    expect(await commands.stashes(repo)).toEqual([])
    await expect(commands.dropStash(repo, second!.hash)).rejects.toThrow(/doesn’t exist any more/)
  })

  it('keeps the stash when popping it conflicts', async () => {
    const repo = await repoWithBase()
    write(repo, 'a.txt', 'stashed\n')
    await commands.stash(repo, 'mine')
    write(repo, 'a.txt', 'committed meanwhile\n')
    await commitAt(repo, 'other', 1_700_000_100)
    const [entry] = await commands.stashes(repo)

    expect(await commands.applyStash(repo, entry!.hash, { pop: true })).toEqual({ conflicted: true })
    expect((await commands.status(repo)).entries.filter((e) => e.conflicted).map((e) => e.path)).toEqual(['a.txt'])
    expect(await commands.stashes(repo)).toHaveLength(1)
  })
})

describe('cherry-pick', () => {
  async function withFeature(): Promise<string> {
    const repo = await repoWithBase()
    await git(repo, 'switch', '-q', '-c', 'feature')
    write(repo, 'b.txt', 'feature\n')
    await commitAt(repo, 'add b', 1_700_000_100)
    write(repo, 'a.txt', 'feature\n')
    await commitAt(repo, 'change a', 1_700_000_200)
    await git(repo, 'switch', '-q', 'main')
    return repo
  }

  it('copies a commit onto the current branch, but not over staged changes', async () => {
    const repo = await withFeature()
    write(repo, 'a.txt', 'staged\n')
    await commands.stage(repo, ['a.txt'])
    await expect(commands.cherryPick(repo, await head(repo, 'feature~1'))).rejects.toThrow(/^Cherry-pick refused: .*Commit or stash/)
    await git(repo, 'reset', '-q', '--hard')

    expect(await commands.cherryPick(repo, await head(repo, 'feature~1'))).toEqual({ conflicted: false })
    const [copy] = await commands.log(repo, 1, { branch: 'main' })
    expect(copy?.subject).toBe('add b')
    expect(copy?.parents).toEqual([await head(repo, 'main~1')])
  })

  it('stops on conflicts, then continues', async () => {
    const repo = await withFeature()
    write(repo, 'a.txt', 'main\n')
    await commitAt(repo, 'main change', 1_700_000_300)

    expect(await commands.cherryPick(repo, await head(repo, 'feature'))).toEqual({ conflicted: true })
    expect((await commands.status(repo)).operation).toEqual({ kind: 'cherry-pick' })
    await expect(commands.cherryPick(repo, await head(repo, 'feature~1'))).rejects.toThrow(/Finish the cherry-pick first/)
    expect((await commands.status(repo)).operation).toEqual({ kind: 'cherry-pick' })

    write(repo, 'a.txt', 'both\n')
    await commands.stage(repo, ['a.txt'])
    expect(await commands.continueOperation(repo)).toEqual({ conflicted: false })
    expect((await commands.log(repo, 1, { branch: 'main' }))[0]?.subject).toBe('change a')
  })

  it('calls off a cherry-pick of changes the branch already has', async () => {
    const repo = await withFeature()
    await commands.cherryPick(repo, await head(repo, 'feature~1'))
    const before = await head(repo)
    await expect(commands.cherryPick(repo, await head(repo, 'feature~1'))).rejects.toThrow(/already has the changes/)
    expect((await commands.status(repo)).operation).toBeUndefined()
    expect(await head(repo)).toBe(before)
  })
})
