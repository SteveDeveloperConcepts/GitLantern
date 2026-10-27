import type { BisectState } from '../../../shared/types'

interface Props {
  state: BisectState
  /** The checked-out commit, the one being tested. */
  head: string | null
  /** git's last word on it: how many steps are left, or the first bad commit. */
  message: string | null
  firstBad: string | null
  busy: boolean
  onMark(verdict: 'good' | 'bad' | 'skip'): void
  onShowCommit(hash: string): void
  onReset(): void
}

/** While bisecting: test the checked-out commit, then say whether the bug is there. */
export function BisectBanner({ state, head, message, firstBad, busy, onMark, onShowCommit, onReset }: Props) {
  return (
    <div className="operation-banner bisect-banner" role="status">
      <div className="operation-text">
        <strong>
          {firstBad ? (
            <>
              Found it: the first bad commit is{' '}
              <button className="link mono" onClick={() => onShowCommit(firstBad)}>
                {firstBad.slice(0, 7)}
              </button>
            </>
          ) : (
            `Bisecting · testing ${head?.slice(0, 7) ?? 'HEAD'}`
          )}
        </strong>
        <span>
          {firstBad
            ? 'Stop bisecting to go back to the branch you were on.'
            : (message ??
              `Check whether the bug is in the checked-out commit, then mark it. ${state.good.length} good, ${state.bad ? '1 bad' : 'no bad yet'}${
                state.skipped.length ? `, ${state.skipped.length} skipped` : ''
              }.`)}
        </span>
      </div>
      {!firstBad && (
        <>
          <button onClick={() => onMark('skip')} disabled={busy} title="Can’t test this one (it doesn’t build, say)">
            Skip
          </button>
          <button className="good" onClick={() => onMark('good')} disabled={busy}>
            Good
          </button>
          <button className="bad" onClick={() => onMark('bad')} disabled={busy}>
            Bad
          </button>
        </>
      )}
      <button className={firstBad ? 'primary' : ''} onClick={onReset} disabled={busy}>
        Stop bisecting
      </button>
    </div>
  )
}
