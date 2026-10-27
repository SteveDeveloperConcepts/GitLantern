/**
 * Small conveniences kept in localStorage: the diff layout, pending review comments. Storage can be
 * missing or full; then the value lasts only until the screen closes.
 */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key)
    return text === null ? fallback : (JSON.parse(text) as T)
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not available: see above.
  }
}
