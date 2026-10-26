import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'"
].join('; ')

// The production build gets a strict CSP. The dev server is left without one because
// React Fast Refresh injects an inline preamble script.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'gitlantern:csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  }
}

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // Run by git (through the askpass trampoline) with ELECTRON_RUN_AS_NODE=1.
          askpass: resolve(import.meta.dirname, 'src/askpass/index.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react(), contentSecurityPolicy()]
  }
})
