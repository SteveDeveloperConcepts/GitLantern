# Developing GitLantern

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
| `yarn dist:win` / `dist:mac` / `dist:linux` | Installers via electron-builder (NSIS / DMG / AppImage and .deb) into `dist/`. Build each on its own system. |
| `yarn screenshots` | Fresh `docs/screenshots/` from demo repositories (run `yarn build` first; see below) |
| `yarn dist:msstore` / `dist:msstore-test` | Microsoft Store packages (AppX), or an unsigned one to install locally |
| `yarn dist:mas` / `dist:mas-dev` | Mac App Store package, or a development-signed sandboxed app |
| `yarn release <version> "<what changed>" …` | Raise the version, tag and push: the Release workflow publishes it on GitHub |

Store setup, signing and submission are in [RELEASING.md](RELEASING.md).

## How it fits together

```
src/
  main/                 Electron main process (Node)
    index.ts            window, single-instance lock, startup wiring (and settings.json carried over
                        from the "Git Steve" data folder, the app's old name)
    ipc.ts              IPC handlers: validate renderer input, only touch repos the user opened
    git/runGit.ts       spawn wrapper: env, exit codes, output limits, GitError; runGitRaw for bytes
    git/commands.ts     typed git operations (status, log, diff, stage, commit, fetch/pull/push, ...)
                        and the validation helpers the other git modules share
    git/history.ts      amend, reword, revert, reset, interactive rebase
    git/refs.ts         branch rename/delete/upstream/push, tags
    git/inspect.ts      blame, file history, comparing commits, both sides of an image
    git/structure.ts    submodules, worktrees, Git LFS
    git/flow.ts         git-flow without the git-flow tools (same config keys)
    git/bisect.ts       bisect start, good/bad/skip, reset
    git/files.ts        archive, patches, clean, .gitignore, git config (identity, signing)
    git/parsers.ts      pure parsers for porcelain v2 status, log, for-each-ref, name-status
    commandLog.ts       the last 500 git commands, for the command log
    settings.ts         settings.json: recent repos, and the Settings screen's values (checked by sanitizeSettings)
    tools.ts            finding and starting editors and terminals, difftool/mergetool, custom actions
    ai.ts               commit messages from the staged diff (Anthropic or OpenAI-compatible APIs)
    askpass/            credential prompts: socket server, trampoline script, prompt parsing, glue to the UI
    accounts/store.ts   connected Git services: metadata in accounts.json, tokens in the SecretStore
    accounts/providerApi.ts  token checks, repository and pull request listing, new pull requests, per service
    accounts/reviewApi.ts    pull request details, comments and submitting reviews, per service
    accounts/oauth.ts   browser sign-in: GitHub's device flow, PKCE with a 127.0.0.1 redirect, token refresh
    pullRequests.ts     which remote and account a repository's pull requests come from; checking one out;
                        fetching one for review
    ssh.ts              find / create / convert the user's SSH key, `ssh -T` connection tests
    secrets.ts          safeStorage-encrypted store (Keychain / DPAPI); no plaintext fallback
    watcher.ts          recursive fs.watch → "worktree" or "refs" change events
    updater.ts          new versions from GitHub releases (electron-updater): installed on Windows, announced on macOS
  askpass/index.ts      helper that git runs as GIT_ASKPASS / SSH_ASKPASS (plain Node, one file)
  preload/index.ts      exposes a typed `window.api` through contextBridge
  shared/               types, IPC channel names, provider definitions (providers.ts),
                        remote-address parsing/conversion (remoteUrl.ts), resolving conflict markers
                        (conflicts.ts) and partial patches for line staging (patch.ts), shared by every process
  renderer/             React UI
    src/App.tsx              the window: tabs, workspaces, settings and the dialogs shared by every tab
    src/RepoView.tsx         one repository's tab: top bar, panels, graph, details and its dialogs
    src/branchMenus.ts       right-click menu contents for branches, commits and tags (pure, unit-tested)
    src/splitDiff.ts         pairing lines for the side-by-side diff (pure, unit-tested)
    src/issueLinks.ts        issue numbers in messages → links (pure, unit-tested)
    src/review.ts            which diff line a review comment belongs on (pure, unit-tested)
    src/conventional.ts      Conventional Commits messages (pure, unit-tested)
    src/theme.ts             applying the theme, accent, colours and size from Settings
    src/graph/layout.ts      lane-assignment algorithm for the commit graph (pure, unit-tested)
    src/graph/branches.ts    which branch each commit belongs to, from refs and merge messages (pure, unit-tested)
    src/graph/search.ts      history search matching, and re-linking a filtered list for the graph (pure, unit-tested)
    src/graph/CommitGraph.tsx virtualised list plus a canvas that draws only the visible lanes
test/                   integration tests against real temporary repositories
resources/askpass.cmd   askpass trampoline shipped with packaged Windows builds
build/                  app icon, Store tile images (appx/), Mac App Store entitlements, and
                        adhoc-mac.yml (Mac builds without a certificate)
scripts/                `yarn release`, store-build preflight check, icon generator, `yarn screenshots`
.github/workflows/      release.yml: a pushed v* tag builds the installers and publishes a GitHub release
```

**Git.** Every operation shells out to the `git` CLI with machine-readable flags (`--porcelain=v2 -z`,
custom `--format` strings with NUL/0x1F separators) and parses the output. Background `status` runs with
`GIT_OPTIONAL_LOCKS=0`, so it never takes the index lock or retriggers the file watcher.

**Branch labels.** Git doesn't record which branch a commit was made on, so `graph/branches.ts` works
it out in one pass over the log, newest first. A branch claims the commits on its first-parent line
from its tip. A merge commit's message (git, GitHub, GitLab, Bitbucket and Gitea formats) names the
branch whose line starts at its second parent, which covers deleted branches. Where claims overlap,
the remote's default branch (from `origin/HEAD`, marked by `parseDecorations`) and other long-lived
names like main and develop win over merged branches, which win over the checked-out branch and
other local and remote branches. The comment at the top of the file explains the order. A row skips
the label when one of its ref labels already names that branch.

**Merge and rebase.** Right-click menus (`branchMenus.ts`) open a dialog that runs `git rev-list
--left-right --count` first, to explain a fast-forward, a merge commit or the commits a rebase replays,
and to warn when they're already on the upstream. `merge` and `rebase` run with `GIT_EDITOR=true`, so
git never waits for an editor. A stop on conflicts returns `{ conflicted: true }` instead of an error.
`status()` reads git's own state files (`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`,
`CHERRY_PICK_HEAD`, `REVERT_HEAD`) on every refresh. That also picks up a merge or rebase started in a
terminal, and the banner offers `--continue`, `--skip` and `--abort` for it.

**Pull and push.** Pull runs `git fetch` and then `git merge --ff-only @{upstream}`, but only when the
branch has no commits of its own. When both sides have new commits, it returns `diverged` and the
renderer opens the merge/rebase dialog in its Pull mode. A push that git refuses (`[rejected]`) is
explained after a fetch by `unseenUpstreamCommits`. It counts the upstream commits that the branch's
reflog never pointed at. If there are any, someone else pushed, and the advice is to pull. If there
are none, the user rewrote commits that were already pushed, and Push offers a force push (below).
Pull uses the same check, so it never offers to merge those old copies back in.

**Force push.** When a refused push turns out to be the rewritten-history case, `push` returns
`needs-force` with the upstream commit it saw, instead of an error. The renderer explains it and,
on confirmation, `forcePush` runs `git push --force-with-lease=<ref>:<that commit> <remote>
HEAD:<ref>`: the lease is the exact commit the user was shown, even if a fetch has moved the
remote-tracking branch since, and naming the remote and ref keeps `push.default` from widening it.

**Stash and cherry-pick.** `stash` is `git stash push --include-untracked`. Stashes are applied,
popped and dropped by commit hash, which `stashRef` turns into the current `stash@{n}`, so a stash
made in a terminal meanwhile can't shift the target. A stash is shown like a commit: its tracked
changes against its first parent, plus the untracked files from its third parent (diffed as
`<hash>^3`). A conflicting stash leaves no state file, so `applyStash` reports conflicts from
`ls-files --unmerged`. Cherry-pick uses `-m 1` for merge commits. When a pick stops without conflicts
the branch already has its changes: GitLantern calls it off instead of leaving an empty cherry-pick.

**Conflicts.** `shared/conflicts.ts` walks git's markers (diff3 bases included) and replaces one
conflict with a side, keeping every other byte: the file is read and written as latin1, so any encoding
and line ending survives. The renderer sends the conflict count it saw, and the main process refuses
if the file has changed since. Once no conflicts are left the file is staged. Whole-file choices are
`git checkout --ours/--theirs`, or `git rm` when that side deleted the file. Sides are named from the
marker labels: HEAD becomes the checked-out branch (in a rebase, the branch being rebased onto).

**Lines and hunks.** `shared/patch.ts` parses one file's diff and builds a patch from the picked lines,
keyed `hunk:line` (`parseDiff` in the renderer numbers lines the same way). Staging applies a forward
patch to the index (`git apply --cached`); unstaging and discarding apply a reverse patch to the
index or the working tree. The side the patch applies to keeps every unpicked change: an unpicked
removal becomes context, an unpicked addition is left out, and hunk start lines are recomputed.
Diffs are produced with fixed `a/` `b/` prefixes so user config can't break this. The main process
checks the patch names the file it was asked about, and refuses text that wasn't valid UTF-8 (it was
altered on its way to the UI). Discarding whole files uses `git restore --worktree` with literal
pathspecs; untracked files go to the trash (`shell.trashItem`).

**History search.** The search box matches the loaded commits in the renderer (subject, author, hash
prefix, branch and tag names). "Matches only" lays out just those commits, dropping links to hidden
ones (`linkedWithin`). The branch and path filters run in git: `git log <branch>` instead of `--all`,
and `--parents -- <path>`, whose parent rewriting keeps the filtered graph joined up.

**Pull requests.** `pullRequests.ts` takes `origin` (or the only remote), finds the connected account
for its host (Azure DevOps' SSH host maps to dev.azure.com), and `providerApi.repoApi` turns the
remote address into the service's API path: `/repos/o/r` on GitHub and Gitea, the URL-encoded
project path on GitLab, `/repositories/w/r` on Bitbucket, and a project-scoped URL on Azure DevOps.
A pull request from the same repository is checked out through its remote branch; one from a fork
is fetched from `refs/pull/N/head` (GitHub, Gitea) or `refs/merge-requests/N/head` (GitLab) into
`pr/N`. The renderer loads the list when the tab opens and after a push, not on every refresh.

**Browser sign-in.** Offered only for hosts with an OAuth client ID: `REGISTERED_CLIENTS` in
`accounts/oauth.ts` (empty until GitLantern's own applications are registered) plus `oauthClients` in
settings.json. GitHub uses the device flow: the app shows the user code and polls the token endpoint.
GitLab and Gitea use an authorization code with PKCE; a one-off server on 127.0.0.1 (random port)
takes the redirect and ignores requests without the right `state`. Neither flow uses a client
secret. Tokens are kept like pasted ones; a refresh token goes in the SecretStore and `freshToken`
renews the access token two minutes before it expires (GitLab: 2 hours, Gitea: 1 hour), for askpass
and API calls alike. GitLab OAuth tokens authenticate git as `oauth2`, and its API with `Bearer`.

To ship browser sign-in for github.com and gitlab.com, register one application on each and put the
client IDs in `REGISTERED_CLIENTS`:

- GitHub: an **OAuth App** (not a GitHub App) with **Enable Device Flow** ticked. The callback URL
  isn't used.
- GitLab: an application under the GitLantern account's **Applications**, **not confidential**,
  redirect URI `http://127.0.0.1/callback` (GitLab accepts any port on 127.0.0.1), scopes `api`,
  `read_repository` and `write_repository`.

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

**Rewriting history.** `history.ts` writes the whole interactive-rebase todo itself and runs `git rebase
-i` with `GIT_SEQUENCE_EDITOR` set to `cp '<todo>'` (git runs editors through its own `sh`, Git for
Windows included) and `GIT_EDITOR=true`, so squashes take git's combined message. A reworded commit, or a
squash given a new message, gets an `exec git commit --amend --only --file=<message>` line after its
group. The todo and message files live in the git dir (`gitlantern-rebase/`), not a temp folder, because
exec lines can run after a stop on conflicts or an `edit`. Ranges with merges are refused rather than
flattened. Rewording HEAD is `commit --amend --only`, which leaves staged changes out.

**Tabs.** `App.tsx` keeps one `RepoView` per open repository mounted (hidden ones keep their selection,
filters and scroll) and the main process one watcher per repository; closing a tab stops its watcher. The
tabs and the active one are saved in settings.json and reopened through `repo:open-known`, which only
accepts folders opened before: Recent shows the last 12, and `knownRepos` (written by the main process
only) keeps every one, so tabs and workspaces beyond those still reopen. Submodules and worktrees open
through `repo:open-related`, which accepts only a submodule or worktree git lists for the repository,
and only when git finds that folder itself to be the repository's root. Shortcuts like Ctrl+F check
they're in the visible tab.

**Settings.** The Settings screen writes through `settings:set`, and `sanitizeSettings` checks every field
on its own (colours are `#rrggbb`, CSS variable names are `--name`, tool names are plain words, issue-link
patterns must compile). Because the renderer can write settings, nothing it writes decides which program
runs or where a secret goes:
- `gitPath` isn't accepted from `settings:set`; Settings → Git picks it with the main process's own file
  dialog (`settings:choose-git`), and it must be named git.
- The AI key goes in the SecretStore with the origin it was saved for (Anthropic's API, or the
  OpenAI-compatible server's), and is only ever sent there: changing the provider or address needs a key
  saved for the new one.
- A custom action's program is resolved first: a bare name like `git` from absolute PATH entries only
  (a plain spawn on Windows would look in the repository first, so a cloned repository could ship a
  git.exe), a path with a folder in it from the repository on purpose. The resolved program and its
  arguments are confirmed by a main-process dialog the first time they run, and the approval (a hash)
  is stored outside the renderer's reach (`approvedActions`).

Custom actions, editors and terminals are started without a shell. Interface size is Chromium's zoom
factor, set by the main process, so pointer positions and the graph's canvas stay in step.

**Toasts.** `RepoView`'s `run(label, action, success, sync)` marks trips to a remote with `sync`: fetch,
pull, push, force push, pushing branches and tags, deleting them on a remote, submodule updates, Git LFS
and checking out pull requests. Each ends with a toast (`toasts.ts`, `components/Toasts.tsx`) repeating
the status bar's outcome: green when done, amber when it needs a look (a pull that needs a merge or
rebase, a push that needs a force push), red with the error's first line when it failed. Toasts go after
5 seconds (9 for failures), stay while pointed at, and at most four show at once.

**Command log.** `runGit` tells a listener when each command starts and ends; `commandLog.ts` keeps the
last 500 (arguments, folder, duration, exit code, the start of stderr on failure), which the log dialog
reads every second while it's open. Nothing sent on stdin is kept. The dialog hides the reads every
refresh makes by default.

**Diffs.** The side-by-side layout pairs a run of removals with the additions after it (`splitDiff.ts`);
line staging stays in the unified layout. Ignoring whitespace (`--ignore-all-space --ignore-blank-lines`)
switches line staging off, since that patch wouldn't apply. Image files get both sides as data URLs from
`git cat-file` (the CSP already allows `data:` images), capped at 20 MB each.

**Pull request review.** `pullRequests.detail` reads the pull request from the service, fetches its head
and target branch (a fork's through `refs/pull/N/head` or `refs/merge-requests/N/head`, into FETCH_HEAD,
so nothing new shows in the graph) and takes their merge base. Files and diffs then come from git like a
commit comparison. Comments from the service are placed on diff lines by side and line number
(`review.ts`); the rest are listed as on an older version. Pending comments and viewed files are kept in
the renderer's localStorage per pull request until the review is submitted, then `reviewApi.ts` sends them
in the shape each service wants (one review on GitHub and Gitea, discussions plus approve on GitLab,
comments plus approve or request-changes on Bitbucket, threads plus a vote on Azure DevOps).

**Screenshots.** `scripts/screenshots.mjs` builds two demo repositories (history with merges, tags, a
submodule, a worktree, a stash, Git LFS, an image change, a bisect in progress) in a temporary folder,
starts the built app with `GITLANTERN_USER_DATA` pointing at a fresh data folder and
`--remote-debugging-port`, and drives it over the DevTools protocol: it clicks through each scene and
captures 1400×880 PNGs. `yarn screenshots commit-details blame` retakes only those. Review mode is shot
against a fake GitHub API served on https://localhost by the script itself.

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
- Not built yet: translations, staging lines of an untracked file (it's staged whole), editing a
  conflict by hand inside GitLantern (pick sides, use your merge tool or your editor), keeping merge
  commits during an interactive rebase, and comments in the side-by-side diff (review mode uses the
  unified one).
- Linux: the AppImage and .deb are built by the Release workflow but haven't been tried on a desktop
  yet. Tokens need a keyring (GNOME Keyring or KWallet); without one nothing is saved.
- External tools: editor and terminal detection is tested on Windows only; the macOS and Linux lists
  follow the tools' documented install locations.
- AI and review mode have been tested against mocked services only, like the other provider calls.
- Git services: browser sign-in has no registered applications yet (see above), and isn't available
  for Bitbucket (its OAuth needs a client secret) or Azure DevOps (it needs a Microsoft Entra app).
  Repository lists show the first page (up to 100, 50 for Gitea), pull request lists the 50 most
  recently updated. Bitbucket uses Atlassian API tokens with the fixed git username
  `x-bitbucket-api-token-auth`. None of the provider calls, pull requests and OAuth included, have
  been tried against live accounts yet: they're covered by mocked-`fetch` tests only.
