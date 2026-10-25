import { describe, expect, it } from 'vitest'
import { refPills } from './refs'

describe('refPills', () => {
  it('folds remote twins into the local branch pill and keeps the rest', () => {
    const pills = refPills([
      { name: 'feature/x', kind: 'local', isCurrent: false },
      { name: 'main', kind: 'local', isCurrent: true },
      { name: 'origin/main', kind: 'remote' },
      { name: 'upstream/main', kind: 'remote' },
      { name: 'origin/other', kind: 'remote' },
      { name: 'v1.0', kind: 'tag' }
    ])
    expect(pills.map((p) => [p.label, p.kind, p.isCurrent, p.remotes])).toEqual([
      ['main', 'local', true, ['origin', 'upstream']],
      ['feature/x', 'local', false, []],
      ['origin/other', 'remote', false, []],
      ['v1.0', 'tag', false, []]
    ])
  })
})
