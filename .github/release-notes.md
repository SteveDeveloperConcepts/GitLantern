<!-- GitHub turns every line break in release notes into a hard break, so keep each paragraph on one line. -->
## Download

| System | File |
|---|---|
| Windows 10 / 11 (64-bit) | `GitLantern-Setup-<version>.exe` |
| macOS, Apple silicon (M1 and later) | `GitLantern-<version>-arm64.dmg` |
| macOS, Intel | `GitLantern-<version>-x64.dmg` |

GitLantern uses the Git installed on your computer. If `git --version` doesn't work in a terminal, install [Git](https://git-scm.com/downloads) first.

Once it's installed, GitLantern looks for new versions itself. On Windows it downloads them and installs them when you restart it. On a Mac it tells you when there's a new one to download.

### Opening it the first time

These builds aren't signed with a publisher certificate yet, so your system warns you once:

- **Windows:** when SmartScreen says "Windows protected your PC", click **More info** → **Run anyway**.
- **macOS:** drag GitLantern into Applications and open it. When macOS says it can't verify the app, click **Done**. Then open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
