/** Text as a .gitignore pattern has to write it to mean just that text. */
export function escapeIgnored(text: string): string {
  // Unescaped, a folder like [slug] is a wildcard that doesn't match itself, and git drops spaces at
  // the end of a line.
  return text.replace(/[\\*?[]| (?= *$)/g, '\\$&')
}

/** The .gitignore pattern for exactly this file or folder, counted from the top of the repository. */
export function ignorePattern(path: string): string {
  // The leading / also keeps a # or ! at the start from meaning anything.
  return `/${escapeIgnored(path)}`
}
