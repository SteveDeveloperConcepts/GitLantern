import type { GitLanternApi } from '../../shared/types'

declare global {
  interface Window {
    api: GitLanternApi
  }
}

export {}
