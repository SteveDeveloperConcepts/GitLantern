import type { Commit } from '../../../shared/types'
import type { CommitBranch } from './branches'
import type { GraphNode } from './layout'

/** Words of the search box, lower-cased. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Whether a commit matches every word of the search: in its subject, author name or email, branch
 * and tag names, or as the start of its hash.
 */
export function matchesSearch(commit: Commit, branch: CommitBranch | undefined, terms: string[]): boolean {
  if (terms.length === 0) return true
  const text = [commit.subject, commit.authorName, commit.authorEmail, branch?.name ?? '', ...commit.refs.map((ref) => ref.name)]
    .join('\n')
    .toLowerCase()
  return terms.every((term) => text.includes(term) || (/^[0-9a-f]{4,}$/.test(term) && commit.hash.startsWith(term)))
}

/** A subset of the history laid out on its own: links to commits that aren't in it are dropped. */
export function linkedWithin(commits: readonly Commit[]): GraphNode[] {
  const present = new Set(commits.map((commit) => commit.hash))
  return commits.map((commit) => ({ hash: commit.hash, parents: commit.parents.filter((parent) => present.has(parent)) }))
}
