import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

describe('remotes, clone and connection tests', () => {
  it('adds, edits and removes remotes', async () => {
    const repo = await makeRepo()
    await commands.addRemote(repo, 'origin', 'https://github.com/acme/web.git')
    await commands.addRemote(repo, 'backup', 'git@git.example.com:team/web.git')
    expect(await commands.remotes(repo)).toEqual([
      { name: 'backup', fetchUrl: 'git@git.example.com:team/web.git', pushUrl: 'git@git.example.com:team/web.git' },
      { name: 'origin', fetchUrl: 'https://github.com/acme/web.git', pushUrl: 'https://github.com/acme/web.git' }
    ])
    expect(await commands.originUrl(repo)).toBe('https://github.com/acme/web.git')

    await commands.setRemoteUrl(repo, 'origin', 'git@github.com:acme/web.git')
    await commands.removeRemote(repo, 'backup')
    expect((await commands.remotes(repo)).map((r) => [r.name, r.fetchUrl])).toEqual([['origin', 'git@github.com:acme/web.git']])

    await expect(commands.addRemote(repo, '-bad', 'https://x/y.git')).rejects.toThrow(/not a valid remote name/)
    await expect(commands.addRemote(repo, 'evil', '--upload-pack=touch pwned')).rejects.toThrow(/Not a Git address/)
  })

  it('clones a repository into a new folder and reports progress', async () => {
    const source = await makeRepo()
    write(source, 'readme.md', '# hello\n')
    await commitAt(source, 'first', 1_700_000_000)

    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-clones-'))
    const phases: string[] = []
    const target = await commands.clone(source, parent, (p) => phases.push(p.phase))
    expect(target).toBe(path.join(parent, path.basename(source)))
    expect(fs.readFileSync(path.join(target, 'readme.md'), 'utf8')).toBe('# hello\n')
    expect(phases[0]).toBe('Connecting')

    // A second clone into the same, now non-empty, folder is refused.
    await expect(commands.clone(source, parent)).rejects.toThrow(/already exists/)
    await expect(commands.clone(source, 'relative/folder')).rejects.toThrow(/Choose a folder/)
  })

  it('tests whether an address is reachable', async () => {
    const source = await makeRepo()
    write(source, 'a.txt', '1\n')
    await commitAt(source, 'first', 1_700_000_000)
    await git(source, 'branch', 'feature')

    expect(await commands.testRemote(source, os.tmpdir())).toEqual({ ok: true, message: 'Reachable · 2 branches' })
    const missing = await commands.testRemote(path.join(os.tmpdir(), 'does-not-exist-gitlantern'), os.tmpdir())
    expect(missing.ok).toBe(false)
  })

  it('reads clone progress from git output', () => {
    expect(commands.parseCloneProgress('Receiving objects:  12% (12/100)\rReceiving objects:  45% (45/100)\r')).toEqual({
      phase: 'Receiving objects',
      percent: 45
    })
    expect(commands.parseCloneProgress('Cloning into \'x\'...\n')).toBeNull()
  })

  it('routes HTTPS credentials for connected hosts to GitLantern', () => {
    commands.setAccountHosts(() => new Set(['github.com', 'git.example.com:8443']))
    expect(
      commands.credentialArgs([
        'https://github.com/a/b.git',
        'https://user@git.example.com:8443/c.git',
        'git@github.com:a/b.git',
        'https://gitlab.com/x.git'
      ])
    ).toEqual(['-c', 'credential.https://github.com.helper=', '-c', 'credential.https://git.example.com:8443.helper='])
    commands.setAccountHosts(() => new Set())
  })
})
