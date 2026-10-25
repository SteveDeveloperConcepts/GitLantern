import { useEffect, useState } from 'react'
import type { AskPassRequest } from '../../../shared/types'

const api = window.api

/** Shows git/ssh credential prompts one at a time, in the order they arrive. */
export function AskPassDialog() {
  const [queue, setQueue] = useState<AskPassRequest[]>([])
  const [value, setValue] = useState('')
  const [remember, setRemember] = useState(false)
  const [canRemember, setCanRemember] = useState(false)

  useEffect(() => api.askpass.onRequest((request) => setQueue((current) => [...current, request])), [])
  useEffect(() => {
    void api.secrets.available().then(setCanRemember)
  }, [])

  const request = queue[0]
  if (!request) return null

  const finish = (answer: { value: string; remember: boolean } | null) => {
    void api.askpass.respond(request.id, answer)
    setQueue((current) => current.slice(1))
    setValue('')
    setRemember(false)
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault()
          finish({ value, remember })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') finish(null)
        }}
      >
        <h2>Git needs your input</h2>
        <p className="prompt-text">{request.prompt}</p>
        <input
          autoFocus
          type={request.secret ? 'password' : 'text'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={request.prompt}
          autoComplete="off"
        />
        <label className={`checkbox${canRemember ? '' : ' disabled'}`}>
          <input
            type="checkbox"
            checked={remember}
            disabled={!canRemember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Remember (encrypted with your OS keychain)
        </label>
        <div className="modal-actions">
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Continue
          </button>
        </div>
      </form>
    </div>
  )
}
