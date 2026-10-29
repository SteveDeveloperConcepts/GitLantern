import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { adoptOldSettings, DEFAULT_USER_SETTINGS, sanitizeSettings, Settings } from './settings'

describe('settings from the Settings screen', () => {
  it('keeps valid values and drops malformed ones, field by field', () => {
    expect(
      sanitizeSettings({
        theme: 'dark',
        accent: 'red',
        colors: { '--bg': '#101010', 'background-image': '#000000', '--text': 'url(x)' },
        zoom: 400,
        autoFetchMinutes: -5,
        diffTool: 'meld --evil',
        mergeTool: 'kdiff3',
        customActions: [
          { id: 'a', name: 'Test', scope: 'commit', command: 'npm', args: ['test', 3], confirm: true },
          { id: 'b', name: '', scope: 'commit', command: 'npm' },
          { id: 'c', name: 'Bad scope', scope: 'everywhere', command: 'npm' }
        ],
        issueLinks: [{ id: 'j', name: 'Jira', pattern: '(', url: 'https://x/$1' }],
        unknown: true
      })
    ).toEqual({
      theme: 'dark',
      colors: { '--bg': '#101010' },
      zoom: 150,
      autoFetchMinutes: 0,
      mergeTool: 'kdiff3',
      customActions: [{ id: 'a', name: 'Test', scope: 'commit', command: 'npm', args: ['test'], confirm: true }],
      issueLinks: []
    })
  })

  it('saves them, and keeps what only the main process may change apart', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-settings-')), 'settings.json')
    const settings = new Settings(file)
    expect(settings.user()).toEqual(DEFAULT_USER_SETTINGS)
    settings.setUser({ theme: 'light', openTabs: ['C:\\code\\web'] })
    settings.setGitPath('C:\\git\\git.exe')
    settings.approveAction('abc')
    const reloaded = new Settings(file)
    expect(reloaded.user()).toMatchObject({ theme: 'light', gitPath: 'C:\\git\\git.exe', openTabs: ['C:\\code\\web'] })
    expect(reloaded.get().gitPath).toBe('C:\\git\\git.exe')
    expect(reloaded.isActionApproved('abc')).toBe(true)
    // What the renderer sends can't approve actions, or pick the program run as git.
    expect(sanitizeSettings({ gitPath: 'C:\\evil.exe', approvedActions: ['evil'] })).toEqual({})
    reloaded.setUser({ ...sanitizeSettings({ approvedActions: ['evil'] }), gitPath: 'C:\\evil.exe' })
    expect(reloaded.isActionApproved('evil')).toBe(false)
    expect(reloaded.get().gitPath).toBe('C:\\git\\git.exe')
  })

  it('remembers every repository opened, beyond the dozen that Recent shows', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-settings-')), 'settings.json')
    const settings = new Settings(file)
    for (let n = 0; n < 15; n++) settings.addRecentRepo(`C:\\code\\repo${n}`)
    const reloaded = new Settings(file)
    expect(reloaded.get().recentRepos).toHaveLength(12)
    expect(reloaded.knownRepos().has('C:\\code\\repo0')).toBe(true)
    expect(reloaded.knownRepos().size).toBe(15)
  })

  it('keeps the latest 200 folder bookmarks, a folder picked again counting as new', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-settings-')), 'settings.json')
    const settings = new Settings(file)
    for (let n = 0; n < 205; n++) settings.setBookmark(`/Users/me/code${n}`, `bookmark${n}`)
    settings.setBookmark('/Users/me/code10', 'again')
    const bookmarks = Object.entries(new Settings(file).bookmarks())
    expect(bookmarks).toHaveLength(200)
    expect(bookmarks[0]).toEqual(['/Users/me/code5', 'bookmark5'])
    expect(bookmarks.at(-1)).toEqual(['/Users/me/code10', 'again'])
  })
})

describe('settings from before the rename', () => {
  it('copies the old settings once, and never over newer ones', () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-appdata-'))
    const oldFolder = path.join(appData, 'Git Steve')
    const file = path.join(appData, 'GitLantern', 'settings.json')
    fs.mkdirSync(oldFolder)
    fs.writeFileSync(path.join(oldFolder, 'settings.json'), JSON.stringify({ recentRepos: ['C:\\code\\web'], cloneFolder: 'C:\\code' }))

    expect(adoptOldSettings(oldFolder, file)).toBe(true)
    expect(new Settings(file).get()).toEqual({ recentRepos: ['C:\\code\\web'], cloneFolder: 'C:\\code' })

    new Settings(file).addRecentRepo('C:\\code\\api')
    expect(adoptOldSettings(oldFolder, file)).toBe(false)
    expect(new Settings(file).get().recentRepos).toEqual(['C:\\code\\api', 'C:\\code\\web'])
  })

  it('does nothing without old settings', () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-appdata-'))
    const file = path.join(appData, 'GitLantern', 'settings.json')
    expect(adoptOldSettings(path.join(appData, 'Git Steve'), file)).toBe(false)
    expect(fs.existsSync(file)).toBe(false)
  })
})
