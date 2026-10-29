import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { GitConfigKey, GitIdentity, OperationResult } from '../../shared/types'
import { assertHash, assertRevision, insideRepo, parentsOf, status } from './commands'
import { GitError, runGit, runGitRaw } from './runGit'

/** git's own messages in English whatever the user's language, so its output can be read. */
const ENGLISH = { LC_ALL: 'C', LANG: 'C' }

function assertAbsolute(file: string): void {
  if (!path.isAbsolute(file)) throw new Error(`Not a full path: ${file}`)
}

/** Save a commit's files as a zip archive. */
export async function archive(repo: string, revision: string, outputFile: string): Promise<void> {
  assertRevision(revision)
  assertAbsolute(outputFile)
  await runGit(['archive', '--format=zip', `--output=${outputFile}`, revision, '--'], { cwd: repo })
}

// Fixed a/ and b/ prefixes whatever the user's config says, so the patch applies anywhere.
const PREFIXES = ['--src-prefix=a/', '--dst-prefix=b/']

/** Save commits as one mailbox of patches in the order given, or the uncommitted changes to tracked files when there are none. */
export async function savePatch(repo: string, hashes: string[], outputFile: string): Promise<void> {
  hashes.forEach(assertHash)
  assertAbsolute(outputFile)
  if (hashes.length === 0) {
    const { stdout } = await runGitRaw(
      ['diff', 'HEAD', '--binary', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', ...PREFIXES, '--'],
      { cwd: repo }
    )
    if (stdout.length === 0) throw new Error('There are no changes to tracked files to save')
    await fs.writeFile(outputFile, stdout)
    return
  }
  const patches: Buffer[] = []
  for (const hash of hashes) {
    // format-patch leaves merge commits out, which would quietly drop one.
    if ((await parentsOf(repo, hash)).length > 1) throw new Error(`${hash.slice(0, 7)} is a merge commit, which a patch can’t hold`)
    // -1 takes just this commit, a root commit included.
    const { stdout } = await runGitRaw(['format-patch', '-1', '--stdout', '--binary', '--no-cover-letter', ...PREFIXES, hash, '--'], {
      cwd: repo
    })
    patches.push(stdout)
  }
  await fs.writeFile(outputFile, Buffer.concat(patches))
}

/** `git am` keeps its state in rebase-apply/ too, but without the head-name file a rebase has. */
async function amInProgress(repo: string): Promise<boolean> {
  const { stdout } = await runGit(['rev-parse', '--git-path', 'rebase-apply'], { cwd: repo })
  return fs.stat(path.resolve(repo, stdout.trim())).then(
    (stat) => stat.isDirectory(),
    () => false
  )
}

async function readStart(file: string): Promise<string> {
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.alloc(100)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.toString('latin1', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** git's error lines without its hints, which talk about carrying on in a terminal. */
const withoutHints = (stderr: string): string =>
  stderr
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('hint:'))
    .join('\n')

/**
 * Apply a patch file. A mailbox (from format-patch) becomes commits through `git am --3way`, and is
 * undone completely if any patch in it fails. Anything else is applied to the working copy and the
 * index with `git apply --3way`, which can leave conflicts to resolve.
 */
export async function applyPatchFile(repo: string, inputFile: string): Promise<OperationResult> {
  assertAbsolute(inputFile)
  const current = await status(repo)
  if (current.operation) throw new Error(`Finish the ${current.operation.kind} first`)
  if (await amInProgress(repo)) throw new Error('Patches are already being applied (git am). Finish or abort that first.')
  if (current.entries.some((entry) => entry.conflicted)) throw new Error('Resolve the conflicts first')

  if (/^From [0-9a-f]{40,64} /.test(await readStart(inputFile))) {
    if (current.entries.some((entry) => entry.index !== null)) {
      throw new Error('Commit or unstage your staged changes first: the patches in that file are applied as commits.')
    }
    try {
      await runGit(['am', '--3way', '--', inputFile], { cwd: repo })
      return { conflicted: false }
    } catch (error) {
      if (!(error instanceof GitError)) throw error
      // git am stops at the first patch that fails, with the ones before it committed: undo the lot.
      if (await amInProgress(repo)) await runGit(['am', '--abort'], { cwd: repo })
      const details = withoutHints(error.stderr)
      throw new Error(`Git couldn’t apply the patches in that file, so nothing was changed.${details ? `\n\n${details}` : ''}`)
    }
  }

  try {
    await runGit(['apply', '--3way', '--', inputFile], { cwd: repo })
    return { conflicted: false }
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    // Like a stash, a 3-way apply leaves no state file when it conflicts: only the conflicted files.
    const { stdout } = await runGit(['ls-files', '--unmerged'], { cwd: repo })
    if (stdout.trim()) return { conflicted: true }
    throw new Error(`Git couldn’t apply that patch, so nothing was changed.\n\n${withoutHints(error.stderr)}`)
  }
}

const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

/** Undo git's C-style quoting of a path ("tab\there", "\303\251"), which it uses for unusual characters. */
function unquotePath(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text
  // A backslash byte is never part of a multi-byte UTF-8 character, so the bytes can be walked one by one.
  const raw = Buffer.from(text.slice(1, -1), 'utf8')
  const bytes: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const byte = raw[i] ?? 0
    if (byte !== 0x5c) {
      bytes.push(byte)
      continue
    }
    const octal = /^[0-7]{3}/.exec(raw.toString('latin1', i + 1, i + 4))
    const escaped = C_ESCAPES[String.fromCharCode(raw[i + 1] ?? 0)]
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      i += 3
    } else if (escaped !== undefined) {
      bytes.push(escaped)
      i += 1
    } else {
      bytes.push(byte)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

const WOULD_REMOVE = 'Would remove '

/** The paths in `git clean -n` output (run in English). Nested repositories it skips aren't listed. */
export function parseCleanPreview(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith(WOULD_REMOVE))
    .map((line) => unquotePath(line.slice(WOULD_REMOVE.length)))
}

/** Untracked files and folders `git clean` would remove (with `ignored`, ignored ones too); folders end in '/'. */
export async function cleanPreview(repo: string, ignored: boolean): Promise<string[]> {
  const { stdout } = await runGit(['clean', ignored ? '-ndx' : '-nd'], { cwd: repo, env: ENGLISH })
  return parseCleanPreview(stdout)
}

/** Hand untracked or ignored files and folders to `removeFile`. Only paths `git clean -ndx` lists right now are allowed. */
export async function clean(repo: string, paths: string[], removeFile: (absolutePath: string) => Promise<void>): Promise<void> {
  const removable = new Set(await cleanPreview(repo, true))
  const refused = paths.filter((file) => !removable.has(file))
  if (refused.length > 0) {
    throw new Error(`Nothing was removed. Only untracked and ignored files can be cleaned, not ${refused.join(', ')}.`)
  }
  for (const file of new Set(paths)) await removeFile(insideRepo(repo, file))
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/** Add a pattern to the repository's .gitignore, or to info/exclude for this copy only, unless that line is already there. */
export async function ignore(repo: string, pattern: string, where: 'gitignore' | 'exclude'): Promise<void> {
  if (!pattern.trim()) throw new Error('Enter a pattern to ignore')
  if (/[\r\n\0]/.test(pattern)) throw new Error('A pattern has to fit on one line')
  let file = path.join(repo, '.gitignore')
  if (where === 'exclude') {
    const { stdout } = await runGit(['rev-parse', '--git-path', 'info/exclude'], { cwd: repo })
    file = path.resolve(repo, stdout.trim())
    await fs.mkdir(path.dirname(file), { recursive: true })
  }
  const existing = await readIfExists(file)
  if (existing.split(/\r?\n/).includes(pattern)) return
  // Keep the file's own line endings, and start on a new line.
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  await fs.appendFile(file, `${existing && !existing.endsWith('\n') ? newline : ''}${pattern}${newline}`)
}

const IDENTITY_KEYS = '^(user\\.(name|email)|(commit|tag)\\.gpgsign)$'

/** A git boolean: true, yes, on or a non-zero number. A key with no value at all counts as true. */
function configBool(value: string | null): boolean {
  if (value === null) return true
  const text = value.trim().toLowerCase()
  return ['true', 'yes', 'on'].includes(text) || (/^-?\d+$/.test(text) && Number(text) !== 0)
}

async function identityIn(repo: string, scope: '--local' | '--global'): Promise<Partial<GitIdentity>> {
  const { stdout } = await runGit(['config', scope, '-z', '--get-regexp', IDENTITY_KEYS], { cwd: repo, allowedExitCodes: [0, 1] })
  // -z: "key\nvalue" records separated by NUL; a key without a value has no newline. The last one set wins, as in git.
  const values = new Map<string, string | null>()
  for (const record of stdout.split('\0').filter(Boolean)) {
    const newline = record.indexOf('\n')
    values.set(newline === -1 ? record : record.slice(0, newline), newline === -1 ? null : record.slice(newline + 1))
  }
  const name = values.get('user.name')
  const email = values.get('user.email')
  return {
    ...(name != null ? { userName: name } : {}),
    ...(email != null ? { userEmail: email } : {}),
    ...(values.has('commit.gpgsign') ? { signCommits: configBool(values.get('commit.gpgsign') ?? null) } : {}),
    ...(values.has('tag.gpgsign') ? { signTags: configBool(values.get('tag.gpgsign') ?? null) } : {})
  }
}

const MAX_TEMPLATE_BYTES = 64 * 1024

/** The file commit.template points at, from whichever config sets it; '' when there's none or it can't be read. */
async function commitTemplate(repo: string): Promise<string> {
  try {
    // --type=path expands ~. A relative path is relative to the repository, where git commit runs.
    const { stdout } = await runGit(['config', '--type=path', '--get', 'commit.template'], { cwd: repo, allowedExitCodes: [0, 1] })
    const file = stdout.replace(/\r?\n$/, '')
    if (!file) return ''
    const handle = await fs.open(path.resolve(repo, file), 'r')
    try {
      const buffer = Buffer.alloc(MAX_TEMPLATE_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return buffer.toString('utf8', 0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/**
 * Name, email and signing settings: the ones this repository sets itself, and the global ones (with
 * defaults for those that aren't set). The commit template is the one in effect for the repository.
 */
export async function identity(repo: string): Promise<{ local: Partial<GitIdentity>; global: GitIdentity }> {
  const [local, global, template] = await Promise.all([identityIn(repo, '--local'), identityIn(repo, '--global'), commitTemplate(repo)])
  return {
    local,
    global: {
      userName: global.userName ?? '',
      userEmail: global.userEmail ?? '',
      signCommits: global.signCommits ?? false,
      signTags: global.signTags ?? false,
      commitTemplate: template
    }
  }
}

/**
 * Take the name and email from another Git config file (the user's ~/.gitconfig, which the Mac App
 * Store build can't read on its own) into the global config. Returns what was copied.
 */
export async function importIdentity(file: string): Promise<{ userName?: string; userEmail?: string }> {
  // A copy of it is read: git runs in the app's sandbox, and gets no further than the app itself.
  assertAbsolute(file)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gl-'))
  const copy = path.join(dir, 'gitconfig')
  try {
    await fs.copyFile(file, copy)
    const read = async (key: string): Promise<string | undefined> =>
      (await runGit(['config', '--file', copy, '--get', key], { cwd: dir, allowedExitCodes: [0, 1] })).stdout.trim() || undefined
    const [userName, userEmail] = await Promise.all([read('user.name'), read('user.email')])
    if (!userName && !userEmail) throw new Error(`${path.basename(file)} has no user.name or user.email in it.`)
    if (userName) await setConfig(null, 'user.name', userName)
    if (userEmail) await setConfig(null, 'user.email', userEmail)
    return { ...(userName ? { userName } : {}), ...(userEmail ? { userEmail } : {}) }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const CONFIG_KEYS: readonly GitConfigKey[] = ['user.name', 'user.email', 'commit.gpgsign', 'tag.gpgsign']

/** Change one setting for a repository, or globally when `repo` is null. A null value removes it. */
export async function setConfig(repo: string | null, key: GitConfigKey, value: string | null): Promise<void> {
  if (!CONFIG_KEYS.includes(key)) throw new Error(`GitLantern doesn’t change ${key}`)
  if (value !== null && /[\r\n\0]/.test(value)) throw new Error('A setting has to fit on one line')
  if (value !== null && key.endsWith('.gpgsign') && value !== 'true' && value !== 'false') throw new Error(`${key} has to be true or false`)
  const scope = repo === null ? '--global' : '--local'
  // --global from the home folder, so no repository's config is involved.
  const cwd = repo ?? os.homedir()
  if (value === null) {
    // Exit 5: it wasn't set, which is what was wanted.
    await runGit(['config', scope, '--unset-all', '--', key], { cwd, allowedExitCodes: [0, 5] })
    return
  }
  // --replace-all: a key set more than once is otherwise refused.
  await runGit(['config', scope, '--replace-all', '--', key, value], { cwd })
}
