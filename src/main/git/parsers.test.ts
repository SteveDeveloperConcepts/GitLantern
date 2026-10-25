import { describe, expect, it } from 'vitest'
import {
  parseBranches,
  parseCommitDetail,
  parseDecorations,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseRemotes,
  parseStatus
} from './parsers'

const F = '\x1f'

describe('parseStatus', () => {
  it('reads branch headers and every entry type', () => {
    const out = [
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaaa bbbb src/staged file.ts',
      '1 .M N... 100644 100644 100644 aaaa aaaa README.md',
      '2 R. N... 100644 100644 100644 aaaa aaaa R100 new name.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.txt',
      '? notes/untracked.md',
      ''
    ].join('\0')

    const { branch, entries } = parseStatus(out)
    expect(branch).toEqual({
      oid: '1234567890abcdef1234567890abcdef12345678',
      head: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1
    })
    expect(entries).toEqual([
      { path: 'src/staged file.ts', index: 'M', worktree: null, untracked: false, conflicted: false },
      { path: 'README.md', index: null, worktree: 'M', untracked: false, conflicted: false },
      { path: 'new name.txt', origPath: 'old name.txt', index: 'R', worktree: null, untracked: false, conflicted: false },
      { path: 'conflict.txt', index: 'U', worktree: 'U', untracked: false, conflicted: true },
      { path: 'notes/untracked.md', index: null, worktree: null, untracked: true, conflicted: false }
    ])
  })

  it('handles an unborn branch and a detached HEAD', () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0').branch.oid).toBeNull()
    expect(parseStatus('# branch.oid abc\0# branch.head (detached)\0').branch.head).toBeNull()
  })
})

describe('parseDecorations', () => {
  it('classifies refs from --decorate=full', () => {
    expect(
      parseDecorations(
        'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1.0, refs/heads/dev'
      )
    ).toEqual([
      { name: 'main', kind: 'local', isCurrent: true },
      { name: 'origin/main', kind: 'remote' },
      { name: 'v1.0', kind: 'tag' },
      { name: 'dev', kind: 'local', isCurrent: false }
    ])
  })

  it('marks a detached HEAD', () => {
    expect(parseDecorations('HEAD, refs/heads/x')).toEqual([
      { name: 'HEAD', kind: 'head' },
      { name: 'x', kind: 'local', isCurrent: false }
    ])
  })
})

describe('parseLog', () => {
  it('splits NUL-terminated records and 0x1f fields', () => {
    const out =
      ['c2', 'c1 m1', 'Ann', 'ann@example.com', '1700000000', 'HEAD -> refs/heads/main', 'Merge it'].join(F) +
      '\0\n' +
      ['c1', '', 'Bob', 'bob@example.com', '1690000000', '', 'First'].join(F) +
      '\0'
    const commits = parseLog(out)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({ hash: 'c2', parents: ['c1', 'm1'], authorName: 'Ann', authorDate: 1700000000, subject: 'Merge it' })
    expect(commits[0]?.refs).toEqual([{ name: 'main', kind: 'local', isCurrent: true }])
    expect(commits[1]).toMatchObject({ hash: 'c1', parents: [], refs: [], subject: 'First' })
  })
})

describe('parseCommitDetail', () => {
  it('splits the subject from the body', () => {
    const out = ['abc', 'p1', 'Ann', 'a@x', '1', '', 'Subject line\n\nBody line 1\nBody line 2\n'].join(F) + '\n'
    const detail = parseCommitDetail(out, [])
    expect(detail.subject).toBe('Subject line')
    expect(detail.body).toBe('Body line 1\nBody line 2')
  })
})

describe('parseBranches', () => {
  it('reads local and remote branches and skips remote HEAD', () => {
    const out = [
      ['refs/heads/main', 'aaa', 'origin/main', '*'].join('\0'),
      ['refs/heads/feature/x', 'bbb', '', ' '].join('\0'),
      ['refs/remotes/origin/HEAD', 'aaa', '', ' '].join('\0'),
      ['refs/remotes/origin/main', 'aaa', '', ' '].join('\0'),
      ''
    ].join('\n')
    expect(parseBranches(out)).toEqual([
      { name: 'main', fullName: 'refs/heads/main', kind: 'local', hash: 'aaa', upstream: 'origin/main', isCurrent: true },
      { name: 'feature/x', fullName: 'refs/heads/feature/x', kind: 'local', hash: 'bbb', upstream: null, isCurrent: false },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', hash: 'aaa', upstream: null, isCurrent: false }
    ])
  })
})

describe('parseRemotes', () => {
  it('pairs fetch and push addresses per remote', () => {
    const out = [
      'origin\thttps://github.com/a/b.git (fetch)',
      'origin\thttps://github.com/a/b.git (push)',
      'mirror\thttps://read.example.com/b.git (fetch)',
      'mirror\tgit@write.example.com:b.git (push)',
      ''
    ].join('\n')
    expect(parseRemotes(out)).toEqual([
      { name: 'origin', fetchUrl: 'https://github.com/a/b.git', pushUrl: 'https://github.com/a/b.git' },
      { name: 'mirror', fetchUrl: 'https://read.example.com/b.git', pushUrl: 'git@write.example.com:b.git' }
    ])
  })
})

describe('parseNumstat', () => {
  it('reads counts, binary files and renames', () => {
    const counts = parseNumstat('3\t1\tsrc/a.ts\0-\t-\timg.png\0' + '2\t0\t\0old.txt\0new.txt\0')
    expect([...counts]).toEqual([
      ['src/a.ts', { additions: 3, deletions: 1 }],
      ['img.png', { additions: null, deletions: null }],
      ['new.txt', { additions: 2, deletions: 0 }]
    ])
  })
})

describe('parseNameStatus', () => {
  it('reads two paths for renames', () => {
    expect(parseNameStatus('M\0a.txt\0R096\0old.txt\0new.txt\0D\0gone.txt\0')).toEqual([
      { status: 'M', path: 'a.txt' },
      { status: 'R', path: 'new.txt', origPath: 'old.txt' },
      { status: 'D', path: 'gone.txt' }
    ])
  })
})
