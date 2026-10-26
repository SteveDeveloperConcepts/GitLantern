import { Icon } from './Icon'
import { Modal } from './Modal'

interface Props {
  /** The checked-out branch. */
  branch: string
  /** The remote branch, e.g. origin/main. */
  upstream: string
  /** Where the remote branch is now: the force push only goes ahead while it's still there. */
  expected: string
  /** Old commits on the remote branch that would be replaced. */
  replaced: number
  /** Commits of the branch that would be uploaded. */
  ahead: number
  onConfirm(): void
  onCancel(): void
}

const commits = (count: number): string => `${count} commit${count === 1 ? '' : 's'}`

/** Offered when a push is refused because the branch was rewritten after it was pushed. */
export function ForcePushDialog({ branch, upstream, expected, replaced, ahead, onConfirm, onCancel }: Props) {
  return (
    <Modal title={`Replace ${upstream}?`} onClose={onCancel}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm()
        }}
      >
        <p className="dialog-text">
          You rewrote commits on {branch} after pushing them, for example by rebasing. {upstream} still has the old copies (
          {commits(replaced)}), so a normal push can’t go ahead.
        </p>
        <p className="dialog-text">
          A force push replaces {upstream} with {branch} as it is now{ahead > 0 ? `: ${commits(ahead)} ${ahead === 1 ? 'goes' : 'go'} up` : ''}. Git Steve
          checks that {upstream} is still at {expected.slice(0, 7)}, and refuses if anyone has pushed to it since, so their work
          can’t be lost.
        </p>
        <div className="notice warning">
          <Icon name="warning" size={16} />
          <p>
            If other people use {upstream}, tell them before you do this: their copies of the old commits will no longer match, and
            they’ll need to reset to the new ones.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="submit" className="primary">
            Force push
          </button>
        </div>
      </form>
    </Modal>
  )
}
