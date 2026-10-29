import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contains } from './folderAccess'

describe('contains', () => {
  const root = path.resolve('/code/web')

  it('covers the folder itself and everything inside it', () => {
    expect(contains(root, root)).toBe(true)
    expect(contains(root, path.join(root, 'src', 'app'))).toBe(true)
    expect(contains(root, path.join(root, '..hidden'))).toBe(true)
  })

  it('leaves out the folder above, its neighbours and names that only start the same', () => {
    expect(contains(root, path.dirname(root))).toBe(false)
    expect(contains(root, path.resolve('/code/api'))).toBe(false)
    expect(contains(root, path.resolve('/code/website'))).toBe(false)
    expect(contains(root, path.resolve('/code/web/../api'))).toBe(false)
  })
})
