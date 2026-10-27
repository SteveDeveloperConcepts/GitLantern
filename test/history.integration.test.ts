import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import * as history from '../src/main/git/history'
import type { RebaseStep } from '../src/shared/types'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()
/** Subjects from the root commit up to HEAD. */
const subjects = async (repo: string): Promise<string[]> => (await git(repo, 'log', '--reverse', '--format=%s')).trim().split('\n')
const message = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'log', '-1', '--format=%B', ref)).trim()
const filesAt = async (repo: string, ref = 'HEAD'): Promise<string[]> =>
  (await git(repo, 'ls-tree', '-r', '--name-only', ref)).trim().split('\n')
const rebaseDir = (repo: string): string => path.join(repo, '.git', 'gitlantern-rebase')

/** One commit per name, each adding its own `<name>.txt`, a minute apart. */
async function linearRepo(names = ['one', 'two', 'three', 'four']): Promise<string> {
  const repo = await makeRepo()
  for (const [index, name] of names.entries()) {
    write(repo, `${name}.txt`, `${name}\n`)
    await commitAt(repo, name, 1_700_000_000 + index * 60)
  }
  return repo
}

/** Steps from `<action> <subject>` lines, like git's own todo, with abbreviated hashes and messages by subject. */
async function steps(repo: string, lines: string[], messages: Record<string, string> = {}): Promise<RebaseStep[]> {
  const commits = await history.rebaseCommits(repo, null)
  return lines.map((line) => {
    const space = line.indexOf(' ')
    const subject = line.slice(space + 1)
    const commit = commits.find((c) => c.subject === subject)
    if (!commit) throw new Error(`No commit called ${subject}`)
    const text = messages[subject]
    return { hash: commit.hash.slice(0, 8), action: line.slice(0, space) as RebaseStep['action'], ...(text ? { message: text } : {}) }
  })
}

describe('amend', () => {
  it('adds the staged changes to the last commit and keeps its message', async () => {
    const repo = await linearRepo(['one', 'two'])
    const parent = await head(repo, 'HEAD~1')
    write(repo, 'extra.txt', 'extra\n')
    await commands.stage(repo, ['extra.txt'])

    await history.amend(repo, null)
    expect(await subjects(repo)).toEqual(['one', 'two'])
    expect(await head(repo, 'HEAD~1')).toBe(parent)
    expect(await filesAt(repo)).toEqual(['extra.txt', 'one.txt', 'two.txt'])
    expect((await commands.status(repo)).entries).toEqual([])
  })

  it('replaces the message, staged changes included', async () => {
    const repo = await linearRepo(['one', 'two'])
    write(repo, 'two.txt', 'changed\n')
    await commands.stage(repo, ['two.txt'])

    await history.amend(repo, 'Two, better\n\nWith a body.\n')
    expect(await history.headMessage(repo)).toBe('Two, better\n\nWith a body.')
    expect(await subjects(repo)).toEqual(['one', 'Two, better'])
    expect(await git(repo, 'show', 'HEAD:two.txt')).toBe('changed\n')
  })

  it('refuses with nothing staged or no commit yet', async () => {
    const repo = await linearRepo(['one'])
    write(repo, 'one.txt', 'unstaged\n')
    await expect(history.amend(repo, null)).rejects.toThrow('Nothing is staged to add to the last commit.')
    await expect(history.amend(repo, '  \n')).rejects.toThrow(/empty/)
    expect(await subjects(repo)).toEqual(['one'])

    const empty = await makeRepo()
    await expect(history.amend(empty, 'first')).rejects.toThrow(/no commit to amend/)
    await expect(history.headMessage(empty)).rejects.toThrow(/no commit to amend/)
  })
})

describe('reword', () => {
  it('rewords HEAD, leaving staged changes staged and out of the commit', async () => {
    const repo = await linearRepo(['one', 'two'])
    const tree = await head(repo, 'HEAD^{tree}')
    write(repo, 'staged.txt', 'staged\n')
    await commands.stage(repo, ['staged.txt'])

    expect(await history.reword(repo, await head(repo), 'Two, reworded')).toEqual({ conflicted: false })
    expect(await history.headMessage(repo)).toBe('Two, reworded')
    expect(await head(repo, 'HEAD^{tree}')).toBe(tree)
    expect((await commands.status(repo)).entries.map((e) => [e.path, e.index])).toEqual([['staged.txt', 'A']])
  })

  it('rewords an older commit, or the root one, by replaying the commits after it', async () => {
    const repo = await linearRepo()
    const before = await history.rebaseCommits(repo, null)
    const tree = await head(repo, 'HEAD^{tree}')

    expect(await history.reword(repo, before[1]!.hash.slice(0, 7), 'Two, reworded\n\nBody.')).toEqual({ conflicted: false })
    expect(await subjects(repo)).toEqual(['one', 'Two, reworded', 'three', 'four'])
    expect(await message(repo, 'HEAD~2')).toBe('Two, reworded\n\nBody.')
    expect(await head(repo, 'HEAD~3')).toBe(before[0]!.hash)
    expect(await head(repo, 'HEAD^{tree}')).toBe(tree)
    expect((await history.rebaseCommits(repo, null)).map((c) => c.authorDate)).toEqual(before.map((c) => c.authorDate))
    const status = await commands.status(repo)
    expect(status.operation).toBeUndefined()
    expect(status.branch.head).toBe('main')
    expect(fs.existsSync(rebaseDir(repo))).toBe(false)

    expect(await history.reword(repo, before[0]!.hash, 'One, reworded')).toEqual({ conflicted: false })
    expect(await subjects(repo)).toEqual(['One, reworded', 'Two, reworded', 'three', 'four'])
  })

  it('refuses commits that aren’t on the branch, and ranges with a merge', async () => {
    const repo = await linearRepo(['one', 'two'])
    await git(repo, 'switch', '-q', '-c', 'side', 'HEAD~1')
    write(repo, 'side.txt', 'side\n')
    await commitAt(repo, 'side', 1_700_001_000)
    const side = await head(repo)
    await git(repo, 'switch', '-q', 'main')
    await expect(history.reword(repo, side, 'Side, reworded')).rejects.toThrow(/isn’t on the checked-out branch/)

    await git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'side')
    await expect(history.reword(repo, await head(repo, 'HEAD~1'), 'Two, reworded')).rejects.toThrow(/merge commit/)
    expect(await subjects(repo)).toContain('two')
    // The merge itself is HEAD, which is simply amended.
    expect(await history.reword(repo, await head(repo), 'Merge side in')).toEqual({ conflicted: false })
    expect(await history.headMessage(repo)).toBe('Merge side in')
    expect((await git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD')).trim().split(' ')).toHaveLength(3)
  })
})

describe('revert', () => {
  it('undoes a commit with a new one, unless that would overwrite changes or undo nothing', async () => {
    const repo = await linearRepo(['one', 'two', 'three'])
    const two = await head(repo, 'HEAD~1')
    write(repo, 'two.txt', 'uncommitted\n')
    await expect(history.revert(repo, two)).rejects.toThrow(/^Revert refused: .*Commit or stash/)
    await git(repo, 'checkout', '--', 'two.txt')

    expect(await history.revert(repo, two)).toEqual({ conflicted: false })
    expect(await subjects(repo)).toEqual(['one', 'two', 'three', 'Revert "two"'])
    expect(fs.existsSync(path.join(repo, 'two.txt'))).toBe(false)

    await expect(history.revert(repo, two)).rejects.toThrow(/^Nothing to revert/)
    expect((await commands.status(repo)).operation).toBeUndefined()
    expect(await subjects(repo)).toHaveLength(4)
  })

  it('reverts a merge commit against its first parent', async () => {
    const repo = await linearRepo(['one'])
    await git(repo, 'switch', '-q', '-c', 'side')
    write(repo, 'side.txt', 'side\n')
    await commitAt(repo, 'side', 1_700_001_000)
    await git(repo, 'switch', '-q', 'main')
    write(repo, 'main.txt', 'main\n')
    await commitAt(repo, 'main', 1_700_001_100)
    await git(repo, 'merge', '-q', '--no-edit', 'side')

    expect(await history.revert(repo, await head(repo))).toEqual({ conflicted: false })
    expect(await filesAt(repo)).toEqual(['main.txt', 'one.txt'])
  })

  it('stops on conflicts, and nothing else rewrites history until it’s finished', async () => {
    const repo = await makeRepo()
    for (const [index, text] of ['one', 'two', 'three'].entries()) {
      write(repo, 'a.txt', `${text}\n`)
      await commitAt(repo, text, 1_700_000_000 + index * 60)
    }
    const two = await head(repo, 'HEAD~1')

    expect(await history.revert(repo, two)).toEqual({ conflicted: true })
    expect((await commands.status(repo)).operation).toEqual({ kind: 'revert' })
    await expect(history.revert(repo, two)).rejects.toThrow('Finish the revert first')
    await expect(history.reset(repo, two, 'hard')).rejects.toThrow('Finish the revert first')
    await expect(history.amend(repo, 'Amended')).rejects.toThrow('Finish the revert first')
    await expect(history.reword(repo, await head(repo), 'Reworded')).rejects.toThrow('Finish the revert first')

    await commands.abortOperation(repo)
    expect((await commands.status(repo)).operation).toBeUndefined()
    expect(await subjects(repo)).toEqual(['one', 'two', 'three'])
  })
})

describe('reset', () => {
  it('moves the branch, keeping the changes staged, unstaged or not at all', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'base\n')
    await commitAt(repo, 'base', 1_700_000_000)
    const base = await head(repo)
    write(repo, 'a.txt', 'changed\n')
    write(repo, 'b.txt', 'new\n')
    await commitAt(repo, 'second', 1_700_000_100)
    const second = await head(repo)
    const changes = async (): Promise<unknown[]> =>
      (await commands.status(repo)).entries.map((e) => [e.path, e.index, e.worktree, e.untracked])

    await history.reset(repo, base, 'soft')
    expect(await head(repo)).toBe(base)
    expect(await changes()).toEqual([
      ['a.txt', 'M', null, false],
      ['b.txt', 'A', null, false]
    ])

    await git(repo, 'reset', '-q', '--hard', second)
    await history.reset(repo, base, 'mixed')
    expect(await head(repo)).toBe(base)
    expect(await changes()).toEqual([
      ['a.txt', null, 'M', false],
      ['b.txt', null, null, true]
    ])

    await git(repo, 'reset', '-q', '--hard', second)
    await history.reset(repo, base.slice(0, 7), 'hard')
    expect(await head(repo)).toBe(base)
    expect(await changes()).toEqual([])
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('base\n')
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false)

    await expect(history.reset(repo, '--hard', 'hard')).rejects.toThrow(/Invalid commit hash/)
  })
})

describe('interactive rebase', () => {
  it('lists the commits after a base, oldest first, with their whole messages', async () => {
    const repo = await linearRepo(['one', 'two', 'three'])
    write(repo, 'four.txt', 'four\n')
    await commitAt(repo, 'four\n\nThe body.', 1_700_000_500)

    const all = await history.rebaseCommits(repo, null)
    expect(all.map((c) => c.subject)).toEqual(['one', 'two', 'three', 'four'])
    expect(all[3]).toEqual({
      hash: await head(repo),
      subject: 'four',
      message: 'four\n\nThe body.',
      authorName: 'Test User',
      authorDate: 1_700_000_500,
      isMerge: false
    })
    expect((await history.rebaseCommits(repo, all[1]!.hash)).map((c) => c.subject)).toEqual(['three', 'four'])
    expect(await history.rebaseCommits(repo, await head(repo))).toEqual([])
  })

  it('reorders commits', async () => {
    const repo = await linearRepo()
    const one = await head(repo, 'HEAD~3')

    const plan = await steps(repo, ['pick four', 'pick two', 'pick three'])
    expect(await history.interactiveRebase(repo, one, plan)).toEqual({ conflicted: false })
    expect(await subjects(repo)).toEqual(['one', 'four', 'two', 'three'])
    expect(await head(repo, 'HEAD~3')).toBe(one)
    expect(await filesAt(repo, 'HEAD~2')).toEqual(['four.txt', 'one.txt'])
    expect((await commands.status(repo)).operation).toBeUndefined()
    expect(fs.existsSync(rebaseDir(repo))).toBe(false)
  })

  it('squashes with a new message, or with git’s combined one', async () => {
    const repo = await linearRepo()
    const one = await head(repo, 'HEAD~3')
    // The new message names the whole group, a fixup after it included.
    const plan = await steps(repo, ['pick two', 'squash three', 'fixup four'], { three: 'Two to four\n\nTogether.' })
    expect(await history.interactiveRebase(repo, one, plan)).toEqual({ conflicted: false })
    expect(await subjects(repo)).toEqual(['one', 'Two to four'])
    expect(await message(repo)).toBe('Two to four\n\nTogether.')
    expect(await filesAt(repo)).toEqual(['four.txt', 'one.txt', 'three.txt', 'two.txt'])

    const other = await linearRepo()
    await history.interactiveRebase(other, await head(other, 'HEAD~3'), await steps(other, ['pick two', 'squash three', 'pick four']))
    expect(await subjects(other)).toEqual(['one', 'two', 'four'])
    expect(await message(other, 'HEAD~1')).toBe('two\n\nthree')
  })

  it('folds fixups into the commit before them, keeping its message', async () => {
    const repo = await linearRepo()
    await history.interactiveRebase(repo, await head(repo, 'HEAD~3'), await steps(repo, ['pick two', 'fixup three', 'fixup four']))
    expect(await subjects(repo)).toEqual(['one', 'two'])
    expect(await message(repo)).toBe('two')
    expect(await filesAt(repo)).toEqual(['four.txt', 'one.txt', 'three.txt', 'two.txt'])
  })

  it('drops commits', async () => {
    const repo = await linearRepo()
    await history.interactiveRebase(repo, await head(repo, 'HEAD~3'), await steps(repo, ['pick two', 'drop three', 'pick four']))
    expect(await subjects(repo)).toEqual(['one', 'two', 'four'])
    expect(fs.existsSync(path.join(repo, 'three.txt'))).toBe(false)
  })

  it('rewords commits, and a squash into a reworded commit combines with its new message', async () => {
    const repo = await linearRepo()
    const plan = await steps(repo, ['reword two', 'squash three', 'reword four'], { two: 'Second', four: 'Fourth\n\nWith a body.' })
    await history.interactiveRebase(repo, await head(repo, 'HEAD~3'), plan)
    expect(await subjects(repo)).toEqual(['one', 'Second', 'Fourth'])
    expect(await message(repo, 'HEAD~1')).toBe('Second\n\nthree')
    expect(await message(repo)).toBe('Fourth\n\nWith a body.')
  })

  it('stops at an edit with the rebase in progress, and carries on from there', async () => {
    const repo = await linearRepo()
    const one = await head(repo, 'HEAD~3')
    const two = await head(repo, 'HEAD~2')

    const plan = await steps(repo, ['edit two', 'pick three', 'reword four'], { four: 'Fourth' })
    expect(await history.interactiveRebase(repo, one, plan)).toEqual({ conflicted: false })
    expect((await commands.status(repo)).operation).toMatchObject({ kind: 'rebase', branch: 'main' })
    expect(await head(repo)).toBe(two)
    // The reword's message is still waiting in the git dir.
    expect(fs.existsSync(rebaseDir(repo))).toBe(true)
    await expect(history.interactiveRebase(repo, one, plan)).rejects.toThrow('Finish the rebase first')

    write(repo, 'two.txt', 'edited\n')
    await commands.stage(repo, ['two.txt'])
    await git(repo, 'commit', '-q', '--amend', '--no-edit')
    expect(await commands.continueOperation(repo)).toEqual({ conflicted: false })
    expect((await commands.status(repo)).operation).toBeUndefined()
    expect(await subjects(repo)).toEqual(['one', 'two', 'three', 'Fourth'])
    expect(await git(repo, 'show', 'HEAD~2:two.txt')).toBe('edited\n')
  })

  it('rewrites from the root commit when there is no base', async () => {
    const repo = await linearRepo(['one', 'two', 'three'])
    const plan = await steps(repo, ['pick two', 'reword one', 'pick three'], { one: 'One, moved' })
    expect(await history.interactiveRebase(repo, null, plan)).toEqual({ conflicted: false })
    expect(await subjects(repo)).toEqual(['two', 'One, moved', 'three'])
    expect((await git(repo, 'rev-list', '--max-parents=0', 'HEAD')).trim()).toBe(await head(repo, 'HEAD~2'))
    expect(await filesAt(repo, 'HEAD~2')).toEqual(['two.txt'])
  })

  it('stops on conflicts with the rebase in progress', async () => {
    const repo = await makeRepo()
    for (const [index, text] of ['one', 'two', 'three'].entries()) {
      write(repo, 'a.txt', `${text}\n`)
      await commitAt(repo, text, 1_700_000_000 + index * 60)
    }

    expect(await history.interactiveRebase(repo, await head(repo, 'HEAD~2'), await steps(repo, ['pick three', 'pick two']))).toEqual({
      conflicted: true
    })
    expect((await commands.status(repo)).operation).toMatchObject({ kind: 'rebase', branch: 'main' })
    await commands.abortOperation(repo)
    expect(await subjects(repo)).toEqual(['one', 'two', 'three'])
  })

  it('refuses steps that don’t match the commits, uncommitted changes, a detached HEAD and merges', async () => {
    const repo = await linearRepo()
    const one = await head(repo, 'HEAD~3')
    const all = await steps(repo, ['pick two', 'pick three', 'pick four'])
    const rebase = (plan: RebaseStep[]): Promise<unknown> => history.interactiveRebase(repo, one, plan)
    const withActions = (...actions: RebaseStep['action'][]): RebaseStep[] =>
      all.map((step, i) => ({ ...step, action: actions[i] ?? 'pick' }))

    await expect(rebase(all.slice(0, 2))).rejects.toThrow(/has no step/)
    await expect(rebase([...all, all[0]!])).rejects.toThrow(/listed more than once/)
    await expect(rebase([{ hash: one, action: 'pick' }, ...all])).rejects.toThrow(/isn’t one of the commits being rewritten/)
    await expect(rebase(withActions('squash'))).rejects.toThrow(/no commit before it/)
    await expect(rebase(withActions('drop', 'fixup'))).rejects.toThrow(/no commit before it/)
    await expect(rebase(withActions('drop', 'drop', 'drop'))).rejects.toThrow(/At least one commit has to stay/)
    await expect(rebase(withActions('reword'))).rejects.toThrow(/new message/)
    await expect(rebase([{ hash: '--exec=x', action: 'pick' }])).rejects.toThrow(/Invalid commit hash/)
    await expect(history.interactiveRebase(repo, '--root', all)).rejects.toThrow(/Not a branch or commit/)

    write(repo, 'two.txt', 'uncommitted\n')
    await expect(rebase(all)).rejects.toThrow(/Commit or stash your changes first/)
    await git(repo, 'checkout', '--', 'two.txt')
    // Untracked files don't get in the way.
    write(repo, 'untracked.txt', 'untracked\n')
    expect(await rebase(withActions('pick', 'drop'))).toEqual({ conflicted: false })
    expect(await subjects(repo)).toEqual(['one', 'two', 'four'])

    await git(repo, 'switch', '-q', '--detach')
    await expect(history.interactiveRebase(repo, one, await steps(repo, ['pick two', 'pick four']))).rejects.toThrow(/Check out a branch/)
    await git(repo, 'switch', '-q', 'main')

    await git(repo, 'switch', '-q', '-c', 'side', one)
    write(repo, 'side.txt', 'side\n')
    await commitAt(repo, 'side', 1_700_001_000)
    const side = await head(repo)
    await git(repo, 'switch', '-q', 'main')
    await expect(history.interactiveRebase(repo, side, [{ hash: side, action: 'pick' }])).rejects.toThrow(/isn’t on the checked-out branch/)

    await git(repo, 'merge', '-q', '--no-edit', 'side')
    const merged = await history.rebaseCommits(repo, one)
    expect(merged.filter((c) => c.isMerge)).toHaveLength(1)
    const picks = merged.map((c): RebaseStep => ({ hash: c.hash, action: 'pick' }))
    await expect(history.interactiveRebase(repo, one, picks)).rejects.toThrow(/is a merge commit\. GitLantern can’t keep merges/)
    await expect(history.interactiveRebase(repo, null, picks)).rejects.toThrow(/merge commit/)
  })
})
