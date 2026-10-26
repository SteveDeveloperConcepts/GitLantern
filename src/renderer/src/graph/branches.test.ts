import { describe, expect, it } from 'vitest'
import type { Commit, RefLabel } from '../../../shared/types'
import { commitBranches, parseMergeSubject } from './branches'

const commit = (hash: string, parents: string[], refs: RefLabel[] = [], subject = hash): Commit => ({
  hash,
  parents,
  refs,
  subject,
  authorName: '',
  authorEmail: '',
  authorDate: 0
})
const local = (name: string, isCurrent = false): RefLabel => ({ name, kind: 'local', isCurrent })
const remote = (name: string, isDefault = false): RefLabel => ({ name, kind: 'remote', isDefault })

/** hash → branch, with " (gone)" for a branch only a merge message names. */
function owners(commits: Commit[]): Record<string, string> {
  return Object.fromEntries([...commitBranches(commits)].map(([hash, branch]) => [hash, `${branch.name}${branch.gone ? ' (gone)' : ''}`]))
}

describe('commitBranches', () => {
  it("stops a feature branch where it started, even when it's checked out", () => {
    expect(
      owners([
        commit('f2', ['f1'], [local('feature', true)]),
        commit('m3', ['m2'], [local('main'), remote('origin/main')]),
        commit('o1', ['m2'], [remote('origin/only-remote')]),
        commit('f1', ['m2']),
        commit('m2', ['m1']),
        commit('m1', [])
      ])
    ).toEqual({ f2: 'feature', f1: 'feature', o1: 'only-remote', m3: 'main', m2: 'main', m1: 'main' })
  })

  it('names a deleted branch from the merge that brought it in', () => {
    expect(
      owners([
        commit('M', ['m1', 'x2'], [local('main', true)], "Merge branch 'fix/x'"),
        commit('x2', ['x1']),
        commit('m1', ['m0']),
        commit('x1', ['m0']),
        commit('m0', [])
      ])
    ).toEqual({ M: 'main', m1: 'main', m0: 'main', x2: 'fix/x (gone)', x1: 'fix/x (gone)' })
  })

  it('handles both copies of main after they diverged, each merging the same branch', () => {
    expect(
      owners([
        commit('c2184ae', ['882c309', 'bd1f158'], [local('main', true)], "Merge branch 'fix/android-picker-ui-freeze'"),
        commit('bd1f158', ['04bde1d'], [remote('origin/fix/android-picker-ui-freeze'), local('fix/android-picker-ui-freeze')]),
        commit('2ab70d7', ['bc775c3', '04bde1d'], [remote('origin/main', true)], "Merge remote-tracking branch 'origin/fix/android-picker-ui-freeze'"),
        commit('04bde1d', ['882c309']),
        commit('bc775c3', ['3477fe2']),
        commit('3477fe2', ['882c309']),
        commit('882c309', ['6b47876']),
        commit('6b47876', [], [{ name: 'v1.3.0', kind: 'tag' }])
      ])
    ).toEqual({
      c2184ae: 'main',
      bd1f158: 'fix/android-picker-ui-freeze',
      '2ab70d7': 'main',
      '04bde1d': 'fix/android-picker-ui-freeze',
      bc775c3: 'main',
      '3477fe2': 'main',
      '882c309': 'main',
      '6b47876': 'main'
    })
  })

  it("keeps a merged branch's commits when another computer's main was fast-forwarded to it", () => {
    expect(
      owners([
        commit('M3', ['M2', 'aws'], [local('main', true)], "Merge branch 'fix/video-upload'"),
        commit('M2', ['M1', 's3'], [], "Merge remote-tracking branch 'origin/main'"),
        commit('aws', ['x3']),
        commit('s3', ['x3']),
        commit('M1', ['base', 'x3'], [], "Merge branch 'fix/video-upload'"),
        commit('x3', ['x2']),
        commit('x2', ['x1']),
        commit('x1', ['base']),
        commit('base', [])
      ])
    ).toEqual({
      M3: 'main',
      M2: 'main',
      M1: 'main',
      s3: 'main',
      base: 'main',
      aws: 'fix/video-upload (gone)',
      x3: 'fix/video-upload (gone)',
      x2: 'fix/video-upload (gone)',
      x1: 'fix/video-upload (gone)'
    })
  })

  it('gives the commits of a merged branch to it, not to a branch that was started from it', () => {
    expect(
      owners([
        commit('b1', ['a2'], [local('b', true)]),
        commit('M', ['m1', 'a2'], [local('main')], "Merge branch 'a'"),
        commit('m1', ['m0']),
        commit('a2', ['a1']),
        commit('a1', ['m0']),
        commit('m0', [])
      ])
    ).toEqual({ b1: 'b', M: 'main', m1: 'main', a2: 'a (gone)', a1: 'a (gone)', m0: 'main' })
  })

  it("treats the remote's default branch as the main line, whatever it's called", () => {
    expect(
      owners([
        commit('f1', ['p1'], [local('feature', true)]),
        commit('p2', ['p1'], [local('production'), remote('origin/production', true)]),
        commit('p1', [])
      ])
    ).toEqual({ f1: 'feature', p2: 'production', p1: 'production' })
  })

  it("names the merge commit's own branch from \"into\", and leaves unnamed merged lines out", () => {
    expect(
      owners([
        commit('M2', ['m1', 'y1'], [local('main')], 'Merged PR 12: Add y'),
        commit('y1', ['D']),
        commit('m1', ['m0']),
        commit('D', ['d0', 'm0'], [], "Merge branch 'main' into feature/d"),
        commit('d0', ['m0']),
        commit('m0', [])
      ])
    ).toEqual({ M2: 'main', m1: 'main', m0: 'main', D: 'feature/d (gone)', d0: 'feature/d (gone)' })
  })
})

describe('parseMergeSubject', () => {
  const remotes = new Set(['origin'])
  it.each([
    ["Merge branch 'fix/x'", ['fix/x'], null],
    ["Merge branch 'fix/x' into develop", ['fix/x'], 'develop'],
    ["Merge branches 'a', 'b' and 'c'", ['a', 'b', 'c'], null],
    ["Merge remote-tracking branch 'origin/fix/x'", ['fix/x'], null],
    ["Merge remote-tracking branch 'gone-remote/fix/x' into main", ['fix/x'], 'main'],
    ["Merge branch 'main' of github.com:owner/repo", ['main'], null],
    ["Merge branch 'main' of https://github.com/owner/repo into feature", ['main'], 'feature'],
    ["Merge branch 'feature' into 'main'", ['feature'], 'main'],
    ['Merge pull request #12 from owner/feature/y', ['feature/y'], null],
    ['Merge pull request #12 in PROJ/repo from feature/y to master', ['feature/y'], 'master'],
    ["Merge pull request 'Add y' (#12) from feature/y into main", ['feature/y'], 'main'],
    ['Merged in feature/y (pull request #12)', ['feature/y'], null],
    ['Merge feat/icons into main', ['feat/icons'], 'main'],
    ['Merge origin/main into main', ['main'], 'main']
  ])('%s', (subject, merged, into) => {
    expect(parseMergeSubject(subject, remotes)).toEqual({ merged, into })
  })

  it.each(["Merge tag 'v1.0'", "Merge commit 'abc1234'", 'Merged PR 12: Add y', 'Fix the build'])('%s names no branch', (subject) => {
    expect(parseMergeSubject(subject, remotes)).toBeNull()
  })
})
