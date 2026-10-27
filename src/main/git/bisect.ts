import type { BisectStep } from '../../shared/types'
import { assertRevision, bisectState, operation } from './commands'
import { runGit } from './runGit'

/** git's own messages in English whatever the user's language, so its output can be read. */
const ENGLISH = { LC_ALL: 'C', LANG: 'C' }

/** What git printed after a bisect step: the first bad commit once it names one, otherwise its "Bisecting: …" line. */
export function parseBisectOutput(output: string): BisectStep {
  // Newer versions quote the term ("the first 'bad' commit"), older ones don't.
  const found = /^([0-9a-f]{40,64}) is the first .+ commit$/m.exec(output)
  if (found?.[1]) return { done: true, firstBad: found[1], message: found[0] }
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  // Anything else, such as only skipped commits being left, is shown as git said it.
  return { done: false, message: lines.find((line) => line.startsWith('Bisecting:')) ?? lines.join('\n') }
}

async function bisect(repo: string, args: string[]): Promise<BisectStep> {
  // Exit 2: only skipped commits are left, so git can't narrow it down further. Its output says so.
  const { stdout, stderr } = await runGit(['bisect', ...args], { cwd: repo, env: ENGLISH, allowedExitCodes: [0, 2] })
  return parseBisectOutput(`${stdout}\n${stderr}`)
}

/** Start looking for the commit that broke something, between a bad commit and a good one; git checks out the first to test. */
export async function bisectStart(repo: string, bad: string, good: string): Promise<BisectStep> {
  assertRevision(bad)
  assertRevision(good)
  if (await bisectState(repo)) throw new Error('A bisect is already in progress. Reset it to start another.')
  const busy = await operation(repo)
  if (busy) throw new Error(`Finish the ${busy.kind} first`)
  return bisect(repo, ['start', bad, good, '--'])
}

/** Mark the checked-out commit good, bad or skipped; git checks out the next one, or names the first bad commit. */
export async function bisectMark(repo: string, verdict: 'good' | 'bad' | 'skip'): Promise<BisectStep> {
  if (!(await bisectState(repo))) throw new Error('No bisect is in progress')
  return bisect(repo, [verdict])
}

/** End the bisect and go back to the branch it started on. */
export async function bisectReset(repo: string): Promise<void> {
  await runGit(['bisect', 'reset'], { cwd: repo })
}
