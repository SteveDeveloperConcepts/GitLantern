import { useEffect, useState, type SyntheticEvent } from 'react'
import type { DiffTarget, ImagePair } from '../../../shared/types'
import { errorMessage } from '../format'

const api = window.api

type Mode = 'side' | 'swipe' | 'blend'
const MODES: { mode: Mode; label: string }[] = [
  { mode: 'side', label: 'Side by side' },
  { mode: 'swipe', label: 'Swipe' },
  { mode: 'blend', label: 'Blend' }
]

const size = (bytes: number | null): string =>
  bytes === null ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Before and after of an image: next to each other, with a slider to swipe between them, or faded over each other. */
export function ImageDiff({ repoPath, target }: { repoPath: string; target: DiffTarget }) {
  const [pair, setPair] = useState<ImagePair | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('side')
  const [amount, setAmount] = useState(50)
  const [dimensions, setDimensions] = useState<Record<'before' | 'after', string>>({ before: '', after: '' })

  useEffect(() => {
    let cancelled = false
    setPair(null)
    setError(null)
    api.git.imagePair(repoPath, target).then(
      (result) => !cancelled && setPair(result),
      (err: unknown) => !cancelled && setError(errorMessage(err))
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, target])

  if (error) return <div className="panel-error">{error}</div>
  if (!pair) return <div className="panel-loading">Loading images…</div>
  const both = pair.before !== null && pair.after !== null
  const shown = both ? mode : 'side'
  const measure = (side: 'before' | 'after') => (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    setDimensions((current) => ({ ...current, [side]: `${image.naturalWidth} × ${image.naturalHeight}` }))
  }

  return (
    <div className="image-diff">
      {both && (
        <div className="image-toolbar">
          <div className="segmented small" role="group" aria-label="How to compare">
            {MODES.map((option) => (
              <button key={option.mode} aria-pressed={mode === option.mode} onClick={() => setMode(option.mode)}>
                {option.label}
              </button>
            ))}
          </div>
          {mode !== 'side' && (
            <input type="range" min={0} max={100} value={amount} onChange={(event) => setAmount(Number(event.target.value))} aria-label={mode === 'swipe' ? 'Swipe' : 'Blend'} />
          )}
        </div>
      )}
      {shown === 'side' ? (
        <div className="image-sides">
          {(['before', 'after'] as const).map((side) => (
            <figure key={side} className={`image-side ${side}`}>
              <figcaption>
                {side === 'before' ? 'Before' : 'After'}
                <span className="dim">
                  {pair[side] === null ? (side === 'before' ? 'new file' : 'deleted') : [dimensions[side], size(side === 'before' ? pair.beforeSize : pair.afterSize)].filter(Boolean).join(' · ')}
                </span>
              </figcaption>
              <div className="checkerboard">{pair[side] && <img src={pair[side] ?? ''} alt={`${target.path} ${side}`} onLoad={measure(side)} />}</div>
            </figure>
          ))}
        </div>
      ) : (
        <div className="image-stack checkerboard">
          <img src={pair.before ?? ''} alt={`${target.path} before`} onLoad={measure('before')} />
          {shown === 'swipe' ? (
            <div className="image-swipe" style={{ clipPath: `inset(0 0 0 ${amount}%)` }}>
              <img src={pair.after ?? ''} alt={`${target.path} after`} onLoad={measure('after')} />
            </div>
          ) : (
            <img className="image-over" src={pair.after ?? ''} alt={`${target.path} after`} style={{ opacity: amount / 100 }} onLoad={measure('after')} />
          )}
          {shown === 'swipe' && <div className="image-swipe-line" style={{ left: `${amount}%` }} />}
        </div>
      )}
    </div>
  )
}
