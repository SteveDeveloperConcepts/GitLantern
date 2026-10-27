import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { commitAt, git, isolateGit, makeRepo, write } from '../../test/helpers'
import type { CustomAction } from '../shared/types'
import { runGit } from './git/runGit'
import { diffTool, difftoolArgs, expandArgs, findOnPath, findTools, launch, mergeTool, resolveProgram, runCustomAction, type LaunchableTool } from './tools'

beforeAll(() => {
  isolateGit()
})

const tempDir = (prefix: string): string => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))

describe('expandArgs', () => {
  it('fills in each placeholder inside an argument, which stays one argument', () => {
    const vars = { REPO: 'C:\\code\\my repo', SHA: 'abc1234', BRANCH: 'feature/x', FILE: 'src/a b.txt' }
    expect(expandArgs(['--repo=${REPO}', '${SHA}..${BRANCH}', '${FILE}', 'plain'], vars)).toEqual([
      '--repo=C:\\code\\my repo',
      'abc1234..feature/x',
      'src/a b.txt',
      'plain'
    ])
  })

  it('leaves missing and unknown placeholders empty, and other text alone', () => {
    expect(expandArgs(['${SHA}', 'x${HOME}y', '${repo}', '$REPO', '${REPO}${REPO}', '${constructor}'], { REPO: '/r' })).toEqual([
      '',
      'xy',
      '',
      '$REPO',
      '/r/r',
      ''
    ])
  })
})

describe('runCustomAction', () => {
  const action = (args: string[], command = process.execPath): CustomAction => ({
    id: 'a',
    name: 'Test',
    scope: 'repository',
    command,
    args,
    confirm: false
  })

  it('runs in the repository with the placeholders filled in, and reports the exit code and all output', async () => {
    const repo = tempDir('gitlantern-action-')
    const script = [
      "process.stdout.write(process.cwd() + '|' + process.argv.slice(1).join('|'))",
      "process.stderr.write(' warning')",
      'process.exit(3)'
    ].join('\n')
    const result = await runCustomAction(action(['-e', script, '${REPO}', '${SHA}', '${BRANCH}', '${FILE}']), repo, {
      sha: 'abc1234',
      branch: 'feature/x',
      file: 'src/a b&c.txt'
    })
    expect(result.exitCode).toBe(3)
    expect(result.output).toContain(`${repo}|${repo}|abc1234|feature/x|src/a b&c.txt`)
    expect(result.output).toContain(' warning')
  })

  it('keeps the first 64 KB of output', async () => {
    const repo = tempDir('gitlantern-action-')
    const result = await runCustomAction(action(['-e', "process.stdout.write('x'.repeat(100000))"]), repo, {})
    expect(result.exitCode).toBe(0)
    expect(result.output.startsWith('x'.repeat(64 * 1024))).toBe(true)
    expect(result.output).not.toContain('x'.repeat(64 * 1024 + 1))
    expect(result.output).toMatch(/cut off at 64 KB$/)
  })

  it('says why when the program can’t be started', async () => {
    const repo = tempDir('gitlantern-action-')
    const result = await runCustomAction(action([], 'gitlantern-no-such-program'), repo, {})
    expect(result.exitCode).toBeNull()
    expect(result.output).toMatch(/Couldn’t find the program “gitlantern-no-such-program”/)
  })

  it('never runs a program the repository ships under a bare command name', async () => {
    const repo = tempDir('gitlantern-action-')
    // On Windows a plain spawn of "planted" would find planted.exe in the working folder first.
    fs.copyFileSync(process.execPath, path.join(repo, process.platform === 'win32' ? 'gitlantern-planted.exe' : 'gitlantern-planted'))
    expect(resolveProgram('gitlantern-planted', repo)).toBeNull()
    const result = await runCustomAction(action(['-e', 'process.exit(0)'], 'gitlantern-planted'), repo, {})
    expect(result.exitCode).toBeNull()
    expect(result.output).toMatch(/Couldn’t find the program “gitlantern-planted” on your PATH/)
    // A path with a folder in it is the repository's own script, on purpose.
    expect(resolveProgram('scripts/deploy', repo)).toBe(path.join(repo, 'scripts', 'deploy'))
    expect(resolveProgram(process.execPath, repo)).toBe(process.execPath)
  })

  it('refuses a file outside the repository, and a malformed commit', async () => {
    const repo = tempDir('gitlantern-action-')
    const run = action(['-e', 'process.exit(0)', '${FILE}'])
    await expect(runCustomAction(run, repo, { file: '../outside.txt' })).rejects.toThrow(/isn’t inside the repository/)
    await expect(runCustomAction(run, repo, { file: path.join(os.tmpdir(), 'elsewhere.txt') })).rejects.toThrow(/isn’t inside/)
    await expect(runCustomAction(run, repo, { sha: '--upload-pack=evil' })).rejects.toThrow(/Invalid commit hash/)
  })
})

describe('difftoolArgs', () => {
  const hash = 'abc1234def'
  const base = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

  it('builds the arguments for each kind of diff', () => {
    expect(difftoolArgs({ kind: 'worktree', path: 'a.txt' }, '')).toEqual(['difftool', '--no-prompt', '--', 'a.txt'])
    expect(difftoolArgs({ kind: 'index', path: 'a.txt' }, 'meld')).toEqual([
      'difftool',
      '--no-prompt',
      '--tool=meld',
      '--cached',
      '--',
      'a.txt'
    ])
    expect(difftoolArgs({ kind: 'commit', hash, path: 'new.txt', origPath: 'old.txt' }, 'bc', base)).toEqual([
      'difftool',
      '--no-prompt',
      '--tool=bc',
      '-M',
      base,
      hash,
      '--',
      'old.txt',
      'new.txt'
    ])
    expect(difftoolArgs({ kind: 'stash', hash, path: 'a.txt' }, '')).toEqual(['difftool', '--no-prompt', `${hash}^1`, hash, '--', 'a.txt'])
    expect(difftoolArgs({ kind: 'stash', hash, path: 'n.txt', untracked: true }, '', base)).toEqual([
      'difftool',
      '--no-prompt',
      base,
      `${hash}^3`,
      '--',
      'n.txt'
    ])
    expect(difftoolArgs({ kind: 'range', from: 'main', to: 'origin/feature', path: 'a.txt' }, '')).toEqual([
      'difftool',
      '--no-prompt',
      '-M',
      'main',
      'origin/feature',
      '--',
      'a.txt'
    ])
  })

  it('refuses untracked and conflicted files, odd tool names and revisions', () => {
    expect(() => difftoolArgs({ kind: 'worktree', path: 'a.txt', untracked: true }, '')).toThrow(/not tracked yet/)
    expect(() => difftoolArgs({ kind: 'worktree', path: 'a.txt', conflicted: true }, '')).toThrow(/merge tool/)
    expect(() => difftoolArgs({ kind: 'worktree', path: 'a.txt' }, '--extcmd=calc')).toThrow(/isn’t a tool name/)
    expect(() => difftoolArgs({ kind: 'worktree', path: 'a.txt' }, 'meld; rm -rf')).toThrow(/isn’t a tool name/)
    expect(() => difftoolArgs({ kind: 'range', from: '--output=x', to: 'main', path: 'a.txt' }, '')).toThrow(/Not a branch or commit/)
    expect(() => difftoolArgs({ kind: 'commit', hash: 'HEAD;x', path: 'a.txt' }, '', base)).toThrow(/Invalid commit hash/)
  })
})

describe('diffTool and mergeTool', () => {
  /** A tool that appends both sides' contents to a file, so the test sees what git compared. */
  async function recordingRepo(): Promise<{ repo: string; out: string }> {
    const repo = await makeRepo()
    const out = path.join(tempDir('gitlantern-difftool-'), 'out.txt').replace(/\\/g, '/')
    await git(repo, 'config', 'difftool.record.cmd', `cat "$LOCAL" "$REMOTE" >> "${out}"`)
    return { repo, out }
  }

  it('asks for a tool when git has none configured', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'one\n')
    await commitAt(repo, 'first', 1_700_000_000)
    const worktree = { kind: 'worktree', path: 'a.txt' } as const
    await expect(diffTool(repo, worktree, '')).rejects.toThrow(/No diff tool is set up\. Pick one in Settings → Tools/)
    await expect(mergeTool(repo, 'a.txt', '')).rejects.toThrow(/No merge tool is set up/)
  })

  it('compares a commit with its parent, and a first commit with nothing', async () => {
    const { repo, out } = await recordingRepo()
    write(repo, 'a.txt', 'one\n')
    await commitAt(repo, 'first', 1_700_000_000)
    const first = (await git(repo, 'rev-parse', 'HEAD')).trim()
    write(repo, 'a.txt', 'two\n')
    await commitAt(repo, 'second', 1_700_000_100)
    const second = (await git(repo, 'rev-parse', 'HEAD')).trim()

    await diffTool(repo, { kind: 'commit', hash: second, path: 'a.txt' }, 'record')
    expect(fs.readFileSync(out, 'utf8')).toBe('one\ntwo\n')
    fs.rmSync(out)
    await diffTool(repo, { kind: 'commit', hash: first, path: 'a.txt' }, 'record')
    expect(fs.readFileSync(out, 'utf8')).toBe('one\n')
  })

  it('explains a tool git doesn’t know', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'one\n')
    await commitAt(repo, 'first', 1_700_000_000)
    write(repo, 'a.txt', 'two\n')
    await expect(diffTool(repo, { kind: 'worktree', path: 'a.txt' }, 'nosuchtool')).rejects.toThrow(
      /Git doesn’t know a diff tool called “nosuchtool”/
    )
  })

  it('resolves a conflicted file with the merge tool', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'base\n')
    await commitAt(repo, 'base', 1_700_000_000)
    await git(repo, 'checkout', '-q', '-b', 'other')
    write(repo, 'a.txt', 'theirs\n')
    await commitAt(repo, 'theirs', 1_700_000_100)
    await git(repo, 'checkout', '-q', 'main')
    write(repo, 'a.txt', 'ours\n')
    await commitAt(repo, 'ours', 1_700_000_200)
    await runGit(['merge', 'other'], { cwd: repo, allowedExitCodes: [0, 1] })
    await git(repo, 'config', 'mergetool.take.cmd', 'cp "$REMOTE" "$MERGED"')
    await git(repo, 'config', 'mergetool.take.trustExitCode', 'true')
    await git(repo, 'config', 'mergetool.keepBackup', 'false')

    await mergeTool(repo, 'a.txt', 'take')
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('theirs\n')
    expect((await git(repo, 'diff', '--name-only', '--diff-filter=U')).trim()).toBe('')
    await expect(mergeTool(repo, 'a.txt', 'take')).rejects.toThrow(/no conflicts left/)
    await expect(mergeTool(repo, '../a.txt', 'take')).rejects.toThrow(/outside the repository/)
  })
})

describe('tool detection', () => {
  it('finds a program in PATH, skipping folders that aren’t absolute', () => {
    const dir = tempDir('gitlantern-path-')
    const name = process.platform === 'win32' ? 'fake-editor.exe' : 'fake-editor'
    fs.writeFileSync(path.join(dir, name), '')
    fs.chmodSync(path.join(dir, name), 0o755)
    const env = { PATH: ['relative-folder', dir].join(path.delimiter), PATHEXT: '.COM;.EXE' }
    expect(findOnPath('fake-editor', env)).toBe(path.join(dir, name))
    expect(findOnPath('gitlantern-missing-editor', env)).toBeNull()
  })

  it('lists tools with unique ids and a way to open a folder', async () => {
    const found = await findTools()
    for (const list of [found.editors, found.terminals]) {
      const ids = list.map((tool) => tool.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const tool of list) {
        expect(tool.name).not.toBe('')
        expect(path.isAbsolute(tool.command)).toBe(true)
        expect(tool.args(os.tmpdir()).every((arg) => typeof arg === 'string')).toBe(true)
      }
    }
  })
})

describe('launch', () => {
  // Writes its working directory, arguments and environment to the file named first.
  const script = [
    "const [out, ...rest] = process.argv.slice(1)",
    "const env = { probe: process.env.GITLANTERN_PROBE ?? null, electron: process.env.ELECTRON_GITLANTERN_TEST ?? null }",
    "require('fs').writeFileSync(out, JSON.stringify({ cwd: process.cwd(), args: rest, env }))"
  ].join('\n')
  const probe = (out: string): LaunchableTool => ({
    id: 'probe',
    name: 'Probe',
    command: process.execPath,
    args: (dir, file) => ['-e', script, out, dir, file ? path.join(dir, file) : ''],
    env: { GITLANTERN_PROBE: 'yes' }
  })

  async function waitFor(file: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, 'utf8')
        if (text) return text
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`${file} wasn’t written`)
  }

  it('starts the tool with the folder and file as whole arguments, whatever characters they have', async () => {
    const base = tempDir('gitlantern-launch-')
    const dir = path.join(base, `a b&c^d'e (f) %PATH%${process.platform === 'win32' ? '' : ' "g"'}`)
    fs.mkdirSync(path.join(dir, 'sub dir'), { recursive: true })
    const file = path.join('sub dir', 'x&y.txt')
    fs.writeFileSync(path.join(dir, file), '')
    const out = path.join(base, 'out.json')

    process.env.ELECTRON_GITLANTERN_TEST = '1'
    try {
      launch(probe(out), dir, file)
    } finally {
      delete process.env.ELECTRON_GITLANTERN_TEST
    }
    const seen = JSON.parse(await waitFor(out)) as { cwd: string; args: string[]; env: Record<string, string | null> }
    expect(seen.args).toEqual([dir, path.join(dir, file)])
    expect(fs.realpathSync.native(seen.cwd)).toBe(dir)
    expect(seen.env).toEqual({ probe: 'yes', electron: null })
  })

  it('refuses a file outside the folder', () => {
    const dir = tempDir('gitlantern-launch-')
    expect(() => launch(probe(path.join(dir, 'out.json')), dir, '../elsewhere.txt')).toThrow(/outside the repository/)
  })
})
