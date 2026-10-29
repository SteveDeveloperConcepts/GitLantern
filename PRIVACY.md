# GitLantern privacy policy

*Last updated: 29 October 2026*

GitLantern is a Git client that runs on your computer. It has no GitLantern account and no server of its
own, and it doesn't collect, sell or share any information about you. This page explains what it keeps on
your computer and when it connects to the internet. It covers every version: the Microsoft Store and Mac
App Store versions, and the downloads on GitHub.

## What GitLantern collects

Nothing. GitLantern has no analytics, telemetry, advertising or crash reporting, and sends nothing to its
developer.

## What stays on your computer

GitLantern keeps its own files in a folder on your computer (the README lists where, for each system):

- **Settings:** your recent repositories and open tabs, workspaces, and everything you choose in Settings.
- **Connected accounts:** which Git services you've connected, with the server and your username.
- **Secrets:** the access tokens for those accounts, your AI API key if you set one, and answers to Git or
  SSH prompts you chose to remember. They're encrypted by your operating system (Windows DPAPI, the macOS
  Keychain or the Linux keyring), so they can't be read on another computer or by another user.

Your repositories are changed only by the Git commands you ask GitLantern to run.

## When GitLantern connects to the internet

Only in these cases, and only to the places named:

- **Git:** when you clone, fetch, pull or push, Git connects to the server of that repository's remote, as
  it would from the command line.
- **Git services you connect** (such as GitHub, GitLab, Bitbucket, Azure DevOps or Gitea): to check a token
  when you connect it, list your repositories or pull requests, show a pull request and send your review
  comments. These requests go straight from your computer to that service, with your token.
- **AI commit messages, if you set them up:** when you click the AI button, the staged changes are sent to
  the provider you chose in Settings (such as Anthropic, OpenAI or a server of your own), with your own API
  key. Nothing is sent until you click it.
- **Update checks, in the downloads from GitHub only:** GitLantern asks GitHub whether a new version is out,
  and may download it. The request contains nothing about you or your repositories. The store versions
  don't check: the store updates them.

What those services do with the information they receive is covered by their own privacy policies.

## Children

GitLantern is a tool for software development. It isn't directed at children, and it doesn't knowingly
collect information from anyone, of any age.

## Removing your information

Remove an account under **Accounts**, and your AI key under **Settings → AI**. To remove everything,
uninstall GitLantern and delete its folder (the README says where it is). Uninstalling the Microsoft Store
version deletes that folder for you.

## Changes and contact

If this policy changes, the new version will be published here, with a new date at the top. Questions are
welcome on the [GitHub issues page](https://github.com/SteveDeveloperConcepts/GitLantern/issues).
