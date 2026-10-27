/** Conventional Commits (conventionalcommits.org): the types the helper offers, with what they're for. */
export const COMMIT_TYPES = [
  { type: 'feat', description: 'A new feature' },
  { type: 'fix', description: 'A bug fix' },
  { type: 'docs', description: 'Documentation only' },
  { type: 'style', description: 'Formatting, no code change' },
  { type: 'refactor', description: 'Neither a fix nor a feature' },
  { type: 'perf', description: 'Makes it faster' },
  { type: 'test', description: 'Adds or fixes tests' },
  { type: 'build', description: 'Build system or dependencies' },
  { type: 'ci', description: 'CI configuration' },
  { type: 'chore', description: 'Other changes' },
  { type: 'revert', description: 'Reverts a commit' }
] as const

export interface ConventionalMessage {
  type: string
  scope: string
  /** A change that breaks compatibility: `!` after the type, and a BREAKING CHANGE footer when explained. */
  breaking: boolean
  description: string
  body: string
  /** What breaks and how to migrate. */
  breakingNote: string
  /** e.g. "Closes #12". */
  footer: string
}

/** The summary line and the description, as the commit form has them. */
export function conventionalMessage(message: ConventionalMessage): { summary: string; description: string } {
  const scope = message.scope.trim() ? `(${message.scope.trim()})` : ''
  const summary = `${message.type}${scope}${message.breaking ? '!' : ''}: ${message.description.trim()}`
  const footers = [
    ...(message.breaking && message.breakingNote.trim() ? [`BREAKING CHANGE: ${message.breakingNote.trim()}`] : []),
    ...(message.footer.trim() ? [message.footer.trim()] : [])
  ]
  const description = [message.body.trim(), footers.join('\n')].filter(Boolean).join('\n\n')
  return { summary, description }
}
