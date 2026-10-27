import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import * as files from '../src/main/git/files'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

let home = ''

beforeAll(() => {
  home = isolateGit()
})

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()
const outputFolder = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-out-'))
const read = (repo: string, file: string): string => fs.readFileSync(path.join(repo, file), 'utf8')
const BINARY = Buffer.from([0, 1, 2, 0xff, 0xfe, 0x0d, 0x0a, 0x0a, 0x80, 0])

async function repoWithBase(): Promise<string> {
  const repo = await makeRepo()
  write(repo, 'a.txt', 'base\n')
  await commitAt(repo, 'base', 1_700_000_000)
  return repo
}

describe('archive', () => {
  it('saves a commit’s files as a zip', async () => {
    const repo = await repoWithBase()
    const base = await head(repo)
    write(repo, 'docs/readme.md', 'hello\n')
    await commitAt(repo, 'docs', 1_700_000_100)
    const zip = path.join(outputFolder(), 'snapshot.zip')

    await files.archive(repo, base, zip)
    const bytes = fs.readFileSync(zip)
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(bytes.includes('a.txt')).toBe(true)
    expect(bytes.includes('docs/readme.md')).toBe(false)

    await expect(files.archive(repo, '--remote=elsewhere', zip)).rejects.toThrow('Not a branch or commit')
    await expect(files.archive(repo, 'main', 'relative.zip')).rejects.toThrow('Not a full path')
  })
})

describe('patches', () => {
  /** main with a base commit; feature with two commits on top, one of them adding a binary file. */
  async function withFeature(): Promise<{ repo: string; commits: string[] }> {
    const repo = await repoWithBase()
    await git(repo, 'switch', '-q', '-c', 'feature')
    write(repo, 'a.txt', 'base\nfeature\n')
    await commitAt(repo, 'extend a', 1_700_000_100)
    fs.writeFileSync(path.join(repo, 'image.bin'), BINARY)
    await commitAt(repo, 'add image', 1_700_000_200)
    const commits = [await head(repo, 'feature~1'), await head(repo, 'feature')]
    await git(repo, 'switch', '-q', 'main')
    return { repo, commits }
  }

  it('saves commits as a mailbox in the order given and applies it back as the same commits', async () => {
    const { repo, commits } = await withFeature()
    const patch = path.join(outputFolder(), 'feature.patch')
    await files.savePatch(repo, commits, patch)
    const text = fs.readFileSync(patch, 'latin1')
    expect(text.startsWith(`From ${commits[0]} `)).toBe(true)
    expect(text.indexOf(`From ${commits[1]} `)).toBeGreaterThan(0)
    expect(text).toContain('GIT binary patch')

    expect(await files.applyPatchFile(repo, patch)).toEqual({ conflicted: false })
    expect((await git(repo, 'log', '--format=%s', 'main')).trim().split('\n')).toEqual(['add image', 'extend a', 'base'])
    expect(await head(repo, 'main^{tree}')).toBe(await head(repo, 'feature^{tree}'))
    expect(fs.readFileSync(path.join(repo, 'image.bin'))).toEqual(BINARY)
    expect((await commands.status(repo)).entries).toEqual([])
  })

  it('saves a root commit, and refuses merge commits', async () => {
    const { repo, commits } = await withFeature()
    const root = await head(repo, 'main')
    const patch = path.join(outputFolder(), 'root.patch')
    await files.savePatch(repo, [root], patch)
    expect(fs.readFileSync(patch, 'utf8')).toMatch(new RegExp(`^From ${root} [\\s\\S]*\\+base\\n`))

    await git(repo, 'switch', '-q', '-c', 'other')
    write(repo, 'other.txt', 'other\n')
    await commitAt(repo, 'other', 1_700_000_300)
    await git(repo, 'merge', '-q', '--no-edit', 'feature')
    await expect(files.savePatch(repo, [await head(repo)], patch)).rejects.toThrow(/is a merge commit/)
    await expect(files.savePatch(repo, ['--stdout'], patch)).rejects.toThrow('Invalid commit hash')
    await expect(files.savePatch(repo, commits, 'feature.patch')).rejects.toThrow('Not a full path')
  })

  it('undoes a whole mailbox when one of its patches doesn’t apply', async () => {
    const { repo, commits } = await withFeature()
    const patch = path.join(outputFolder(), 'feature.patch')
    await files.savePatch(repo, commits, patch)
    // The second patch adds image.bin, which main now has with other contents.
    fs.writeFileSync(path.join(repo, 'image.bin'), 'different\n')
    await commitAt(repo, 'other image', 1_700_000_300)
    const before = await head(repo)

    await expect(files.applyPatchFile(repo, patch)).rejects.toThrow('Git couldn’t apply the patches in that file, so nothing was changed.')
    expect(await head(repo)).toBe(before)
    expect((await commands.status(repo)).entries).toEqual([])
    expect(fs.existsSync(path.join(repo, '.git', 'rebase-apply'))).toBe(false)

    // Staged changes would get mixed into the commits, so they're refused before anything starts.
    write(repo, 'a.txt', 'staged\n')
    await commands.stage(repo, ['a.txt'])
    await expect(files.applyPatchFile(repo, patch)).rejects.toThrow(/Commit or unstage your staged changes first/)
    expect((await commands.status(repo)).entries.map((e) => [e.path, e.index])).toEqual([['a.txt', 'M']])
  })

  it('saves uncommitted changes as a plain patch and applies it back', async () => {
    const repo = await repoWithBase()
    const patch = path.join(outputFolder(), 'changes.patch')
    await expect(files.savePatch(repo, [], patch)).rejects.toThrow('There are no changes to tracked files to save')

    write(repo, 'a.txt', 'base\nchanged\n')
    write(repo, 'staged.txt', 'new\n')
    await commands.stage(repo, ['staged.txt'])
    fs.writeFileSync(path.join(repo, 'untracked.bin'), BINARY)
    await files.savePatch(repo, [], patch)
    const text = fs.readFileSync(patch, 'utf8')
    expect(text.startsWith('diff --git a/a.txt b/a.txt')).toBe(true)
    expect(text).toContain('b/staged.txt')
    expect(text).not.toContain('untracked.bin')

    await git(repo, 'reset', '-q', '--hard')
    expect(await files.applyPatchFile(repo, patch)).toEqual({ conflicted: false })
    expect(read(repo, 'a.txt')).toBe('base\nchanged\n')
    expect(read(repo, 'staged.txt')).toBe('new\n')
    // A 3-way apply goes through the index, so the changes come back staged.
    expect((await commands.status(repo)).entries.filter((e) => !e.untracked).map((e) => [e.path, e.index])).toEqual([
      ['a.txt', 'M'],
      ['staged.txt', 'A']
    ])
  })

  it('leaves conflicts to resolve when a plain patch clashes, and refuses one that doesn’t apply at all', async () => {
    const repo = await repoWithBase()
    const patch = path.join(outputFolder(), 'changes.patch')
    write(repo, 'a.txt', 'mine\n')
    await files.savePatch(repo, [], patch)
    await git(repo, 'reset', '-q', '--hard')
    write(repo, 'a.txt', 'theirs\n')
    await commitAt(repo, 'clash', 1_700_000_100)

    expect(await files.applyPatchFile(repo, patch)).toEqual({ conflicted: true })
    expect((await commands.status(repo)).entries.filter((e) => e.conflicted).map((e) => e.path)).toEqual(['a.txt'])
    await expect(files.applyPatchFile(repo, patch)).rejects.toThrow('Resolve the conflicts first')

    await git(repo, 'reset', '-q', '--hard')
    const junk = path.join(outputFolder(), 'junk.patch')
    fs.writeFileSync(junk, 'not a patch\n')
    await expect(files.applyPatchFile(repo, junk)).rejects.toThrow(/^Git couldn’t apply that patch, so nothing was changed\./)
  })

  it('refuses to apply a patch while a merge is in progress', async () => {
    const repo = await repoWithBase()
    await git(repo, 'switch', '-q', '-c', 'side')
    write(repo, 'a.txt', 'side\n')
    await commitAt(repo, 'side', 1_700_000_100)
    await git(repo, 'switch', '-q', 'main')
    write(repo, 'a.txt', 'main\n')
    await commitAt(repo, 'main', 1_700_000_200)
    await commands.merge(repo, 'side')
    const patch = path.join(outputFolder(), 'any.patch')
    fs.writeFileSync(patch, 'diff\n')
    await expect(files.applyPatchFile(repo, patch)).rejects.toThrow('Finish the merge first')
  })
})

describe('clean', () => {
  async function untidyRepo(): Promise<string> {
    const repo = await makeRepo()
    write(repo, '.gitignore', '*.log\n')
    write(repo, 'a.txt', 'tracked\n')
    await commitAt(repo, 'base', 1_700_000_000)
    write(repo, 'new.txt', 'untracked\n')
    write(repo, 'build/out/result.txt', 'untracked folder\n')
    write(repo, 'debug.log', 'ignored\n')
    return repo
  }

  it('lists untracked files and folders, with ignored ones on request', async () => {
    const repo = await untidyRepo()
    expect(await files.cleanPreview(repo, false)).toEqual(['build/', 'new.txt'])
    expect(await files.cleanPreview(repo, true)).toEqual(['build/', 'debug.log', 'new.txt'])
  })

  it('reads git’s quoted names and leaves out what it skips', () => {
    const output = [
      'Would remove "tab\\there"',
      'Would remove "caf\\303\\251 \\"x\\".txt"',
      'Would remove plain dir/',
      'Would skip repository nested/',
      ''
    ].join('\n')
    expect(files.parseCleanPreview(output)).toEqual(['tab\there', 'café "x".txt', 'plain dir/'])
  })

  it('removes only what the preview lists right now', async () => {
    const repo = await untidyRepo()
    const removed: string[] = []
    const remove = async (file: string): Promise<void> => {
      removed.push(file)
      fs.rmSync(file, { recursive: true })
    }

    for (const refused of [['a.txt'], ['new.txt', '../outside.txt'], ['build/out/result.txt'], ['.git/']]) {
      await expect(files.clean(repo, refused, remove)).rejects.toThrow('Nothing was removed. Only untracked and ignored files')
    }
    expect(removed).toEqual([])

    await files.clean(repo, ['new.txt', 'build/', 'debug.log'], remove)
    expect(removed).toEqual([path.join(repo, 'new.txt'), path.join(repo, 'build'), path.join(repo, 'debug.log')])
    expect(await files.cleanPreview(repo, true)).toEqual([])
    expect(read(repo, 'a.txt')).toBe('tracked\n')
  })
})

describe('ignore', () => {
  it('adds a pattern to .gitignore on a line of its own, once', async () => {
    const repo = await repoWithBase()
    await files.ignore(repo, 'build/', 'gitignore')
    expect(read(repo, '.gitignore')).toBe('build/\n')
    await files.ignore(repo, 'build/', 'gitignore')
    expect(read(repo, '.gitignore')).toBe('build/\n')

    write(repo, '.gitignore', 'node_modules')
    await files.ignore(repo, '*.log', 'gitignore')
    expect(read(repo, '.gitignore')).toBe('node_modules\n*.log\n')

    write(repo, '.gitignore', 'node_modules\r\n')
    await files.ignore(repo, '*.log', 'gitignore')
    await files.ignore(repo, 'node_modules', 'gitignore')
    expect(read(repo, '.gitignore')).toBe('node_modules\r\n*.log\r\n')

    await expect(files.ignore(repo, '  ', 'gitignore')).rejects.toThrow('Enter a pattern to ignore')
    await expect(files.ignore(repo, 'a\n!b', 'gitignore')).rejects.toThrow('A pattern has to fit on one line')
  })

  it('adds a pattern to info/exclude, making the folder if needed', async () => {
    const repo = await repoWithBase()
    fs.rmSync(path.join(repo, '.git', 'info'), { recursive: true, force: true })
    write(repo, 'local.txt', 'mine\n')
    await files.ignore(repo, 'local.txt', 'exclude')
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toBe('local.txt\n')
    expect(fs.existsSync(path.join(repo, '.gitignore'))).toBe(false)
    expect(await files.cleanPreview(repo, false)).toEqual([])
    expect(await files.cleanPreview(repo, true)).toEqual(['local.txt'])
  })
})

describe('identity and settings', () => {
  it('reads and changes settings for one repository and globally', async () => {
    const repo = await repoWithBase()
    const globalConfig = path.join(home, 'gitconfig')
    expect(await files.identity(repo)).toEqual({
      local: {},
      global: { userName: '', userEmail: '', signCommits: false, signTags: false, commitTemplate: '' }
    })

    await files.setConfig(repo, 'user.name', 'Repo Name')
    await files.setConfig(repo, 'commit.gpgsign', 'true')
    await files.setConfig(null, 'user.email', '-global@example.com')
    await files.setConfig(null, 'tag.gpgsign', 'false')
    // The global settings went to the test's own global config, not the real one.
    expect(fs.readFileSync(globalConfig, 'utf8')).toContain('-global@example.com')
    expect(await files.identity(repo)).toEqual({
      local: { userName: 'Repo Name', signCommits: true },
      global: { userName: '', userEmail: '-global@example.com', signCommits: false, signTags: false, commitTemplate: '' }
    })

    // A key set twice is replaced, and removing one that isn't there is fine.
    await git(repo, 'config', '--add', 'user.name', 'Second Name')
    await files.setConfig(repo, 'user.name', 'Only Name')
    expect((await git(repo, 'config', '--local', '--get-all', 'user.name')).trim()).toBe('Only Name')
    await files.setConfig(repo, 'user.name', null)
    await files.setConfig(repo, 'user.name', null)
    await files.setConfig(null, 'user.email', null)
    expect(await files.identity(repo)).toMatchObject({ local: { signCommits: true }, global: { userEmail: '' } })
    expect((await files.identity(repo)).local.userName).toBeUndefined()

    await expect(files.setConfig(repo, 'commit.gpgsign', 'yes')).rejects.toThrow('commit.gpgsign has to be true or false')
    await expect(files.setConfig(repo, 'user.name', 'Two\nLines')).rejects.toThrow('A setting has to fit on one line')
    await expect(files.setConfig(repo, 'core.editor' as 'user.name', 'vim')).rejects.toThrow(/doesn’t change core\.editor/)
  })

  it('reads the commit template in effect, up to 64 KB', async () => {
    const repo = await repoWithBase()
    write(repo, '.git/message.txt', 'Summary\n\nWhy:\n')
    await git(repo, 'config', 'commit.template', '.git/message.txt')
    expect((await files.identity(repo)).global.commitTemplate).toBe('Summary\n\nWhy:\n')

    const big = path.join(outputFolder(), 'big.txt')
    fs.writeFileSync(big, 'x'.repeat(70_000))
    await git(repo, 'config', 'commit.template', big)
    expect((await files.identity(repo)).global.commitTemplate).toHaveLength(64 * 1024)

    await git(repo, 'config', 'commit.template', path.join(outputFolder(), 'missing.txt'))
    expect((await files.identity(repo)).global.commitTemplate).toBe('')
  })
})
