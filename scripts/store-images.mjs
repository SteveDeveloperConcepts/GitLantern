// The images for the store listings: `yarn build && yarn screenshots --store && yarn store-images`.
//
// Frames the screenshots in dist/store/screens with a headline, at the sizes each store takes, and draws
// the Microsoft Store's logos from build/icon.png. Writes dist/store/mac-app-store/ and
// dist/store/microsoft-store/. It runs in Electron (an Electron main script, not Node), which lays each
// image out as a web page and saves it as a PNG. docs/STORE-LISTING.md has the text that goes with them.
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const store = path.join(root, 'dist', 'store')
const screens = path.join(store, 'screens')
const icon = pathToFileURL(path.join(root, 'build', 'icon.png')).href

// Each store's screenshots, in the order they're shown. The Mac set leaves out the Git services dialog,
// whose SSH key section is different in the App Store version.
const shared = [
  ['commit-details', 'Your history, clear at a glance', 'A colour-coded graph of every branch, merge and tag, with diffs side by side.'],
  ['pr-review', 'Review pull requests in the app', 'Comment on lines, tick off files and approve, without leaving your history.'],
  ['changes', 'Commit exactly what you mean', 'Stage single lines or hunks, amend, stash, and let AI draft the message.'],
  ['interactive-rebase', 'Tidy up history before you push', 'Reorder, squash, reword and drop commits in one dialog.'],
  ['branches', 'Branches, tags and the rest', 'Worktrees, submodules, stashes and Git LFS, a right-click away.'],
  ['blame', 'Who changed this line, and why', 'Each line with the commit, author and age that last changed it.'],
  ['image-diff-swipe', 'See what changed in images', 'Side by side, swipe or blend between the old and new version.'],
  ['bisect', 'Find the commit that broke it', 'Mark commits good or bad, and bisect names the one to blame.'],
  ['light-theme', 'Light, dark or your own colours', 'Pick a theme, an accent colour and the interface size.']
]
const mac = [...shared, ['file-history', 'Every change to a file', 'Its whole history, followed across renames, with the diff of each commit.']]
const microsoft = [...shared, ['accounts', 'Works with any Git service', 'GitHub, GitLab, Bitbucket, Azure DevOps, Gitea or your own server.']]

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const BASE = `
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    position: relative;
    font-family: -apple-system, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif;
    color: #f4f1ea;
    background:
      radial-gradient(ellipse 60% 55% at 50% -8%, rgba(244, 186, 88, 0.30), transparent 70%),
      radial-gradient(ellipse 50% 60% at 100% 100%, rgba(106, 169, 255, 0.10), transparent 70%),
      linear-gradient(180deg, #2e3036, #16171a);
  }
  h1 { font-weight: 700; letter-spacing: -0.02em; line-height: 1.08; }
  p { color: #c9c6bf; line-height: 1.3; }
  .window { position: absolute; overflow: hidden; background: #141518; border: 2px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 40px 120px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.5); }
  .window img.shot { display: block; width: 100%; }
  .bar { display: flex; align-items: center; background: #1f2024; border-bottom: 2px solid rgba(255, 255, 255, 0.06); }
`

// A macOS window's title bar: the three traffic lights.
const macBar = (height) => {
  const dot = Math.round(height * 0.36)
  const lights = ['#ff5f57', '#febc2e', '#28c840']
    .map((colour) => `<span style="width:${dot}px;height:${dot}px;border-radius:50%;background:${colour};margin-right:${Math.round(dot * 0.65)}px"></span>`)
    .join('')
  return `<div class="bar" style="height:${height}px;padding-left:${Math.round(height * 0.42)}px">${lights}</div>`
}

// A Windows window's title bar: the app's name, and minimise, maximise and close.
const windowsBar = (height) => {
  const size = Math.round(height * 0.34)
  const stroke = Math.max(2, Math.round(height / 40))
  const control = (svg) => `<span style="width:${Math.round(height * 1.5)}px;display:flex;justify-content:center"><svg width="${size}" height="${size}" viewBox="0 0 10 10" fill="none" stroke="#c9c6bf" stroke-width="${(stroke * 10) / size}">${svg}</svg></span>`
  return `<div class="bar" style="height:${height}px;padding-left:${Math.round(height * 0.4)}px">
    <img src="${icon}" style="width:${Math.round(height * 0.62)}px;height:${Math.round(height * 0.62)}px;margin-right:${Math.round(height * 0.25)}px">
    <span style="font-size:${Math.round(height * 0.36)}px;color:#c9c6bf;flex:1">GitLantern</span>
    ${control('<path d="M1 5h8"/>')}${control('<rect x="1" y="1" width="8" height="8"/>')}${control('<path d="M1 1l8 8M9 1l-8 8"/>')}
  </div>`
}

/** Mac App Store, 2880×1800: the headline on top, the window below it running off the bottom. */
function macPage([name, title, text]) {
  const shot = pathToFileURL(path.join(screens, `${name}.png`)).href
  return {
    width: 2880,
    height: 1800,
    html: `<style>${BASE}
      .text { position: absolute; top: 118px; left: 0; right: 0; text-align: center; }
      h1 { font-size: 112px; }
      p { font-size: 54px; margin-top: 26px; }
      .window { left: 290px; top: 450px; width: 2300px; border-radius: 26px; }
    </style>
    <div class="text"><h1>${escape(title)}</h1><p>${escape(text)}</p></div>
    <div class="window">${macBar(62)}<img class="shot" src="${shot}"></div>`
  }
}

/** Microsoft Store, 3840×2160: the headline on the left, the window on the right. */
function microsoftPage([name, title, text]) {
  const shot = pathToFileURL(path.join(screens, `${name}.png`)).href
  return {
    width: 3840,
    height: 2160,
    html: `<style>${BASE}
      body { background:
        radial-gradient(ellipse 45% 70% at 0% 50%, rgba(244, 186, 88, 0.24), transparent 70%),
        radial-gradient(ellipse 50% 60% at 100% 100%, rgba(106, 169, 255, 0.10), transparent 70%),
        linear-gradient(180deg, #2e3036, #16171a); }
      .text { position: absolute; left: 160px; width: 880px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
      h1 { font-size: 124px; }
      p { font-size: 60px; margin-top: 44px; }
      .window { left: 1140px; top: 240px; width: 2560px; border-radius: 22px; }
    </style>
    <div class="text"><h1>${escape(title)}</h1><p>${escape(text)}</p></div>
    <div class="window">${windowsBar(78)}<img class="shot" src="${shot}"></div>`
  }
}

/** The Microsoft Store's logos: box art (1:1) and poster art (2:3) with the name, hero art (16:9) without text. */
function logoPages() {
  const wordmark = (size) => `<div style="font-size:${size}px;font-weight:700;letter-spacing:-0.02em">GitLantern</div>`
  const glow = 'radial-gradient(circle at 50% 42%, rgba(244, 186, 88, 0.32), transparent 55%), linear-gradient(180deg, #2e3036, #16171a)'
  const centred = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center'
  const hero = pathToFileURL(path.join(screens, 'commit-details.png')).href
  return {
    'box-art': {
      width: 2160,
      height: 2160,
      html: `<style>${BASE} body { background: ${glow}; }</style>
        <div style="${centred}"><img src="${icon}" style="width:1240px;margin-bottom:10px">${wordmark(200)}</div>`
    },
    'poster-art': {
      width: 1440,
      height: 2160,
      html: `<style>${BASE} body { background: ${glow}; }</style>
        <div style="${centred}">
          <img src="${icon}" style="width:1080px">
          ${wordmark(170)}
          <p style="font-size:72px;margin-top:36px;text-align:center">A friendly Git client</p>
        </div>`
    },
    // The Store puts the name over the bottom left, so that part stays plain.
    'hero-art': {
      width: 3840,
      height: 2160,
      html: `<style>${BASE}
          body { background: radial-gradient(ellipse 55% 60% at 72% 30%, rgba(244, 186, 88, 0.30), transparent 70%), linear-gradient(160deg, #2e3036, #121316); perspective: 4200px; }
          .window { left: 1500px; top: 230px; width: 2900px; border-radius: 26px; transform: rotateY(-16deg) rotateX(6deg); transform-origin: left center; }
        </style>
        <div class="window">${windowsBar(80)}<img class="shot" src="${hero}"></div>
        <img src="${icon}" style="position:absolute;left:330px;top:250px;width:900px">`
    }
  }
}

async function capture(win, page, file) {
  const url = pathToFileURL(path.join(store, '.page.html')).href
  fs.writeFileSync(fileURLToPath(url), `<!doctype html><meta charset="utf-8">${page.html}`)
  win.setContentSize(page.width, page.height)
  await win.loadURL(url)
  const debug = win.webContents.debugger
  await debug.sendCommand('Emulation.setDeviceMetricsOverride', { width: page.width, height: page.height, deviceScaleFactor: 1, mobile: false })
  // Wait for the screenshot and icon to be decoded before taking the picture.
  await win.webContents.executeJavaScript('Promise.all([...document.images].map((img) => img.decode())).then(() => document.fonts.ready)')
  const { data } = await debug.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: page.width, height: page.height, scale: 1 } })
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`  ${path.relative(root, file)}`)
}

app.dock?.hide()
app.whenReady().then(async () => {
  try {
    const missing = [...mac, ...microsoft].map(([name]) => name).filter((name) => !fs.existsSync(path.join(screens, `${name}.png`)))
    if (missing.length > 0) throw new Error(`Missing from dist/store/screens: ${[...new Set(missing)].join(', ')}. Run \`yarn screenshots --store\` first.`)
    // Offscreen, so the hidden window still draws: on Windows Page.captureScreenshot otherwise waits forever
    // for a frame that never comes.
    const win = new BrowserWindow({ show: false, enableLargerThanScreen: true, useContentSize: true, width: 1200, height: 800, webPreferences: { offscreen: true } })
    win.webContents.debugger.attach()
    const sets = [
      ['mac-app-store', mac, macPage],
      ['microsoft-store', microsoft, microsoftPage]
    ]
    for (const [folder, scenes, layout] of sets) {
      fs.rmSync(path.join(store, folder), { recursive: true, force: true })
      fs.mkdirSync(path.join(store, folder), { recursive: true })
      for (const [index, scene] of scenes.entries()) {
        await capture(win, layout(scene), path.join(store, folder, `${String(index + 1).padStart(2, '0')}-${scene[0]}.png`))
      }
    }
    for (const [name, page] of Object.entries(logoPages())) await capture(win, page, path.join(store, 'microsoft-store', `${name}.png`))
    fs.rmSync(path.join(store, '.page.html'), { force: true })
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
  app.quit()
})
