// Fresh screenshots for README.md and the store listings: `yarn build && yarn screenshots`.
//
// Builds two demo repositories in a temporary folder, starts the built app with its own data folder
// (GITLANTERN_USER_DATA) and Chrome's remote debugging port, then clicks through the app over the
// DevTools protocol and saves each scene to docs/screenshots/. Nothing here touches your own
// settings or repositories.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'docs', 'screenshots')
const PORT = 9333
const WIDTH = 1400
const HEIGHT = 880
const only = process.argv.slice(2)

// ---- Demo repositories ----

const DAY = 24 * 3600
const now = Math.floor(Date.now() / 1000)
const AUTHORS = {
  maya: ['Maya Chen', 'maya@example.com'],
  theo: ['Theo Okafor', 'theo@example.com'],
  priya: ['Priya Raman', 'priya@example.com'],
  sam: ['Sam Rivera', 'sam@example.com']
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
}

function write(repo, file, text) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), text)
}

/** Commit everything as `author`, `daysAgo` days back. */
function commit(repo, author, daysAgo, message, extra = []) {
  const [name, email] = AUTHORS[author]
  const date = `${now - Math.round(daysAgo * DAY)} +0000`
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', message, ...extra], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date
  })
}

/** A small PNG: the lantern diamond, drawn per pixel. `glow` is the refreshed logo. */
function logo(glow) {
  const size = 192
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - size / 2)
      const dy = Math.abs(y - size / 2)
      const diamond = dx + dy < size * 0.3
      const ring = glow && Math.hypot(dx, dy) < size * 0.46 && Math.hypot(dx, dy) > size * 0.38
      const [r, g, b] = diamond ? (glow ? [255, 190, 80] : [232, 163, 61]) : ring ? [106, 169, 255] : glow ? [24, 28, 40] : [20, 21, 24]
      row.push(r, g, b, 255)
    }
    rows.push(Buffer.from(row))
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ -1) >>> 0
}

const ROUTER = `export type Route = { path: string; render(): string }

const routes = new Map<string, Route>()

export function addRoute(route: Route): void {
  routes.set(route.path, route)
}

export function navigate(path: string): string {
  const route = routes.get(path) ?? routes.get('/404')
  return route ? route.render() : ''
}
`

function makeWeb(base) {
  const repo = path.join(base, 'lantern-web')
  fs.mkdirSync(repo, { recursive: true })
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  write(repo, 'README.md', '# Lantern Web\n\nThe web front end for Lantern.\n\n## Getting started\n\n    npm install\n    npm run dev\n')
  write(repo, 'package.json', '{\n  "name": "lantern-web",\n  "version": "1.0.0",\n  "private": true\n}\n')
  write(repo, 'src/index.ts', "import { navigate } from './router'\n\ndocument.body.innerHTML = navigate(location.hash.slice(1) || '/')\n")
  write(repo, '.gitignore', 'node_modules/\ndist/\n')
  commit(repo, 'maya', 40, 'Initial commit')
  write(repo, 'src/router.ts', ROUTER)
  commit(repo, 'maya', 38, 'Add router with hash-based navigation')
  fs.mkdirSync(path.join(repo, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'assets/logo.png'), logo(false))
  commit(repo, 'theo', 35, 'Add the lantern logo')
  try {
    git(repo, ['lfs', 'track', '*.psd'])
    fs.mkdirSync(path.join(repo, 'art'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'art/hero.psd'), Buffer.alloc(64 * 1024, 7))
    commit(repo, 'theo', 34, 'Keep design files in Git LFS')
  } catch {
    // No Git LFS here: the LFS screen shows how to set it up instead.
  }
  write(repo, 'src/styles.css', 'header {\n  display: flex;\n  gap: 12px;\n  padding: 12px 24px;\n}\n\nnav a {\n  color: #e8a33d;\n}\n')
  commit(repo, 'priya', 33, 'Style the header and navigation')
  git(repo, ['tag', '-a', 'v1.0.0', '-m', 'First public release'])

  git(repo, ['switch', '-q', '-c', 'feature/login'])
  write(repo, 'src/auth/login.ts', "export function loginForm(): string {\n  return '<form><input name=email><input name=password type=password></form>'\n}\n")
  commit(repo, 'sam', 30, 'Add login form')
  write(
    repo,
    'src/auth/login.ts',
    "const EMAIL = /^[^@\\s]+@[^@\\s]+$/\n\nexport function loginForm(): string {\n  return '<form><input name=email><input name=password type=password></form>'\n}\n\nexport function validate(email: string, password: string): string | null {\n  if (!EMAIL.test(email)) return 'Enter a valid email address'\n  if (password.length < 8) return 'Passwords have at least 8 characters'\n  return null\n}\n"
  )
  commit(repo, 'sam', 29, 'Validate email and password before submitting (#12)', ['-m', 'Closes #12. The form now refuses to submit until both fields look right.'])
  write(repo, 'test/login.test.ts', "import { validate } from '../src/auth/login'\n\ntest('rejects short passwords', () => {\n  expect(validate('a@b.c', 'short')).toMatch(/8 characters/)\n})\n")
  commit(repo, 'sam', 28, 'Test the login form')
  git(repo, ['switch', '-q', 'main'])
  write(repo, 'README.md', '# Lantern Web\n\nThe web front end for Lantern.\n\n## Getting started\n\n    npm install\n    npm run dev\n\nOpen http://localhost:5173 in your browser.\n')
  commit(repo, 'theo', 29, 'Fix typo in README')
  git(repo, ['merge', '-q', '--no-ff', '--no-edit', 'feature/login'], {
    GIT_AUTHOR_NAME: AUTHORS.maya[0],
    GIT_AUTHOR_EMAIL: AUTHORS.maya[1],
    GIT_COMMITTER_NAME: AUTHORS.maya[0],
    GIT_COMMITTER_EMAIL: AUTHORS.maya[1],
    GIT_AUTHOR_DATE: `${now - 27 * DAY} +0000`,
    GIT_COMMITTER_DATE: `${now - 27 * DAY} +0000`
  })
  fs.writeFileSync(path.join(repo, 'assets/logo.png'), logo(true))
  commit(repo, 'priya', 25, 'Refresh the logo for the new brand')
  write(
    repo,
    'src/router.ts',
    ROUTER.replace(
      "export function navigate(path: string): string {\n  const route = routes.get(path) ?? routes.get('/404')\n  return route ? route.render() : ''\n}",
      "const rendered = new Map<string, string>()\n\nexport function navigate(path: string): string {\n  const cached = rendered.get(path)\n  if (cached !== undefined) return cached\n  const route = routes.get(path) ?? routes.get('/404')\n  const html = route ? route.render() : ''\n  rendered.set(path, html)\n  return html\n}"
    )
  )
  commit(repo, 'theo', 22, 'Cache rendered routes (#18)')
  git(repo, ['tag', '-a', 'v1.1.0', '-m', 'Login and route caching'])
  git(repo, ['branch', 'develop'])
  for (const [key, value] of [
    ['gitflow.branch.master', 'main'],
    ['gitflow.branch.develop', 'develop'],
    ['gitflow.prefix.feature', 'feature/'],
    ['gitflow.prefix.release', 'release/'],
    ['gitflow.prefix.hotfix', 'hotfix/'],
    ['gitflow.prefix.versiontag', 'v']
  ]) {
    git(repo, ['config', key, value])
  }

  git(repo, ['switch', '-q', '-c', 'feature/dark-mode', 'develop'])
  write(repo, 'src/styles.css', 'header {\n  display: flex;\n  gap: 12px;\n  padding: 12px 24px;\n}\n\nnav a {\n  color: #e8a33d;\n}\n\n@media (prefers-color-scheme: dark) {\n  body {\n    background: #141518;\n    color: #e8e6e1;\n  }\n}\n')
  commit(repo, 'priya', 18, 'Add a dark theme')
  write(repo, 'src/theme.ts', "export function rememberTheme(theme: 'light' | 'dark'): void {\n  localStorage.setItem('theme', theme)\n}\n")
  commit(repo, 'priya', 16, 'Remember the theme choice')
  git(repo, ['switch', '-q', 'main'])

  // A second repository, added as a submodule.
  const tokens = path.join(base, 'design-tokens')
  fs.mkdirSync(tokens, { recursive: true })
  git(tokens, ['init', '-q', '-b', 'main'])
  write(tokens, 'tokens.json', '{ "accent": "#e8a33d", "radius": 8 }\n')
  commit(tokens, 'priya', 14, 'Colours and spacing')
  git(repo, ['-c', 'protocol.file.allow=always', 'submodule', '-q', 'add', tokens.replace(/\\/g, '/'), 'vendor/design-tokens'])
  commit(repo, 'maya', 12, 'Add the design tokens as a submodule')

  write(repo, 'src/spinner.ts', "export const spinner = '<div class=\"spinner\" role=\"status\">Loading…</div>'\n")
  write(repo, 'src/router.ts', fs.readFileSync(path.join(repo, 'src/router.ts'), 'utf8').replace("const routes = new Map<string, Route>()", "import { spinner } from './spinner'\n\nconst routes = new Map<string, Route>()"))
  commit(repo, 'sam', 9, 'Show a spinner while routes load')
  write(repo, 'package.json', '{\n  "name": "lantern-web",\n  "version": "1.2.0-beta",\n  "private": true\n}\n')
  commit(repo, 'theo', 5, 'Bump version to 1.2.0-beta')
  git(repo, ['tag', 'v1.2.0-beta'])

  // A remote, pushed to, so there are remote branches and an upstream to be ahead of.
  const remote = path.join(base, 'remote', 'lantern-web.git')
  fs.mkdirSync(remote, { recursive: true })
  git(remote, ['init', '-q', '--bare', '-b', 'main'])
  git(repo, ['remote', 'add', 'origin', remote])
  git(repo, ['push', '-q', '-u', 'origin', 'main', 'develop', 'feature/dark-mode', '--tags'], { GIT_LFS_SKIP_PUSH: '1' })
  write(repo, 'src/auth/session.ts', "export function expired(token: { exp: number }): boolean {\n  return token.exp * 1000 < Date.now()\n}\n")
  commit(repo, 'maya', 2, 'Handle expired sessions (WEB-42)')
  // Shown as GitHub and GitLab; nothing is fetched while taking screenshots.
  git(repo, ['remote', 'set-url', 'origin', 'https://github.com/lantern-labs/lantern-web.git'])
  git(repo, ['remote', 'add', 'gitlab', 'git@gitlab.com:lantern-labs/lantern-web.git'])

  git(repo, ['worktree', 'add', '-q', path.join(base, 'lantern-web-dark-mode'), 'feature/dark-mode'])

  write(repo, 'src/index.ts', "import { navigate } from './router'\n\ndocument.body.innerHTML = navigate(location.hash.slice(1) || '/')\n\ndocument.addEventListener('keydown', (event) => {\n  if (event.key === '/') document.querySelector('input')?.focus()\n})\n")
  git(repo, ['stash', 'push', '-q', '-m', 'Half-done keyboard shortcuts'])

  // Uncommitted work: a staged README change, an edited router and a new file.
  write(repo, 'README.md', fs.readFileSync(path.join(repo, 'README.md'), 'utf8') + '\n## Tests\n\n    npm test\n')
  git(repo, ['add', 'README.md'])
  write(
    repo,
    'src/router.ts',
    fs
      .readFileSync(path.join(repo, 'src/router.ts'), 'utf8')
      .replace('export function addRoute(route: Route): void {\n  routes.set(route.path, route)\n}', 'export function addRoute(route: Route): void {\n  if (routes.has(route.path)) throw new Error(`Route ${route.path} exists`)\n  routes.set(route.path, route)\n  rendered.delete(route.path)\n}')
      .replace("  const route = routes.get(path) ?? routes.get('/404')\n  const html", "  const route = routes.get(path) ?? routes.get('/404')\n  if (!route) return spinner\n  const html")
  )
  write(repo, 'src/auth/oauth.ts', "export const providers = ['github', 'gitlab'] as const\n")
  return repo
}

function makeApi(base) {
  const repo = path.join(base, 'lantern-api')
  fs.mkdirSync(repo, { recursive: true })
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  const steps = [
    ['maya', 'Initial API server'],
    ['theo', 'Add health check endpoint'],
    ['sam', 'Read the port from the environment'],
    ['priya', 'Add request logging'],
    ['theo', 'Paginate the projects list'],
    ['maya', 'Cache project lookups'],
    ['sam', 'Switch to the new database driver'],
    ['priya', 'Rate-limit login attempts'],
    ['theo', 'Return 404 for unknown routes'],
    ['maya', 'Upgrade dependencies']
  ]
  steps.forEach(([author, message], index) => {
    write(repo, 'server.ts', `// ${steps.slice(0, index + 1).map(([, m]) => m).join('\n// ')}\nexport const version = ${index + 1}\n`)
    commit(repo, author, 30 - index * 3, message)
  })
  const good = git(repo, ['rev-parse', 'HEAD~8']).trim()
  git(repo, ['bisect', 'start', 'HEAD', good])
  return repo
}

// ---- A pretend GitHub, for review mode ----

/**
 * Serve just enough of GitHub's REST API on https://localhost for review mode, with a certificate made
 * for the occasion (the app is started with NODE_TLS_REJECT_UNAUTHORIZED=0). Git reaches the demo remote
 * through an ssh stand-in (core.sshCommand), so the pull request's commits really are fetched.
 */
async function fakeGitHub(base, web) {
  const https = await import('node:https')
  const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
  const key = path.join(base, 'localhost-key.pem')
  const cert = path.join(base, 'localhost-cert.pem')
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], {
    stdio: 'ignore'
  })
  const head = git(web, ['rev-parse', 'feature/dark-mode']).trim()
  const ago = (days) => new Date((now - days * DAY) * 1000).toISOString()
  const repo = { full_name: 'lantern-labs/lantern-web' }
  const user = (login) => ({ login })
  const pull = {
    number: 7,
    title: 'Dark theme for the whole app',
    body: 'Adds a dark theme that follows the system setting, and remembers a choice made in the menu.\n\nCloses #31. Screenshots in the thread below.',
    state: 'open',
    draft: false,
    merged: false,
    user: user('priya'),
    head: { ref: 'feature/dark-mode', sha: head, repo },
    base: { ref: 'main', repo },
    html_url: 'https://github.com/lantern-labs/lantern-web/pull/7',
    updated_at: ago(1),
    created_at: ago(16)
  }
  const routes = {
    '/user': { login: 'maya', id: 1 },
    '/repos/lantern-labs/lantern-web/pulls': [pull],
    '/repos/lantern-labs/lantern-web/pulls/7': pull,
    '/repos/lantern-labs/lantern-web/pulls/7/comments': [
      {
        id: 101,
        user: user('theo'),
        body: 'Should this come from the design tokens instead of a hard-coded colour?',
        path: 'src/styles.css',
        line: 13,
        original_line: 13,
        side: 'RIGHT',
        commit_id: head,
        created_at: ago(3)
      },
      { id: 102, user: user('priya'), body: 'Good idea, the tokens have it as --bg. I’ll switch it over.', path: 'src/styles.css', line: 13, original_line: 13, side: 'RIGHT', in_reply_to_id: 101, commit_id: head, created_at: ago(2) }
    ],
    '/repos/lantern-labs/lantern-web/issues/7/comments': [{ id: 201, user: user('sam'), body: 'Tried it in Firefox and Safari too, both look right.', created_at: ago(2) }],
    '/repos/lantern-labs/lantern-web/pulls/7/reviews': [{ id: 301, user: user('theo'), body: 'Looks good apart from the colour question.', state: 'COMMENTED', submitted_at: ago(3), commit_id: head }],
    '/repos/lantern-labs/lantern-web/pulls/7/files': [],
    '/repos/lantern-labs/lantern-web/pulls/7/commits': []
  }
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://localhost')
    const route = url.pathname.replace(/^\/api\/v3/, '')
    const found = routes[route]
    response.setHeader('Content-Type', 'application/json')
    if (request.method !== 'GET') {
      request.resume()
      response.end(JSON.stringify({ id: 999, state: 'COMMENTED' }))
    } else if (found !== undefined) {
      // One page is all there is.
      response.end(JSON.stringify(url.searchParams.get('page') && url.searchParams.get('page') !== '1' ? [] : found))
    } else {
      response.end(JSON.stringify(route.endsWith('s') ? [] : {}))
    }
  })
  await new Promise((resolve, reject) => server.listen(443, '127.0.0.1', resolve).on('error', reject))

  // origin now "lives" on localhost; ssh to it runs git against the demo remote instead.
  const remote = path.join(base, 'remote', 'lantern-web.git').replace(/\\/g, '/')
  const shim = path.join(base, 'fake-ssh.sh')
  fs.writeFileSync(shim, `#!/bin/sh\ncase "$*" in\n  *receive-pack*) exec git receive-pack '${remote}' ;;\n  *) exec git upload-pack '${remote}' ;;\nesac\n`)
  return { server, shim: shim.replace(/\\/g, '/') }
}

// ---- Driving the app ----

async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = pages.find((p) => p.type === 'page' && p.url.includes('index.html'))
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Not listening yet.
    }
    await sleep(500)
  }
  throw new Error('The app never opened its window')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class Page {
  constructor(socket) {
    this.socket = socket
    this.next = 1
    this.pending = new Map()
    /** Errors the page logged or threw while the scenes ran, reported at the end. */
    this.problems = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') this.problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.problems.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
      }
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.next++
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async run(source) {
    const result = await this.send('Runtime.evaluate', { expression: `(async () => { ${HELPERS}; ${source} })()`, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  async shot(name) {
    if (only.length > 0 && !only.includes(name)) return
    await sleep(400)
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`  ${name}.png`)
  }
}

// Run in the page before each step: find things by their text, click them, wait for them.
const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const visible = (el) => el && el.offsetParent !== null
  const find = (selector, text) => [...document.querySelectorAll(selector)].find((el) => visible(el) && (!text || el.textContent.trim().includes(text)))
  const waitFor = async (selector, text, timeout = 8000) => {
    for (let t = 0; t < timeout; t += 100) { const el = find(selector, text); if (el) return el; await sleep(100) }
    throw new Error('Not found: ' + selector + ' ' + (text ?? ''))
  }
  const click = async (selector, text) => { const el = await waitFor(selector, text); el.scrollIntoView({ block: 'center' }); el.click(); await sleep(250); return el }
  const rightClick = async (selector, text) => {
    const el = await waitFor(selector, text)
    el.scrollIntoView({ block: 'center' })
    // Menus close when something scrolls, so let the scroll finish first.
    await sleep(400)
    const box = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + Math.min(240, box.width / 2), clientY: box.top + box.height / 2 }))
    await sleep(250)
  }
  const choose = async (select, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(150)
  }
  const escape = async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200) }
  const closeModal = async () => { const button = find('.modal-title button[aria-label="Close"]'); if (button) button.click(); await sleep(250) }
`

async function scenes(page, repos) {
  const tab = (name) => page.run(`await click('.repo-tab', ${JSON.stringify(name)})`)
  const commitRow = (subject) => page.run(`await click('.commit-row', ${JSON.stringify(subject)})`)

  await page.run(`await waitFor('.commit-row', 'Handle expired sessions')`)
  await tab('lantern-web')

  // The commit graph with a commit's details and its diff, side by side.
  await commitRow('Validate email and password')
  await page.run(`await waitFor('.diff-line, .split-row'); await click('.diff-tools button', 'Split')`)
  await page.shot('commit-details')

  // Images: the old and new logo.
  await commitRow('Refresh the logo')
  await page.run(`await waitFor('.image-side img')`)
  await page.shot('image-diff')
  await page.run(`await click('.image-toolbar button', 'Swipe'); const range = await waitFor('.image-toolbar input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, '45'); range.dispatchEvent(new Event('input', { bubbles: true }))`)
  await page.shot('image-diff-swipe')

  // Changes: unstaged and staged files, a diff with hunk buttons, the commit form.
  await page.run(`await click('.tabs button', 'Changes'); await click('.file-open', 'router.ts'); await waitFor('.diff-line'); await click('.diff-tools button', 'Unified')`)
  await page.shot('changes')

  // History rewriting from the graph's menu.
  await page.run(`await rightClick('.commit-row', 'Show a spinner')`)
  await page.shot('commit-menu')
  await page.run(`await escape()`)
  await page.run(`await rightClick('.commit-row', 'Refresh the logo')`)
  await page.run(`await click('.menu-item', 'Edit history from here')`)
  await page.run(`
    await waitFor('.rebase-row')
    const rows = [...document.querySelectorAll('.rebase-row')]
    const row = (text) => rows.find((r) => r.textContent.includes(text))
    await choose(row('Show a spinner').querySelector('select'), 'squash')
    await choose(row('Bump version').querySelector('select'), 'reword')
    const area = row('Bump version').querySelector('textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'Release 1.2.0 beta\\n\\nFirst build with the spinner and the design tokens.')
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await choose(row('Refresh the logo').querySelector('select'), 'drop')
  `)
  await page.shot('interactive-rebase')
  await page.run(`await closeModal()`)

  // Reset, with the three modes explained.
  await page.run(`await rightClick('.commit-row', 'Show a spinner'); await click('.menu-item', 'Reset main to here')`)
  await page.run(`await waitFor('.radio-card')`)
  await page.shot('reset')
  await page.run(`await closeModal()`)

  // Branches, tags, worktrees, submodules and stashes.
  await page.run(`await click('.tabs button', 'Branches'); const toggle = find('.section-toggle', 'Tags'); if (toggle.getAttribute('aria-expanded') === 'false') toggle.click(); await sleep(200)`)
  await page.run(`await rightClick('.branch-item', 'dark-mode')`)
  await page.shot('branches')
  await page.run(`await click('.menu-item', 'Compare with main')`)
  await page.run(`await waitFor('.compare-heading'); await sleep(500)`)
  await page.shot('compare')

  // A file's history and blame.
  await page.run(`await click('.tabs button', 'Changes'); await click('.file-open', 'router.ts'); await click('.diff-tools button', 'History')`)
  await page.run(`await waitFor('.history-item'); await click('.history-item', 'Cache rendered routes'); await waitFor('.inspector-diff .diff-line')`)
  await page.shot('file-history')
  await page.run(`await click('.inspector-tabs button', 'Blame'); await waitFor('.blame-group')`)
  await page.shot('blame')
  await page.run(`await closeModal()`)

  // Tags and the tag dialog.
  await page.run(`await rightClick('.commit-row', 'Handle expired sessions'); await click('.menu-item', 'Create tag here')`)
  await page.run(`const input = await waitFor('.modal input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'v1.2.0'); input.dispatchEvent(new Event('input', { bubbles: true })); const area = find('.modal textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'Sessions expire properly now'); area.dispatchEvent(new Event('input', { bubbles: true }))`)
  await page.shot('tag')
  await page.run(`await closeModal()`)

  // The Tools menu and the remotes.
  await page.run(`await click('.topbar button[aria-label=Tools]')`)
  await page.shot('tools-menu')
  await page.run(`await click('.menu-item', 'Git LFS')`)
  await page.run(`await waitFor('.modal .dialog-text', 'Large File Storage', 15000)`)
  await page.shot('lfs')
  await page.run(`await closeModal()`)
  await page.run(`await click('.topbar button[aria-label=Tools]'); await click('.menu-item', 'git-flow settings')`)
  await page.shot('git-flow')
  await page.run(`const cancel = find('.modal button', 'Cancel'); cancel.click(); await sleep(200)`)
  await page.run(`await click('.tabs button', 'Remotes')`)
  await page.shot('remotes')

  // Accounts and clone.
  await page.run(`await click('.topbar button', 'Accounts'); await waitFor('.modal')`)
  await page.shot('accounts')
  await page.run(`await closeModal(); await click('.topbar button[aria-label^="Repository"]'); await click('.menu-item', 'Clone repository')`)
  await page.run(`const input = await waitFor('.modal input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://github.com/lantern-labs/lantern-docs.git'); input.dispatchEvent(new Event('input', { bubbles: true }))`)
  await page.shot('clone')
  await page.run(`await closeModal()`)

  // Bisect in the second tab.
  await tab('lantern-api')
  await page.run(`await waitFor('.bisect-banner')`)
  await page.shot('bisect')

  // Settings and the command log.
  await tab('lantern-web')
  await page.run(`await click('.topbar button[aria-label=Settings]'); await waitFor('.settings-nav')`)
  await page.shot('settings')
  await page.run(`await click('.settings-nav button', 'AI')`)
  await page.shot('settings-ai')
  await page.run(`await click('.settings-nav button', 'Custom actions')`)
  await page.shot('settings-actions')
  await page.run(`await closeModal()`)
  await page.run(`await click('.tabs button', 'Changes'); await click('.changes-section button', 'Stage all'); await sleep(1200); await click('.changes-section button', 'Unstage all'); await sleep(1200)`)
  // The log reads the commands once a second; wait for a read after the last one finished.
  await page.run(`await click('.topbar button[aria-label=Tools]'); await click('.menu-item', 'Git command log'); await waitFor('.command-entry'); await sleep(1500)`)
  await page.shot('command-log')
  await page.run(`await closeModal()`)

  // The light theme.
  await page.run(`await window.api.settings.set({ theme: 'light' }); await sleep(600); await click('.commit-row', 'Merge branch')`)
  await page.shot('light-theme')
  await page.run(`await window.api.settings.set({ theme: 'system' })`)

  // Review mode, against the pretend GitHub: connect the account, open #7, comment on a line.
  const { server, shim } = await fakeGitHub(path.dirname(repos.web), repos.web)
  try {
    git(repos.web, ['remote', 'set-url', 'origin', 'git@localhost:lantern-labs/lantern-web.git'])
    git(repos.web, ['config', 'core.sshCommand', `sh '${shim}'`])
    await page.run(`await window.api.accounts.connect({ provider: 'github', host: 'localhost', token: 'demo-token' })`)
    await page.run(`await click('.tabs button', 'Changes'); await sleep(800); await click('.tabs button', 'PRs'); await waitFor('.pr-item', 'Dark theme', 15000)`)
    await page.shot('pull-requests')
    await page.run(`await click('.pr-actions button', 'Review'); await waitFor('.pr-review .file-open', 'styles.css', 20000); await click('.pr-review .file-open', 'styles.css'); await waitFor('.review-thread')`)
    await page.run(`
      const line = [...document.querySelectorAll('.pr-review .diff-line')].find((row) => row.textContent.includes('color: #e8e6e1'))
      line.querySelector('.gutter').click()
      await sleep(200)
      const area = await waitFor('.composer textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'Same for the text colour: the tokens call it --text.')
      area.dispatchEvent(new Event('input', { bubbles: true }))
      await click('.composer button', 'Add to review')
      const viewed = find('.pr-file-bar input[type=checkbox]')
      if (viewed && !viewed.checked) viewed.click()
      await sleep(300)
    `)
    await page.shot('pr-review')
    await page.run(`await click('.pr-review-head button', 'Finish review'); await waitFor('.radio-card'); await click('.radio-card', 'Approve'); const area = find('.modal textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'Lovely work. Two small colour notes, otherwise ready to go.'); area.dispatchEvent(new Event('input', { bubbles: true }))`)
    await page.shot('pr-review-submit')
    await page.run(`await closeModal()`)

    // Toasts: a real fetch and push, through the ssh stand-in to the demo remote.
    git(repos.web, ['remote', 'remove', 'gitlab'])
    await page.run(`
      await click('.pr-review-head button[aria-label="Back to the history"]')
      await click('.segmented button', 'Fetch')
      // Pointing at a toast keeps it, so the fetch's stays for the picture.
      ;(await waitFor('.toast', 'Fetched', 30000)).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      // The buttons wait for the refresh after the fetch, and the push's.
      const settled = async () => { for (let t = 0; t < 100 && find('.segmented button', 'Push').disabled; t++) await sleep(100) }
      await settled()
      await click('.segmented button', 'Push'); await waitFor('.toast', 'Pushed', 30000)
      await settled()
    `)
    await page.shot('toasts')
  } finally {
    server.close()
  }
}

async function main() {
  // node_modules/electron/path.txt names the binary inside its dist folder.
  const electronDir = path.join(root, 'node_modules', 'electron')
  const electron = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim())
  if (!fs.existsSync(path.join(root, 'out', 'main', 'index.js'))) throw new Error('Run `yarn build` first')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlantern-shots-'))
  console.log(`Demo repositories in ${base}`)
  const web = makeWeb(base)
  const apiRepo = makeApi(base)
  const userData = path.join(base, 'app-data')
  fs.mkdirSync(userData, { recursive: true })
  const settings = {
    recentRepos: [web, apiRepo, path.join(base, 'lantern-web-dark-mode')],
    user: {
      openTabs: [web, apiRepo],
      activeTab: web,
      conventionalCommits: true,
      issueLinks: [{ id: 'jira', name: 'Jira', pattern: '\\b(WEB-\\d+)\\b', url: 'https://lantern.atlassian.net/browse/$1', remoteContains: '' }],
      commitTemplates: [{ id: 'bug', name: 'Bug fix', text: 'Fix: \n\nCause:\n\nHow it was fixed:\n' }],
      customActions: [
        { id: 'tests', name: 'Run the tests', scope: 'repository', command: 'npm', args: ['test'], confirm: false },
        { id: 'deploy', name: 'Deploy this commit to staging', scope: 'commit', command: 'deploy', args: ['--commit', '${SHA}', '--env', 'staging'], confirm: true }
      ],
      workspaces: [{ id: 'lantern', name: 'Lantern', repos: [web, apiRepo] }]
    }
  }
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings, null, 2))
  fs.mkdirSync(out, { recursive: true })

  const app = spawn(electron, [path.join(root, 'out', 'main', 'index.js'), `--remote-debugging-port=${PORT}`], {
    // The pretend GitHub's certificate is self-signed (see fakeGitHub).
    env: { ...process.env, GITLANTERN_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '0', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    stdio: 'ignore'
  })
  try {
    const socket = new WebSocket(await connect())
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve)
      socket.addEventListener('error', reject)
    })
    const page = new Page(socket)
    await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await page.send('Runtime.enable')
    await scenes(page, { web, api: apiRepo })
    if (page.problems.length > 0) {
      console.log(`\nThe page reported ${page.problems.length} error(s):`)
      for (const problem of page.problems) console.log(`  ${problem.split('\n')[0]}`)
    }
    socket.close()
  } finally {
    app.kill()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
