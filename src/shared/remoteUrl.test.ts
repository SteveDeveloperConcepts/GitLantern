import { describe, expect, it } from 'vitest'
import { credentialOrigin, parseRemoteUrl, repoNameFromUrl, serviceName, toHttpsUrl, toSshUrl } from './remoteUrl'

describe('parseRemoteUrl', () => {
  it('reads HTTPS, SSH, scp-style and local addresses', () => {
    expect(parseRemoteUrl('https://github.com/acme/web.git')).toEqual({ protocol: 'https', host: 'github.com', path: 'acme/web.git' })
    expect(parseRemoteUrl('https://org@dev.azure.com/org/proj/_git/repo')).toEqual({
      protocol: 'https',
      host: 'dev.azure.com',
      path: 'org/proj/_git/repo',
      user: 'org'
    })
    expect(parseRemoteUrl('git@gitlab.com:acme/web.git')).toEqual({ protocol: 'ssh', host: 'gitlab.com', path: 'acme/web.git', user: 'git' })
    expect(parseRemoteUrl('ssh://git@git.example.com:2222/team/app.git')).toEqual({
      protocol: 'ssh',
      host: 'git.example.com:2222',
      path: 'team/app.git',
      user: 'git'
    })
    expect(parseRemoteUrl('C:\\repos\\app')?.protocol).toBe('file')
    expect(parseRemoteUrl('/srv/git/app.git')?.protocol).toBe('file')
  })

  it('rejects option-like and empty input', () => {
    expect(parseRemoteUrl('--upload-pack=evil')).toBeNull()
    expect(parseRemoteUrl('   ')).toBeNull()
  })
})

describe('conversions', () => {
  it('switches between HTTPS and SSH', () => {
    expect(toSshUrl('https://github.com/acme/web.git')).toBe('git@github.com:acme/web.git')
    expect(toHttpsUrl('git@github.com:acme/web.git')).toBe('https://github.com/acme/web.git')
    expect(toSshUrl('https://org@dev.azure.com/org/proj/_git/repo')).toBe('git@ssh.dev.azure.com:v3/org/proj/repo')
    expect(toHttpsUrl('git@ssh.dev.azure.com:v3/org/proj/repo')).toBe('https://dev.azure.com/org/proj/_git/repo')
    expect(toSshUrl('git@github.com:acme/web.git')).toBeNull()
  })

  it('derives folder names, credential origins and service names', () => {
    expect(repoNameFromUrl('https://github.com/acme/web.git')).toBe('web')
    expect(repoNameFromUrl('git@gitlab.com:acme/api')).toBe('api')
    expect(repoNameFromUrl('C:\\repos\\app\\')).toBe('app')
    expect(credentialOrigin('https://user@git.example.com:8443/a/b.git')).toBe('https://git.example.com:8443')
    expect(credentialOrigin('git@github.com:a/b.git')).toBeNull()
    expect(serviceName('git@ssh.dev.azure.com:v3/o/p/r')).toBe('Azure DevOps')
    expect(serviceName('https://git.example.com/a.git')).toBe('git.example.com')
  })
})
