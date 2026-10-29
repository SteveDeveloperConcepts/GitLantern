# Store listings

What to paste into App Store Connect and Partner Center, field by field. The images are made by

```bash
yarn build && yarn screenshots --store && yarn store-images
```

which writes them to `dist/store/mac-app-store/` and `dist/store/microsoft-store/` (see
[RELEASING.md](RELEASING.md)). Each field's limit is in brackets; everything here fits.

The two versions differ, and so do their listings. The **Mac App Store** version brings its own Git and
runs in Apple's sandbox: it can't use your installed Git, external diff and merge tools or credential
managers, so its listing doesn't mention them. The **Microsoft Store** version runs the Git for Windows
you installed, so its listing says that Git is required. Neither mentions browser sign-in, which needs
an OAuth application set up for each server first (README, "Where your data lives").

---

## Mac App Store (App Store Connect)

### App information

| Field | Value |
|---|---|
| Name [30] | GitLantern |
| Subtitle [30] | A fast, friendly Git client |
| Primary category | Developer Tools |
| Secondary category | Productivity |
| Privacy Policy URL | https://github.com/SteveDeveloperConcepts/GitLantern/blob/main/PRIVACY.md |
| Content rights | It shows the user's own repositories and pull requests from the services they connect. If you answer that it accesses third-party content, the rights are the user's, through their own account. |

### Version information

**Screenshots:** the ten in `dist/store/mac-app-store/`, in file-name order (2880×1800).

**Promotional text** [170] (can change at any time, without a new version):

```
It comes with its own Git, so there's nothing else to install. Commit graph, line-by-line staging, history editing and pull request reviews for GitHub, GitLab and more.
```

**Description** [4000]:

```
GitLantern is a fast, friendly Git client. See your repository's history as a colour-coded commit graph, stage and commit, tidy up history, review pull requests, and fetch, pull and push, all from one window with a tab for each repository.

It comes with its own Git and Git LFS, so there's nothing else to install. It works with any Git service: GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, Forgejo, Codeberg or your own server.

YOUR HISTORY
• A commit graph of every branch, merge and tag, labelled with the branch each commit came from, even after that branch was merged and deleted.
• Search by message, author, hash or branch, or narrow the graph to one branch, file or folder.
• Diffs in one column or side by side, with changes to spaces hidden if you like.
• Changed images side by side, with a slider to swipe or blend between them.
• ⌘-click a second commit to see everything between the two, or compare a branch with the one you're on.
• File history, followed across renames, and blame for every line.

COMMITTING
• Stage, unstage or discard whole files, single hunks or individual lines.
• Amend the last commit, stash your work with a note, and save or apply patches.
• Commit message templates, a Conventional Commits helper, and an optional AI button that drafts the message from your staged changes, with Claude, an OpenAI-compatible service or Ollama. Nothing is sent until you click it.

CHANGING HISTORY
• Reorder, squash, reword, edit or drop commits in one dialog.
• Merge, rebase, cherry-pick, revert and reset, each explained before anything happens.
• Resolve conflicts side by side: pick one side, the other or both.
• Bisect: mark commits good or bad until GitLantern names the one that brought the bug in.

PULL REQUESTS AND REVIEWS
• See the open pull requests (merge requests on GitLab), check one out, or open a new one from your branch.
• Review mode: read the description and conversation, comment on lines, tick off files as you view them, then approve, comment or request changes. Works with GitHub, GitLab, Gitea and Forgejo, Bitbucket and Azure DevOps.

ANY GIT SERVICE
• Connect an account with an access token. GitLantern links straight to the page that makes one, and stores it encrypted with the macOS Keychain.
• Clone from any HTTPS or SSH address, or pick from the repositories in your connected accounts.
• Fetch, pull and push, with counts of what's waiting, refused pushes explained in plain words, and force pushes that never throw away someone else's commits.
• Bring your SSH keys in with one click, or create a new one.

BRANCHES, TAGS AND MORE
• Branches, tags, worktrees, submodules and stashes, a right-click away.
• Git LFS: set it up, choose which files it stores, and lock files.
• git-flow features, releases and hotfixes.
• Save any commit's files as a zip.

YOUR WAY
• A tab for each repository, reopened next time, and workspaces to open a set of them together.
• Light, dark or system theme, an accent colour, your own colours and the interface size.
• Open a repository in your editor or Terminal, or show it in Finder.

PRIVATE BY DESIGN
No GitLantern account, no analytics, no tracking. GitLantern only goes online when Git does, or when you ask it to check a token, list your repositories or pull requests, or write a commit message with AI.

GOOD TO KNOW
GitLantern opens the folders you choose, and remembers them for next time. It keeps its own Git settings and SSH keys: copy your name, email and keys in with one click from Settings.
```

**Keywords** [100] (the name and subtitle count already, so they aren't repeated):

```
github,gitlab,bitbucket,gitea,azure devops,version control,source control,repo,diff,merge,rebase,lfs
```

| Field | Value |
|---|---|
| Support URL | https://github.com/SteveDeveloperConcepts/GitLantern/issues |
| Marketing URL | https://github.com/SteveDeveloperConcepts/GitLantern |
| Copyright | 2026 Steve Vaubell |
| What's New | Not shown for the first version. Later, a few lines from the GitHub release notes. |

### App Privacy

Choose **Data Not Collected**. GitLantern has no server and sends nothing to its developer or anyone working
with them. The AI commit message button sends the staged changes to a provider the user picks, with the
user's own key, only when they click it.

### Age rating

Answer **None** or **No** throughout: it should come out at 4+. Pull request descriptions and comments come
from the user's own Git services, as in any Git client.

### App Review information

Untick **Sign-in required**. Notes:

```
GitLantern is a Git client. No account is needed to try it.

1. Click "Clone a repository…", paste https://github.com/octocat/Hello-World, choose a folder with Browse…, then click Clone.
2. The repository's history appears as a commit graph. Click a commit to see what it changed.
3. To try committing, change a file in that folder, then open the Changes tab, stage the file and click Commit.

Connecting a Git service under Accounts needs an access token for that service, and is optional. Git and Git LFS are built into the app (Contents/Resources/git) and run inside the App Sandbox.
```

---

## Microsoft Store (Partner Center)

### Store listing

**Product name:** GitLantern

**Short description** [1000] (shown above the description):

```
A fast, friendly Git client for Windows. A colour-coded commit graph, line-by-line staging, history editing and pull request reviews, for GitHub, GitLab, Bitbucket, Azure DevOps, Gitea and any Git server. Requires Git for Windows.
```

**Description** [10000]:

```
GitLantern is a fast, friendly Git client for Windows. See your repository's history as a colour-coded commit graph, stage and commit, tidy up history, review pull requests, and fetch, pull and push, all from one window with a tab for each repository.

It runs the Git you already have, so your config, hooks, signing keys and Git Credential Manager keep working. It connects to any Git service: GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, Forgejo, Codeberg or your own server, with an access token or an SSH key.

Requires Git for Windows (https://git-scm.com/download/win), installed with its default options.

YOUR HISTORY
• A commit graph of every branch, merge and tag, labelled with the branch each commit came from, even after that branch was merged and deleted.
• Search by message, author, hash or branch, or narrow the graph to one branch, file or folder.
• Diffs in one column or side by side, with changes to spaces hidden if you like, or open them in your own diff tool.
• Changed images side by side, with a slider to swipe or blend between them.
• Ctrl-click a second commit to see everything between the two, or compare a branch with the one you're on.
• File history, followed across renames, and blame for every line.
• A log of every Git command GitLantern ran, as you'd type it.

COMMITTING
• Stage, unstage or discard whole files, single hunks or individual lines. Discarded files go to the Recycle Bin.
• Amend the last commit, stash your work with a note, and save or apply patches.
• Commit message templates, a Conventional Commits helper, and an optional AI button that drafts the message from your staged changes, with Claude, an OpenAI-compatible service or Ollama. Nothing is sent until you click it.

CHANGING HISTORY
• Reorder, squash, reword, edit or drop commits in one dialog.
• Merge, rebase, cherry-pick, revert and reset, each explained before anything happens.
• Resolve conflicts side by side (pick one side, the other or both) or in your own merge tool.
• Bisect: mark commits good or bad until GitLantern names the one that brought the bug in.

PULL REQUESTS AND REVIEWS
• See the open pull requests (merge requests on GitLab), check one out, or open a new one from your branch.
• Review mode: read the description and conversation, comment on lines, tick off files as you view them, then approve, comment or request changes. Works with GitHub, GitLab, Gitea and Forgejo, Bitbucket and Azure DevOps.

ANY GIT SERVICE
• Connect an account with an access token. GitLantern links straight to the page that makes one, and stores it encrypted by Windows.
• Once a server is connected, GitLantern answers Git's sign-in prompts for it: no more password prompts.
• Clone from any HTTPS or SSH address, or pick from the repositories in your connected accounts.
• Fetch, pull and push, with counts of what's waiting, refused pushes explained in plain words, and force pushes that never throw away someone else's commits.
• See your SSH key, create one, and test that a server accepts it. PuTTY keys are converted for you.

BRANCHES, TAGS AND MORE
• Branches, tags (annotated and signed), worktrees, submodules and stashes, a right-click away.
• Git LFS: set it up, choose which files it stores, and lock files.
• git-flow features, releases and hotfixes, compatible with the git-flow command-line tools.
• Save any commit's files as a zip.

YOUR WAY
• A tab for each repository, reopened next time, and workspaces to open a set of them together.
• Light, dark or system theme, an accent colour, your own colours and the interface size.
• Open a repository in VS Code, Cursor, Zed, a JetBrains IDE and others, open a terminal there, or show it in Explorer.
• Add your own commands to the Tools menu and to the menus of commits, branches and files.
• Runs natively on Arm PCs.

PRIVATE BY DESIGN
No GitLantern account, no analytics, no tracking. GitLantern only goes online when Git does, or when you ask it to check a token, list your repositories or pull requests, or write a commit message with AI. Updates come through the Microsoft Store.
```

**What's new in this version** [1500]: leave empty for the first submission. Later, a few lines from the
GitHub release notes.

**Product features** [20 × 200]:

```
Colour-coded commit graph of every branch, merge and tag
Unified and side-by-side diffs, and image diffs you can swipe or blend
Stage, unstage or discard single lines and hunks
Edit history: reorder, squash, reword, edit and drop commits
Merge, rebase, cherry-pick, revert and reset, each explained first
Resolve conflicts side by side, or in your own merge tool
Review pull requests: comment on lines, mark files viewed, approve
Works with GitHub, GitLab, Bitbucket, Azure DevOps, Gitea and any Git server
AI commit messages with Claude, OpenAI-compatible services or Ollama, only when you ask
File history across renames, blame, and bisect
Branches, tags, worktrees, submodules, stashes, Git LFS and git-flow
Uses your installed Git: your config, hooks and credential manager keep working
Tabs, workspaces, light and dark themes, and your own colours
No account and no telemetry
```

**Screenshots:** the ten numbered images in `dist/store/microsoft-store/` (3840×2160), in file-name order,
with these captions [200]:

| Image | Caption |
|---|---|
| 01-commit-details | Your history, clear at a glance: a colour-coded graph of every branch, merge and tag, with diffs side by side. |
| 02-pr-review | Review pull requests in the app: comment on lines, tick off files and approve. |
| 03-changes | Stage single lines or hunks, amend, stash, and let AI draft the commit message. |
| 04-interactive-rebase | Tidy up history before you push: reorder, squash, reword and drop commits in one dialog. |
| 05-branches | Branches, tags, worktrees, submodules, stashes and Git LFS, a right-click away. |
| 06-blame | Blame: each line with the commit, author and age that last changed it. |
| 07-image-diff-swipe | Image diffs: side by side, swipe or blend between the old and new version. |
| 08-bisect | Find the commit that broke it: mark commits good or bad, and bisect names the one to blame. |
| 09-light-theme | Light, dark or your own colours, and the interface size you like. |
| 10-accounts | Works with GitHub, GitLab, Bitbucket, Azure DevOps, Gitea or your own server. |

**Store logos:**

| Partner Center | File |
|---|---|
| 2:3 Poster art (1440×2160) | `dist/store/microsoft-store/poster-art.png` |
| 1:1 Box art (2160×2160) | `dist/store/microsoft-store/box-art.png` |
| 16:9 Super hero art (3840×2160), optional | `dist/store/microsoft-store/hero-art.png` (no text: the Store writes the name over its bottom left) |

### Additional information

**Search terms** [7 × 30, 21 words in all]:

```
git client
github
gitlab
version control
source control
pull request
diff merge
```

| Field | Value |
|---|---|
| Short title | GitLantern |
| Developed by | Steve Vaubell |
| Copyright and trademark info [200] | © 2026 Steve Vaubell. GitHub, GitLab, Bitbucket, Azure DevOps and Gitea are trademarks of their respective owners. |
| Additional license terms | GitLantern is open-source software under the MIT License: https://github.com/SteveDeveloperConcepts/GitLantern/blob/main/LICENSE |

### Properties

| Field | Value |
|---|---|
| Category | Developer tools |
| Privacy policy URL | https://github.com/SteveDeveloperConcepts/GitLantern/blob/main/PRIVACY.md |
| Website | https://github.com/SteveDeveloperConcepts/GitLantern |
| Support contact info | https://github.com/SteveDeveloperConcepts/GitLantern/issues |
| System requirements (notes) | Requires Git for Windows (https://git-scm.com/download/win). |
| Restricted capability `runFullTrust` | Desktop Git client: runs Git and SSH on the user's computer. |

### Age ratings

In the IARC questionnaire, choose **Utility, productivity, communication or other**, and answer **No** to
the content questions. It should come out at 3+ / Everyone. If asked whether users can communicate or
share content: pull request comments are posted to the user's Git service, so answer **Yes**. That adds a
"Users interact" note, not a higher rating.
