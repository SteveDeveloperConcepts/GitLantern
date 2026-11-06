import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { menuTemplate } from './menu'

const PLATFORMS: NodeJS.Platform[] = ['win32', 'darwin', 'linux']

/** Every role in a template, submenus included. In lower case, because Electron reads them in any case. */
function roles(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role.toLowerCase()] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : [])
  ])
}

function view(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const submenu = template.find((item) => item.label === 'View')?.submenu
  return Array.isArray(submenu) ? submenu : []
}

describe('menuTemplate', () => {
  it('has no Developer Tools in a packaged copy', () => {
    for (const platform of PLATFORMS) {
      const found = roles(menuTemplate({ platform, packaged: true }))
      expect(found).not.toContain('toggledevtools')
      // Electron's whole View menu, which has them in it.
      expect(found).not.toContain('viewmenu')
    }
  })

  it('has them in a development run', () => {
    for (const platform of PLATFORMS) {
      expect(roles(menuTemplate({ platform, packaged: false }))).toContain('toggledevtools')
    }
  })

  it('keeps the rest of the View menu', () => {
    const rest = ['reload', 'forcereload', 'resetzoom', 'zoomin', 'zoomout', 'togglefullscreen']
    for (const platform of PLATFORMS) {
      expect(roles(view(menuTemplate({ platform, packaged: true })))).toEqual(rest)
      expect(roles(view(menuTemplate({ platform, packaged: false }))).filter((role) => role !== 'toggledevtools')).toEqual(rest)
    }
  })

  it('has File, Edit, View and Window, after the application menu on macOS', () => {
    const top = (platform: NodeJS.Platform): string[] =>
      menuTemplate({ platform, packaged: true }).map((item) => item.role ?? item.label ?? '')
    expect(top('win32')).toEqual(['fileMenu', 'editMenu', 'View', 'windowMenu'])
    expect(top('linux')).toEqual(top('win32'))
    expect(top('darwin')).toEqual(['appMenu', ...top('win32')])
  })
})
