import type {
  Branch,
  BranchStatus,
  ChangedFile,
  Commit,
  CommitDetail,
  FileStatusCode,
  RefLabel,
  RepoStatus,
  Stash,
  StatusEntry
} from '../../shared/types'

const FIELD = '\x1f'
const STATUS_CODES = new Set<string>(['M', 'T', 'A', 'D', 'R', 'C', 'U'])

/** `git log --format` for {@link parseLog}: fields joined by 0x1f, one record per commit (use with -z). */
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s'].join('%x1f')
/** Same fields as {@link LOG_FORMAT} but with the full message (%B) last. */
export const DETAIL_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%B'].join('%x1f')
/** `git for-each-ref --format` for {@link parseBranches}: NUL-separated fields, one line per ref. */
export const BRANCH_FORMAT = '%(refname)%00%(objectname)%00%(upstream:short)%00%(HEAD)'
/** `git stash list -z --format` for {@link parseStashes}: hash, reflog subject, date. */
export const STASH_FORMAT = ['%H', '%gs', '%at'].join('%x1f')

function statusCode(c: string | undefined): FileStatusCode | null {
  return c !== undefined && STATUS_CODES.has(c) ? (c as FileStatusCode) : null
}

/** Split off `count` space-separated fields; the remainder is the path, which may contain spaces. */
function splitFields(line: string, count: number): { fields: string[]; rest: string } {
  const fields: string[] = []
  let pos = 0
  for (let n = 0; n < count; n++) {
    const next = line.indexOf(' ', pos)
    if (next === -1) throw new Error(`Malformed status entry: ${line}`)
    fields.push(line.slice(pos, next))
    pos = next + 1
  }
  return { fields, rest: line.slice(pos) }
}

function changedEntry(path: string, xy: string | undefined): StatusEntry {
  return {
    path,
    index: statusCode(xy?.[0]),
    worktree: statusCode(xy?.[1]),
    untracked: false,
    conflicted: false
  }
}

function applyBranchHeader(header: string, branch: BranchStatus): void {
  const space = header.indexOf(' ')
  const key = header.slice(0, space)
  const value = header.slice(space + 1)
  switch (key) {
    case 'branch.oid':
      branch.oid = value === '(initial)' ? null : value
      break
    case 'branch.head':
      branch.head = value === '(detached)' ? null : value
      break
    case 'branch.upstream':
      branch.upstream = value
      break
    case 'branch.ab': {
      const match = /^\+(\d+) -(\d+)$/.exec(value)
      if (match) {
        branch.ahead = Number(match[1])
        branch.behind = Number(match[2])
      }
      break
    }
  }
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export function parseStatus(stdout: string): RepoStatus {
  const branch: BranchStatus = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 }
  const entries: StatusEntry[] = []
  const tokens = stdout.split('\0')

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    if (token.startsWith('# ')) {
      applyBranchHeader(token.slice(2), branch)
      continue
    }
    switch (token[0]) {
      case '1': {
        const { fields, rest } = splitFields(token, 8)
        entries.push(changedEntry(rest, fields[1]))
        break
      }
      case '2': {
        // Renames and copies: the original path follows as the next NUL-terminated token.
        const { fields, rest } = splitFields(token, 9)
        entries.push({ ...changedEntry(rest, fields[1]), origPath: tokens[++i] ?? '' })
        break
      }
      case 'u': {
        const { rest } = splitFields(token, 10)
        entries.push({ path: rest, index: 'U', worktree: 'U', untracked: false, conflicted: true })
        break
      }
      case '?':
        entries.push({ path: token.slice(2), index: null, worktree: null, untracked: true, conflicted: false })
        break
      // '!' (ignored) entries are not requested.
    }
  }
  return { branch, entries }
}

/** Parse `%D` from `git log --decorate=full`, e.g. `HEAD -> refs/heads/main, tag: refs/tags/v1`. */
export function parseDecorations(decoration: string): RefLabel[] {
  const labels: RefLabel[] = []
  const remoteHeads: string[] = []
  for (const part of decoration.split(', ')) {
    let ref = part.trim()
    if (!ref) continue
    if (ref === 'HEAD') {
      labels.push({ name: 'HEAD', kind: 'head' })
      continue
    }
    let isCurrent = false
    if (ref.startsWith('HEAD -> ')) {
      ref = ref.slice('HEAD -> '.length)
      isCurrent = true
    }
    if (ref.startsWith('tag: ')) ref = ref.slice('tag: '.length)

    if (ref.startsWith('refs/heads/')) {
      labels.push({ name: ref.slice('refs/heads/'.length), kind: 'local', isCurrent })
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length)
      if (name.endsWith('/HEAD')) remoteHeads.push(name.slice(0, -'HEAD'.length))
      else labels.push({ name, kind: 'remote' })
    } else if (ref.startsWith('refs/tags/')) {
      labels.push({ name: ref.slice('refs/tags/'.length), kind: 'tag' })
    }
  }
  // `origin/HEAD` is listed without its target, but it's always on the same commit as it. When that
  // remote has one other branch here, that branch is the remote's default.
  for (const prefix of remoteHeads) {
    const candidates = labels.filter((label) => label.kind === 'remote' && label.name.startsWith(prefix))
    if (candidates.length === 1 && candidates[0]) candidates[0].isDefault = true
  }
  return labels
}

function parseCommitFields(record: string): { commit: Commit; last: string } {
  const fields = record.split(FIELD)
  const [hash = '', parents = '', authorName = '', authorEmail = '', authorDate = '0', refs = ''] = fields
  const last = fields.slice(6).join(FIELD)
  return {
    commit: {
      hash,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorDate: Number(authorDate),
      subject: last,
      refs: parseDecorations(refs)
    },
    last
  }
}

/** Parse `git log -z --decorate=full --format=<LOG_FORMAT>`. */
export function parseLog(stdout: string): Commit[] {
  const commits: Commit[] = []
  for (const record of stdout.split('\0')) {
    const trimmed = record.replace(/^\n/, '')
    if (trimmed) commits.push(parseCommitFields(trimmed).commit)
  }
  return commits
}

/** Parse `git show -s --decorate=full --format=<DETAIL_FORMAT>` plus the file list. */
export function parseCommitDetail(stdout: string, files: ChangedFile[]): CommitDetail {
  const { commit, last } = parseCommitFields(stdout.replace(/\n+$/, ''))
  const newline = last.indexOf('\n')
  const subject = newline === -1 ? last : last.slice(0, newline)
  const body = newline === -1 ? '' : last.slice(newline + 1).replace(/^\n+/, '')
  return { ...commit, subject, body, files }
}

/** Parse `git for-each-ref --format=<BRANCH_FORMAT> refs/heads refs/remotes`. */
export function parseBranches(stdout: string): Branch[] {
  const branches: Branch[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const [fullName = '', hash = '', upstream = '', head = ''] = line.split('\0')
    if (fullName.startsWith('refs/heads/')) {
      branches.push({
        name: fullName.slice('refs/heads/'.length),
        fullName,
        kind: 'local',
        hash,
        upstream: upstream || null,
        isCurrent: head === '*'
      })
    } else if (fullName.startsWith('refs/remotes/') && !fullName.endsWith('/HEAD')) {
      branches.push({
        name: fullName.slice('refs/remotes/'.length),
        fullName,
        kind: 'remote',
        hash,
        upstream: null,
        isCurrent: false
      })
    }
  }
  return branches
}

/**
 * Parse `git stash list -z --format=<STASH_FORMAT>`, newest (stash@{0}) first. The subject is
 * "On main: <message>" when a message was given and "WIP on main: <hash> <subject>" otherwise.
 */
export function parseStashes(stdout: string): Stash[] {
  return stdout
    .split('\0')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash = '', subject = '', date = '0'] = record.split(FIELD)
      const match = /^(WIP on|On) ([^:]*): ([\s\S]*)$/.exec(subject)
      const branch = match?.[2] && match[2] !== '(no branch)' ? match[2] : null
      const message = !match ? subject : match[1] === 'On' ? (match[3] ?? '') : `WIP on ${match[2]}: ${(match[3] ?? '').replace(/^[0-9a-f]+ /, '')}`
      return { hash, message, branch, date: Number(date) }
    })
}

export interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

/** Parse `git remote -v`: one line per remote and direction, `name<TAB>url (fetch|push)`. */
export function parseRemotes(stdout: string): Remote[] {
  const byName = new Map<string, Remote>()
  for (const line of stdout.split('\n')) {
    const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    const [, name = '', url = '', direction] = match
    const remote = byName.get(name) ?? { name, fetchUrl: url, pushUrl: url }
    if (direction === 'fetch') remote.fetchUrl = url
    else remote.pushUrl = url
    byName.set(name, remote)
  }
  return [...byName.values()]
}

/** Parse `git diff-tree --numstat -z` into added/removed line counts per path (null for binary). */
export function parseNumstat(stdout: string): Map<string, { additions: number | null; deletions: number | null }> {
  const counts = new Map<string, { additions: number | null; deletions: number | null }>()
  const tokens = stdout.split('\0')
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i++]
    if (!token) continue
    const [added = '-', deleted = '-', path = ''] = token.split('\t')
    let file = path
    if (!file) {
      // Renames leave the path empty and put "old\0new" in the next two tokens.
      i++
      file = tokens[i++] ?? ''
    }
    counts.set(file, {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted)
    })
  }
  return counts
}

/** Parse `git diff-tree --name-status -z` (renames and copies carry two paths). */
export function parseNameStatus(stdout: string): ChangedFile[] {
  const tokens = stdout.split('\0')
  const files: ChangedFile[] = []
  let i = 0
  while (i < tokens.length) {
    const status = tokens[i++]
    if (!status) continue
    const letter = status[0] ?? '?'
    if (letter === 'R' || letter === 'C') {
      const origPath = tokens[i++] ?? ''
      const path = tokens[i++] ?? ''
      files.push({ status: letter, path, origPath })
    } else {
      files.push({ status: letter, path: tokens[i++] ?? '' })
    }
  }
  return files
}
