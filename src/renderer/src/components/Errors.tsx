export interface AppError {
  id: number
  message: string
}

/** Error banners stacked at the top of the window; they stay until dismissed. */
export function Errors({ errors, onDismiss }: { errors: AppError[]; onDismiss(id: number): void }) {
  if (errors.length === 0) return null
  return (
    <div className="errors" role="alert">
      {errors.map((error) => (
        <div key={error.id} className="error-banner">
          <pre>{error.message}</pre>
          <button className="link" onClick={() => onDismiss(error.id)} aria-label="Dismiss">
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
