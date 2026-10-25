import { parseRemoteUrl } from '../../shared/remoteUrl'

export interface CredentialPrompt {
  kind: 'username' | 'password'
  host: string
}

/** Recognise git's HTTPS prompts: `Username for 'https://host': ` and `Password for 'https://user@host': `. */
export function parseCredentialPrompt(prompt: string): CredentialPrompt | null {
  const match = /^(Username|Password) for '([^']+)'/.exec(prompt.trim())
  if (!match) return null
  const parsed = parseRemoteUrl(match[2] ?? '')
  if (!parsed || (parsed.protocol !== 'https' && parsed.protocol !== 'http')) return null
  return { kind: match[1] === 'Username' ? 'username' : 'password', host: parsed.host }
}
