import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/release.mjs')

/** A bare "server" and a clone of it whose package.json says 0.1.0, with `main` pushed and tracked. */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-release-'))
  const globalConfig = path.join(dir, 'gitconfig')
  fs.writeFileSync(globalConfig, '')
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com'
  }
  const git = (cwd: string, ...args: string[]): string => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  const server = path.join(dir, 'server.git')
  const repo = path.join(dir, 'repo')
  git(dir, 'init', '-q', '--bare', '-b', 'main', server)
  git(dir, 'clone', '-q', server, repo)
  fs.writeFileSync(path.join(repo, 'package.json'), '{\n  "name": "gitlantern",\n  "productName": "GitLantern",\n  "version": "0.1.0"\n}\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  const release = (...args: string[]) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, env, encoding: 'utf8' })
    return { code: result.status, out: result.stdout, err: result.stderr }
  }
  const version = () => JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version as string
  return { dir, server, repo, git, release, version }
}

describe('yarn release', () => {
  it('bumps, commits, tags with the notes and pushes both', () => {
    const { server, repo, git, release, version } = setup()
    const result = release('0.2.0', 'Pull handles diverged branches', '- Refused pushes explained')
    expect(result.err).not.toContain('✖')
    expect(result.code).toBe(0)
    expect(result.out).toContain('✔ Pushed v0.2.0')

    expect(version()).toBe('0.2.0')
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('Release 0.2.0')
    expect(git(repo, 'cat-file', '-t', 'v0.2.0')).toBe('tag')
    expect(git(repo, 'tag', '-l', '--format=%(contents)', 'v0.2.0')).toBe(
      'GitLantern 0.2.0\n\n- Pull handles diverged branches\n- Refused pushes explained'
    )
    expect(git(server, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(git(server, 'rev-parse', 'v0.2.0^{commit}')).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('changes nothing on a dry run', () => {
    const { server, repo, git, release, version } = setup()
    const before = git(repo, 'rev-parse', 'HEAD')
    const result = release('0.2.0', 'Something new', '--dry-run')
    expect(result.code).toBe(0)
    expect(result.out).toContain('raise the version in package.json from 0.1.0 to 0.2.0')
    expect(result.out).toContain('GitLantern 0.2.0\n\n- Something new')
    expect(result.out).toContain('Dry run: nothing was changed.')
    expect(version()).toBe('0.1.0')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(repo, 'tag', '-l')).toBe('')
    expect(git(server, 'tag', '-l')).toBe('')
  })

  it('only tags when package.json already has the version', () => {
    const { server, repo, git, release } = setup()
    fs.writeFileSync(path.join(repo, 'package.json'), fs.readFileSync(path.join(repo, 'package.json'), 'utf8').replace('0.1.0', '0.2.0'))
    git(repo, 'commit', '-q', '-am', 'bump by hand')
    const result = release('0.2.0', 'Something new')
    expect(result.code).toBe(0)
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('bump by hand')
    expect(git(server, 'rev-parse', 'v0.2.0^{commit}')).toBe(git(repo, 'rev-parse', 'HEAD'))
  })

  it('refuses before changing anything when something is wrong', () => {
    const { dir, server, repo, git, release, version } = setup()
    const refuse = (pattern: RegExp, ...args: string[]) => {
      const result = release(...args)
      expect(result.code).toBe(1)
      expect(result.err).toMatch(pattern)
      expect(version()).toBe('0.1.0')
      expect(git(repo, 'tag', '-l')).toBe('')
    }
    refuse(/Give the new version/)
    refuse(/"v0\.2" isn't a version like 1\.4\.0/, 'v0.2', 'Something')
    refuse(/0\.0\.9 is lower than the current version, 0\.1\.0/, '0.0.9', 'Something')
    refuse(/Say what changed/, '0.2.0')
    refuse(/placeholder from the docs/, '0.2.0', '<what changed>')

    fs.writeFileSync(path.join(repo, 'package.json'), '{ "version": "0.1.0", "private": true }\n')
    refuse(/Commit or discard your uncommitted changes/, '0.2.0', 'Something')
    git(repo, 'checkout', '--', 'package.json')

    // A failed attempt left the tag on the server.
    git(repo, 'tag', 'v0.2.0')
    git(repo, 'push', '-q', 'origin', 'v0.2.0')
    git(repo, 'tag', '-d', 'v0.2.0')
    refuse(/v0\.2\.0 is already on origin\. .*\n.*git push origin :refs\/tags\/v0\.2\.0/, '0.2.0', 'Something')
    git(repo, 'push', '-q', 'origin', ':refs/tags/v0.2.0')

    // Someone else pushed in the meantime.
    const other = path.join(dir, 'other')
    git(dir, 'clone', '-q', server, other)
    fs.writeFileSync(path.join(other, 'b.txt'), 'b\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'their work')
    git(other, 'push', '-q')
    refuse(/origin\/main has 1 commit that main doesn't\. Pull first/, '0.2.0', 'Something')
  })
})
