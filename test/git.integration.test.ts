import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import { runGit } from '../src/main/git/runGit'
import { layoutGraph } from '../src/renderer/src/graph/layout'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

describe('git commands against a real repository', () => {
  it('handles an empty repository', async () => {
    const repo = await makeRepo()
    expect(await commands.log(repo)).toEqual([])
    const status = await commands.status(repo)
    expect(status.branch).toMatchObject({ head: 'main', oid: null })
  })

  it('stages, unstages and commits, including the very first commit', async () => {
    const repo = await makeRepo()
    write(repo, 'hello world.txt', 'hi\n')
    write(repo, 'src/app.ts', 'export {}\n')

    let status = await commands.status(repo)
    expect(status.entries.map((e) => [e.path, e.untracked])).toEqual([
      ['hello world.txt', true],
      ['src/app.ts', true]
    ])

    await commands.stage(repo, ['hello world.txt', 'src/app.ts'])
    await commands.unstage(repo, ['src/app.ts']) // unborn branch path (git rm --cached)
    status = await commands.status(repo)
    expect(status.entries.find((e) => e.path === 'hello world.txt')?.index).toBe('A')
    expect(status.entries.find((e) => e.path === 'src/app.ts')?.untracked).toBe(true)

    await commands.commit(repo, 'First commit\n\nWith a body.\n')
    const [first] = await commands.log(repo)
    expect(first?.subject).toBe('First commit')
    expect(first?.refs).toEqual([{ name: 'main', kind: 'local', isCurrent: true }])

    const detail = await commands.show(repo, first?.hash ?? '')
    expect(detail.body).toBe('With a body.')
    expect(detail.files).toEqual([{ status: 'A', path: 'hello world.txt', additions: 1, deletions: 0 }])

    // After the first commit, unstage goes through git restore --staged.
    write(repo, 'hello world.txt', 'hi there\n')
    await commands.stage(repo, ['hello world.txt'])
    await commands.unstage(repo, ['hello world.txt'])
    status = await commands.status(repo)
    expect(status.entries.find((e) => e.path === 'hello world.txt')).toMatchObject({ index: null, worktree: 'M' })
  })

  it('produces diffs for the working tree, the index, commits and untracked files', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'one\n')
    await git(repo, 'add', 'a.txt')
    await git(repo, 'commit', '-q', '-m', 'add a')
    write(repo, 'a.txt', 'one\ntwo\n')
    write(repo, 'new.txt', 'brand new\n')

    expect(await commands.diff(repo, { kind: 'worktree', path: 'a.txt' })).toContain('+two')
    expect(await commands.diff(repo, { kind: 'worktree', path: 'new.txt', untracked: true })).toContain('+brand new')
    await commands.stage(repo, ['a.txt'])
    expect(await commands.diff(repo, { kind: 'index', path: 'a.txt' })).toContain('+two')

    const [head] = await commands.log(repo)
    expect(await commands.diff(repo, { kind: 'commit', hash: head?.hash ?? '', path: 'a.txt' })).toContain('+one')
    await expect(commands.diff(repo, { kind: 'worktree', path: '../outside.txt', untracked: true })).rejects.toThrow(
      /outside the repository/
    )
  })

  it('lists branches, switches and lays out a merge graph', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    await commitAt(repo, 'base', 1_700_000_000)
    await commands.createBranch(repo, 'feature/x')
    write(repo, 'b.txt', '2\n')
    await commitAt(repo, 'feature work', 1_700_000_100)
    await commands.checkout(repo, { name: 'main', kind: 'local' })
    write(repo, 'c.txt', '3\n')
    await commitAt(repo, 'main work', 1_700_000_200)
    await runGit(['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature/x'], {
      cwd: repo,
      env: { GIT_AUTHOR_DATE: '1700000300 +0000', GIT_COMMITTER_DATE: '1700000300 +0000' }
    })
    await git(repo, 'tag', 'v1')

    const branches = await commands.branches(repo)
    expect(branches.map((b) => [b.name, b.isCurrent])).toEqual([
      ['feature/x', false],
      ['main', true]
    ])

    const commits = await commands.log(repo)
    expect(commits.map((c) => c.subject)).toEqual(['merge feature', 'main work', 'feature work', 'base'])
    expect(commits[0]?.refs).toEqual([
      { name: 'main', kind: 'local', isCurrent: true },
      { name: 'v1', kind: 'tag' }
    ])
    expect(commits[2]?.refs).toEqual([{ name: 'feature/x', kind: 'local', isCurrent: false }])

    const { rows, columns } = layoutGraph(commits)
    expect(columns).toBe(2)
    expect(rows.map((r) => r.column)).toEqual([0, 0, 1, 0])

    await expect(commands.createBranch(repo, 'bad..name')).rejects.toThrow(/not a valid branch name/)
  })

  it('pushes to a remote and tracks remote branches', async () => {
    const remote = await makeRepo()
    await git(remote, 'config', 'receive.denyCurrentBranch', 'ignore')
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-q', '-m', 'base')
    await git(repo, 'remote', 'add', 'origin', remote)

    await commands.push(repo) // no upstream yet: push --set-upstream origin HEAD
    expect((await commands.status(repo)).branch.upstream).toBe('origin/main')

    await commands.fetch(repo)
    expect((await commands.branches(repo)).some((b) => b.kind === 'remote' && b.name === 'origin/main')).toBe(true)
    await commands.pull(repo)
    expect((await git(remote, 'rev-parse', 'main')).trim()).toBe((await git(repo, 'rev-parse', 'HEAD')).trim())
  })
})
