import { describe, expect, it } from 'vitest'
import { parseCredentialPrompt } from './prompts'

describe('parseCredentialPrompt', () => {
  it('recognises git HTTPS username and password prompts', () => {
    expect(parseCredentialPrompt("Username for 'https://github.com': ")).toEqual({ kind: 'username', host: 'github.com' })
    expect(parseCredentialPrompt("Password for 'https://priya@git.example.com:8443': ")).toEqual({
      kind: 'password',
      host: 'git.example.com:8443'
    })
  })

  it('ignores SSH and other prompts', () => {
    expect(parseCredentialPrompt("Enter passphrase for key '/home/me/.ssh/id_ed25519': ")).toBeNull()
    expect(parseCredentialPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])?')).toBeNull()
  })
})
