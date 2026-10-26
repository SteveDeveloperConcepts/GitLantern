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
| `yarn dist:win` / `dist:mac` | Installers via electron-builder (NSIS / DMG) into `dist/`. Build the macOS one on a Mac. |
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
    git/runGit.ts       spawn wrapper: env, exit codes, output limits, GitError
    git/commands.ts     typed git operations (status, log, diff, stage, commit, fetch/pull/push, ...)
    git/parsers.ts      pure parsers for porcelain v2 status, log, for-each-ref, name-status
    askpass/            credential prompts: socket server, trampoline script, prompt parsing, glue to the UI
    accounts/store.ts   connected Git services: metadata in accounts.json, tokens in the SecretStore
    accounts/providerApi.ts  token checks, repository and pull request listing, new pull requests, per service
    accounts/oauth.ts   browser sign-in: GitHub's device flow, PKCE with a 127.0.0.1 redirect, token refresh
    pullRequests.ts     which remote and account a repository's pull requests come from; checking one out
    ssh.ts              find / create / convert the user's SSH key, `ssh -T` connection tests
    secrets.ts          safeStorage-encrypted store (Keychain / DPAPI); no plaintext fallback
    watcher.ts          recursive fs.watch → "worktree" or "refs" change events
  askpass/index.ts      helper that git runs as GIT_ASKPASS / SSH_ASKPASS (plain Node, one file)
  preload/index.ts      exposes a typed `window.api` through contextBridge
  shared/               types, IPC channel names, provider definitions (providers.ts),
                        remote-address parsing/conversion (remoteUrl.ts), resolving conflict markers
                        (conflicts.ts) and partial patches for line staging (patch.ts), shared by every process
  renderer/             React UI
    src/branchMenus.ts       right-click menu contents for branches and commits (pure, unit-tested)
    src/graph/layout.ts      lane-assignment algorithm for the commit graph (pure, unit-tested)
    src/graph/branches.ts    which branch each commit belongs to, from refs and merge messages (pure, unit-tested)
    src/graph/search.ts      history search matching, and re-linking a filtered list for the graph (pure, unit-tested)
    src/graph/CommitGraph.tsx virtualised list plus a canvas that draws only the visible lanes
test/                   integration tests against real temporary repositories
resources/askpass.cmd   askpass trampoline shipped with packaged Windows builds
build/                  app icon, Store tile images (appx/), Mac App Store entitlements, and
                        adhoc-mac.yml (Mac builds without a certificate)
scripts/                `yarn release`, store-build preflight check, icon generator
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
- Not built yet: a settings screen (`gitPath` and `oauthClients` in `settings.json` already work),
  staging lines of an untracked file (it's staged whole), and editing a conflict by hand inside Git
  Steve (pick sides, or use your editor).
- Git services: browser sign-in has no registered applications yet (see above), and isn't available
  for Bitbucket (its OAuth needs a client secret) or Azure DevOps (it needs a Microsoft Entra app).
  Repository lists show the first page (up to 100, 50 for Gitea), pull request lists the 50 most
  recently updated. Bitbucket uses Atlassian API tokens with the fixed git username
  `x-bitbucket-api-token-auth`. None of the provider calls, pull requests and OAuth included, have
  been tried against live accounts yet: they're covered by mocked-`fetch` tests only.
