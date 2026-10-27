/** How a fetch, pull, push or other trip to a remote ended: done, done but needing a look, or failed. */
export type ToastTone = 'ok' | 'info' | 'error'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  detail?: string
}

/** At most this many toasts at once; older ones make way. */
export const MAX_TOASTS = 4

/** How long a toast stays, in milliseconds: failures longer, so there's time to read them. */
export const toastDuration = (tone: ToastTone): number => (tone === 'error' ? 9000 : 5000)

/** The list with `toast` added at the end, the oldest dropped beyond MAX_TOASTS. A repeat replaces its twin. */
export function addToast(list: readonly Toast[], toast: Toast): Toast[] {
  const others = list.filter((t) => !(t.tone === toast.tone && t.title === toast.title && t.detail === toast.detail))
  return [...others, toast].slice(-MAX_TOASTS)
}

/** The first line of an error, short enough for a toast; the whole message is in the error banner. */
export function toastDetail(message: string, max = 160): string {
  const line = message.split('\n').find((part) => part.trim())?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
