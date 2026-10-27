import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as structure from '../src/main/git/structure'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  const home = isolateGit()
  // Submodules cloned from local folders use the file transport, which git turns off for them by default.
  fs.appendFileSync(path.join(home, 'gitconfig'), '[protocol "file"]\n\tallow = always\n')
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()
// Real paths, as git reports them: the temp folder can be a symlink (macOS's /var → /private/var) or
// carry a Windows 8.3 short name (C:\Users\RUNNER~1 on GitHub's runners).
const tempFolder = (prefix: string): string => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))

async function repoWith(file: string, contents: string, unixSeconds = 1_700_000_000): Promise<string> {
  const repo = fs.realpathSync.native(await makeRepo())
  write(repo, file, contents)
  await commitAt(repo, `add ${file}`, unixSeconds)
  return repo
}

// `git submodule` and `git lfs` start many processes each, which is slow on Windows.
const SLOW = { timeout: 120_000 }

describe('submodules', SLOW, () => {
  it('lists nothing without a .gitmodules file', async () => {
    expect(await structure.submodules(await repoWith('a.txt', 'a\n'))).toEqual([])
  })

  it('adds a submodule, shows when it is checked out at another commit, and removes it', async () => {
    const lib = await repoWith('lib.txt', 'lib\n')
    const repo = await repoWith('a.txt', 'a\n')
    await structure.addSubmodule(repo, lib, 'libs/lib')
    await commitAt(repo, 'add lib', 1_700_000_100)
    const recorded = await head(lib)
    expect(await structure.submodules(repo)).toEqual([{ path: 'libs/lib', url: lib, hash: recorded, state: 'ok' }])

    const checkout = path.join(repo, 'libs', 'lib')
    write(checkout, 'more.txt', 'more\n')
    await commitAt(checkout, 'more', 1_700_000_200)
    expect(await structure.submodules(repo)).toEqual([{ path: 'libs/lib', url: lib, hash: recorded, state: 'modified' }])

    await structure.removeSubmodule(repo, 'libs/lib')
    expect(await structure.submodules(repo)).toEqual([])
    expect(fs.existsSync(checkout)).toBe(false)
    expect(fs.existsSync(path.join(repo, '.git', 'modules', 'libs', 'lib'))).toBe(false)
    expect(await git(repo, 'diff', '--cached', '--name-status')).toBe('M\t.gitmodules\nD\tlibs/lib\n')
  })

  it('refuses addresses that could be options, folders outside the repository and folders in use', async () => {
    const lib = await repoWith('lib.txt', 'lib\n')
    const repo = await repoWith('a.txt', 'a\n')
    await expect(structure.addSubmodule(repo, '--upload-pack=touch pwned', 'lib')).rejects.toThrow(/Not a Git address/)
    await expect(structure.addSubmodule(repo, lib, '../outside')).rejects.toThrow(/outside the repository/)
    write(repo, 'taken/file.txt', 'x\n')
    await expect(structure.addSubmodule(repo, lib, 'taken')).rejects.toThrow(/taken already exists and isn’t empty/)
    await expect(structure.addSubmodule(repo, lib, 'a.txt')).rejects.toThrow(/a.txt already exists/)
    await expect(structure.removeSubmodule(repo, 'a.txt')).rejects.toThrow(/isn’t a submodule/)

    // An empty folder is fine.
    fs.mkdirSync(path.join(repo, 'empty'))
    await structure.addSubmodule(repo, lib, 'empty')
    expect((await structure.submodules(repo)).map((entry) => [entry.path, entry.state])).toEqual([['empty', 'ok']])
  })

  it('clones missing submodules, nested ones included, one by one or all at once', async () => {
    const deep = await repoWith('deep.txt', 'deep\n')
    const lib = await repoWith('lib.txt', 'lib\n')
    await structure.addSubmodule(lib, deep, 'deep')
    await commitAt(lib, 'add deep', 1_700_000_100)
    const repo = await repoWith('a.txt', 'a\n')
    await structure.addSubmodule(repo, lib, 'lib')
    await commitAt(repo, 'add lib', 1_700_000_200)

    // Adding a submodule doesn't clone the ones inside it. Their addresses come from lib's .gitmodules.
    expect(await structure.submodules(repo)).toEqual([
      { path: 'lib', url: lib, hash: await head(lib), state: 'ok' },
      { path: 'lib/deep', url: deep, hash: await head(deep), state: 'uninitialized' }
    ])
    await structure.updateSubmodules(repo, ['lib/deep'])
    expect((await structure.submodules(repo)).map((entry) => entry.state)).toEqual(['ok', 'ok'])
    expect(fs.readFileSync(path.join(repo, 'lib', 'deep', 'deep.txt'), 'utf8')).toBe('deep\n')

    const parent = tempFolder('gitlantern-clones-')
    const copy = path.join(parent, 'copy')
    await git(parent, 'clone', '-q', repo, copy)
    expect((await structure.submodules(copy)).map((entry) => [entry.path, entry.state])).toEqual([['lib', 'uninitialized']])
    await structure.updateSubmodules(copy, [])
    expect((await structure.submodules(copy)).map((entry) => [entry.path, entry.state])).toEqual([
      ['lib', 'ok'],
      ['lib/deep', 'ok']
    ])
    await expect(structure.updateSubmodules(copy, ['a.txt'])).rejects.toThrow(/isn’t a submodule/)
  })
})

describe('worktrees', () => {
  async function repoWithFeature(): Promise<string> {
    const repo = await repoWith('a.txt', 'a\n')
    await git(repo, 'branch', 'feature')
    return repo
  }

  it('adds worktrees for an existing branch and a new one, and lists them', async () => {
    const repo = await repoWithFeature()
    const parent = tempFolder('gitlantern-worktrees-')
    const hash = await head(repo)
    expect(await structure.worktrees(repo)).toEqual([
      { path: repo, head: hash, branch: 'main', isMain: true, isCurrent: true, locked: false, prunable: false }
    ])

    const feature = path.join(parent, 'feature')
    await structure.addWorktree(repo, { path: feature, branch: 'feature' })
    // An empty folder is fine.
    const fix = path.join(parent, 'fix')
    fs.mkdirSync(fix)
    await structure.addWorktree(repo, { path: fix, newBranch: 'fix', startPoint: 'main' })
    expect(await structure.worktrees(repo)).toEqual([
      { path: repo, head: hash, branch: 'main', isMain: true, isCurrent: true, locked: false, prunable: false },
      { path: feature, head: hash, branch: 'feature', isMain: false, isCurrent: false, locked: false, prunable: false },
      { path: fix, head: hash, branch: 'fix', isMain: false, isCurrent: false, locked: false, prunable: false }
    ])
    expect(fs.readFileSync(path.join(fix, 'a.txt'), 'utf8')).toBe('a\n')

    // Seen from a linked worktree, that one is current.
    expect((await structure.worktrees(feature)).map((entry) => [entry.isMain, entry.isCurrent])).toEqual([
      [true, false],
      [false, true],
      [false, false]
    ])
    if (process.platform === 'win32') expect((await structure.worktrees(feature.toUpperCase()))[1]?.isCurrent).toBe(true)
  })

  it('refuses branches checked out elsewhere, unknown branches, bad names and folders in use', async () => {
    const repo = await repoWithFeature()
    const parent = tempFolder('gitlantern-worktrees-')
    const folder = (name: string): string => path.join(parent, name)
    await expect(structure.addWorktree(repo, { path: folder('a'), branch: 'main' })).rejects.toThrow(
      /^main is already checked out in .+ only one worktree at a time/
    )
    await expect(structure.addWorktree(repo, { path: folder('b'), branch: 'nope' })).rejects.toThrow(/no local branch called nope/)
    await expect(structure.addWorktree(repo, { path: folder('c'), branch: '--detach' })).rejects.toThrow(/Not a branch or commit/)
    await expect(structure.addWorktree(repo, { path: folder('d'), newBranch: '-f' })).rejects.toThrow(/not a valid branch name/)
    await expect(structure.addWorktree(repo, { path: folder('e'), newBranch: 'a b' })).rejects.toThrow(/not a valid branch name/)
    await expect(structure.addWorktree(repo, { path: folder('f'), newBranch: 'feature' })).rejects.toThrow(/called feature already exists/)
    await expect(structure.addWorktree(repo, { path: folder('g'), newBranch: 'g', startPoint: '--orphan' })).rejects.toThrow(
      /Not a branch or commit/
    )
    await expect(structure.addWorktree(repo, { path: 'relative', branch: 'feature' })).rejects.toThrow(/Choose a folder/)

    // A taken folder is refused before git makes the new branch.
    write(parent, 'taken/file.txt', 'x\n')
    await expect(structure.addWorktree(repo, { path: folder('taken'), newBranch: 'taken' })).rejects.toThrow(/exists and isn’t empty/)
    expect(await git(repo, 'branch', '--list', 'taken')).toBe('')
    expect(await structure.worktrees(repo)).toHaveLength(1)
  })

  it('locks, unlocks, removes and prunes worktrees, but not the main one or the one open', async () => {
    const repo = await repoWithFeature()
    const parent = tempFolder('gitlantern-worktrees-')
    const feature = path.join(parent, 'feature')
    const scratch = path.join(parent, 'scratch')
    await structure.addWorktree(repo, { path: feature, branch: 'feature' })
    await structure.addWorktree(repo, { path: scratch, newBranch: 'scratch' })

    await structure.lockWorktree(repo, feature, true)
    await structure.lockWorktree(repo, feature, true)
    expect((await structure.worktrees(repo)).map((entry) => entry.locked)).toEqual([false, true, false])
    await expect(structure.removeWorktree(repo, feature, true)).rejects.toThrow(/is locked\. Unlock it first/)
    await structure.lockWorktree(repo, feature, false)
    expect((await structure.worktrees(repo)).map((entry) => entry.locked)).toEqual([false, false, false])
    await expect(structure.lockWorktree(repo, repo, true)).rejects.toThrow(/main worktree can’t be locked/)

    // The same worktree named another way (a junction here; macOS's /var or an 8.3 short name on CI).
    const alias = path.join(tempFolder('gitlantern-alias-'), 'link')
    fs.symlinkSync(parent, alias, 'junction')
    await structure.lockWorktree(repo, path.join(alias, 'feature'), true)
    expect((await structure.worktrees(repo)).map((entry) => entry.locked)).toEqual([false, true, false])
    await structure.lockWorktree(repo, path.join(alias, 'feature'), false)

    await expect(structure.removeWorktree(repo, repo, false)).rejects.toThrow(/main worktree can’t be removed/)
    await expect(structure.removeWorktree(feature, feature, false)).rejects.toThrow(/open in this window/)
    await expect(structure.removeWorktree(repo, path.join(parent, 'elsewhere'), false)).rejects.toThrow(/isn’t a worktree/)

    write(feature, 'a.txt', 'changed\n')
    await expect(structure.removeWorktree(repo, feature, false)).rejects.toThrow(/changes that aren’t committed/)
    await structure.removeWorktree(repo, feature, true)
    expect(fs.existsSync(feature)).toBe(false)

    fs.rmSync(scratch, { recursive: true, force: true })
    expect((await structure.worktrees(repo)).map((entry) => [entry.path, entry.prunable])).toEqual([
      [repo, false],
      [scratch, true]
    ])
    await structure.pruneWorktrees(repo)
    expect((await structure.worktrees(repo)).map((entry) => entry.path)).toEqual([repo])
  })
})

const hasLfs = spawnSync('git', ['lfs', 'version']).status === 0

describe.skipIf(!hasLfs)('Git LFS', SLOW, () => {
  async function lfsRepo(): Promise<string> {
    const repo = await repoWith('a.txt', 'a\n')
    await structure.lfsInstall(repo)
    await structure.lfsTrack(repo, '*.bin')
    write(repo, 'big.bin', 'binary\n')
    await commitAt(repo, 'add big.bin', 1_700_000_100)
    return repo
  }

  it('tracks and untracks patterns and lists the files it manages', async () => {
    const plain = await structure.lfs(await repoWith('a.txt', 'a\n'))
    expect(plain).toMatchObject({ installed: true, patterns: [], files: [] })
    expect(plain.version).toMatch(/^\d+\.\d+/)

    const repo = await lfsRepo()
    await structure.lfsTrack(repo, 'my file.dat')
    write(repo, 'my file.dat', 'data\n')
    await commitAt(repo, 'add my file.dat', 1_700_000_200)
    const info = await structure.lfs(repo)
    expect(info.patterns).toEqual(['*.bin', 'my[[:space:]]file.dat'])
    expect(info.files.map((file) => [file.path, file.downloaded])).toEqual([
      ['big.bin', true],
      ['my file.dat', true]
    ])
    expect(info.files[0]?.oid).toMatch(/^[0-9a-f]{10}$/)

    await structure.lfsUntrack(repo, '*.bin')
    expect((await structure.lfs(repo)).patterns).toEqual(['my[[:space:]]file.dat'])
    for (const bad of ['', ' ', '-x', '--help', '*.a\n*.b']) await expect(structure.lfsTrack(repo, bad)).rejects.toThrow(/isn’t a pattern/)
    await expect(structure.lfsLock(repo, '../outside.bin')).rejects.toThrow(/outside the repository/)
  })

  it('pulls Git LFS files into a clone and pushes them to the upstream remote', async () => {
    const repo = await lfsRepo()
    const parent = tempFolder('gitlantern-lfs-')
    const copy = path.join(parent, 'copy')
    await git(parent, 'clone', '-q', repo, copy)
    expect((await structure.lfs(copy)).files.map((file) => [file.path, file.downloaded])).toEqual([['big.bin', false]])
    await structure.lfsInstall(copy)
    await structure.lfsPull(copy)
    expect((await structure.lfs(copy)).files.map((file) => [file.path, file.downloaded])).toEqual([['big.bin', true]])
    expect(fs.readFileSync(path.join(copy, 'big.bin'), 'utf8')).toBe('binary\n')

    const bare = path.join(parent, 'bare.git')
    await git(parent, 'init', '-q', '--bare', bare)
    await git(repo, 'remote', 'add', 'backup', bare)
    // --no-verify skips Git LFS's pre-push hook, so only lfsPush uploads the file.
    await git(repo, 'push', '-q', '--no-verify', '-u', 'backup', 'main')
    expect(fs.existsSync(path.join(bare, 'lfs', 'objects'))).toBe(false)
    await structure.lfsPush(repo)
    expect(fs.readdirSync(path.join(bare, 'lfs', 'objects'))).toHaveLength(1)
  })
})

describe('parsers', () => {
  const hash = 'a'.repeat(40)

  it('reads submodule status lines', () => {
    const output = [
      ` ${hash} libs/my lib (heads/main)`,
      `-${hash} libs/my lib/deep`,
      `+${hash} other (v1.0-2-g${'b'.repeat(7)})`,
      // Only checked-out submodules have `(describe)` after the path, so this is all path.
      `U${'0'.repeat(40)} odd (name)`,
      ''
    ].join('\n')
    expect(structure.parseSubmoduleStatus(output)).toEqual([
      { path: 'libs/my lib', hash, state: 'ok' },
      { path: 'libs/my lib/deep', hash, state: 'uninitialized' },
      { path: 'other', hash, state: 'modified' },
      { path: 'odd (name)', hash: '0'.repeat(40), state: 'conflict' }
    ])
    expect(structure.parseSubmoduleStatus('')).toEqual([])
  })

  it('reads submodules from .gitmodules, with dots and spaces in their names', () => {
    const output = [
      'submodule.libs/my lib.path\nlibs/my lib',
      'submodule.libs/my lib.url\nhttps://example.com/lib.git',
      'submodule.v1.2.path\nvendor/v1.2/',
      'submodule.v1.2.url\n../v1.2.git',
      'submodule.no-path.url\nhttps://example.com/x.git',
      'submodule.no-value.path',
      ''
    ].join('\0')
    expect(structure.parseGitmodules(output)).toEqual([
      { name: 'libs/my lib', path: 'libs/my lib', url: 'https://example.com/lib.git' },
      { name: 'v1.2', path: 'vendor/v1.2', url: '../v1.2.git' }
    ])
  })

  it('reads worktree lists, with or without -z', () => {
    const main = path.resolve('/work/app')
    const z = [
      'worktree /work/app',
      `HEAD ${hash}`,
      'branch refs/heads/main',
      '',
      'worktree /work/app-fix',
      `HEAD ${hash}`,
      'detached',
      'locked on a USB drive\nnamed "x"',
      '',
      'worktree /work/gone',
      `HEAD ${hash}`,
      'branch refs/heads/gone',
      'prunable gitdir file points to non-existent location',
      '',
      ''
    ].join('\0')
    const expected = [
      { path: main, head: hash, branch: 'main', isMain: true, isCurrent: true, locked: false, prunable: false },
      { path: path.resolve('/work/app-fix'), head: hash, branch: null, isMain: false, isCurrent: false, locked: true, prunable: false },
      { path: path.resolve('/work/gone'), head: hash, branch: 'gone', isMain: false, isCurrent: false, locked: false, prunable: true }
    ]
    expect(structure.parseWorktrees(z, main)).toEqual(expected)
    expect(structure.parseWorktrees(z.replace('locked on a USB drive\nnamed "x"', 'locked').replaceAll('\0', '\n'), main)).toEqual(expected)

    // A bare repository's entry has no HEAD.
    expect(structure.parseWorktrees('worktree /srv/app.git\nbare\n\n', main)).toEqual([
      { path: path.resolve('/srv/app.git'), head: null, branch: null, isMain: true, isCurrent: false, locked: false, prunable: false }
    ])
    expect(structure.parseWorktrees('', main)).toEqual([])
  })

  it('reads Git LFS versions, patterns and files', () => {
    expect(structure.parseLfsVersion('git-lfs/3.5.1 (GitHub; windows amd64; go 1.22.2)\n')).toBe('3.5.1')
    expect(structure.parseLfsVersion('something else\n')).toBe('something else')

    const attributes = [
      '# Git LFS',
      '*.psd filter=lfs diff=lfs merge=lfs -text',
      '  my[[:space:]]file.dat   filter=lfs diff=lfs merge=lfs -text\r',
      '*.txt text eol=lf',
      '*.png -filter',
      '[attr]lfs filter=lfs diff=lfs merge=lfs -text',
      '*.filterless filter=lfsx',
      ''
    ].join('\n')
    expect(structure.parseLfsPatterns(attributes)).toEqual(['*.psd', 'my[[:space:]]file.dat'])

    const oid = 'c'.repeat(64)
    expect(structure.parseLfsFiles(`${oid} * art/hero.psd\nabcdef0123 - my file.dat\r\nnot a line\n`)).toEqual([
      { path: 'art/hero.psd', oid, downloaded: true },
      { path: 'my file.dat', oid: 'abcdef0123', downloaded: false }
    ])
  })

  it('reads Git LFS locks', () => {
    const json = JSON.stringify([
      { id: '3', path: 'art/hero.psd', owner: { name: 'Ada' }, locked_at: '2024-05-17T15:49:06+00:00' },
      { id: 4, path: 'b.bin', locked_at: 'not a date' },
      { path: 'no-id.bin' },
      null
    ])
    expect(structure.parseLfsLocks(json)).toEqual([
      { id: '3', path: 'art/hero.psd', owner: 'Ada', lockedAt: Date.UTC(2024, 4, 17, 15, 49, 6) / 1000 },
      { id: '4', path: 'b.bin', owner: '', lockedAt: 0 }
    ])
    expect(structure.parseLfsLocks('')).toEqual([])
    expect(structure.parseLfsLocks('{}')).toEqual([])
    expect(() => structure.parseLfsLocks('Locking is not supported')).toThrow(/couldn’t read/)
  })
})
