import { describe, expect, it } from 'vitest'
import { linkify, rulesFor } from './issueLinks'

const jira = { id: 'j', name: 'Jira', pattern: '\\b([A-Z]+-\\d+)\\b', url: 'https://acme.atlassian.net/browse/$1', remoteContains: '' }

describe('issue links', () => {
  it('links #123 to the issue page of the service the repository is on', () => {
    const [rule] = rulesFor('git@github.com:acme/web.git', [])
    expect(linkify('Fix crash (#42)', rule ? [rule] : [])).toEqual([
      { text: 'Fix crash (' },
      { text: '#42', url: 'https://github.com/acme/web/issues/42' },
      { text: ')' }
    ])
    expect(rulesFor('https://gitlab.com/group/app.git', [])[0]?.url).toBe('https://gitlab.com/group/app/-/issues/$1')
    expect(rulesFor('C:\\code\\local', [])).toEqual([])
  })

  it('applies custom rules first, only to repositories they are for', () => {
    const scoped = { ...jira, id: 'k', remoteContains: 'acme/web' }
    expect(rulesFor('https://github.com/acme/web.git', [scoped]).map((r) => r.id)).toEqual(['k', 'service'])
    expect(rulesFor('https://github.com/other/app.git', [scoped]).map((r) => r.id)).toEqual(['service'])
    expect(linkify('WEB-7 and #3', rulesFor('https://github.com/acme/web.git', [jira]))).toEqual([
      { text: 'WEB-7', url: 'https://acme.atlassian.net/browse/WEB-7' },
      { text: ' and ' },
      { text: '#3', url: 'https://github.com/acme/web/issues/3' }
    ])
  })

  it('never links to anything but web pages, and ignores broken patterns', () => {
    const file = { ...jira, url: 'file:///C:/$1' }
    expect(linkify('ABC-1', [file])).toEqual([{ text: 'ABC-1' }])
    expect(linkify('ABC-1', [{ ...jira, pattern: '(' }])).toEqual([{ text: 'ABC-1' }])
  })
})
