import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CustomAction, CustomActionContext, CustomActionResult, DiffTarget, ExternalTool } from '../shared/types'
import { assertHash, assertRevision, insideRepo, LITERAL_PATHS, parentsOf, withOrigPath } from './git/commands'
import { resolveGitPath } from './git/resolveGit'
import { gitExecutable, GitError, runGit } from './git/runGit'

/** A detected editor or terminal, and how to start it. */
export interface LaunchableTool extends ExternalTool {
  /** The program: an absolute path (or /usr/bin/open for a macOS app). */
  command: string
  /** Its arguments for the repository folder and, for editors, a file in it (relative to `dir`). */
  args(dir: string, file?: string): string[]
  /** Extra environment variables for it. */
  env?: Record<string, string>
  /**
   * Windows: pass the arguments as they are, without Node's quoting. Only for `cmd /c start`, whose
   * arguments are fixed text and a detected program's path, never anything from the repository.
   */
  verbatim?: boolean
}

export interface DetectedTools {
  editors: LaunchableTool[]
  terminals: LaunchableTool[]
}

const OPEN = '/usr/bin/open'

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch (error) {
    // App execution aliases (WindowsApps\wt.exe) can't be stat'ed, but they exist and they run.
    if ((error as NodeJS.ErrnoException).code !== 'EACCES') return false
    try {
      return fs.lstatSync(file).isSymbolicLink()
    } catch {
      return false
    }
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function isExecutable(file: string): boolean {
  if (!isFile(file)) return false
  if (process.platform === 'win32') return true
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The first program called `name` in PATH (then `extraDirs`), on Windows trying each PATHEXT extension in turn. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, extraDirs: string[] = []): string | null {
  const dirs = [...(env.PATH ?? env.Path ?? '').split(path.delimiter), ...extraDirs]
    .map((dir) => dir.replace(/^"(.*)"$/, '$1'))
    // A relative entry would find programs in whatever folder GitLantern happens to run in.
    .filter((dir) => path.isAbsolute(dir))
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension.toLowerCase())
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

/** Opens the folder and, when given, a file in it: what most editors' command lines take. */
const openFolder = (dir: string, file?: string): string[] => (file ? [dir, path.join(dir, file)] : [dir])

/** `open -a App folder [file]`: hands the folder (and file) to a macOS app. */
const openWith =
  (app: string) =>
  (dir: string, file?: string): string[] => ['-a', app, dir, ...(file ? [path.join(dir, file)] : [])]

/** Per-user installs go to %LOCALAPPDATA%\Programs, the others to Program Files. */
function windowsRoots(): string[] {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  return [path.join(local, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((dir): dir is string => !!dir)
}

/** A program in the folder of `file` or one of the few above it: VS Code's bin\code.cmd runs ..\Code.exe. */
function exeNear(file: string, names: string[], levels: number): string | null {
  let dir = path.dirname(file)
  for (let depth = 0; depth < levels; depth++) {
    const found = names.map((name) => path.join(dir, name)).find(isFile)
    if (found) return found
    dir = path.dirname(dir)
  }
  return null
}

function macApp(name: string): string | null {
  const folders = ['/Applications', path.join(os.homedir(), 'Applications')]
  const candidates = path.isAbsolute(name) ? [name] : folders.map((dir) => path.join(dir, name))
  return candidates.find(isDirectory) ?? null
}

interface EditorSpec {
  id: string
  name: string
  /** Its command-line names, looked up in PATH. */
  cli: string[]
  /** Windows: the program itself, installed in one of these folders of %LOCALAPPDATA%\Programs or Program Files. */
  exe: string[]
  folders: string[]
  /** macOS: the app, and the command-line tool inside it (which opens a folder and a file in one window). */
  app: string
  appCli: string[]
}

const VSCODE_BIN = 'Contents/Resources/app/bin'

const EDITORS: EditorSpec[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    cli: ['code'],
    exe: ['Code.exe'],
    folders: ['Microsoft VS Code'],
    app: 'Visual Studio Code.app',
    appCli: [`${VSCODE_BIN}/code`]
  },
  {
    id: 'vscode-insiders',
    name: 'Visual Studio Code - Insiders',
    cli: ['code-insiders'],
    exe: ['Code - Insiders.exe'],
    folders: ['Microsoft VS Code Insiders'],
    app: 'Visual Studio Code - Insiders.app',
    appCli: [`${VSCODE_BIN}/code`, `${VSCODE_BIN}/code-insiders`]
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    cli: ['codium'],
    exe: ['VSCodium.exe'],
    folders: ['VSCodium'],
    app: 'VSCodium.app',
    appCli: [`${VSCODE_BIN}/codium`]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    cli: ['cursor'],
    exe: ['Cursor.exe'],
    folders: ['cursor'],
    app: 'Cursor.app',
    appCli: [`${VSCODE_BIN}/cursor`, `${VSCODE_BIN}/code`]
  },
  { id: 'zed', name: 'Zed', cli: ['zed', 'zeditor'], exe: ['Zed.exe'], folders: ['Zed'], app: 'Zed.app', appCli: ['Contents/MacOS/cli'] },
  {
    id: 'sublime',
    name: 'Sublime Text',
    cli: ['subl'],
    exe: ['subl.exe', 'sublime_text.exe'],
    folders: ['Sublime Text', 'Sublime Text 3'],
    app: 'Sublime Text.app',
    appCli: ['Contents/SharedSupport/bin/subl']
  }
]

const LINUX_DIRS = ['/usr/local/bin', '/usr/bin', '/snap/bin', path.join(os.homedir(), '.local', 'bin')]

function editorTool(spec: EditorSpec): LaunchableTool | null {
  const tool = { id: spec.id, name: spec.name }
  if (process.platform === 'win32') {
    for (const name of spec.cli) {
      const found = findOnPath(name)
      if (found && /\.(exe|com)$/i.test(found)) return { ...tool, command: found, args: openFolder }
      // Node won't start a .cmd without a shell, so run the program the .cmd runs.
      const exe = found && exeNear(found, spec.exe, 4)
      if (exe) return { ...tool, command: exe, args: openFolder }
    }
    const installed = windowsRoots()
      .flatMap((root) => spec.folders.flatMap((folder) => spec.exe.map((exe) => path.join(root, folder, exe))))
      .find(isFile)
    return installed ? { ...tool, command: installed, args: openFolder } : null
  }
  if (process.platform === 'darwin') {
    const app = macApp(spec.app)
    if (!app) return null
    const cli = spec.appCli.map((file) => path.join(app, file)).find(isExecutable)
    return cli ? { ...tool, command: cli, args: openFolder } : { ...tool, command: OPEN, args: openWith(app) }
  }
  // ZFS has a daemon called zed in sbin; editors never live there.
  const env = { PATH: (process.env.PATH ?? '').split(':').filter((dir) => !/\/sbin\/?$/.test(dir)).join(':') }
  const command = spec.cli.map((name) => findOnPath(name, env, LINUX_DIRS)).find((found) => found !== null)
  return command ? { ...tool, command, args: openFolder } : null
}

/** Visual Studio itself (not just its Build Tools), found by the installer's vswhere. */
function visualStudio(): Promise<LaunchableTool | null> {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!isFile(vswhere)) return Promise.resolve(null)
  // The core editor component is what the IDE has and Build Tools don't.
  const editor = ['-requires', 'Microsoft.VisualStudio.Component.CoreEditor']
  const args = ['-latest', '-products', '*', ...editor, '-format', 'json', '-utf8', '-nologo']
  return new Promise((resolve) => {
    execFile(vswhere, args, { timeout: 15_000, windowsHide: true }, (error, stdout) => {
      try {
        const [instance] = error ? [] : (JSON.parse(stdout) as Array<{ productPath?: unknown; displayName?: unknown }>)
        const devenv = typeof instance?.productPath === 'string' ? instance.productPath : ''
        if (!/devenv\.exe$/i.test(devenv) || !isFile(devenv)) return resolve(null)
        const name = typeof instance?.displayName === 'string' && instance.displayName ? instance.displayName : 'Visual Studio'
        // A folder opens as a folder; a single file opens in the running Visual Studio.
        resolve({ id: 'visual-studio', name, command: devenv, args: (dir, file) => (file ? ['/Edit', path.join(dir, file)] : [dir]) })
      } catch {
        resolve(null)
      }
    })
  })
}

const JETBRAINS: Record<string, string> = {
  idea: 'IntelliJ IDEA',
  pycharm: 'PyCharm',
  webstorm: 'WebStorm',
  phpstorm: 'PhpStorm',
  goland: 'GoLand',
  rider: 'Rider',
  clion: 'CLion',
  rubymine: 'RubyMine',
  datagrip: 'DataGrip',
  rustrover: 'RustRover',
  dataspell: 'DataSpell',
  aqua: 'Aqua',
  studio: 'Android Studio',
  fleet: 'Fleet',
  writerside: 'Writerside'
}

/** Where JetBrains Toolbox keeps its launch scripts: the folder set in its settings, or its default one. */
function toolboxScripts(): string {
  const home = os.homedir()
  const toolbox =
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'JetBrains', 'Toolbox')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox')
        : path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'JetBrains', 'Toolbox')
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(toolbox, '.settings.json'), 'utf8')) as { shell_scripts?: { location?: unknown } }
    const location = settings.shell_scripts?.location
    if (typeof location === 'string' && path.isAbsolute(location)) return location
  } catch {
    // No settings file: the default folder.
  }
  return path.join(toolbox, 'scripts')
}

/** The program a Toolbox .cmd script starts, e.g. `start "" "C:\…\bin\idea64.exe" %*`. */
function exeInScript(file: string): string | null {
  try {
    for (const [, exe] of fs.readFileSync(file, 'utf8').matchAll(/"([^"]+\.exe)"/gi)) {
      if (exe && path.isAbsolute(exe) && isFile(exe)) return exe
    }
  } catch {
    // Unreadable: skip it.
  }
  return null
}

/** IDEs installed with JetBrains Toolbox, one per launch script (idea, webstorm, idea1 for a second IntelliJ…). */
function jetBrainsTools(): LaunchableTool[] {
  const folder = toolboxScripts()
  let files: string[]
  try {
    files = fs.readdirSync(folder).sort()
  } catch {
    return []
  }
  return files.flatMap((file) => {
    const script = process.platform === 'win32' ? /^(.+)\.cmd$/i.exec(file)?.[1] : file.includes('.') ? undefined : file
    if (!script) return []
    const full = path.join(folder, file)
    // Windows' scripts are .cmd files, which Node can't start without a shell: run the IDE's .exe they name.
    const command = process.platform === 'win32' ? exeInScript(full) : isExecutable(full) ? full : null
    if (!command) return []
    const base = script.replace(/\d+$/, '')
    const known = JETBRAINS[base.toLowerCase()]
    const name = known ? (base === script ? known : `${known} (${script})`) : `JetBrains ${script}`
    return [{ id: `jetbrains-${script.toLowerCase()}`, name, command, args: openFolder }]
  })
}

function notepadPlusPlus(): LaunchableTool | null {
  const exe = windowsRoots()
    .map((root) => path.join(root, 'Notepad++', 'notepad++.exe'))
    .find(isFile)
  return exe
    ? {
        id: 'notepad-plus-plus',
        name: 'Notepad++',
        command: exe,
        args: (dir, file) => (file ? [path.join(dir, file)] : ['-openFoldersAsWorkspace', dir])
      }
    : null
}

/**
 * A console program in a window of its own. Node starts detached programs without a console, so
 * `cmd /c start` opens one for it. That command line is fixed text plus the program's detected path:
 * the repository is only the working directory, so nothing in its name (&, ^, %, spaces) reaches cmd.
 * (cmd can't start in a \\server\share folder; it falls back to the Windows folder there.)
 */
function consoleTool(id: string, name: string, cmd: string, program: string): LaunchableTool | null {
  // The path goes to cmd as written: a quote would end it early and a % would be expanded.
  if (/["%]/.test(program)) return null
  return { id, name, command: cmd, args: () => ['/d', '/c', 'start', '""', `"${program}"`], verbatim: true }
}

function windowsTerminals(gitPath: string): LaunchableTool[] {
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  const cmd = path.join(system32, 'cmd.exe')
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  const exe = (...candidates: Array<string | null | undefined>): string | undefined =>
    candidates.find((candidate): candidate is string => !!candidate && /\.exe$/i.test(candidate) && isFile(candidate))

  const tools: Array<LaunchableTool | null> = []
  const wt = exe(findOnPath('wt'), path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe'))
  // `-d .` is the working directory, so the folder's name never goes through wt's own parsing (which splits on ;).
  if (wt) tools.push({ id: 'windows-terminal', name: 'Windows Terminal', command: wt, args: () => ['-d', '.'] })
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pwsh = exe(findOnPath('pwsh'), path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
  if (pwsh) tools.push(consoleTool('pwsh', 'PowerShell', cmd, pwsh))
  const powershell = exe(path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  if (powershell) tools.push(consoleTool('powershell', 'Windows PowerShell', cmd, powershell))
  // Git Bash belongs to the Git that GitLantern runs: git-bash.exe is in the Git folder above cmd\git.exe or mingw64\bin\git.exe.
  const nextToGit = path.isAbsolute(gitPath) ? exeNear(gitPath, ['git-bash.exe'], 3) : null
  const bash = exe(nextToGit, path.join(programFiles, 'Git', 'git-bash.exe'))
  // It starts in its working directory; CHERE_INVOKING keeps a login shell from moving to the home folder.
  if (bash) tools.push({ id: 'git-bash', name: 'Git Bash', command: bash, args: () => [], env: { CHERE_INVOKING: '1' } })
  if (isFile(cmd)) tools.push(consoleTool('cmd', 'Command Prompt', cmd, cmd))
  return tools.filter((tool): tool is LaunchableTool => tool !== null)
}

const MAC_TERMINALS: Array<[id: string, name: string, apps: string[]]> = [
  ['terminal', 'Terminal', ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app']],
  ['iterm', 'iTerm', ['iTerm.app']],
  ['warp', 'Warp', ['Warp.app']],
  ['ghostty', 'Ghostty', ['Ghostty.app']]
]

function macTerminals(): LaunchableTool[] {
  return MAC_TERMINALS.flatMap(([id, name, apps]) => {
    const app = apps.map(macApp).find((found) => found !== null)
    // Each of them opens a new window in a folder it's handed.
    return app ? [{ id, name, command: OPEN, args: (dir: string) => ['-a', app, dir] }] : []
  })
}

/** Linux terminals and how each is told its starting folder. All of them also start in their working directory. */
const LINUX_TERMINALS: Array<[id: string, name: string, args: (dir: string) => string[]]> = [
  ['gnome-terminal', 'GNOME Terminal', (dir) => [`--working-directory=${dir}`]],
  ['ptyxis', 'Ptyxis', (dir) => ['--new-window', `--working-directory=${dir}`]],
  ['konsole', 'Konsole', (dir) => ['--workdir', dir]],
  ['xfce4-terminal', 'Xfce Terminal', (dir) => [`--working-directory=${dir}`]],
  ['kitty', 'kitty', (dir) => ['--directory', dir]],
  ['alacritty', 'Alacritty', (dir) => ['--working-directory', dir]],
  ['wezterm', 'WezTerm', (dir) => ['start', '--cwd', dir]],
  ['x-terminal-emulator', 'Default terminal', () => []]
]

function linuxTerminals(): LaunchableTool[] {
  return LINUX_TERMINALS.flatMap(([id, name, args]) => {
    const command = findOnPath(id, process.env, LINUX_DIRS)
    return command ? [{ id, name, command, args }] : []
  })
}

/** The editors and terminals installed on this computer, the usual choice first. */
export async function findTools(gitPath = resolveGitPath()): Promise<DetectedTools> {
  const platform = process.platform
  const editors = EDITORS.map(editorTool)
  if (platform === 'win32') editors.push(await visualStudio())
  editors.push(...jetBrainsTools())
  if (platform === 'win32') editors.push(notepadPlusPlus())
  const xcode = platform === 'darwin' ? macApp('Xcode.app') : null
  if (xcode) editors.push({ id: 'xcode', name: 'Xcode', command: OPEN, args: openWith(xcode) })
  const terminals = platform === 'win32' ? windowsTerminals(gitPath) : platform === 'darwin' ? macTerminals() : linuxTerminals()
  return { editors: editors.filter((tool): tool is LaunchableTool => tool !== null), terminals }
}

/** GitLantern's environment without Electron's own variables, which would confuse other Electron apps such as VS Code. */
function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('ELECTRON_')))
  return { ...env, ...extra }
}

/** Start an editor or terminal on a repository folder (and a file in it), detached so it outlives GitLantern. */
export function launch(tool: LaunchableTool, dir: string, file?: string): void {
  if (file) insideRepo(dir, file)
  if (path.isAbsolute(tool.command) && !isFile(tool.command)) {
    throw new Error(`${tool.name} isn’t at ${tool.command} any more. Restart GitLantern to look for it again.`)
  }
  // No shell: every argument reaches the program as it is, whatever characters the path has.
  const child = spawn(tool.command, tool.args(dir, file), {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
    env: childEnv(tool.env),
    windowsVerbatimArguments: tool.verbatim === true
  })
  child.on('error', (error) => console.error(`Couldn’t start ${tool.name}:`, error.message))
  child.unref()
}

export interface ActionVariables {
  REPO: string
  SHA?: string
  BRANCH?: string
  FILE?: string
}

const VARIABLES = new Set(['REPO', 'SHA', 'BRANCH', 'FILE'])

/** Fill in ${REPO}, ${SHA}, ${BRANCH} and ${FILE} in each argument; unknown or missing ones become empty. */
export function expandArgs(args: string[], vars: ActionVariables): string[] {
  const value = (name: string): string => (VARIABLES.has(name) ? (vars[name as keyof ActionVariables] ?? '') : '')
  return args.map((arg) => arg.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => value(name)))
}

const ACTION_OUTPUT_LIMIT = 64 * 1024
const ACTION_TIMEOUT_MS = 10 * 60 * 1000

function cannotStart(command: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return `Couldn’t find the program “${command}”. Check the action in Settings, or give the program’s full path.`
  if (code === 'EINVAL' && /\.(cmd|bat)$/i.test(command)) {
    return `Windows can’t start “${command}” directly. Use the program it runs (an .exe) as the command instead.`
  }
  return `Couldn’t start “${command}”: ${(error as Error).message}`
}

/**
 * The program a custom action runs, as a full path, or null when it can't be found. A bare name like
 * `git` is looked up on PATH only: a plain spawn on Windows would try the working folder (the
 * repository) first, so a cloned repository could ship its own git.exe. A path with a folder in it
 * (`scripts/deploy.ps1`) is the repository's own file on purpose, and is taken from the repository.
 */
export function resolveProgram(command: string, repo: string): string | null {
  const name = command.trim()
  if (!name) return null
  if (path.isAbsolute(name)) return name
  if (/[\\/]/.test(name)) return path.resolve(repo, name)
  // git is the one GitLantern itself runs, wherever that is.
  const git = gitExecutable()
  const found = name.toLowerCase() === 'git' && path.isAbsolute(git) ? git : findOnPath(name)
  if (!found) return null
  const relative = path.relative(repo, found)
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return null
  return found
}

/** Run a custom action in the repository with its placeholders filled in, and collect what it prints. */
export async function runCustomAction(action: CustomAction, repo: string, context: CustomActionContext): Promise<CustomActionResult> {
  if (context.file) {
    try {
      insideRepo(repo, context.file)
    } catch {
      throw new Error(`“${context.file}” isn’t inside the repository, so the action wasn’t run.`)
    }
  }
  if (context.sha) assertHash(context.sha)
  if (context.branch) assertRevision(context.branch)
  if (!action.command.trim()) return { exitCode: null, output: 'This action has no program to run. Add one in Settings.' }
  const program = resolveProgram(action.command, repo)
  if (!program) {
    return {
      exitCode: null,
      output: `Couldn’t find the program “${action.command}” on your PATH. Check the action in Settings, or give the program’s full path.`
    }
  }
  const args = expandArgs(action.args, { REPO: repo, SHA: context.sha, BRANCH: context.branch, FILE: context.file })

  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let cut = false
    let timedOut = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(program, args, {
        cwd: repo,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv()
      })
    } catch (error) {
      // Windows refuses .cmd and .bat files right away.
      resolve({ exitCode: null, output: cannotStart(action.command, error) })
      return
    }
    const collect = (chunk: Buffer): void => {
      if (size >= ACTION_OUTPUT_LIMIT) {
        cut = true
        return
      }
      const room = ACTION_OUTPUT_LIMIT - size
      if (chunk.length > room) cut = true
      chunks.push(chunk.subarray(0, room))
      size += Math.min(chunk.length, room)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, ACTION_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, output: cannotStart(action.command, error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      let output = Buffer.concat(chunks).toString('utf8')
      const note = (text: string): void => void (output += `${output && !output.endsWith('\n') ? '\n' : ''}${text}`)
      if (cut) note('… output cut off at 64 KB')
      if (timedOut) note('Stopped after 10 minutes.')
      resolve({ exitCode: timedOut ? null : code, output })
    })
  })
}

const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function toolArgs(tool: string): string[] {
  if (!tool) return []
  if (!TOOL_NAME.test(tool)) throw new Error(`“${tool}” isn’t a tool name Git would know. Use a name like meld, bc or vscode.`)
  return [`--tool=${tool}`]
}

/**
 * `git difftool` arguments for one file of a diff. `base` is what a commit is compared with (its
 * parent, or the empty tree for a first commit), and the empty tree for a stash's untracked file.
 */
export function difftoolArgs(target: DiffTarget, tool: string, base?: string): string[] {
  const start = ['difftool', '--no-prompt', ...toolArgs(tool)]
  const baseRef = (): string => {
    if (!base) throw new Error('Nothing to compare this file with')
    assertHash(base)
    return base
  }
  switch (target.kind) {
    case 'worktree':
      if (target.untracked) {
        throw new Error('This file is new and not tracked yet, so there’s nothing to compare it with. Open it in your editor instead.')
      }
      if (target.conflicted) throw new Error('This file has conflicts. Open it in the merge tool instead.')
      return [...start, '--', target.path]
    case 'index':
      return [...start, '--cached', '--', target.path]
    case 'commit':
      assertHash(target.hash)
      return [...start, '-M', baseRef(), target.hash, '--', ...withOrigPath(target)]
    case 'stash':
      assertHash(target.hash)
      // A stash's untracked files are in its third parent, all of them new.
      return target.untracked
        ? [...start, baseRef(), `${target.hash}^3`, '--', target.path]
        : [...start, `${target.hash}^1`, target.hash, '--', target.path]
    case 'range':
      assertRevision(target.from)
      assertRevision(target.to)
      return [...start, '-M', target.from, target.to, '--', ...withOrigPath(target)]
  }
}

/** The empty tree's hash, which git knows without storing it (it depends on the repository's hash format). */
async function emptyTree(repo: string): Promise<string> {
  return (await runGit(['hash-object', '-t', 'tree', '--stdin'], { cwd: repo, stdin: '' })).stdout.trim()
}

const noToolMessage = (kind: 'diff' | 'merge'): string =>
  `No ${kind} tool is set up. Pick one in Settings → Tools, or set one with: git config --global ${kind}.tool <name>`

/**
 * Without a tool in its config, git guesses one and may pick vimdiff, which would wait for a
 * terminal GitLantern doesn't have. So ask for one to be set up instead.
 */
async function requireConfiguredTool(repo: string, kind: 'diff' | 'merge'): Promise<void> {
  // difftool falls back to merge.tool.
  for (const key of kind === 'diff' ? ['diff.tool', 'merge.tool'] : ['merge.tool']) {
    const { stdout } = await runGit(['config', '--get', key], { cwd: repo, allowedExitCodes: [0, 1] })
    if (stdout.trim()) return
  }
  throw new Error(noToolMessage(kind))
}

/** Plain words for git's complaints about diff and merge tools. */
function toolError(error: unknown, kind: 'diff' | 'merge'): unknown {
  if (!(error instanceof GitError)) return error
  const text = error.stderr || error.message
  const unknown = /not set for tool '([^']+)'/.exec(text)
  if (unknown) {
    return new Error(
      `Git doesn’t know a ${kind} tool called “${unknown[1]}”. Pick one that git ${kind}tool --tool-help lists, in Settings → Tools, ` +
        `or set ${kind}tool.${unknown[1]}.cmd in your Git config.`
    )
  }
  const missing = /The (?:diff|merge) tool (\S+) is not available as '([^']*)'/.exec(text)
  if (missing) {
    return new Error(
      `The ${kind} tool “${missing[1]}” isn’t installed, or Git can’t find “${missing[2]}”. ` +
        `Install it, or set ${kind}tool.${missing[1]}.path in your Git config.`
    )
  }
  if (/No known (?:diff|merge) tool is available/i.test(text)) return new Error(noToolMessage(kind))
  return new Error(text.replace(/^fatal: external diff died.*$/m, '').trim() || error.message)
}

/** Open one file of a diff in the user's diff tool (`git difftool`); resolves once the tool is closed. */
export async function diffTool(repo: string, target: DiffTarget, tool: string): Promise<void> {
  let base: string | undefined
  if (target.kind === 'commit') {
    assertHash(target.hash)
    base = (await parentsOf(repo, target.hash))[0] ?? (await emptyTree(repo))
  } else if (target.kind === 'stash' && target.untracked) {
    base = await emptyTree(repo)
  }
  const args = difftoolArgs(target, tool, base)
  if (!tool) await requireConfiguredTool(repo, 'diff')
  try {
    await runGit(args, { cwd: repo, env: LITERAL_PATHS })
  } catch (error) {
    throw toolError(error, 'diff')
  }
}

/** Resolve a conflicted file in the user's merge tool (`git mergetool`); resolves once the tool is closed. */
export async function mergeTool(repo: string, file: string, tool: string): Promise<void> {
  insideRepo(repo, file)
  const args = ['mergetool', '--no-prompt', ...toolArgs(tool), '--', file]
  if (!tool) await requireConfiguredTool(repo, 'merge')
  let stdout: string
  try {
    stdout = (await runGit(args, { cwd: repo, env: LITERAL_PATHS })).stdout
  } catch (error) {
    throw toolError(error, 'merge')
  }
  if (/No files need merging/i.test(stdout)) throw new Error('This file has no conflicts left to merge.')
}
