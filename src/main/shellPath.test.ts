import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { explainFailure } from './git/runGit'
import { mergePaths, parseShellOutput, readShellPath, usualDirs } from './shellPath'

const MARKER = '__GITLANTERN_PATH__'

describe('usualDirs', () => {
  it('has Homebrew, MacPorts and ~/.local/bin on macOS', () => {
    const dirs = usualDirs('darwin', '/Users/me')
    expect(dirs).toEqual(expect.arrayContaining(['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', path.join('/Users/me', '.local', 'bin')]))
  })

  it('has ~/.local/bin and Homebrew on Linux', () => {
    expect(usualDirs('linux', '/home/me')).toEqual(expect.arrayContaining([path.join('/home/me', '.local', 'bin'), '/home/linuxbrew/.linuxbrew/bin']))
  })
})

describe('mergePaths', () => {
  it('keeps the earlier values first and each folder once', () => {
    expect(mergePaths('/shell/bin:/usr/bin', '/usr/bin:/bin', '/opt/homebrew/bin:/shell/bin')).toBe('/shell/bin:/usr/bin:/bin:/opt/homebrew/bin')
  })

  it('drops empty and relative entries, which would find programs in the repository', () => {
    expect(mergePaths('.:/usr/bin::node_modules/.bin', undefined, '~/bin:/bin:')).toBe('/usr/bin:/bin')
  })
})

describe('parseShellOutput', () => {
  it('finds the PATH between the markers, whatever the startup files printed around it', () => {
    expect(parseShellOutput(`Welcome!\n${MARKER}\n/a/bin:/usr/bin\n${MARKER}\nlogout\n`)).toBe('/a/bin:/usr/bin')
  })

  it('is null until the second marker arrives, or when there is no PATH', () => {
    expect(parseShellOutput(`${MARKER}\n/a/bin:/usr`)).toBeNull()
    expect(parseShellOutput(`${MARKER}\n\n${MARKER}\n`)).toBeNull()
    expect(parseShellOutput('nothing here')).toBeNull()
  })
})

describe.skipIf(process.platform === 'win32')('readShellPath', () => {
  /** A stand-in for the user's shell: a script that runs `body`, where "$4" is the command after -i -l -c. */
  function fakeShell(body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-shell-'))
    const file = path.join(dir, 'zsh')
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    return file
  }

  it('reads the PATH the shell has, past what its startup files print', async () => {
    const shell = fakeShell('echo "Last login: today"\nPATH="/from/zshrc:$PATH"; export PATH\neval "$4"\necho bye')
    expect(await readShellPath(shell)).toBe(`/from/zshrc:${process.env.PATH}`)
  })

  it('doesn’t wait for a program the startup files left running', async () => {
    const shell = fakeShell('sleep 30 &\neval "$4"')
    const started = Date.now()
    expect(await readShellPath(shell)).toBe(process.env.PATH)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('gives up on a shell that hangs', async () => {
    const shell = fakeShell('sleep 30')
    const started = Date.now()
    expect(await readShellPath(shell, 300)).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('is null when the shell fails or doesn’t exist', async () => {
    expect(await readShellPath(fakeShell('echo "zsh: bad option"\nexit 1'))).toBeNull()
    expect(await readShellPath('/nonexistent/zsh')).toBeNull()
  })
})

describe('explainFailure', () => {
  it('explains a missing git-lfs, as sh and dash word it', () => {
    expect(explainFailure('git-lfs filter-process: git-lfs: command not found\nfatal: the remote end hung up unexpectedly\n')).toMatch(/Install Git LFS/)
    expect(explainFailure('sh: 1: git-lfs: not found\n')).toMatch(/couldn’t find the git-lfs program/)
  })

  it('leaves other failures to git’s own words', () => {
    expect(explainFailure('fatal: not a git repository')).toBeUndefined()
    expect(explainFailure("git: 'lfs' is not a git command. See 'git --help'.")).toBeUndefined()
  })
})
