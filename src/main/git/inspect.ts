import fs from 'node:fs/promises'
import { imageMime } from '../../shared/images'
import type { BlameCommit, BlameLine, BlameResult, ChangedFile, DiffTarget, FileHistoryEntry, ImagePair } from '../../shared/types'
import { LITERAL_PATHS, assertHash, assertRevision, changedFiles, insideRepo, parentsOf } from './commands'
import { LOG_FORMAT, parseLog, parseNameStatus } from './parsers'
import { runGit, runGitRaw } from './runGit'

/** Images bigger than this (on either side) aren't previewed. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** Like git, a file with a NUL byte this close to its start counts as binary. */
const BINARY_CHECK_BYTES = 8000

/** Files changed between two commits or branches, with line counts. */
export async function compareFiles(repo: string, from: string, to: string): Promise<ChangedFile[]> {
  assertRevision(from)
  assertRevision(to)
  return changedFiles(repo, [from, to])
}

/** The absolute path of a file from the UI: inside the repository, and on one line, since cat-file reads one name per line. */
function repoPath(repo: string, file: string): string {
  if (/[\r\n]/.test(file)) throw new Error('File names with line breaks aren’t supported here')
  return insideRepo(repo, file)
}

/**
 * A file in a commit or the index (`<rev>:<path>`, `:0:<path>`), or null when it doesn't exist there:
 * cat-file answers "missing" instead of failing, so nothing depends on git's (translated) errors.
 */
async function findBlob(repo: string, spec: string): Promise<{ oid: string; size: number } | null> {
  const { stdout } = await runGit(['cat-file', '--batch-check'], { cwd: repo, stdin: `${spec}\n` })
  const match = /^([0-9a-f]{40,64}) blob (\d+)$/.exec(stdout.trim())
  return match?.[1] ? { oid: match[1], size: Number(match[2]) } : null
}

const isMissing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** One side of an image diff: a blob (`spec`), the file in the working copy (no `spec`). */
interface ImageSide {
  path: string
  mime: string
  spec?: string
}

function imageSide(repo: string, file: string, spec?: string): ImageSide {
  repoPath(repo, file)
  const mime = imageMime(file)
  if (!mime) throw new Error(`${file} isn’t an image GitLantern can preview`)
  return { path: file, mime, spec }
}

/** Where both versions of the file come from, for each kind of diff (the same sides `diff` compares). */
async function imageSides(repo: string, target: DiffTarget): Promise<[ImageSide | null, ImageSide | null]> {
  const file = target.path
  switch (target.kind) {
    case 'worktree':
      return [target.untracked ? null : imageSide(repo, file, `:0:${file}`), imageSide(repo, file)]
    case 'index':
      return [imageSide(repo, file, `HEAD:${file}`), imageSide(repo, file, `:0:${file}`)]
    case 'commit': {
      assertHash(target.hash)
      const after = imageSide(repo, file, `${target.hash}:${file}`)
      const old = target.origPath ?? file
      const [parent] = await parentsOf(repo, target.hash)
      return [parent ? imageSide(repo, old, `${parent}:${old}`) : null, after]
    }
    case 'stash':
      assertHash(target.hash)
      // A stash commit's first parent is where it was made; its third holds the untracked files.
      return target.untracked
        ? [null, imageSide(repo, file, `${target.hash}^3:${file}`)]
        : [imageSide(repo, file, `${target.hash}^1:${file}`), imageSide(repo, file, `${target.hash}:${file}`)]
    case 'range': {
      assertRevision(target.from)
      assertRevision(target.to)
      const old = target.origPath ?? file
      return [imageSide(repo, old, `${target.from}:${old}`), imageSide(repo, file, `${target.to}:${file}`)]
    }
  }
}

function checkSize(file: string, size: number): void {
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`${file} is too big to preview: ${(size / 1024 / 1024).toFixed(1)} MB, and images up to 20 MB are shown.`)
  }
}

/** The bytes of one side, or null when the file doesn't exist there. */
async function readSide(repo: string, side: ImageSide | null): Promise<Buffer | null> {
  if (!side) return null
  if (side.spec === undefined) {
    const absolute = repoPath(repo, side.path)
    const stat = await fs.stat(absolute).catch((error: unknown) => {
      if (isMissing(error)) return null
      throw error
    })
    if (!stat?.isFile()) return null
    checkSize(side.path, stat.size)
    return fs.readFile(absolute)
  }
  const blob = await findBlob(repo, side.spec)
  if (!blob) return null
  checkSize(side.path, blob.size)
  return (await runGitRaw(['cat-file', 'blob', blob.oid], { cwd: repo, maxOutputBytes: MAX_IMAGE_BYTES })).stdout
}

/** Both versions of an image file a diff is about, as data URLs; null where the file doesn't exist on that side. */
export async function imagePair(repo: string, target: DiffTarget): Promise<ImagePair> {
  const [beforeSide, afterSide] = await imageSides(repo, target)
  const [before, after] = await Promise.all([readSide(repo, beforeSide), readSide(repo, afterSide)])
  const dataUrl = (side: ImageSide | null, bytes: Buffer | null): string | null =>
    side && bytes ? `data:${side.mime};base64,${bytes.toString('base64')}` : null
  return {
    before: dataUrl(beforeSide, before),
    after: dataUrl(afterSide, after),
    beforeSize: before?.length ?? null,
    afterSize: after?.length ?? null
  }
}

const BLAME_HEADER = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/

/**
 * Parse `git blame --porcelain`. Every line starts with a header (commit, original and final line
 * number); the commit's details follow the first time it appears, then the line itself after a tab.
 */
export function parseBlame(stdout: string): BlameResult {
  const lines: BlameLine[] = []
  const commits: Record<string, BlameCommit> = {}
  let current: BlameCommit | null = null
  let number = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('\t')) {
      if (current) lines.push({ number, text: line.slice(1).replace(/\r$/, ''), hash: current.hash })
      continue
    }
    const header = BLAME_HEADER.exec(line)
    if (header) {
      const hash = header[1] ?? ''
      // Lines not committed yet carry git's all-zero hash.
      current = commits[hash] ??= { hash, authorName: '', authorEmail: '', authorDate: 0, summary: '', uncommitted: /^0+$/.test(hash) }
      number = Number(header[2])
      continue
    }
    if (!current) continue
    const space = line.indexOf(' ')
    const value = space === -1 ? '' : line.slice(space + 1)
    switch (space === -1 ? line : line.slice(0, space)) {
      case 'author':
        current.authorName = value
        break
      case 'author-mail':
        current.authorEmail = value.replace(/^<|>$/g, '')
        break
      case 'author-time':
        current.authorDate = Number(value)
        break
      case 'summary':
        current.summary = value
        break
    }
  }
  return { lines, commits, binary: false }
}

/** The first bytes of a file in the working copy, enough to tell whether it's binary. */
async function fileStart(absolute: string): Promise<Buffer> {
  const handle = await fs.open(absolute, 'r')
  try {
    const buffer = Buffer.alloc(BINARY_CHECK_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Who last changed each line of a file: as it is at `revision`, or in the working copy (uncommitted lines included) without one. */
export async function blame(repo: string, file: string, revision?: string): Promise<BlameResult> {
  const absolute = repoPath(repo, file)
  let start: Buffer
  if (revision === undefined) {
    // git blames the working copy against HEAD, so a file HEAD doesn't have has nothing to blame yet.
    if (!(await findBlob(repo, `HEAD:${file}`))) throw new Error(`${file} hasn’t been committed yet, so there’s no history to blame.`)
    start = await fileStart(absolute).catch((error: unknown) => {
      if (isMissing(error)) throw new Error(`${file} isn’t in the working copy. Blame it at a commit instead.`)
      throw error
    })
  } else {
    assertRevision(revision)
    const blob = await findBlob(repo, `${revision}:${file}`)
    if (!blob) throw new Error(`${file} doesn’t exist in ${revision}`)
    start = (await runGitRaw(['cat-file', 'blob', blob.oid], { cwd: repo })).stdout
  }
  if (start.subarray(0, BINARY_CHECK_BYTES).includes(0)) return { binary: true, lines: [], commits: {} }
  const { stdout } = await runGit(['blame', '--porcelain', ...(revision === undefined ? [] : [revision]), '--', file], { cwd: repo })
  return parseBlame(stdout)
}

/** Starts each commit's record in {@link fileHistory}'s log, ahead of the LOG_FORMAT fields. */
const RECORD = '\x1e'

/**
 * Parse `git log -z --name-status --format=%x1e<LOG_FORMAT> -- <file>`: each commit, then that file's
 * status and path(s). Commits that list no change to it (merges) are left out.
 */
export function parseFileHistory(stdout: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = []
  for (const record of stdout.split(RECORD)) {
    // The commit's fields end at the first NUL; the status and path(s) follow on the next line.
    const end = record.indexOf('\0')
    if (end === -1) continue
    const [commit] = parseLog(record.slice(0, end))
    const [change] = parseNameStatus(record.slice(end + 1).replace(/^\n/, ''))
    if (!commit || !change) continue
    entries.push({ commit, status: change.status, path: change.path, ...(change.origPath ? { origPath: change.origPath } : {}) })
  }
  return entries
}

/** Commits that changed a file, newest first, followed across renames (up to 1000). */
export async function fileHistory(repo: string, file: string): Promise<FileHistoryEntry[]> {
  insideRepo(repo, file)
  // No commits yet, so no history (git log would fail).
  const born = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: repo, allowedExitCodes: [0, 1] })
  if (born.exitCode !== 0) return []
  const { stdout } = await runGit(
    ['log', '--follow', '-M', '--name-status', '--decorate=full', '--max-count=1000', '-z', `--format=%x1e${LOG_FORMAT}`, '--', file],
    { cwd: repo, env: LITERAL_PATHS }
  )
  return parseFileHistory(stdout)
}
