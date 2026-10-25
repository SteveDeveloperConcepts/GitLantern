import type { RefLabel } from '../../../shared/types'

export interface RefPill {
  key: string
  label: string
  kind: RefLabel['kind']
  isCurrent: boolean
  /** Remotes whose branch of the same name points at the same commit, e.g. "origin". */
  remotes: string[]
}

/**
 * Merge a local branch with its remote twins on the same commit into one pill
 * (`main · origin` instead of `main` and `origin/main`), so rows stay short.
 */
export function refPills(refs: RefLabel[]): RefPill[] {
  const remoteRefs = refs.filter((r) => r.kind === 'remote')
  const absorbed = new Set<string>()
  const pills: RefPill[] = []

  for (const ref of refs) {
    if (ref.kind !== 'local') continue
    const twins = remoteRefs.filter((r) => r.name.slice(r.name.indexOf('/') + 1) === ref.name)
    twins.forEach((t) => absorbed.add(t.name))
    pills.push({
      key: `local:${ref.name}`,
      label: ref.name,
      kind: 'local',
      isCurrent: ref.isCurrent === true,
      remotes: twins.map((t) => t.name.slice(0, t.name.indexOf('/')))
    })
  }
  for (const ref of refs) {
    if (ref.kind === 'local' || absorbed.has(ref.name)) continue
    pills.push({ key: `${ref.kind}:${ref.name}`, label: ref.name, kind: ref.kind, isCurrent: false, remotes: [] })
  }
  // The checked-out branch first.
  return pills.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
}
