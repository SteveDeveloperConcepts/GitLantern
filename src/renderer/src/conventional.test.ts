import { describe, expect, it } from 'vitest'
import { conventionalMessage } from './conventional'

const base = { type: 'feat', scope: '', breaking: false, description: 'add login', body: '', breakingNote: '', footer: '' }

describe('conventional commit helper', () => {
  it('writes the summary line with an optional scope', () => {
    expect(conventionalMessage(base)).toEqual({ summary: 'feat: add login', description: '' })
    expect(conventionalMessage({ ...base, scope: ' auth ' }).summary).toBe('feat(auth): add login')
  })

  it('marks breaking changes and puts the footers after the body', () => {
    const message = conventionalMessage({ ...base, breaking: true, body: 'Uses OAuth now.', breakingNote: 'Tokens must be renewed.', footer: 'Closes #12' })
    expect(message.summary).toBe('feat!: add login')
    expect(message.description).toBe('Uses OAuth now.\n\nBREAKING CHANGE: Tokens must be renewed.\nCloses #12')
  })
})
