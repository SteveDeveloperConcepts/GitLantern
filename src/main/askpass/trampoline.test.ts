import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TRAMPOLINE_CMD } from './trampoline'

describe('trampoline', () => {
  it('ships the same Windows trampoline that the app writes', () => {
    const shipped = fs.readFileSync(path.join(import.meta.dirname, '../../../resources/askpass.cmd'), 'utf8')
    expect(shipped).toBe(TRAMPOLINE_CMD)
  })
})
