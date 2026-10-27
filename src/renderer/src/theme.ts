import type { UserSettings } from '../../shared/types'

/** Hex colour → "r, g, b", for the translucent selection tint made from the accent. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`
}

/** Readable text on the accent: dark on light colours, white on dark ones. */
function textOn(hex: string): string {
  const [r = 0, g = 0, b = 0] = rgb(hex).split(', ').map(Number)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1b1405' : '#ffffff'
}

/**
 * Apply the theme, accent and custom colours from Settings to the page. (The interface size is the
 * window's zoom factor, which the main process sets.)
 */
export function applyAppearance(settings: Pick<UserSettings, 'theme' | 'accent' | 'colors'>): void {
  const root = document.documentElement
  if (settings.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = settings.theme
  const custom: Record<string, string> = { ...settings.colors }
  if (settings.accent) {
    custom['--accent'] = settings.accent
    custom['--accent-text'] = textOn(settings.accent)
    custom['--bg-selected'] = `rgba(${rgb(settings.accent)}, 0.14)`
  }
  // Clear what an earlier setting put there, then set what's wanted now.
  for (const name of [...root.style].filter((property) => property.startsWith('--'))) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(custom)) root.style.setProperty(name, value)
}
