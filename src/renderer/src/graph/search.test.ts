import { describe, expect, it } from 'vitest'
import type { Commit } from '../../../shared/types'
import { linkedWithin, matchesSearch, searchTerms } from './search'

const commit = (hash: string, subject: string, parents: string[] = []): Commit => ({
  hash,
  parents,
  authorName: 'Priya Shah',
  authorEmail: 'priya@acme.dev',
  authorDate: 0,
  subject,
  refs: [{ name: 'v1.2', kind: 'tag' }]
})

describe('history search', () => {
  const fix = commit('a1b2c3d4e5', 'Fix login timeout')

  it('needs every word somewhere: subject, author, branch, tags or the start of the hash', () => {
    expect(matchesSearch(fix, undefined, searchTerms('  LOGIN   priya '))).toBe(true)
    expect(matchesSearch(fix, undefined, searchTerms('login bob'))).toBe(false)
    expect(matchesSearch(fix, { name: 'auth', gone: false }, searchTerms('auth v1.2'))).toBe(true)
    expect(matchesSearch(fix, undefined, searchTerms('a1b2'))).toBe(true)
    expect(matchesSearch(fix, undefined, searchTerms('b2c3'))).toBe(false)
    expect(matchesSearch(fix, undefined, [])).toBe(true)
  })

  it('drops links to commits left out of a filtered list', () => {
    const list = [commit('c', 'third', ['b']), commit('a', 'first', [])]
    expect(linkedWithin(list)).toEqual([
      { hash: 'c', parents: [] },
      { hash: 'a', parents: [] }
    ])
  })
})
