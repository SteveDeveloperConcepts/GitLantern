# Git Steve

**A fast, friendly desktop Git client for Windows and macOS.**

Git Steve shows your repository's history as a colour-coded commit graph. You can stage and commit
changes, switch branches, and fetch, pull and push, all from one window. It connects to **any Git
service** (GitHub, GitLab, Bitbucket, Azure DevOps, Gitea/Forgejo or your own server) with a token or an
SSH key. It runs the Git you already have installed, so your existing config, hooks and credential
managers keep working.

![Git Steve showing the commit graph, with commit details and a diff below it](docs/screenshots/commit-details.png)

> **Status: early preview (v0.1).** Tested on Windows 11. The macOS build is experimental.

---

## Features

### Your history

- **Commit graph:** every branch, merge and tag as a coloured lane graph, with author avatars. It
  shows the latest 2,000 commits across all branches and scrolls smoothly through them. Uncommitted
  work appears as a dashed row on top.
- **Commit details and diffs:** click a commit to see its message, author, parents and changed files
  with line counts. The diff alongside has line numbers.
- **Stage and commit:** stage or unstage single files or everything at once, see each file's diff, and
  write a summary plus an optional description.
- **Branches:** switch from the branch menu in the top bar or double-click one on the Branches tab
  (remote branches get a local tracking branch), and create new branches.
- **Fetch, pull and push:** fetch all remotes, pull (fast-forward only, so no surprise merge commits)
  and push. The buttons show how many commits are waiting. A new branch's upstream is set on its first
  push.
- **Live updates:** the view refreshes when files change on disk or when you use Git from a terminal.

### Any Git service

- **Connect accounts:** GitHub (and GitHub Enterprise), GitLab (and self-managed GitLab), Bitbucket,
  Azure DevOps, Gitea / Forgejo / Codeberg, or any other HTTPS Git server. Paste an access token
  (Git Steve links straight to the right page to create one), and it's checked with the service and
  stored encrypted by your operating system's keychain.
- **No more password prompts:** once a server is connected, Git Steve answers Git's sign-in requests
  for it automatically, for clone, fetch, pull and push.
- **Clone from anywhere:** paste any HTTPS or SSH address, or browse and filter the repositories in your
  connected accounts and clone with one click. Progress is shown as it downloads.
- **Remotes tab:** see each remote's service and how it signs in. Add, edit or remove remotes, test a
  connection before you save it, and switch a remote between HTTPS and SSH with one click (Azure
  DevOps' different SSH format included).
- **SSH keys:** see your public key, create one if you don't have one, copy it to paste into a service,
  and test that a server accepts it. PuTTY-format keys are detected and converted.
- **Other prompts:** when Git or SSH asks something else (a key passphrase, a new host), Git Steve asks
  in a dialog and can remember the answer, encrypted.

### Everything else

- **Dark and light themes:** these follow your system setting.
- **Private by design:** no Git Steve account, no telemetry. It only talks to the network when Git does,
  or when you ask it to check a token or list your repositories.

<table>
  <tr>
    <td><img src="docs/screenshots/accounts.png" alt="Git services dialog with provider tiles, the GitLab token form and SSH key card" /></td>
    <td><img src="docs/screenshots/clone.png" alt="Clone dialog with an address, account picker and destination folder" /></td>
  </tr>
  <tr>
    <td align="center">Connect GitHub, GitLab, Bitbucket, Azure DevOps, Gitea or any server</td>
    <td align="center">Clone from an address or your accounts</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/changes.png" alt="Changes tab with unstaged and staged files, a diff with line numbers and the commit form" /></td>
    <td><img src="docs/screenshots/remotes.png" alt="Remotes tab showing an HTTPS GitHub remote and an SSH GitLab remote" /></td>
  </tr>
  <tr>
    <td align="center">Stage files and review changes</td>
    <td align="center">Manage remotes and switch HTTPS ↔ SSH</td>
  </tr>
</table>

---

## Install

### 1. Install Git (if you don't have it)

Git Steve uses your computer's own Git. To check whether it's installed, open a terminal and run
`git --version`.

- **Windows:** install [Git for Windows](https://git-scm.com/download/win) with the default options.
- **macOS:** run `xcode-select --install` in Terminal, or `brew install git` if you use
  [Homebrew](https://brew.sh).

### 2. Download Git Steve

Get the latest installer from the [**Releases**](../../releases/latest) page:

| System | File | How to install |
|---|---|---|
| Windows 10 / 11 (64-bit) | `Git Steve Setup <version>.exe` | Run it and follow the steps. |
| macOS | `Git Steve-<version>….dmg` | Open it and drag **Git Steve** into **Applications**. |

**"Unknown publisher" warnings.** Preview builds aren't code-signed yet, so your system may warn you the
first time you open the app:

- **Windows (SmartScreen):** click **More info** → **Run anyway**.
- **macOS (Gatekeeper):** right-click **Git Steve** in Applications and choose **Open**, or go to
  **System Settings → Privacy & Security** and click **Open Anyway**.

### Or build it yourself

You need [Node.js](https://nodejs.org) 22.12 or newer, [Yarn 1](https://classic.yarnpkg.com)
(`npm install -g yarn`) and Git.

```bash
git clone https://github.com/SteveDeveloperConcepts/GitSteve.git
cd GitSteve
yarn install
yarn dev             # run the app in development mode
yarn dist:win        # or: yarn dist:mac (on a Mac) to build an installer into dist/
```

Builds for the Microsoft Store and the Mac App Store are covered in [docs/RELEASING.md](docs/RELEASING.md).

---

## Using Git Steve

1. **Connect your Git service (optional, recommended):** click **Accounts** in the top bar (or
   **Connect a Git service** on the start screen) and pick your service. Click the link to its token
   page, create a token with the permissions shown, paste it in and click **Connect**. Using SSH
   instead? The same dialog shows your SSH key, creates one if you need it and tests it.
2. **Open or clone a repository:** **Open a repository…** picks a folder already on your computer.
   **Clone a repository…** takes any address, or lets you pick from your connected accounts. Folders
   you've opened before appear under **Recent** and in the repository menu at the top left.
3. **Explore history:** scroll the graph, and click a commit to see its details and diff in the pane
   below. Use **↑ / ↓** to move between commits. Drag the divider to resize the pane.
4. **Commit:** on the **Changes** tab, click a file to see its diff, then press **+** to stage it (or
   **Stage all**). Write a summary and click **Commit**, or press **Ctrl+Enter** (**⌘+Enter** on Mac).
5. **Branches:** use the branch menu in the top bar, or the **Branches** tab: click a branch to jump to
   it in the graph, double-click to check it out. **Branch** creates one from where you are.
6. **Remotes:** the **Remotes** tab lists where this repository pushes and pulls. **Add remote**
   connects a new or empty repository to a service. **Test connection** checks the address first.
7. **Sync:** use **Fetch**, **Pull** and **Push** in the top bar. The status bar at the bottom shows
   your branch, how many commits you're ahead or behind, and which account the remote uses.

## Where your data lives

Git Steve never changes anything in your repositories except through the Git commands you ask for. Its
own settings live here:

| System | Folder |
|---|---|
| Windows | `%APPDATA%\Git Steve` |
| Windows, installed from the Microsoft Store | `%LOCALAPPDATA%\Packages\<package name>\LocalCache\Roaming\Git Steve` |
| macOS | `~/Library/Application Support/Git Steve` |

- `settings.json`: your recent repositories, the last clone folder, and an optional `gitPath` that
  points at a specific `git` executable.
- `accounts.json`: which services you've connected (server, username). It never contains tokens.
- `secrets.json`: account tokens and answers you chose to remember, encrypted with Windows DPAPI or
  the macOS Keychain. They can't be read on another computer or by another user. Remove an account
  under **Accounts**. To clear remembered answers, open the **Branches** tab and click **Forget all**.

Git Steve never changes your SSH keys. The only exception is **Create an SSH key**, which writes
`~/.ssh/id_ed25519` when you have no key yet.

To uninstall, remove the app as usual (Windows: **Settings → Apps**; macOS: drag it to the Trash).
Then delete the folder above if you also want your settings gone.

## Troubleshooting

**"Git was not found"**<br>
Install Git (see above) and restart Git Steve. If Git is somewhere unusual, add
`"gitPath": "C:\\path\\to\\git.exe"` to `settings.json` and restart.

**I saved a wrong password**<br>
Go to **Branches → Forget all**, then retry. Git Steve will ask again.

**"The service rejected this token"**<br>
The token was copied incompletely or has expired. Create a new one from the link in the **Accounts**
dialog and connect again: it replaces the old one.

**Push fails with "Authentication failed" on a connected server**<br>
The token is missing a permission (the dialog lists the ones each service needs) or was revoked.
Reconnect the account with a fresh token.

**SSH: "didn't accept your SSH key"**<br>
Copy your public key from **Accounts → SSH key** and add it to your account's SSH key settings on that
service, then click **Test** again.

**I never see a password prompt for a server I haven't connected**<br>
Your Git credential manager (for example Git Credential Manager on Windows, or the macOS Keychain
helper) is handling sign-in, so you should see its window instead. Servers you connect in Git Steve use
your Git Steve account instead.

**Pull says it can't fast-forward**<br>
Your branch and the remote have both moved on. Merge or rebase from a terminal for now. Built-in merge
and rebase are on the roadmap.

## Roadmap

- Stash, merge, rebase and cherry-pick
- Resolving merge conflicts
- Discarding changes, and staging individual lines or hunks
- Search and filtering in the history
- Pull requests / merge requests from connected accounts
- Browser sign-in (OAuth) as an alternative to pasting a token
- A settings screen
- Signed installers and a bundled Git for Windows

Ideas and bug reports are welcome on the [Issues](../../issues) page.

## Contributing

Git Steve is built with Electron, React and TypeScript. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers
how the code is organised and how to run it. Before opening a pull request, please run:

```bash
yarn typecheck
yarn build
yarn test
```

## License

No license has been chosen yet, so all rights are reserved for now. A `LICENSE` file will be added
before the first public release.
