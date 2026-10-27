import { parseRemoteUrl, toHttpsUrl } from '../../shared/remoteUrl'
import type { IssueLinkRule } from '../../shared/types'

/** A piece of a commit message: plain text, or text that links somewhere. */
export interface TextPart {
  text: string
  url?: string
}

/**
 * The rules that apply to a repository: the user's own (those whose `remoteContains` matches its
 * origin, or that have none), then `#123` links for services whose issue pages are known.
 */
export function rulesFor(origin: string | null, custom: IssueLinkRule[]): IssueLinkRule[] {
  const own = custom.filter((rule) => !rule.remoteContains || (origin ?? '').includes(rule.remoteContains))
  const builtIn = origin ? serviceRule(origin) : null
  return builtIn ? [...own, builtIn] : own
}

/** `#123` → the issue page on GitHub, GitLab, Gitea / Forgejo / Codeberg and Bitbucket. */
function serviceRule(origin: string): IssueLinkRule | null {
  const parsed = parseRemoteUrl(origin)
  if (!parsed || parsed.protocol === 'file' || parsed.protocol === 'git') return null
  // The repository's web page: the HTTPS address without credentials, or the SSH one converted.
  const web = parsed.protocol === 'ssh' ? toHttpsUrl(origin) : `${parsed.protocol}://${parsed.host}/${parsed.path}`
  if (!web) return null
  const base = web.replace(/\.git$/, '')
  const host = parsed.host
  // Azure DevOps work items use AB#123, not #123, and need the project; leave them to custom rules.
  if (host.includes('dev.azure.com') || host.includes('visualstudio.com')) return null
  const issues = host.includes('gitlab') ? `${base}/-/issues/$1` : `${base}/issues/$1`
  return { id: 'service', name: 'Issues', pattern: '#(\\d+)\\b', url: issues, remoteContains: '' }
}

const MAX_PARTS = 400

/** Split text into plain parts and links, by the first rule that matches at each position. */
export function linkify(text: string, rules: IssueLinkRule[]): TextPart[] {
  const patterns = rules.flatMap((rule) => {
    try {
      return [{ rule, regex: new RegExp(rule.pattern, 'g') }]
    } catch {
      return []
    }
  })
  if (patterns.length === 0 || !text) return [{ text }]
  const parts: TextPart[] = []
  let position = 0
  while (position < text.length && parts.length < MAX_PARTS) {
    let best: { index: number; match: RegExpExecArray; rule: IssueLinkRule } | null = null
    for (const { rule, regex } of patterns) {
      regex.lastIndex = position
      const match = regex.exec(text)
      if (match && match[0] && (!best || match.index < best.index)) best = { index: match.index, match, rule }
    }
    if (!best) break
    if (best.index > position) parts.push({ text: text.slice(position, best.index) })
    const groups = best.match
    const url = best.rule.url.replace(/\$(\d)/g, (_, n: string) => encodeURIComponent(groups[Number(n)] ?? ''))
    // Only web pages: a rule can't turn a message into a link to a file or a program.
    parts.push(/^https?:\/\//i.test(url) ? { text: groups[0], url } : { text: groups[0] })
    position = best.index + groups[0].length
  }
  if (position < text.length) parts.push({ text: text.slice(position) })
  return parts
}
