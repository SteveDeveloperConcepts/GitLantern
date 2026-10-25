const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

/** "3 days ago" style label for a unix timestamp in seconds. */
export function formatRelative(unixSeconds: number, now = Date.now()): string {
  const elapsed = Math.round(now / 1000 - unixSeconds)
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(elapsed) >= seconds) return relative.format(-Math.round(elapsed / seconds), unit)
  }
  return 'just now'
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // ipcRenderer.invoke prefixes errors from the main process; drop the noise.
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Split a path into its folder (shown dimmed) and file name. */
export function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? { dir: '', base: path } : { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) }
}
