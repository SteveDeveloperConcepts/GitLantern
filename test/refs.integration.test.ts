import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as refs from '../src/main/git/refs'
import { runGit } from '../src/main/git/runGit'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const F = '\x1f'
const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()
const localBranches = async (repo: string): Promise<string[]> =>
  (await git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).split('\n').filter(Boolean)
const serverRefs = async (repo: string, pattern: string): Promise<string[]> =>
  (await git(repo, 'ls-remote', '--refs', 'origin', pattern))
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1] ?? '')

/** A bare "server" with main, and two clones of it: ours and someone else's. */
async function setup(): Promise<{ ours: string; theirs: string; server: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-refs-'))
  const server = path.join(dir, 'server.git')
  await runGit(['init', '-q', '--bare', '-b', 'main', server], { cwd: dir })
  const ours = path.join(dir, 'ours')
  const theirs = path.join(dir, 'theirs')
  await runGit(['clone', '-q', server, ours], { cwd: dir })
  write(ours, 'a.txt', 'base\n')
  await commitAt(ours, 'base', 1_700_000_000)
  await git(ours, 'push', '-q', '-u', 'origin', 'main')
  await runGit(['clone', '-q', server, theirs], { cwd: dir })
  return { ours, theirs, server }
}

/** A branch with one commit of its own, made without checking it out for long. */
async function branchWithCommit(repo: string, name: string, at: number): Promise<void> {
  await git(repo, 'switch', '-q', '-c', name)
  write(repo, `${name}.txt`, `${name}\n`)
  await commitAt(repo, `work on ${name}`, at)
  await git(repo, 'switch', '-q', 'main')
}

describe('parseTags', () => {
  it('reads annotated and lightweight tags', () => {
    const out = [
      ['refs/tags/v2', 'tag', 'aaaa', 'cccc', 'Release 2', '1700000500', 'Ann Tagger', ''].join(F),
      ['refs/tags/light', 'commit', 'bbbb', '', 'commit subject', '1700000000', '', 'Bob Author'].join(F),
      ''
    ].join('\x1e\n')
    expect(refs.parseTags(out)).toEqual([
      { name: 'v2', hash: 'cccc', annotated: true, message: 'Release 2', date: 1_700_000_500, tagger: 'Ann Tagger' },
      { name: 'light', hash: 'bbbb', annotated: false, message: '', date: 1_700_000_000, tagger: 'Bob Author' }
    ])
    expect(refs.parseTags('')).toEqual([])
  })
})

describe('branches', () => {
  it('deletes merged branches and reports unmerged ones until forced', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    await commitAt(repo, 'first', 1_700_000_000)
    await git(repo, 'branch', 'merged')
    await branchWithCommit(repo, 'unmerged', 1_700_000_100)
    const tip = await head(repo, 'unmerged')

    expect(await refs.deleteBranch(repo, 'merged', false)).toBe('deleted')
    expect(await refs.deleteBranch(repo, 'unmerged', false)).toBe('not-merged')
    expect(await head(repo, 'unmerged')).toBe(tip)
    expect(await refs.deleteBranch(repo, 'unmerged', true)).toBe('deleted')
    expect(await localBranches(repo)).toEqual(['main'])
  })

  it('refuses the checked-out branch, missing branches and bad names', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    await commitAt(repo, 'first', 1_700_000_000)
    await git(repo, 'branch', 'other')
    await git(repo, 'switch', '-q', 'other')
    await git(repo, 'switch', '-q', 'main')

    await expect(refs.deleteBranch(repo, 'main', true)).rejects.toThrow('main is checked out. Switch to another branch first.')
    await expect(refs.deleteBranch(repo, 'nope', false)).rejects.toThrow('There’s no branch called nope')
    await expect(refs.deleteBranch(repo, '-D', true)).rejects.toThrow('"-D" is not a valid branch name')
    // A shorthand for the previous branch, which check-ref-format would otherwise expand to `other`.
    await expect(refs.deleteBranch(repo, '@{-1}', true)).rejects.toThrow(/is not a valid branch name/)
    await expect(refs.deleteBranch(repo, 'a..b', true)).rejects.toThrow(/is not a valid branch name/)
    expect(await localBranches(repo)).toEqual(['main', 'other'])
  })

  it('counts a branch as merged when its upstream has its commits, like git does', async () => {
    const { ours } = await setup()
    await branchWithCommit(ours, 'feature', 1_700_000_100)
    await git(ours, 'push', '-q', '-u', 'origin', 'feature')
    // Not on main (HEAD), but safe on origin/feature.
    expect(await refs.deleteBranch(ours, 'feature', false)).toBe('deleted')
  })

  it('renames a branch, keeping its upstream', async () => {
    const { ours } = await setup()
    await branchWithCommit(ours, 'feat', 1_700_000_100)
    await git(ours, 'push', '-q', '-u', 'origin', 'feat')
    await git(ours, 'branch', 'taken')

    await refs.renameBranch(ours, 'feat', 'feature')
    expect(await localBranches(ours)).toEqual(['feature', 'main', 'taken'])
    expect((await git(ours, 'config', '--get', 'branch.feature.merge')).trim()).toBe('refs/heads/feat')

    await expect(refs.renameBranch(ours, 'feature', 'taken')).rejects.toThrow('There’s already a branch called taken')
    await expect(refs.renameBranch(ours, 'feature', 'bad name')).rejects.toThrow('"bad name" is not a valid branch name')
    await expect(refs.renameBranch(ours, 'missing', 'x')).rejects.toThrow('There’s no branch called missing')

    // Only the case changes: a case-insensitive disk sees the same file.
    await refs.renameBranch(ours, 'feature', 'Feature')
    expect(await localBranches(ours)).toEqual(['Feature', 'main', 'taken'])
  })

  it('sets and unsets a branch’s upstream', async () => {
    const { ours } = await setup()
    await branchWithCommit(ours, 'feat', 1_700_000_100)
    await git(ours, 'push', '-q', 'origin', 'feat')
    await git(ours, 'branch', 'other')

    await refs.setUpstream(ours, 'other', 'origin/feat')
    expect((await git(ours, 'for-each-ref', '--format=%(upstream:short)', 'refs/heads/other')).trim()).toBe('origin/feat')
    await refs.setUpstream(ours, 'other', null)
    expect((await git(ours, 'for-each-ref', '--format=%(upstream:short)', 'refs/heads/other')).trim()).toBe('')
    // Unlinking a branch that isn't linked is already done.
    await refs.setUpstream(ours, 'other', null)

    await expect(refs.setUpstream(ours, 'other', 'origin/nope')).rejects.toThrow(
      'origin/nope isn’t a remote branch. Fetch first if it’s new.'
    )
    await expect(refs.setUpstream(ours, 'other', 'feat')).rejects.toThrow(/isn’t a remote branch/)
    await expect(refs.setUpstream(ours, 'other', '--evil')).rejects.toThrow(/Not a branch or commit/)
  })

  it('deletes a branch on the remote, and its remote-tracking branch', async () => {
    const { ours } = await setup()
    await branchWithCommit(ours, 'feat', 1_700_000_100)
    await git(ours, 'push', '-q', 'origin', 'feat')
    expect(await serverRefs(ours, 'refs/heads/*')).toEqual(['refs/heads/feat', 'refs/heads/main'])

    await refs.deleteRemoteBranch(ours, 'origin/feat')
    expect(await serverRefs(ours, 'refs/heads/*')).toEqual(['refs/heads/main'])
    expect(await git(ours, 'for-each-ref', 'refs/remotes/origin/feat')).toBe('')
    expect(await localBranches(ours)).toEqual(['feat', 'main'])

    await expect(refs.deleteRemoteBranch(ours, 'upstream/feat')).rejects.toThrow(
      'upstream/feat isn’t a branch on any of this repository’s remotes'
    )
    await expect(refs.deleteRemoteBranch(ours, 'origin/-x')).rejects.toThrow(/is not a valid branch name/)
  })

  it('pushes a branch that isn’t checked out, linking it the first time', async () => {
    const { ours } = await setup()
    await branchWithCommit(ours, 'feat', 1_700_000_100)

    await refs.pushBranch(ours, 'feat', 'origin')
    expect(await serverRefs(ours, 'refs/heads/feat')).toEqual(['refs/heads/feat'])
    expect((await git(ours, 'for-each-ref', '--format=%(upstream:short)', 'refs/heads/feat')).trim()).toBe('origin/feat')

    // A later push moves the branch on the server.
    await git(ours, 'switch', '-q', 'feat')
    write(ours, 'more.txt', 'more\n')
    await commitAt(ours, 'more work', 1_700_000_200)
    await git(ours, 'switch', '-q', 'main')
    await refs.pushBranch(ours, 'feat', 'origin')
    expect((await git(ours, 'ls-remote', 'origin', 'refs/heads/feat')).split('\t')[0]).toBe(await head(ours, 'feat'))

    await expect(refs.pushBranch(ours, 'feat', 'nowhere')).rejects.toThrow('This repository has no remote called nowhere')
    await expect(refs.pushBranch(ours, 'missing', 'origin')).rejects.toThrow('There’s no branch called missing')
  })

  it('explains a refused branch push: someone else pushed', async () => {
    const { ours, theirs } = await setup()
    await branchWithCommit(ours, 'feat', 1_700_000_100)
    await refs.pushBranch(ours, 'feat', 'origin')

    await git(theirs, 'fetch', '-q')
    await git(theirs, 'switch', '-q', 'feat')
    write(theirs, 'theirs.txt', 'theirs\n')
    await commitAt(theirs, 'their work', 1_700_000_200)
    await git(theirs, 'push', '-q')

    await git(ours, 'switch', '-q', 'feat')
    write(ours, 'ours.txt', 'ours\n')
    await commitAt(ours, 'our work', 1_700_000_300)
    await git(ours, 'switch', '-q', 'main')

    await expect(refs.pushBranch(ours, 'feat', 'origin')).rejects.toThrow(
      'Push refused: origin/feat has 1 commit that feat doesn’t, and pushing would throw it away. Check out feat and click Pull'
    )
  })

  it('explains a refused branch push: its commits were rewritten', async () => {
    const { ours } = await setup()
    await branchWithCommit(ours, 'feat', 1_700_000_100)
    await refs.pushBranch(ours, 'feat', 'origin')
    await git(ours, 'switch', '-q', 'feat')
    await git(ours, 'commit', '-q', '--amend', '-m', 'work on feat, reworded')
    await git(ours, 'switch', '-q', 'main')

    await expect(refs.pushBranch(ours, 'feat', 'origin')).rejects.toThrow(
      /^Push refused: origin\/feat still has the old copies of commits you’ve since rewritten.*Check out feat and click Push/
    )
  })
})

describe('tags', () => {
  it('creates lightweight and annotated tags and lists them newest first', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    await commitAt(repo, 'first', 1_700_000_000)
    const first = await head(repo)
    write(repo, 'a.txt', '2\n')
    await commitAt(repo, 'second', 1_700_000_100)
    const second = await head(repo)

    await refs.createTag(repo, { name: 'light', target: first })
    await refs.createTag(repo, { name: 'v1.0', target: 'main', message: 'Release 1.0\n\n#42 is fixed\n' })
    // Whitespace alone isn't a message: lightweight.
    await refs.createTag(repo, { name: 'blank', target: 'main', message: '  \n' })

    const list = await refs.tags(repo)
    expect(list.map((tag) => tag.name)).toEqual(['v1.0', 'blank', 'light'])
    expect(list[0]).toMatchObject({ name: 'v1.0', hash: second, annotated: true, message: 'Release 1.0', tagger: 'Test User' })
    expect(list[0]?.date).toBeGreaterThan(1_700_000_100)
    expect(list[1]).toEqual({ name: 'blank', hash: second, annotated: false, message: '', date: 1_700_000_100, tagger: 'Test User' })
    expect(list[2]).toEqual({ name: 'light', hash: first, annotated: false, message: '', date: 1_700_000_000, tagger: 'Test User' })
    expect(await git(repo, 'tag', '-l', '--format=%(contents)', 'v1.0')).toBe('Release 1.0\n\n#42 is fixed\n\n')
  })

  it('refuses bad tags with a reason', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    await commitAt(repo, 'first', 1_700_000_000)
    await refs.createTag(repo, { name: 'v1', target: 'main' })

    await expect(refs.createTag(repo, { name: 'v1', target: 'main' })).rejects.toThrow('A tag called v1 already exists.')
    await expect(refs.createTag(repo, { name: 'v2', target: 'main', sign: true })).rejects.toThrow('A signed tag needs a message.')
    await expect(refs.createTag(repo, { name: '-f', target: 'main' })).rejects.toThrow('"-f" is not a valid tag name')
    await expect(refs.createTag(repo, { name: 'a b', target: 'main' })).rejects.toThrow('"a b" is not a valid tag name')
    await expect(refs.createTag(repo, { name: 'v2', target: '--all' })).rejects.toThrow(/Not a branch or commit/)
    await expect(refs.createTag(repo, { name: 'v2', target: 'nope' })).rejects.toThrow('There’s no branch or commit called nope')
    await expect(refs.deleteTag(repo, 'nope')).rejects.toThrow('There’s no tag called nope')

    await refs.deleteTag(repo, 'v1')
    expect(await refs.tags(repo)).toEqual([])
  })

  it('pushes tags to a remote and deletes them there', async () => {
    const { ours, theirs } = await setup()
    await refs.createTag(ours, { name: 'v1', target: 'main', message: 'One' })
    await refs.createTag(ours, { name: 'light', target: 'main' })

    await refs.pushTag(ours, 'v1', 'origin')
    await refs.pushTag(ours, 'light', 'origin')
    expect(await serverRefs(ours, 'refs/tags/*')).toEqual(['refs/tags/light', 'refs/tags/v1'])

    await refs.deleteRemoteTag(ours, 'light', 'origin')
    expect(await serverRefs(ours, 'refs/tags/*')).toEqual(['refs/tags/v1'])
    expect((await refs.tags(ours)).map((tag) => tag.name)).toEqual(['v1', 'light'])

    // Someone else's tag of the same name on another commit.
    write(theirs, 'b.txt', 'b\n')
    await commitAt(theirs, 'theirs', 1_700_000_100)
    await git(theirs, 'tag', 'release')
    await git(theirs, 'push', '-q', 'origin', 'refs/tags/release')
    await refs.createTag(ours, { name: 'release', target: 'main' })
    await expect(refs.pushTag(ours, 'release', 'origin')).rejects.toThrow(
      'Push refused: origin already has a different tag called release. Delete it there first to replace it.'
    )
    await expect(refs.pushTag(ours, 'nope', 'origin')).rejects.toThrow('There’s no tag called nope')
    await expect(refs.deleteRemoteTag(ours, 'v1', '-x')).rejects.toThrow(/not a valid remote name/)
  })
})
