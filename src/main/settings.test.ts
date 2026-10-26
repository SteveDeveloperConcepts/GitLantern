import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { adoptOldSettings, Settings } from './settings'

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
