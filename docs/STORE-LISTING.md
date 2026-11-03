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

**Screenshots:** the ten in `dist/store/mac-app-store/`, in file-name order (2880×1800). Not the ones in
`docs/screenshots/`: those are the README's, at 1400×880, which App Store Connect turns down as "File
dimensions are invalid", and they show the diff and merge tool links this version doesn't have.

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

**Product name:** GitLantern - Git Desktop Client, picked from the dropdown. Reserve it first under
Product management → Manage app names → Reserve more names. Keep *GitLantern* reserved too: the package's
`appx.displayName` in `electron-builder.yml` is GitLantern, so that's what the Start menu shows.

**Short description** [1000] (shown above the description):

```
A fast, friendly Git client for Windows. A colour-coded commit graph, line-by-line staging, history editing and pull request reviews, for GitHub, GitLab, Bitbucket, Azure DevOps, Gitea and any Git server. Uses live generative AI for one optional feature: drafting commit messages, only when you ask. Requires Git for Windows.
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
• Commit message templates, a Conventional Commits helper, and an optional AI button that drafts the message from your staged changes (see GENERATIVE AI below).

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

GENERATIVE AI
GitLantern uses live generative AI for one optional feature: the AI button above the commit message drafts a message from your staged changes. It's off until you choose a service under Settings → AI: Claude or an OpenAI-compatible service with your own API key, or your own Ollama server. Nothing is sent until you click the button. The draft only fills in the commit message box, and AI can get things wrong, so read and edit it before you commit. If an AI-written message is inappropriate, offensive or harmful, click "Report a problem with it" under the message, or open an issue at https://github.com/SteveDeveloperConcepts/GitLantern/issues. Every report is reviewed and acted on.

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
Optional generative AI drafts commit messages, only when you ask, with a link to report a bad one
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

**Store display images** (optional: without them the Store uses the smaller logo in the package). These
are committed, so they need no build step; `python scripts/make_icons.py` redraws them.

| Partner Center | File |
|---|---|
| 1:1 App tile icon (300×300) | `build/store-display/300x300.png` |
| 1:1 (150×150) | `build/store-display/150x150.png` |
| 1:1 (71×71) | `build/store-display/71x71.png` |

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
| Product declarations | Tick **This product incorporates generative AI features, which utilize artificial intelligence to create new content**: the AI button writes commit messages (policy 11.16). Leave the others as they are. |

### Submission options

**Notes for certification:**

```
GitLantern is a Git client. It needs Git for Windows (https://git-scm.com/download/win). No account is needed to try it: click "Clone a repository…", paste https://github.com/octocat/Hello-World, choose a folder and click Clone.

Generative AI (policy 11.16):
- What it does: the sparkle button above the commit message, in the Changes tab, drafts a Git commit message from the staged changes. It is the only generative AI feature, and the "generative AI" product declaration is ticked.
- Disclosure: the short description, the description (GENERATIVE AI section) and the product features say the app uses live generative AI.
- When it runs: only after the user chooses a service under Settings → AI (Claude or an OpenAI-compatible service with their own API key, or their own Ollama server), and only when they click the button. No key comes with the app. To try it without a paid key, run Ollama on the test PC, choose OpenAI-compatible with the address http://localhost:11434/v1 and a model you have pulled (for example llama3.2), stage a change and click the sparkle button.
- Keeping the content within Store policy: the model is told to reply with a commit message describing the diff and nothing else, and to ignore any instructions inside the diff. The text is never posted or shared. It only fills in the user's own commit message box, where they read and edit it before committing, and it uses the content safety of the service the user chose.
- Reporting: under every AI-written message, "Report a problem with it" opens a new issue on the project's GitHub (https://github.com/SteveDeveloperConcepts/GitLantern/issues), the listing's support contact. The developer reviews each report and acts on it, for example by changing the instructions the model is given.
```

### Age ratings

In the IARC questionnaire, choose **Utility, productivity, communication or other**, and answer **No** to
the content questions. It should come out at 3+ / Everyone. If asked whether users can communicate or
share content: pull request comments are posted to the user's Git service, so answer **Yes**. That adds a
"Users interact" note, not a higher rating.
