import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureGit, runGit } from '../src/main/git/runGit'

/** Point git at an empty global config so the user's hooks, signing and credential helpers stay out. */
export function isolateGit(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsteve-home-'))
  const globalConfig = path.join(home, 'gitconfig')
  fs.writeFileSync(globalConfig, '')
  const env = {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com'
  }
  configureGit({ gitPath: 'git', env: () => env })
  return home
}

export async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsteve-repo-'))
  await runGit(['init', '-q', '-b', 'main'], { cwd: dir })
  return path.resolve(dir)
}

export function write(repo: string, file: string, contents: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), contents)
}

export async function git(repo: string, ...args: string[]): Promise<string> {
  return (await runGit(args, { cwd: repo })).stdout
}

/** Stage everything and commit with a fixed timestamp, so history order doesn't depend on timing. */
export async function commitAt(repo: string, message: string, unixSeconds: number, ...extraArgs: string[]): Promise<void> {
  const date = `${unixSeconds} +0000`
  await runGit(['add', '-A'], { cwd: repo })
  await runGit(['commit', '-q', '-m', message, ...extraArgs], {
    cwd: repo,
    env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  })
}
