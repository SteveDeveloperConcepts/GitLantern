/**
 * Which branch each commit belongs to.
 *
 * Git doesn't record the branch a commit was made on, so this reads it from the history. A branch's
 * own commits are the ones on its first-parent line: from its tip, follow each commit's first parent.
 * A merge commit's other parents start the lines of the branches it merged, and its message usually
 * names them ("Merge branch 'fix/x'"), even after the branch was deleted.
 *
 * Lines overlap: a feature branch's first-parent line runs on into the history of the branch it
 * started from. Where several branches claim a commit, the strongest claim wins:
 *   1. the remote's default branch (where origin/HEAD points), from its tip
 *   2. other long-lived branches from their tips: main, master, trunk, develop…
 *   3. a branch named by a merge commit. It outranks the branches below because a branch started
 *      from an unmerged feature branch also claims that branch's commits. Main named this way is
 *      no stronger than any other: when another computer fast-forwards its main to a feature
 *      branch, a later "Merge remote-tracking branch 'origin/main'" reaches the feature's commits
 *      too. Between two of these, the merge that names the commit itself beats a line from above.
 *   4. the checked-out branch, 5. other local branches, 6. branches only on a remote.
 * Otherwise the first claim to arrive, from the newest child, wins.
 */
import type { Commit, RefLabel } from '../../../shared/types'

export interface CommitBranch {
  name: string
  /** No branch of that name exists any more: only a merge commit's message names it. */
  gone: boolean
}

const TRUNKS = ['main', 'master', 'trunk', 'develop', 'development', 'dev']
const REMOTE = 0
const LOCAL = 1
const CURRENT = 2
const MERGED = 3
const TRUNK = 4
const DEFAULT = 5

interface Claim {
  name: string
  rank: number
  /** From a merge that names this very commit, not inherited along a first-parent line. */
  direct?: boolean
}

/** The branch a ref stands for, with a remote branch's remote left off (`origin/main` → `main`). */
export function branchNameOf(ref: RefLabel): string | null {
  if (ref.kind === 'local') return ref.name
  if (ref.kind === 'remote') return ref.name.slice(ref.name.indexOf('/') + 1)
  return null
}

/** Commits must come newest first, every commit before its parents (git log --date-order). */
export function commitBranches(commits: readonly Commit[]): Map<string, CommitBranch> {
  const existing = new Set<string>()
  const defaults = new Set<string>()
  const remotes = new Set<string>()
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const name = branchNameOf(ref)
      if (name === null) continue
      existing.add(name)
      if (ref.kind === 'remote') remotes.add(ref.name.slice(0, ref.name.indexOf('/')))
      if (ref.isDefault) defaults.add(name)
    }
  }
  const rank = (name: string, otherwise: number): number =>
    defaults.has(name) ? DEFAULT : TRUNKS.includes(name) ? TRUNK : otherwise

  const claims = new Map<string, Claim>()
  const offer = (hash: string, claim: Claim): void => {
    const best = claims.get(hash)
    if (!best || claim.rank > best.rank || (claim.rank === best.rank && claim.direct && !best.direct)) claims.set(hash, claim)
  }

  const result = new Map<string, CommitBranch>()
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const name = branchNameOf(ref)
      if (name !== null) offer(commit.hash, { name, rank: rank(name, ref.kind === 'remote' ? REMOTE : ref.isCurrent ? CURRENT : LOCAL) })
    }
    const merge = commit.parents.length > 1 ? parseMergeSubject(commit.subject, remotes) : null
    if (merge?.into) offer(commit.hash, { name: merge.into, rank: MERGED, direct: true })

    // Every child has been seen by now, so this claim is final.
    const claim = claims.get(commit.hash)
    if (claim) result.set(commit.hash, { name: claim.name, gone: !existing.has(claim.name) })
    const [firstParent, ...otherParents] = commit.parents
    if (claim && firstParent) offer(firstParent, { name: claim.name, rank: claim.rank })
    otherParents.forEach((parent, index) => {
      const name = merge?.merged[index]
      if (name) offer(parent, { name, rank: MERGED, direct: true })
    })
  }
  return result
}

export interface MergeSubject {
  /** Branches merged in, for the second parent onwards. */
  merged: string[]
  /** The branch merged into, when the message says. */
  into: string | null
}

/**
 * Branch names in a merge commit's subject line, as written by git, GitHub, GitLab, Bitbucket and
 * Gitea. Remote names are left off. Null when it names no branch (`Merge tag 'v1'`, `Merged PR 12: …`).
 */
export function parseMergeSubject(subject: string, remotes: ReadonlySet<string> = new Set()): MergeSubject | null {
  const local = (name: string): string => {
    const slash = name.indexOf('/')
    return slash > 0 && remotes.has(name.slice(0, slash)) ? name.slice(slash + 1) : name
  }
  const result = (merged: string[], into?: string): MergeSubject => ({
    merged: merged.map(local),
    into: into ? local(into) : null
  })

  // git: Merge branch 'a' · Merge branches 'a', 'b' and 'c' · Merge remote-tracking branch 'origin/a'
  // with " of <url>" after a pull, and " into <branch>" off main. GitLab: Merge branch 'a' into 'main'
  let match = /^Merge (remote-tracking )?branch(?:es)? ((?:'[^']+'(?:, | and )?)+)(?: of \S+)?(?: into '?([^']+?)'?)?$/.exec(subject)
  if (match) {
    const names = [...(match[2] ?? '').matchAll(/'([^']+)'/g)].map((quoted) => quoted[1] ?? '')
    // A remote-tracking branch always starts with its remote's name, even if that remote is gone.
    const merged = match[1] ? names.map((name) => name.slice(name.indexOf('/') + 1)) : names
    return result(merged, match[3])
  }
  // GitHub: Merge pull request #12 from owner/branch
  match = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)
  if (match?.[1]) return result([match[1]])
  // Bitbucket Server: Merge pull request #12 in PROJ/repo from branch to main
  match = /^Merge pull request #\d+ in \S+ from (\S+) to (\S+)$/.exec(subject)
  if (match?.[1]) return result([match[1]], match[2])
  // Gitea: Merge pull request 'Title' (#12) from branch into main
  match = /^Merge pull request '.*' \(#\d+\) from (\S+) into (\S+)$/.exec(subject)
  if (match?.[1]) return result([match[1].replace(/^[^:]+:/, '')], match[2])
  // Bitbucket Cloud: Merged in branch (pull request #12)
  match = /^Merged in (\S+) \(pull request #\d+\)/.exec(subject)
  if (match?.[1]) return result([match[1]])
  // Hand-written: Merge feature/x into main
  match = /^Merge (\S+) into (\S+)$/.exec(subject)
  if (match?.[1]) return result([match[1]], match[2])
  return null
}
