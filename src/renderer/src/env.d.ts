import type { GitSteveApi } from '../../shared/types'

declare global {
  interface Window {
    api: GitSteveApi
  }
}

export {}
