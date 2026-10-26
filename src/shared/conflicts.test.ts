import { describe, expect, it } from 'vitest'
import { countConflicts, resolveConflict } from './conflicts'

const file = ['top', '<<<<<<< HEAD', 'mine', '=======', 'theirs', '>>>>>>> feature', 'middle', '<<<<<<< HEAD', 'a', '||||||| base', 'old', '=======', 'b', '>>>>>>> feature', 'end', ''].join('\n')

describe('resolveConflict', () => {
  it('keeps the chosen side of one conflict and leaves the others', () => {
    expect(countConflicts(file)).toBe(2)
    const ours = resolveConflict(file, 0, 'ours')
    expect(ours.remaining).toBe(1)
    expect(ours.text.split('\n').slice(0, 3)).toEqual(['top', 'mine', 'middle'])
    expect(countConflicts(ours.text)).toBe(1)

    // diff3 style: the base section is dropped whichever side is kept.
    expect(resolveConflict(file, 1, 'theirs').text.split('\n').slice(-4)).toEqual(['middle', 'b', 'end', ''])
    expect(resolveConflict(file, 1, 'both').text.split('\n').slice(-5)).toEqual(['middle', 'a', 'b', 'end', ''])
  })

  it('keeps Windows line endings and a missing final newline', () => {
    const crlf = 'x\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> feature\r\ny'
    expect(resolveConflict(crlf, 0, 'theirs')).toEqual({ text: 'x\r\ntheirs\r\ny', remaining: 0 })
  })

  it('refuses a conflict that is not there, and ignores unfinished markers', () => {
    expect(() => resolveConflict(file, 2, 'ours')).toThrow(/isn’t in the file/)
    const unfinished = 'a\n<<<<<<< HEAD\nb\n=======\nc\n'
    expect(countConflicts(unfinished)).toBe(0)
    expect(() => resolveConflict(unfinished, 0, 'ours')).toThrow()
  })
})
