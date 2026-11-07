<!-- GitHub turns every line break in release notes into a hard break, so keep each paragraph on one line. -->
## Download

| System | File |
|---|---|
| Windows 10 / 11 (64-bit) | `GitLantern-Setup-<version>.exe` |
| macOS, Apple silicon (M1 and later) | `GitLantern-<version>-arm64.dmg` |
| macOS, Intel | `GitLantern-<version>-x64.dmg` |
| Linux (64-bit), any distribution | `GitLantern-<version>-x86_64.AppImage` |
| Debian, Ubuntu and similar | `gitlantern_<version>_amd64.deb` |

GitLantern uses the Git installed on your computer. If `git --version` doesn't work in a terminal, install [Git](https://git-scm.com/downloads) first.

Once it's installed, GitLantern looks for new versions itself. On Windows, on a Mac and in the AppImage it downloads them and installs them when you restart it. With the .deb, it tells you when there's a new one to download.

**On a Mac with GitLantern 0.8.1 or earlier,** install this version by hand once: open the disk image and drag GitLantern into Applications, replacing the old copy. Those versions can only tell you a new one is out. From this one on, GitLantern updates itself.

### Opening it the first time

- **Windows:** the installer isn't signed with a publisher certificate yet, so Windows warns you once. When SmartScreen says "Windows protected your PC", click **More info** → **Run anyway**.
- **macOS:** drag GitLantern into Applications and open it.
