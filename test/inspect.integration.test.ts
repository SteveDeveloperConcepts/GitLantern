import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as inspect from '../src/main/git/inspect'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

// Two 1×1 PNGs (transparent and black). Their headers have NUL bytes, as every PNG does.
const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const png = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString('base64')}`
const pair = (before: Buffer | null, after: Buffer | null): object => ({
  before: before && png(before),
  after: after && png(after),
  beforeSize: before?.length ?? null,
  afterSize: after?.length ?? null
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()
const writeBytes = (repo: string, file: string, bytes: Buffer): void => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), bytes)
}

describe('image pairs', () => {
  it('reads both sides of an image for every kind of diff', async () => {
    const repo = await makeRepo()
    writeBytes(repo, 'my logo.png', RED)
    await commitAt(repo, 'add logo', 1_700_000_000)
    const root = await head(repo)

    // Root commit: nothing before.
    expect(await inspect.imagePair(repo, { kind: 'commit', hash: root, path: 'my logo.png' })).toEqual(pair(null, RED))

    // Working copy against the index, then the index against HEAD.
    writeBytes(repo, 'my logo.png', BLUE)
    expect(await inspect.imagePair(repo, { kind: 'worktree', path: 'my logo.png' })).toEqual(pair(RED, BLUE))
    expect(await inspect.imagePair(repo, { kind: 'index', path: 'my logo.png' })).toEqual(pair(RED, RED))
    await git(repo, 'add', 'my logo.png')
    expect(await inspect.imagePair(repo, { kind: 'index', path: 'my logo.png' })).toEqual(pair(RED, BLUE))
    expect(await inspect.imagePair(repo, { kind: 'worktree', path: 'my logo.png' })).toEqual(pair(BLUE, BLUE))

    writeBytes(repo, 'new.png', RED)
    expect(await inspect.imagePair(repo, { kind: 'worktree', path: 'new.png', untracked: true })).toEqual(pair(null, RED))
    fs.rmSync(path.join(repo, 'new.png'))

    await commitAt(repo, 'blue logo', 1_700_000_100)
    const changed = await head(repo)
    expect(await inspect.imagePair(repo, { kind: 'commit', hash: changed, path: 'my logo.png' })).toEqual(pair(RED, BLUE))

    // A rename: the old side is read from the old name.
    fs.mkdirSync(path.join(repo, 'art'))
    await git(repo, 'mv', 'my logo.png', 'art/logo.png')
    await commitAt(repo, 'move logo', 1_700_000_200)
    const moved = await head(repo)
    expect(await inspect.imagePair(repo, { kind: 'commit', hash: moved, path: 'art/logo.png', origPath: 'my logo.png' })).toEqual(
      pair(BLUE, BLUE)
    )
    expect(await inspect.imagePair(repo, { kind: 'range', from: root, to: moved, path: 'art/logo.png', origPath: 'my logo.png' })).toEqual(
      pair(RED, BLUE)
    )
    expect(await inspect.imagePair(repo, { kind: 'range', from: root, to: 'main', path: 'art/logo.png' })).toEqual(pair(null, BLUE))

    // Deleted: nothing after.
    await git(repo, 'rm', '-q', 'art/logo.png')
    await commitAt(repo, 'remove logo', 1_700_000_300)
    expect(await inspect.imagePair(repo, { kind: 'commit', hash: await head(repo), path: 'art/logo.png' })).toEqual(pair(BLUE, null))
  })

  it('reads a stash’s images, untracked ones included', async () => {
    const repo = await makeRepo()
    writeBytes(repo, 'logo.png', RED)
    await commitAt(repo, 'add logo', 1_700_000_000)
    writeBytes(repo, 'logo.png', BLUE)
    writeBytes(repo, 'icons/new.png', RED)
    await git(repo, 'stash', 'push', '-q', '--include-untracked')
    const stash = await head(repo, 'stash@{0}')

    expect(await inspect.imagePair(repo, { kind: 'stash', hash: stash, path: 'logo.png' })).toEqual(pair(RED, BLUE))
    expect(await inspect.imagePair(repo, { kind: 'stash', hash: stash, path: 'icons/new.png', untracked: true })).toEqual(pair(null, RED))
  })

  it('refuses files that aren’t images, are outside the repository or are too big', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'text\n')
    await commitAt(repo, 'first', 1_700_000_000)

    await expect(inspect.imagePair(repo, { kind: 'worktree', path: 'a.txt' })).rejects.toThrow(
      'a.txt isn’t an image GitLantern can preview'
    )
    await expect(inspect.imagePair(repo, { kind: 'worktree', path: '../outside.png' })).rejects.toThrow('Path is outside the repository')
    await expect(inspect.imagePair(repo, { kind: 'commit', hash: '--all', path: 'x.png' })).rejects.toThrow(/Invalid commit hash/)
    await expect(inspect.imagePair(repo, { kind: 'range', from: 'main', to: 'a..b', path: 'x.png' })).rejects.toThrow(
      /Not a branch or commit/
    )

    fs.writeFileSync(path.join(repo, 'huge.png'), Buffer.alloc(21 * 1024 * 1024))
    await expect(inspect.imagePair(repo, { kind: 'worktree', path: 'huge.png', untracked: true })).rejects.toThrow(
      'huge.png is too big to preview: 21.0 MB, and images up to 20 MB are shown.'
    )
  })
})

describe('compareFiles', () => {
  it('lists the files changed between two revisions', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', '1\n')
    write(repo, 'b.txt', 'b\n')
    await commitAt(repo, 'first', 1_700_000_000)
    const first = await head(repo)
    write(repo, 'a.txt', '1\n2\n')
    fs.rmSync(path.join(repo, 'b.txt'))
    write(repo, 'c.txt', 'c\n')
    await commitAt(repo, 'second', 1_700_000_100)

    expect(await inspect.compareFiles(repo, first, 'main')).toEqual([
      { status: 'M', path: 'a.txt', additions: 1, deletions: 0 },
      { status: 'D', path: 'b.txt', additions: 0, deletions: 1 },
      { status: 'A', path: 'c.txt', additions: 1, deletions: 0 }
    ])
    await expect(inspect.compareFiles(repo, '--output=x', 'main')).rejects.toThrow(/Not a branch or commit/)
  })
})

describe('blame', () => {
  it('parses porcelain output', () => {
    const hash = 'a'.repeat(40)
    const zero = '0'.repeat(40)
    const out = [
      `${hash} 1 1 2`,
      'author Ann',
      'author-mail <ann@example.com>',
      'author-time 1700000000',
      'author-tz +0000',
      'committer Ann',
      'summary First commit',
      'filename f.txt',
      '\tline one\r',
      `${hash} 2 2`,
      '\tline two',
      `${zero} 3 3 1`,
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 1700000100',
      'summary Version of f.txt from f.txt',
      'filename f.txt',
      '\t\tindented',
      ''
    ].join('\n')
    expect(inspect.parseBlame(out)).toEqual({
      binary: false,
      lines: [
        { number: 1, text: 'line one', hash },
        { number: 2, text: 'line two', hash },
        { number: 3, text: '\tindented', hash: zero }
      ],
      commits: {
        [hash]: {
          hash,
          authorName: 'Ann',
          authorEmail: 'ann@example.com',
          authorDate: 1_700_000_000,
          summary: 'First commit',
          uncommitted: false
        },
        [zero]: {
          hash: zero,
          authorName: 'Not Committed Yet',
          authorEmail: 'not.committed.yet',
          authorDate: 1_700_000_100,
          summary: 'Version of f.txt from f.txt',
          uncommitted: true
        }
      }
    })
  })

  it('blames the working copy, uncommitted lines included, or a revision', async () => {
    const repo = await makeRepo()
    write(repo, 'f.txt', 'one\ntwo\n')
    await commitAt(repo, 'first', 1_700_000_000)
    const first = await head(repo)
    write(repo, 'f.txt', 'one\ntwo\nthree\n')
    await commitAt(repo, 'second', 1_700_000_100)
    const second = await head(repo)
    write(repo, 'f.txt', 'one\nTWO\nthree\n')

    const working = await inspect.blame(repo, 'f.txt')
    expect(working.binary).toBe(false)
    expect(working.lines.map((line) => [line.number, line.text])).toEqual([
      [1, 'one'],
      [2, 'TWO'],
      [3, 'three']
    ])
    expect(working.lines[0]?.hash).toBe(first)
    expect(working.lines[2]?.hash).toBe(second)
    const uncommitted = working.commits[working.lines[1]?.hash ?? '']
    expect(uncommitted?.uncommitted).toBe(true)
    expect(working.commits[first]).toEqual({
      hash: first,
      authorName: 'Test User',
      authorEmail: 'test@example.com',
      authorDate: 1_700_000_000,
      summary: 'first',
      uncommitted: false
    })

    const atFirst = await inspect.blame(repo, 'f.txt', first)
    expect(atFirst.lines).toEqual([
      { number: 1, text: 'one', hash: first },
      { number: 2, text: 'two', hash: first }
    ])
    expect(Object.keys(atFirst.commits)).toEqual([first])
  })

  it('reports binary files and files with nothing to blame', async () => {
    const repo = await makeRepo()
    writeBytes(repo, 'logo.png', RED)
    write(repo, 'a.txt', 'a\n')
    await commitAt(repo, 'first', 1_700_000_000)

    expect(await inspect.blame(repo, 'logo.png')).toEqual({ binary: true, lines: [], commits: {} })
    expect(await inspect.blame(repo, 'logo.png', 'HEAD')).toEqual({ binary: true, lines: [], commits: {} })

    write(repo, 'new.txt', 'new\n')
    await expect(inspect.blame(repo, 'new.txt')).rejects.toThrow('new.txt hasn’t been committed yet, so there’s no history to blame.')
    await expect(inspect.blame(repo, 'new.txt', 'HEAD')).rejects.toThrow('new.txt doesn’t exist in HEAD')
    fs.rmSync(path.join(repo, 'a.txt'))
    await expect(inspect.blame(repo, 'a.txt')).rejects.toThrow('a.txt isn’t in the working copy. Blame it at a commit instead.')
    expect((await inspect.blame(repo, 'a.txt', 'HEAD')).lines).toHaveLength(1)
    await expect(inspect.blame(repo, 'a.txt', '-L1,1')).rejects.toThrow(/Not a branch or commit/)
    await expect(inspect.blame(repo, '../a.txt')).rejects.toThrow('Path is outside the repository')
  })
})

describe('fileHistory', () => {
  it('follows a file across a rename, newest first', async () => {
    const repo = await makeRepo()
    write(repo, 'old name.txt', '1\n')
    write(repo, 'other.txt', 'x\n')
    await commitAt(repo, 'add', 1_700_000_000)
    write(repo, 'old name.txt', '1\n2\n')
    await commitAt(repo, 'edit', 1_700_000_100)
    write(repo, 'other.txt', 'y\n')
    await commitAt(repo, 'unrelated', 1_700_000_150)
    fs.mkdirSync(path.join(repo, 'docs'))
    await git(repo, 'mv', 'old name.txt', 'docs/new name.txt')
    await commitAt(repo, 'move', 1_700_000_200)
    write(repo, 'docs/new name.txt', '1\n2\n3\n')
    await commitAt(repo, 'edit again', 1_700_000_300)
    await git(repo, 'tag', 'v1')

    const history = await inspect.fileHistory(repo, 'docs/new name.txt')
    expect(history.map((entry) => [entry.commit.subject, entry.status, entry.path, entry.origPath])).toEqual([
      ['edit again', 'M', 'docs/new name.txt', undefined],
      ['move', 'R', 'docs/new name.txt', 'old name.txt'],
      ['edit', 'M', 'old name.txt', undefined],
      ['add', 'A', 'old name.txt', undefined]
    ])
    expect(history[0]?.commit).toMatchObject({ authorName: 'Test User', authorDate: 1_700_000_300, parents: [await head(repo, 'HEAD~1')] })
    expect(history[0]?.commit.refs).toEqual([
      { name: 'main', kind: 'local', isCurrent: true },
      { name: 'v1', kind: 'tag' }
    ])
  })

  it('has no history in a repository without commits, and refuses paths outside it', async () => {
    const repo = await makeRepo()
    expect(await inspect.fileHistory(repo, 'a.txt')).toEqual([])
    await expect(inspect.fileHistory(repo, '../a.txt')).rejects.toThrow('Path is outside the repository')
  })
})
