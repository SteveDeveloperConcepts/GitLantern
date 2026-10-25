import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()

/** main and feature both change line 1 of a.txt after a shared base commit; main is checked out. */
async function divergedRepo(featureCommits: string[] = ['feature']): Promise<string> {
  const repo = await makeRepo()
  write(repo, 'a.txt', 'base\n')
  await commitAt(repo, 'base', 1_700_000_000)
  await git(repo, 'switch', '-q', '-c', 'feature')
  let time = 1_700_000_100
  for (const [index, text] of featureCommits.entries()) {
    // The first feature commit conflicts with main; later ones touch other files.
    write(repo, index === 0 ? 'a.txt' : `extra-${index}.txt`, `${text}\n`)
    await commitAt(repo, text, time++)
  }
  await git(repo, 'switch', '-q', 'main')
  write(repo, 'a.txt', 'main\n')
  await commitAt(repo, 'main change', 1_700_000_200)
  return repo
}

describe('merge and rebase', () => {
  it('fast-forwards, or makes a merge commit when asked', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    await commitAt(repo, 'base', 1_700_000_000)
    await git(repo, 'switch', '-q', '-c', 'feature')
    write(repo, 'b.txt', '2\n')
    await commitAt(repo, 'feature work', 1_700_000_100)
    await git(repo, 'switch', '-q', 'main')

    expect(await commands.compare(repo, 'feature')).toEqual({ ahead: 0, behind: 1, published: 0 })
    const base = await head(repo)
    expect(await commands.merge(repo, 'feature')).toEqual({ conflicted: false })
    expect(await head(repo)).toBe(await head(repo, 'feature'))

    await git(repo, 'reset', '-q', '--hard', base)
    await commands.merge(repo, 'feature', { noFastForward: true })
    expect((await git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(3)
  })

  it('stops a merge on conflicts, then aborts it', async () => {
    const repo = await divergedRepo()
    const before = await head(repo)
    expect(await commands.compare(repo, 'feature')).toEqual({ ahead: 1, behind: 1, published: 0 })

    expect(await commands.merge(repo, 'feature')).toEqual({ conflicted: true })
    const status = await commands.status(repo)
    expect(status.operation).toEqual({ kind: 'merge', incoming: await head(repo, 'feature') })
    expect(status.entries.filter((e) => e.conflicted).map((e) => e.path)).toEqual(['a.txt'])
    const conflictView = await commands.diff(repo, { kind: 'worktree', path: 'a.txt', conflicted: true })
    expect(conflictView.split('\n')).toEqual(['<<<<<<< HEAD', 'main', '=======', 'feature', '>>>>>>> feature', ''])

    await commands.abortOperation(repo)
    expect((await commands.status(repo)).operation).toBeUndefined()
    expect(await head(repo)).toBe(before)
  })

  it('finishes a merge once the conflicts are resolved and staged', async () => {
    const repo = await divergedRepo()
    await commands.merge(repo, 'feature')
    // Continuing with the conflict still unresolved reports it again rather than failing.
    expect(await commands.continueOperation(repo)).toEqual({ conflicted: true })

    write(repo, 'a.txt', 'both\n')
    await commands.stage(repo, ['a.txt'])
    expect(await commands.continueOperation(repo)).toEqual({ conflicted: false })
    expect((await commands.status(repo)).operation).toBeUndefined()
    const [merge] = await commands.log(repo, 1)
    expect(merge?.parents).toHaveLength(2)
    expect(merge?.subject).toBe("Merge branch 'feature'")
  })

  it('rebases through a conflict with continue', async () => {
    const repo = await divergedRepo(['feature one', 'feature two'])
    const mainHash = await head(repo)
    await git(repo, 'switch', '-q', 'feature')

    expect(await commands.rebase(repo, 'main')).toEqual({ conflicted: true })
    expect((await commands.status(repo)).operation).toEqual({ kind: 'rebase', branch: 'feature', onto: mainHash, step: 1, total: 2 })

    write(repo, 'a.txt', 'main and feature\n')
    await commands.stage(repo, ['a.txt'])
    expect(await commands.continueOperation(repo)).toEqual({ conflicted: false })

    const status = await commands.status(repo)
    expect(status.operation).toBeUndefined()
    expect(status.branch.head).toBe('feature')
    expect((await git(repo, 'merge-base', 'HEAD', 'main')).trim()).toBe(mainHash)
    expect((await commands.log(repo, 3)).map((c) => c.subject)).toEqual(['feature two', 'feature one', 'main change'])
  })

  it('skips the conflicting commit during a rebase', async () => {
    const repo = await divergedRepo(['feature one', 'feature two'])
    await git(repo, 'switch', '-q', 'feature')
    await commands.rebase(repo, 'main')

    expect(await commands.skipOperation(repo)).toEqual({ conflicted: false })
    expect((await commands.log(repo, 2)).map((c) => c.subject)).toEqual(['feature two', 'main change'])
  })

  it('counts commits that are already pushed', async () => {
    const remote = await makeRepo()
    const repo = await divergedRepo(['feature one', 'feature two'])
    await git(repo, 'remote', 'add', 'origin', remote)
    await git(repo, 'switch', '-q', 'feature')
    await git(repo, 'push', '-q', '-u', 'origin', 'feature')
    write(repo, 'local.txt', 'not pushed\n')
    await commitAt(repo, 'local only', 1_700_000_300)

    expect(await commands.compare(repo, 'main')).toEqual({ ahead: 3, behind: 1, published: 2 })
  })

  it('refuses a merge that would overwrite uncommitted changes', async () => {
    const repo = await divergedRepo()
    write(repo, 'a.txt', 'uncommitted\n')
    await expect(commands.merge(repo, 'feature')).rejects.toThrow(/overwritten/)
    expect((await commands.status(repo)).operation).toBeUndefined()
  })

  it('rejects names git could read as options or ranges', async () => {
    const repo = await divergedRepo()
    await expect(commands.merge(repo, '--abort')).rejects.toThrow(/Not a branch or commit/)
    await expect(commands.rebase(repo, 'main..feature')).rejects.toThrow(/Not a branch or commit/)
    await expect(commands.compare(repo, 'main --')).rejects.toThrow(/Not a branch or commit/)
    await expect(commands.continueOperation(repo)).rejects.toThrow(/No merge or rebase/)
  })
})
