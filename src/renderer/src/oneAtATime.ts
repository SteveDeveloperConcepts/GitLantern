/**
 * Let a load run one at a time. Calls made while it runs ask for one more run afterwards, not one each,
 * so the last call is always followed by a run that started after it.
 */
export function oneAtATime(load: () => Promise<void>): () => Promise<void> {
  let running = false
  let again = false
  return async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        await load()
      } while (again)
    } finally {
      running = false
    }
  }
}
