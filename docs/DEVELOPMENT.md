# Developing Git Steve

Requirements: Node.js 22.12+, Yarn 1 and Git on `PATH`.

```bash
yarn install
yarn dev
```

The first `yarn dev` downloads the Electron binary.

| Script | What it does |
|---|---|
| `yarn dev` | Electron with hot reload for the UI |
| `yarn build` | Production bundles into `out/` |
| `yarn start` | Run the production build |
| `yarn typecheck` | Type-check the main process and the renderer |
| `yarn test` | Unit and integration tests. The askpass round trip needs `yarn build` first. |
| `yarn dist:win` / `dist:mac` | Installers via electron-builder (NSIS / DMG) into `dist/`. Build the macOS one on a Mac. |
| `yarn dist:msstore` / `dist:msstore-test` | Microsoft Store packages (AppX), or an unsigned one to install locally |
| `yarn dist:mas` / `dist:mas-dev` | Mac App Store package, or a development-signed sandboxed app |

Store setup, signing and submission are in [RELEASING.md](RELEASING.md).

## How it fits together

```
src/
  main/                 Electron main process (Node)
    index.ts            window, single-instance lock, startup wiring
    ipc.ts              IPC handlers: validate renderer input, only touch repos the user opened
    git/runGit.ts       spawn wrapper: env, exit codes, output limits, GitError
    git/commands.ts     typed git operations (status, log, diff, stage, commit, fetch/pull/push, ...)
    git/parsers.ts      pure parsers for porcelain v2 status, log, for-each-ref, name-status
    askpass/            credential prompts: socket server, trampoline script, prompt parsing, glue to the UI
    accounts/store.ts   connected Git services: metadata in accounts.json, tokens in the SecretStore
    accounts/providerApi.ts  token checks and repository listing for GitHub, GitLab, Bitbucket, Azure DevOps, Gitea
    ssh.ts              find / create / convert the user's SSH key, `ssh -T` connection tests
    secrets.ts          safeStorage-encrypted store (Keychain / DPAPI); no plaintext fallback
    watcher.ts          recursive fs.watch → "worktree" or "refs" change events
  askpass/index.ts      helper that git runs as GIT_ASKPASS / SSH_ASKPASS (plain Node, one file)
  preload/index.ts      exposes a typed `window.api` through contextBridge
  shared/               types, IPC channel names, provider definitions (providers.ts) and
                        remote-address parsing/conversion (remoteUrl.ts), shared by every process
  renderer/             React UI
    src/graph/layout.ts      lane-assignment algorithm for the commit graph (pure, unit-tested)
    src/graph/CommitGraph.tsx virtualised list plus a canvas that draws only the visible lanes
test/                   integration tests against real temporary repositories
resources/askpass.cmd   askpass trampoline shipped with packaged Windows builds
build/                  app icon, Store tile images (appx/) and Mac App Store entitlements
scripts/                store-build preflight check, icon generator
```

**Git.** Every operation shells out to the `git` CLI with machine-readable flags (`--porcelain=v2 -z`,
custom `--format` strings with NUL/0x1F separators) and parses the output. Background `status` runs with
`GIT_OPTIONAL_LOCKS=0`, so it never takes the index lock or retriggers the file watcher.

**Credentials.** Git and ssh are started with `GIT_ASKPASS` / `SSH_ASKPASS` pointing at a small
trampoline (`askpass.cmd` on Windows, `askpass.sh` elsewhere) in the app's data folder. Packaged Windows
builds use the copy in `resources/` instead, because Microsoft Store packages hide new AppData files from
other programs. The trampoline runs
the app's own binary with `ELECTRON_RUN_AS_NODE=1` on `askpass.js`. That helper sends the prompt to the
app over a named pipe or Unix socket, authenticated with a per-run random token. The app shows a dialog,
and "Remember" stores the answer with `safeStorage`. Git credential helpers you already have
(Git Credential Manager, osxkeychain) still run first.

**Git services.** Connecting an account checks the token against the service's API, then stores it
with `safeStorage`. For every network command (clone, fetch, pull, push, `ls-remote`) whose remote
host has an account, git is started with `-c credential.<scheme>://<host>.helper=`. That empty value
clears the credential-helper list for that host only, so git falls through to askpass, and askpass
answers `Username for '…'` / `Password for '…'` with the account's git username and token
(`askpass/prompts.ts`). Hosts without an account keep the user's own helpers (GCM, osxkeychain). The
token never reaches the renderer. Tests mock `fetch` for the provider APIs, so no real tokens are
needed.

The UI was designed first as a Claude Design canvas (repository view, welcome, clone, Git services and
remotes screens), then built to match.

**Security.** The renderer runs with `contextIsolation`, `sandbox` and no Node integration. A strict CSP is
injected into production builds. Navigation and new windows are blocked. The main process re-validates
every IPC argument.

## Known gaps / next steps

- macOS: written to be cross-platform but only exercised on Windows so far. The DMG notarises when
  the `APPLE_*` variables in RELEASING.md are set.
- Mac App Store: the `mas` build signs and packages, but the app isn't sandbox-ready (no bundled Git,
  no security-scoped bookmarks, `~/.gitconfig` and `~/.ssh` hidden). Details in RELEASING.md.
- Windows: Git must be installed. Bundling portable MinGit under `resources/` would make the app
  self-contained.
- Don't disable Electron's `RunAsNode` fuse: the askpass helper depends on it. Replacing the helper
  with a tiny native trampoline would remove that dependency.
- Not built yet: stash, merge / rebase / cherry-pick UI, conflict resolution, discarding changes,
  hunk/line staging, a search box, and a settings screen (`gitPath` in `settings.json` already works).
- Git services: tokens only (no OAuth browser sign-in yet). Repository lists show the first page
  (up to 100, 50 for Gitea). Bitbucket uses Atlassian API tokens with the fixed git username
  `x-bitbucket-api-token-auth`. None of the provider calls have been tried against live accounts yet:
  they're covered by mocked-`fetch` tests only.
