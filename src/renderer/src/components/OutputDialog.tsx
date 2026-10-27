import type { CustomActionResult } from '../../../shared/types'
import { Modal } from './Modal'

/** What a custom action printed, and how it ended. */
export function OutputDialog({ title, result, onClose }: { title: string; result: CustomActionResult; onClose(): void }) {
  return (
    <Modal title={title} onClose={onClose} className="modal-wide">
      <div className="form">
        <p className={result.exitCode === 0 ? 'test-ok' : 'test-fail'}>
          {result.exitCode === null ? 'It couldn’t be started.' : result.exitCode === 0 ? 'Finished.' : `Finished with exit code ${result.exitCode}.`}
        </p>
        <pre className="action-output selectable">{result.output || '(no output)'}</pre>
        <div className="modal-actions">
          <button onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
