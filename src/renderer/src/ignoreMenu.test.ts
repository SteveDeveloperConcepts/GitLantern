import { describe, expect, it, vi } from 'vitest'
import { ignoreMenu, parentFolders, type IgnoreAction } from './ignoreMenu'

const labels = (file: string, untracked: boolean) => ignoreMenu(file, untracked, vi.fn()).map((item) => item.label)

/** Pick an item and return what it asked for. */
function pick(file: string, label: string, untracked = true) {
  const ignore = vi.fn<IgnoreAction>()
  const item = ignoreMenu(file, untracked, ignore).find((i) => i.label === label)
  if (!item) throw new Error(`No item ${label}`)
  item.onSelect()
  const [pattern, where, covers] = ignore.mock.calls[0] ?? []
  return { pattern, where, covers: covers as (path: string) => boolean }
}

describe('parentFolders', () => {
  it('lists every folder, nearest first', () => {
    expect(parentFolders('bin/Debug/net8.0/app.dll')).toEqual(['bin/Debug/net8.0/', 'bin/Debug/', 'bin/'])
  })

  it('has nothing for a file at the top', () => {
    expect(parentFolders('README.md')).toEqual([])
  })

  it('counts a path ending in a slash as a folder itself', () => {
    expect(parentFolders('vendor/nested/')).toEqual(['vendor/nested/', 'vendor/'])
  })
})

describe('ignoreMenu', () => {
  it('offers a new file, its type, every folder it’s in, and this copy only', () => {
    expect(labels('bin/Debug/app.dll', true)).toEqual(['Ignore this file', 'Ignore all .dll files', 'Ignore bin/Debug/', 'Ignore bin/', 'Ignore here only'])
  })

  it('offers only the folders for a tracked file, which ignoring can’t take out of Git', () => {
    expect(labels('src/gen/a.ts', false)).toEqual(['Ignore src/gen/', 'Ignore src/'])
    expect(labels('README.md', false)).toEqual([])
  })

  it('has no folders for a new file at the top', () => {
    expect(labels('notes.txt', true)).toEqual(['Ignore this file', 'Ignore all .txt files', 'Ignore here only'])
  })

  it('treats a repository inside this one as the folder it is', () => {
    expect(labels('vendor/nested/', true)).toEqual(['Ignore vendor/nested/', 'Ignore vendor/', 'Ignore here only'])
  })

  it('leaves out the type for a name that’s only a dot file', () => {
    expect(labels('conf/.env', true)).toEqual(['Ignore this file', 'Ignore conf/', 'Ignore here only'])
  })

  it('keeps the end of a long folder path, which tells the folders apart', () => {
    expect(labels('packages/some-long-package-name/generated/output/first/second/third/app.js', false).slice(0, 3)).toEqual([
      'Ignore …generated/output/first/second/third/',
      'Ignore …-name/generated/output/first/second/',
      'Ignore …package-name/generated/output/first/'
    ])
  })

  it('doesn’t cut an emoji in half when shortening', () => {
    const emoji = '\u{1F600}'
    const [label] = labels(`${emoji.repeat(40)}/app.js`, false)
    expect(label).toBe(`Ignore …${emoji.repeat(35)}/`)
  })

  it('gives each folder’s whole path as its tooltip', () => {
    const deep = 'packages/some-long-package-name/generated/output/first/second/third/'
    expect(ignoreMenu(`${deep}app.js`, false, vi.fn())[0]?.title).toBe(deep)
  })

  it('ignores a folder with an anchored pattern that covers only what’s inside it', () => {
    const { pattern, where, covers } = pick('src/gen/a.ts', 'Ignore src/')
    expect(pattern).toBe('/src/')
    expect(where).toBe('gitignore')
    expect(covers('src/gen/a.ts')).toBe(true)
    expect(covers('src/other.ts')).toBe(true)
    expect(covers('srcfoo/a.ts')).toBe(false)
    expect(covers('other/src/a.ts')).toBe(false)
  })

  it('escapes the folder, the file and its type', () => {
    expect(pick('app/[slug]/page.tsx', 'Ignore app/[slug]/').pattern).toBe('/app/\\[slug]/')
    expect(pick('app/[slug]/page.tsx', 'Ignore this file').pattern).toBe('/app/\\[slug]/page.tsx')
    expect(pick('backup.[old]', 'Ignore all .[old] files').pattern).toBe('*.\\[old]')
  })

  it('covers one file with its own items, and a type wherever it is', () => {
    const file = pick('logs/a.log', 'Ignore this file')
    expect(file).toMatchObject({ pattern: '/logs/a.log', where: 'gitignore' })
    expect(file.covers('logs/a.log')).toBe(true)
    expect(file.covers('logs/b.log')).toBe(false)

    const here = pick('logs/a.log', 'Ignore here only')
    expect(here).toMatchObject({ pattern: '/logs/a.log', where: 'exclude' })
    expect(here.covers('logs/a.log')).toBe(true)

    const type = pick('logs/a.log', 'Ignore all .log files')
    expect(type).toMatchObject({ pattern: '*.log', where: 'gitignore' })
    expect(type.covers('other/b.log')).toBe(true)
    expect(type.covers('other/b.txt')).toBe(false)
  })
})
