import type { FinishFlowOptions, FlowConfig, FlowKind, OperationResult } from '../../shared/types'
import { merge, status } from './commands'
import { runGit } from './runGit'

const DEFAULT_PREFIXES: Record<FlowKind, string> = { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' }
const KINDS = Object.keys(DEFAULT_PREFIXES) as FlowKind[]

/** git-flow settings from the gitflow.* keys the git-flow tools use; null until both branches are set. */
export async function flowConfig(repo: string): Promise<FlowConfig | null> {
  const { stdout } = await runGit(['config', '-z', '--get-regexp', '^gitflow\\.(branch|prefix)\\.'], {
    cwd: repo,
    allowedExitCodes: [0, 1]
  })
  // -z: "key\nvalue" records separated by NUL. A key without a value has no newline.
  const values = new Map<string, string>()
  for (const record of stdout.split('\0')) {
    const newline = record.indexOf('\n')
    if (newline !== -1) values.set(record.slice(0, newline), record.slice(newline + 1))
  }
  const master = values.get('gitflow.branch.master')
  const develop = values.get('gitflow.branch.develop')
  if (!master || !develop) return null
  return {
    master,
    develop,
    prefixes: {
      feature: values.get('gitflow.prefix.feature') ?? DEFAULT_PREFIXES.feature,
      release: values.get('gitflow.prefix.release') ?? DEFAULT_PREFIXES.release,
      hotfix: values.get('gitflow.prefix.hotfix') ?? DEFAULT_PREFIXES.hotfix
    },
    versionTagPrefix: values.get('gitflow.prefix.versiontag') ?? ''
  }
}

/** A full ref name git accepts, and nothing git could read as an option. */
async function validRef(repo: string, ref: string, name: string): Promise<boolean> {
  if (!name || name.startsWith('-')) return false
  const { exitCode } = await runGit(['check-ref-format', ref], { cwd: repo, allowedExitCodes: [0, 1] })
  return exitCode === 0
}

async function assertBranchName(repo: string, name: string): Promise<void> {
  if (!(await validRef(repo, `refs/heads/${name}`, name))) throw new Error(`"${name}" is not a valid branch name`)
}

async function exists(repo: string, ref: string): Promise<boolean> {
  const { exitCode } = await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repo, allowedExitCodes: [0, 1] })
  return exitCode === 0
}

/** Set the repository up for git-flow: check the names, create the development branch if needed, and save the settings. */
export async function flowInit(repo: string, config: FlowConfig): Promise<void> {
  const tagPrefix = config.versionTagPrefix
  // All checked at once. A prefix is only half a name, so it's checked with something after it.
  type Check = [ref: string, name: string, problem: string]
  const names: Check[] = [
    ...[config.master, config.develop].map((name): Check => [`refs/heads/${name}`, name, `"${name}" is not a valid branch name`]),
    ...KINDS.map((kind): Check => {
      const prefix = config.prefixes[kind]
      return [`refs/heads/${prefix}x`, `${prefix}x`, `"${prefix}" can’t start a branch name`]
    }),
    [`refs/tags/${tagPrefix}x`, `${tagPrefix}x`, `"${tagPrefix}" can’t start a tag name`]
  ]
  const valid = await Promise.all(names.map(([ref, name]) => validRef(repo, ref, name)))
  const invalid = names.find((_, index) => !valid[index])
  if (invalid) throw new Error(invalid[2])
  if (config.master === config.develop) throw new Error('The production and development branches have to be different')
  // Tags and branches with the same names would make every merge of a release ambiguous.
  if (tagPrefix === config.prefixes.release || tagPrefix === config.prefixes.hotfix) {
    throw new Error('The version tag prefix has to differ from the release and hotfix prefixes')
  }

  if (!(await exists(repo, `refs/heads/${config.master}`))) {
    const { stdout } = await runGit(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/heads/'], { cwd: repo })
    throw new Error(stdout.trim() ? `There’s no branch called ${config.master}` : 'Make the first commit first.')
  }
  if (!(await exists(repo, `refs/heads/${config.develop}`))) {
    await runGit(['branch', '--no-track', config.develop, `refs/heads/${config.master}`], { cwd: repo })
  }
  const settings: [string, string][] = [
    ['gitflow.branch.master', config.master],
    ['gitflow.branch.develop', config.develop],
    ...KINDS.map((kind): [string, string] => [`gitflow.prefix.${kind}`, config.prefixes[kind]]),
    ['gitflow.prefix.versiontag', tagPrefix]
  ]
  // One at a time: git config locks the file while it writes.
  for (const [key, value] of settings) await runGit(['config', '--local', '--', key, value], { cwd: repo })
}

async function requireConfig(repo: string): Promise<FlowConfig> {
  const config = await flowConfig(repo)
  if (!config) throw new Error('Set up git-flow for this repository first')
  return config
}

/** Make a feature or release branch from the development branch, or a hotfix branch from production, and switch to it. */
export async function flowStart(repo: string, kind: FlowKind, name: string): Promise<void> {
  const config = await requireConfig(repo)
  const branch = config.prefixes[kind] + name
  await assertBranchName(repo, branch)
  if (await exists(repo, `refs/heads/${branch}`)) throw new Error(`${branch} already exists`)
  const base = kind === 'hotfix' ? config.master : config.develop
  if (!(await exists(repo, `refs/heads/${base}`))) throw new Error(`There’s no branch called ${base}`)
  await runGit(['switch', '--no-track', '-c', branch, `refs/heads/${base}`], { cwd: repo })
}

/** Merge the branch into `target` with a merge commit, unless an earlier run already did. */
async function mergeInto(repo: string, branch: string, target: string): Promise<OperationResult> {
  const merged = await runGit(['merge-base', '--is-ancestor', `refs/heads/${branch}`, `refs/heads/${target}`], {
    cwd: repo,
    allowedExitCodes: [0, 1]
  })
  if (merged.exitCode === 0) return { conflicted: false }
  await runGit(['switch', target], { cwd: repo })
  // By its short name, so the commit says "Merge branch 'release/1.2'" like git-flow's own.
  return merge(repo, branch, { noFastForward: true })
}

/**
 * Finish a git-flow branch: a feature is merged into the development branch; a release or hotfix into
 * production, tagged there, then merged into the development branch. The branch is deleted unless kept.
 * A merge that stops on conflicts is left for the user; running this again afterwards carries on,
 * skipping the merges and the tag that are already done.
 */
export async function flowFinish(repo: string, kind: FlowKind, name: string, options: FinishFlowOptions): Promise<OperationResult> {
  const config = await requireConfig(repo)
  const branch = config.prefixes[kind] + name
  const tag = config.versionTagPrefix + name
  await assertBranchName(repo, branch)
  if (kind !== 'feature' && !(await validRef(repo, `refs/tags/${tag}`, tag))) throw new Error(`"${tag}" is not a valid tag name`)
  const required = [branch, config.develop, ...(kind === 'feature' ? [] : [config.master])]
  const [current, ...found] = await Promise.all([status(repo), ...required.map((ref) => exists(repo, `refs/heads/${ref}`))])
  const missing = required.find((_, index) => !found[index])
  if (missing) throw new Error(`There’s no branch called ${missing}`)
  if (current.operation) throw new Error(`Finish the ${current.operation.kind} first`)
  if (current.bisect) throw new Error('Finish the bisect first')
  if (current.entries.some((entry) => !entry.untracked)) throw new Error(`Commit or stash your changes before finishing ${branch}.`)

  if (kind !== 'feature') {
    if ((await mergeInto(repo, branch, config.master)).conflicted) return { conflicted: true }
    if (!(await exists(repo, `refs/tags/${tag}`))) {
      const message = options.tagMessage?.trim() || `${kind === 'release' ? 'Release' : 'Hotfix'} ${name}`
      await runGit(['tag', '-a', '--file=-', '--', tag, `refs/heads/${config.master}`], { cwd: repo, stdin: message })
    }
  }
  if ((await mergeInto(repo, branch, config.develop)).conflicted) return { conflicted: true }

  // git-flow ends on the development branch. A run that only had the deletion left may not be there yet.
  await runGit(['switch', config.develop], { cwd: repo })
  if (!options.keepBranch) await runGit(['branch', '-d', '--', branch], { cwd: repo })
  return { conflicted: false }
}
