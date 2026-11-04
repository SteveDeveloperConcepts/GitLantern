import { describe, expect, it } from 'vitest'
import { escapeIgnored, ignorePattern } from './gitignore'

describe('escapeIgnored', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeIgnored('.log')).toBe('.log')
  })

  it('escapes wildcards without adding a leading slash', () => {
    expect(escapeIgnored('.[old]')).toBe('.\\[old]')
  })
})

describe('ignorePattern', () => {
  it('counts from the top of the repository', () => {
    expect(ignorePattern('build/')).toBe('/build/')
    expect(ignorePattern('src/gen/a.txt')).toBe('/src/gen/a.txt')
  })

  it('escapes what git would read as a wildcard', () => {
    expect(ignorePattern('app/[slug]/')).toBe('/app/\\[slug]/')
    expect(ignorePattern('a*b/c?d/')).toBe('/a\\*b/c\\?d/')
    expect(ignorePattern('back\\slash/')).toBe('/back\\\\slash/')
  })

  it('keeps spaces at the end of a name, which git would drop', () => {
    expect(ignorePattern('name  ')).toBe('/name\\ \\ ')
    expect(ignorePattern('with space/sub folder/')).toBe('/with space/sub folder/')
    expect(ignorePattern('trailing /')).toBe('/trailing /')
  })

  it('leaves # and ! alone, behind the leading slash', () => {
    expect(ignorePattern('#notes/')).toBe('/#notes/')
    expect(ignorePattern('!keep/')).toBe('/!keep/')
  })
})
