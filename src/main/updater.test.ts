import { describe, expect, it } from 'vitest'
import { updateMode } from './updater'

const PLATFORMS: NodeJS.Platform[] = ['win32', 'darwin', 'linux']

describe('updateMode', () => {
  it('downloads and installs updates on Windows and macOS', () => {
    expect(updateMode({ packaged: true, platform: 'win32', store: false })).toBe('install')
    // The Mac app is signed with a Developer ID, so macOS installs the update.
    expect(updateMode({ packaged: true, platform: 'darwin', store: false })).toBe('install')
  })

  it('installs them in an AppImage, and only announces them to a .deb', () => {
    expect(updateMode({ packaged: true, platform: 'linux', store: false, appImage: true })).toBe('install')
    expect(updateMode({ packaged: true, platform: 'linux', store: false, appImage: false })).toBe('notify')
    expect(updateMode({ packaged: true, platform: 'linux', store: false })).toBe('notify')
  })

  it('leaves Store copies to their store', () => {
    expect(updateMode({ packaged: true, platform: 'win32', store: true })).toBeNull()
    expect(updateMode({ packaged: true, platform: 'darwin', store: true })).toBeNull()
  })

  it('never checks in a development run', () => {
    for (const platform of PLATFORMS) {
      expect(updateMode({ packaged: false, platform, store: false })).toBeNull()
      expect(updateMode({ packaged: false, platform, store: false, appImage: true })).toBeNull()
    }
  })

  it('never checks on systems it has no installer for', () => {
    expect(updateMode({ packaged: true, platform: 'freebsd', store: false })).toBeNull()
  })
})
