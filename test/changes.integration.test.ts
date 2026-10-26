import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import { countConflicts } from '../src/shared/conflicts'
import { hunkKeys, lineKey, parsePatch, selectLines } from '../src/shared/patch'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const read = (repo: string, file: string): string => fs.readFileSync(path.join(repo, file), 'utf8')
const lines = (count: number, change: (n: number) => string = (n) => `line ${n}`): string =>
  Array.from({ length: count }, (_, i) => `${change(i + 1)}\n`).join('')

/** A file of 30 lines, committed, with lines 2 and 25 changed in the working tree. */
async function twoHunks(): Promise<string> {
  const repo = await makeRepo()
  write(repo, 'f.txt', lines(30))
  await commitAt(repo, 'base', 1_700_000_000)
  write(repo, 'f.txt', lines(30, (n) => (n === 2 || n === 25 ? `CHANGED ${n}` : `line ${n}`)))
  return repo
}

describe('discard', () => {
  it('restores tracked files and removes untracked ones, leaving staged changes alone', async () => {
    const repo = await twoHunks()
    write(repo, 'staged.txt', 'staged\n')
    await commands.stage(repo, ['staged.txt'])
    write(repo, 'staged.txt', 'staged, then edited\n')
    write(repo, 'junk.txt', 'junk\n')
    const removed: string[] = []

    await commands.discard(repo, ['f.txt', 'staged.txt', 'junk.txt'], async (file) => {
      removed.push(path.relative(repo, file))
      fs.rmSync(file)
    })
    expect(read(repo, 'f.txt')).toBe(lines(30))
    expect(read(repo, 'staged.txt')).toBe('staged\n')
    expect(removed).toEqual(['junk.txt'])
    expect((await commands.status(repo)).entries.map((e) => [e.path, e.index, e.worktree])).toEqual([['staged.txt', 'A', null]])
  })

  it('treats file names as names, not patterns', async () => {
    const repo = await makeRepo()
    write(repo, '[a].txt', '1\n')
    write(repo, 'a.txt', '1\n')
    await commitAt(repo, 'base', 1_700_000_000)
    write(repo, '[a].txt', '2\n')
    write(repo, 'a.txt', '2\n')
    await commands.discard(repo, ['[a].txt'])
    expect(read(repo, '[a].txt')).toBe('1\n')
    expect(read(repo, 'a.txt')).toBe('2\n')
  })
})

describe('staging lines and hunks', () => {
  it('stages one hunk, then unstages it again', async () => {
    const repo = await twoHunks()
    const patch = parsePatch(await commands.diff(repo, { kind: 'worktree', path: 'f.txt' }))!
    expect(patch.hunks).toHaveLength(2)

    await commands.applyPatch(repo, 'f.txt', selectLines(patch, new Set(hunkKeys(patch, 1)), 'forward')!, 'stage')
    const staged = await commands.diff(repo, { kind: 'index', path: 'f.txt' })
    expect(staged).toContain('+CHANGED 25')
    expect(staged).not.toContain('CHANGED 2\n')
    expect(await commands.diff(repo, { kind: 'worktree', path: 'f.txt' })).toContain('+CHANGED 2\n')

    const index = parsePatch(staged)!
    await commands.applyPatch(repo, 'f.txt', selectLines(index, new Set(hunkKeys(index, 0)), 'reverse')!, 'unstage')
    expect(await commands.diff(repo, { kind: 'index', path: 'f.txt' })).toBe('')
  })

  it('stages only the added line of a changed line, keeping the old one', async () => {
    const repo = await twoHunks()
    const patch = parsePatch(await commands.diff(repo, { kind: 'worktree', path: 'f.txt' }))!
    // Hunk 0: " line 1", "-line 2", "+CHANGED 2", …
    expect(patch.hunks[0]?.lines[2]).toMatchObject({ kind: 'add', text: 'CHANGED 2' })
    await commands.applyPatch(repo, 'f.txt', selectLines(patch, new Set([lineKey(0, 2)]), 'forward')!, 'stage')
    expect((await git(repo, 'show', ':f.txt')).split('\n').slice(0, 4)).toEqual(['line 1', 'line 2', 'CHANGED 2', 'line 3'])
  })

  it('discards one hunk from the working tree', async () => {
    const repo = await twoHunks()
    const patch = parsePatch(await commands.diff(repo, { kind: 'worktree', path: 'f.txt' }))!
    await commands.applyPatch(repo, 'f.txt', selectLines(patch, new Set(hunkKeys(patch, 0)), 'reverse')!, 'discard')
    expect(read(repo, 'f.txt')).toBe(lines(30, (n) => (n === 25 ? 'CHANGED 25' : `line ${n}`)))
  })

  it('refuses a patch for another file, or one that no longer fits', async () => {
    const repo = await twoHunks()
    const patch = selectLines(parsePatch(await commands.diff(repo, { kind: 'worktree', path: 'f.txt' }))!, new Set([lineKey(0, 2)]), 'forward')!
    await expect(commands.applyPatch(repo, 'other.txt', patch, 'stage')).rejects.toThrow(/isn’t for other.txt/)
    write(repo, 'f.txt', 'rewritten\n')
    await expect(commands.applyPatch(repo, 'f.txt', patch, 'discard')).rejects.toThrow(/couldn’t apply/)
  })
})

describe('picking sides of conflicts', () => {
  /** main and feature both change both conflict regions of c.txt; a merge of feature stops on them. */
  async function conflicted(): Promise<string> {
    const repo = await makeRepo()
    write(repo, 'c.txt', lines(20))
    write(repo, 'gone.txt', 'base\n')
    await commitAt(repo, 'base', 1_700_000_000)
    await git(repo, 'switch', '-q', '-c', 'feature')
    write(repo, 'c.txt', lines(20, (n) => (n === 2 || n === 18 ? `feature ${n}` : `line ${n}`)))
    fs.rmSync(path.join(repo, 'gone.txt'))
    await commitAt(repo, 'feature', 1_700_000_100)
    await git(repo, 'switch', '-q', 'main')
    write(repo, 'c.txt', lines(20, (n) => (n === 2 || n === 18 ? `main ${n}` : `line ${n}`)))
    write(repo, 'gone.txt', 'main edit\n')
    await commitAt(repo, 'main', 1_700_000_200)
    expect(await commands.merge(repo, 'feature')).toEqual({ conflicted: true })
    return repo
  }

  it('resolves conflicts one at a time and stages the file after the last one', async () => {
    const repo = await conflicted()
    expect(countConflicts(read(repo, 'c.txt'))).toBe(2)
    expect(await commands.resolveConflict(repo, 'c.txt', { index: 1, choice: 'theirs', conflicts: 2 })).toEqual({ remaining: 1 })
    await expect(commands.resolveConflict(repo, 'c.txt', { index: 0, choice: 'ours', conflicts: 2 })).rejects.toThrow(/changed on disk/)
    expect(await commands.resolveConflict(repo, 'c.txt', { index: 0, choice: 'both', conflicts: 1 })).toEqual({ remaining: 0 })

    expect(read(repo, 'c.txt')).toBe(lines(20, (n) => (n === 2 ? 'main 2\nfeature 2' : n === 18 ? 'feature 18' : `line ${n}`)))
    const entry = (await commands.status(repo)).entries.find((e) => e.path === 'c.txt')
    expect(entry).toMatchObject({ conflicted: false, index: 'M' })
  })

  it('takes a whole side, deleting the file when that side deleted it', async () => {
    const repo = await conflicted()
    await commands.resolveFile(repo, 'c.txt', 'theirs')
    expect(read(repo, 'c.txt')).toBe(lines(20, (n) => (n === 2 || n === 18 ? `feature ${n}` : `line ${n}`)))
    await commands.resolveFile(repo, 'gone.txt', 'theirs')
    expect(fs.existsSync(path.join(repo, 'gone.txt'))).toBe(false)
    expect((await commands.status(repo)).entries.every((e) => !e.conflicted)).toBe(true)
    expect(await commands.continueOperation(repo)).toEqual({ conflicted: false })
  })
})

describe('history filters', () => {
  it('shows one branch, or the commits that changed a path', async () => {
    const repo = await makeRepo()
    write(repo, 'docs/readme.md', '1\n')
    await commitAt(repo, 'docs', 1_700_000_000)
    write(repo, 'src/app.ts', '1\n')
    await commitAt(repo, 'code', 1_700_000_100)
    await git(repo, 'switch', '-q', '-c', 'feature')
    write(repo, 'docs/readme.md', '2\n')
    await commitAt(repo, 'more docs', 1_700_000_200)
    await git(repo, 'switch', '-q', 'main')

    expect((await commands.log(repo)).map((c) => c.subject)).toEqual(['more docs', 'code', 'docs'])
    expect((await commands.log(repo, 2000, { branch: 'main' })).map((c) => c.subject)).toEqual(['code', 'docs'])
    const docs = await commands.log(repo, 2000, { path: 'docs' })
    expect(docs.map((c) => c.subject)).toEqual(['more docs', 'docs'])
    // Parents are rewritten to the nearest commit that touched the path, so the graph still joins up.
    expect(docs[0]?.parents).toEqual([docs[1]?.hash])
    await expect(commands.log(repo, 2000, { branch: '--all' })).rejects.toThrow(/Not a branch or commit/)
  })
})
