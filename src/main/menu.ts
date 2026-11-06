import type { MenuItemConstructorOptions } from 'electron'

/**
 * The menu bar. These are the menus Electron gives an app that sets none, written out so that View can
 * leave out Toggle Developer Tools (Ctrl+Shift+I): only a development run (`yarn dev`, `yarn start`)
 * has it. Electron's whole View menu, `role: 'viewMenu'`, would bring it back for everyone.
 */
export function menuTemplate(env: { platform: NodeJS.Platform; packaged: boolean }): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions[] = env.platform === 'darwin' ? [{ role: 'appMenu' }] : []
  const developerTools: MenuItemConstructorOptions[] = env.packaged ? [] : [{ role: 'toggleDevTools' }]
  return [
    ...appMenu,
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...developerTools,
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
}
