import { beforeAll, describe, expect, it } from 'vitest'
import * as commands from '../src/main/git/commands'
import * as flow from '../src/main/git/flow'
import type { FlowConfig } from '../src/shared/types'
import { commitAt, git, isolateGit, makeRepo, write } from './helpers'

beforeAll(() => {
  isolateGit()
})

const CONFIG: FlowConfig = {
  master: 'main',
  develop: 'develop',
  prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' },
  versionTagPrefix: 'v'
}

const head = async (repo: string, ref = 'HEAD'): Promise<string> => (await git(repo, 'rev-parse', ref)).trim()
const currentBranch = async (repo: string): Promise<string> => (await git(repo, 'symbolic-ref', '--short', 'HEAD')).trim()
const parentsOf = async (repo: string, ref: string): Promise<string[]> =>
  (await git(repo, 'rev-list', '--parents', '-n', '1', ref)).trim().split(' ').slice(1)
const localBranches = async (repo: string): Promise<string[]> =>
  (await git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/')).split('\n').filter(Boolean)

/** A repository with one commit on main, set up for git-flow (develop made from main). */
async function flowRepo(): Promise<string> {
  const repo = await makeRepo()
  write(repo, 'a.txt', 'base\n')
  await commitAt(repo, 'base', 1_700_000_000)
  await flow.flowInit(repo, CONFIG)
  return repo
}

describe('git-flow setup', () => {
  it('has no settings until it is set up, then reads the keys git-flow uses', async () => {
    const repo = await makeRepo()
    write(repo, 'a.txt', 'base\n')
    await commitAt(repo, 'base', 1_700_000_000)
    expect(await flow.flowConfig(repo)).toBeNull()

    await flow.flowInit(repo, CONFIG)
    expect(await flow.flowConfig(repo)).toEqual(CONFIG)
    expect((await git(repo, 'config', '--local', 'gitflow.branch.develop')).trim()).toBe('develop')
    expect((await git(repo, 'config', '--local', 'gitflow.prefix.versiontag')).trim()).toBe('v')
    // develop was made from main, and main stays checked out.
    expect(await head(repo, 'develop')).toBe(await head(repo, 'main'))
    expect(await currentBranch(repo)).toBe('main')
  })

  it('fills in git-flow’s default prefixes when only the branches are set', async () => {
    const repo = await makeRepo()
    await git(repo, 'config', 'gitflow.branch.master', 'main')
    expect(await flow.flowConfig(repo)).toBeNull()
    await git(repo, 'config', 'gitflow.branch.develop', 'dev')
    expect(await flow.flowConfig(repo)).toEqual({
      master: 'main',
      develop: 'dev',
      prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' },
      versionTagPrefix: ''
    })
  })

  it('refuses bad names, a missing production branch and a repository without commits', async () => {
    const empty = await makeRepo()
    await expect(flow.flowInit(empty, CONFIG)).rejects.toThrow('Make the first commit first.')

    const repo = await makeRepo()
    write(repo, 'a.txt', 'base\n')
    await commitAt(repo, 'base', 1_700_000_000)
    await expect(flow.flowInit(repo, { ...CONFIG, master: '--force' })).rejects.toThrow('"--force" is not a valid branch name')
    await expect(flow.flowInit(repo, { ...CONFIG, develop: 'has space' })).rejects.toThrow('not a valid branch name')
    await expect(flow.flowInit(repo, { ...CONFIG, develop: 'main' })).rejects.toThrow(/have to be different/)
    await expect(flow.flowInit(repo, { ...CONFIG, prefixes: { ...CONFIG.prefixes, feature: 'a..b' } })).rejects.toThrow(
      '"a..b" can’t start a branch name'
    )
    await expect(flow.flowInit(repo, { ...CONFIG, versionTagPrefix: 'v:' })).rejects.toThrow('can’t start a tag name')
    await expect(flow.flowInit(repo, { ...CONFIG, versionTagPrefix: 'release/' })).rejects.toThrow(/version tag prefix has to differ/)
    await expect(flow.flowInit(repo, { ...CONFIG, master: 'production' })).rejects.toThrow('There’s no branch called production')
    // Nothing was written or created along the way.
    expect(await flow.flowConfig(repo)).toBeNull()
    expect(await localBranches(repo)).toEqual(['main'])
  })
})

describe('git-flow branches', () => {
  it('starts features and releases from develop and hotfixes from main', async () => {
    const plain = await makeRepo()
    await expect(flow.flowStart(plain, 'feature', 'login')).rejects.toThrow(/Set up git-flow/)

    const repo = await flowRepo()
    await git(repo, 'switch', '-q', 'develop')
    write(repo, 'dev.txt', 'develop work\n')
    await commitAt(repo, 'develop work', 1_700_000_100)

    await flow.flowStart(repo, 'feature', 'login')
    expect(await currentBranch(repo)).toBe('feature/login')
    expect(await head(repo)).toBe(await head(repo, 'develop'))
    // No upstream: a git-flow branch is local until it's pushed.
    expect(await commands.configValue(repo, 'branch.feature/login.merge')).toBeNull()

    await flow.flowStart(repo, 'release', '1.0')
    expect(await head(repo, 'release/1.0')).toBe(await head(repo, 'develop'))
    await flow.flowStart(repo, 'hotfix', '0.9.1')
    expect(await currentBranch(repo)).toBe('hotfix/0.9.1')
    expect(await head(repo)).toBe(await head(repo, 'main'))

    await expect(flow.flowStart(repo, 'feature', 'login')).rejects.toThrow('feature/login already exists')
    await expect(flow.flowStart(repo, 'feature', 'two words')).rejects.toThrow('not a valid branch name')
  })

  it('finishes a feature into develop with a merge commit, and deletes it unless kept', async () => {
    const repo = await flowRepo()
    await flow.flowStart(repo, 'feature', 'login')
    write(repo, 'login.txt', 'login\n')
    await commitAt(repo, 'add login', 1_700_000_100)
    const tip = await head(repo)

    expect(await flow.flowFinish(repo, 'feature', 'login', {})).toEqual({ conflicted: false })
    expect(await currentBranch(repo)).toBe('develop')
    expect(await parentsOf(repo, 'develop')).toEqual([await head(repo, 'main'), tip])
    expect((await git(repo, 'log', '-1', '--format=%s', 'develop')).trim()).toBe("Merge branch 'feature/login' into develop")
    expect(await localBranches(repo)).toEqual(['develop', 'main'])

    await flow.flowStart(repo, 'feature', 'search')
    write(repo, 'search.txt', 'search\n')
    await commitAt(repo, 'add search', 1_700_000_200)
    // Uncommitted changes to tracked files block it; untracked files don't.
    write(repo, 'a.txt', 'edited\n')
    const finishing = flow.flowFinish(repo, 'feature', 'search', {})
    await expect(finishing).rejects.toThrow('Commit or stash your changes before finishing feature/search.')
    await git(repo, 'checkout', '--', 'a.txt')
    write(repo, 'notes.txt', 'untracked\n')
    expect(await flow.flowFinish(repo, 'feature', 'search', { keepBranch: true })).toEqual({ conflicted: false })
    expect(await localBranches(repo)).toEqual(['develop', 'feature/search', 'main'])
    await expect(flow.flowFinish(repo, 'feature', 'missing', {})).rejects.toThrow('There’s no branch called feature/missing')
  })

  it('finishes a hotfix: merged into main, tagged there with the message given, then merged into develop', async () => {
    const repo = await flowRepo()
    await flow.flowStart(repo, 'hotfix', '1.0.1')
    write(repo, 'a.txt', 'fixed\n')
    await commitAt(repo, 'fix', 1_700_000_100)
    const tip = await head(repo)

    expect(await flow.flowFinish(repo, 'hotfix', '1.0.1', { tagMessage: 'Urgent fix' })).toEqual({ conflicted: false })
    const main = await head(repo, 'main')
    expect((await parentsOf(repo, 'main'))[1]).toBe(tip)
    expect((await git(repo, 'cat-file', '-t', 'v1.0.1')).trim()).toBe('tag')
    expect(await head(repo, 'v1.0.1^{commit}')).toBe(main)
    expect((await git(repo, 'tag', '-l', '--format=%(contents:subject)', 'v1.0.1')).trim()).toBe('Urgent fix')
    expect((await parentsOf(repo, 'develop'))[1]).toBe(tip)
    expect(await currentBranch(repo)).toBe('develop')
    expect(await localBranches(repo)).toEqual(['develop', 'main'])
  })

  it('carries on a release finish that stopped on conflicts, skipping what is already done', async () => {
    const repo = await flowRepo()
    await flow.flowStart(repo, 'release', '2.0')
    write(repo, 'a.txt', 'release\n')
    write(repo, 'b.txt', 'release\n')
    await commitAt(repo, 'release work', 1_700_000_100)
    // Both main and develop change the same files meanwhile, so both merges conflict.
    await git(repo, 'switch', '-q', 'main')
    write(repo, 'a.txt', 'main\n')
    await commitAt(repo, 'main change', 1_700_000_200)
    await git(repo, 'switch', '-q', 'develop')
    write(repo, 'b.txt', 'develop\n')
    await commitAt(repo, 'develop change', 1_700_000_300)
    await git(repo, 'switch', '-q', 'release/2.0')

    expect(await flow.flowFinish(repo, 'release', '2.0', {})).toEqual({ conflicted: true })
    expect(await currentBranch(repo)).toBe('main')
    expect((await commands.status(repo)).operation?.kind).toBe('merge')
    await expect(flow.flowFinish(repo, 'release', '2.0', {})).rejects.toThrow('Finish the merge first')
    write(repo, 'a.txt', 'resolved\n')
    await git(repo, 'add', 'a.txt')
    await git(repo, 'commit', '-q', '--no-edit')
    const mainMerge = await head(repo, 'main')

    // Second run: main already has the release, so it tags it and moves on to develop, which conflicts.
    expect(await flow.flowFinish(repo, 'release', '2.0', {})).toEqual({ conflicted: true })
    expect(await currentBranch(repo)).toBe('develop')
    expect(await head(repo, 'main')).toBe(mainMerge)
    expect(await head(repo, 'v2.0^{commit}')).toBe(mainMerge)
    expect((await git(repo, 'tag', '-l', '--format=%(contents:subject)', 'v2.0')).trim()).toBe('Release 2.0')
    const tagObject = await head(repo, 'v2.0')
    write(repo, 'b.txt', 'resolved\n')
    await git(repo, 'add', 'b.txt')
    await git(repo, 'commit', '-q', '--no-edit')
    const developMerge = await head(repo, 'develop')

    // Third run: only the branch is left to delete.
    expect(await flow.flowFinish(repo, 'release', '2.0', {})).toEqual({ conflicted: false })
    expect(await head(repo, 'main')).toBe(mainMerge)
    expect(await head(repo, 'develop')).toBe(developMerge)
    expect(await head(repo, 'v2.0')).toBe(tagObject)
    expect(await localBranches(repo)).toEqual(['develop', 'main'])
    expect(await currentBranch(repo)).toBe('develop')
    expect((await git(repo, 'log', '-1', '--format=%s', 'main')).trim()).toBe("Merge branch 'release/2.0'")
  })
})
