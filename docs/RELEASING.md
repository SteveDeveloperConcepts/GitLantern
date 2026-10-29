# Releasing GitLantern

Every build is a [Yarn](https://classic.yarnpkg.com) command. Install Yarn 1 once (`npm install -g yarn`,
or `corepack enable`), then run `yarn install` in the project folder.

| Command | Builds | Run it on | Output in `dist/` |
|---|---|---|---|
| `yarn dist:win` | Windows installer to share directly (NSIS) | Windows | `GitLantern-Setup-<version>.exe` |
| `yarn dist:mac` | macOS disk image to share directly | Mac | `GitLantern-<version>-<arch>.dmg` |
| `yarn dist:linux` | Linux AppImage and Debian package | Linux | `GitLantern-<version>-x86_64.AppImage`, `gitlantern_<version>_amd64.deb` |
| `yarn dist:msstore` | **Microsoft Store** packages, x64 and ARM64 | Windows 10 / 11 | `GitLantern-<version>-x64.appx`, `…-arm64.appx` |
| `yarn dist:msstore-test` | The Store package, installable on your own PC for testing | Windows 11 | `GitLantern-<version>-x64-test.appx` |
| **Product → Archive** in `macos/GitLantern.xcodeproj` (`yarn xcode`) | **Mac App Store** archive (Apple silicon + Intel), uploaded from Xcode's Organizer | Mac with Xcode | Xcode's Organizer |
| `yarn dist:mas` | The same Mac App Store build without Xcode, as a package for Transporter | Mac with Xcode | `mas-universal/GitLantern-<version>-mas.pkg` |
| `yarn dist:mas-dev` | Sandboxed build that runs on your own Mac, for testing | Mac with Xcode | `mas-dev…/GitLantern.app` |

The store commands check your setup first and stop with a message saying what's missing.

**Before every release:**

1. Raise `version` in `package.json` (`yarn release` does this for GitHub releases). Both stores reject
   an upload whose version isn't higher than the last one.
2. Run `yarn typecheck` and `yarn test`.

The app icon is `build/icon.png` (macOS) and `build/icon.ico` (Windows). The Store tile images are in
`build/appx/`. `scripts/make_icons.py` draws all of them; change it and run `python scripts/make_icons.py`
(needs [Pillow](https://pypi.org/project/pillow/)) to update them together.

---

## GitHub releases

`yarn release` publishes a new version. It raises the version in `package.json`, commits it, tags the
commit with your release notes, and pushes the commit and tag together. The tag starts the **Release**
workflow, which builds the Windows, macOS and Linux installers on GitHub's servers and publishes them. You
don't need a Mac to ship the Mac version, or Linux to ship the Linux one.

1. Commit and push the work you're releasing. Run `yarn typecheck` and `yarn test`.
2. Run `yarn release` with the new version, then one quoted line for each change. Each line appears under
   **What's new** on the release page:

   ```
   yarn release <new version> "<what changed>" "<what else changed>"
   ```

   Replace each `<…>`, angle brackets included, with your own text:
   - the version: three numbers, higher than the one in `package.json`
   - each change: one short sentence written for the people who use GitLantern

   Add `--dry-run` to see the plan and the release notes without changing anything.

   Before it changes anything, it checks that:
   - the version is higher than the current one
   - you have no uncommitted changes
   - nobody has pushed to the branch since you last pulled
   - the tag doesn't exist yet

   If a check fails, it says what's wrong and changes nothing.

3. Follow the **Release** workflow on the repository's **Actions** tab. `yarn release` prints the link. The
   workflow type-checks and tests on Windows, macOS and Linux, then builds:
   - `GitLantern-Setup-<version>.exe` for Windows
   - `GitLantern-<version>-arm64.dmg` and `GitLantern-<version>-x64.dmg` for Apple silicon and Intel Macs
   - `GitLantern-<version>-x86_64.AppImage` and `gitlantern_<version>_amd64.deb` for Linux

   It then publishes the release. The release notes contain:
   - **What's new**, from your lines
   - the download notes from `.github/release-notes.md`
   - a link to every change since the last release

   It takes about 3 minutes.

**If the build fails**, nothing is published. Delete the tag on GitHub and on your computer, replacing
`<version>` with the version you released:

```
git push origin :refs/tags/v<version>
git tag -d v<version>
```

Then fix the problem, commit and push the fix, and run `yarn release` again with the same version and
notes. `package.json` already has that version, so this time it only tags and pushes.

Once a release is published, it can't be replaced this way. To change its notes, open the release on
GitHub and click **Edit**.

**Signing.** These builds have no publisher certificate: the Windows installer is unsigned, and the Mac app
has only an ad-hoc signature, without which Apple silicon Macs won't open it at all. Users see a warning
the first time they open either one, and the release notes explain how to get past it. To remove the
warnings, build signed versions yourself (the notarised DMG below, or a Windows code-signing certificate)
and replace the files on the release. If you replace the Windows installer, also replace `latest.yml` and
its `.blockmap` with the ones from the same build. Installed copies check the installer against them and
refuse one that doesn't match.

### How installed copies update

GitLantern checks the latest GitHub release 10 seconds after it starts, then every 4 hours
(`src/main/updater.ts`):

- **Windows:** it downloads a newer version in the background and shows **Restart now**. If the user
  doesn't restart, the new version installs the next time they quit GitLantern.
- **macOS:** it only says a new version is out. **Download** opens the release page. macOS only installs
  updates signed with a Developer ID, and these builds have an ad-hoc signature. See below for how to
  turn on full updates.
- **Store copies and `yarn dev`:** these never check. The stores update their own copies.

Copies of 0.4.1 and earlier don't check. People using those versions have to install the next one by
hand.

The checks read files that electron-builder writes next to the installers, and the workflow attaches
them to the release: `latest.yml` (Windows), `latest-mac.yml`, and the `.blockmap` files, which let
Windows download only what changed. Don't delete them from a release.

Every published release reaches everyone within a few hours, and you can't take it back from copies
that have already updated. If a release is broken, publish a fixed one with a higher version.

**Full updates on macOS.** Once you have a Developer ID certificate:

1. Sign and notarise the Mac build in the Release workflow instead of using `build/adhoc-mac.yml`.
2. Add `zip` to `mac.target` in `electron-builder.yml`. Mac updates install from the zip, not the DMG.
   Add `dist/*.zip` to the files the workflow uploads.
3. In `updateMode` in `src/main/updater.ts`, return `'install'` for `darwin` too.

Copies with the ad-hoc signature can't install a signed update, so Mac users install the first signed
version by hand. The notice tells them it's out.

---

## Microsoft Store

You don't need a code-signing certificate: Microsoft signs Store packages for you. Users get GitLantern
with no SmartScreen warning, and updates come through the Store.

### One-time setup

1. **Create a developer account** in [Partner Center](https://partner.microsoft.com/dashboard)
   (Apps and games). Check the sign-up page for the current fee.
2. **Reserve the name.** Go to **Apps and games → New product → MSIX or PWA app**, and reserve
   *GitLantern*. If the name is taken, reserve another one and change `appx.displayName` in
   `electron-builder.yml` to match.
3. **Copy your package identity.** Open the app, then **Product management → Product identity**. Copy three
   values into the `appx` section of `electron-builder.yml`, replacing the `REPLACE-ME` placeholders:

   | Partner Center | `electron-builder.yml` |
   |---|---|
   | Package/Identity/Name | `identityName` |
   | Package/Identity/Publisher (starts with `CN=`) | `publisher` |
   | Package/Properties/PublisherDisplayName | `publisherDisplayName` |

### Build and test

```bash
yarn dist:msstore
```

This makes one `.appx` per processor type. Upload both: Windows on ARM PCs get the native ARM64 build.

To try the Store build before uploading it (Windows 11, from PowerShell **run as administrator**):

```bash
yarn dist:msstore-test
```

```powershell
Add-AppxPackage -Path "dist\GitLantern-0.1.0-x64-test.appx" -AllowUnsigned
```

That package is unsigned, so Windows only installs it with `-AllowUnsigned` and it can't be uploaded.
It installs for all users. Remove it afterwards with
`Get-AppxPackage *GitLantern* -AllUsers | Remove-AppxPackage -AllUsers`.

### Submit

1. In Partner Center, open the app and click **Start your submission**.
2. **Packages:** drag in both `.appx` files from `dist/`.
3. **Properties:** category *Developer tools*. In **System requirements**, note that Git for Windows must be
   installed.
4. **Store listings:** description, and at least one screenshot. The images in `docs/screenshots/`
   work. Mention in the description that Git must be installed.
5. **Privacy policy URL:** required, because GitLantern stores access tokens. Explain what's stored and
   that it stays on the user's computer (see "Where your data lives" in the README).
6. **Restricted capability:** Partner Center asks why the app uses `runFullTrust`. Every desktop app
   packaged this way declares it. A suitable answer: "Desktop Git client: runs Git and SSH on the user's
   computer."
7. **Age ratings** and **Pricing and availability**, then **Submit to the Store**.

Certification usually takes a few days. Partner Center emails you with the result.

### How the Store version differs

- **Settings location:** Windows stores files the app creates in AppData in a private per-app folder,
  `%LOCALAPPDATA%\Packages\<package family name>\LocalCache\Roaming\GitLantern`. Uninstalling the app
  deletes it.
- **Sign-in helper:** other programs can't always see that private folder, so the sign-in helper that Git
  runs ships inside the app instead of being written to AppData (`resources/askpass.cmd`). Every packaged
  Windows build uses it.
- **Git:** Git isn't bundled, so users still install Git for Windows themselves.

---

## Mac App Store

You build, archive and upload the App Store version in **Xcode**, with `macos/GitLantern.xcodeproj`
(`yarn xcode` opens it). The project has two targets:

- **Electron app** runs `macos/build-electron.sh`. That builds the bundled Git, the JavaScript, and the
  App Store variant of the Electron app with electron-builder, unsigned, into `dist/xcode/`.
- **GitLantern** is the app Xcode builds and signs. Its build phase, `macos/embed-electron.sh`, copies the
  Electron app into it and signs everything inside with the certificate Xcode picked. Then Xcode signs
  the app itself, with `macos/GitLantern.entitlements` and your provisioning profile.

So **Product → Run** starts the sandboxed app on your Mac, and **Product → Archive** makes the archive that
**Distribute App** uploads. Without Xcode, `yarn dist:mas` builds the same app as a signed `.pkg` for
Transporter.

### How the App Store version differs

Apple runs every App Store app inside the **App Sandbox**. GitLantern works around it like this:

- **It brings its own Git.** Apple's `/usr/bin/git` refuses to run in the sandbox, and Git from Homebrew is
  out of its reach. `scripts/build-mas-git.sh` compiles Git (universal, linked only against libraries that
  come with macOS) and adds Git LFS, into `build/mas-git/`. Xcode's build and `yarn dist:mas` both run
  the script, which only builds again when the versions pinned in it change. The app runs that Git from `Contents/Resources/git`,
  and Settings → Git offers no other.
- **Folders:** the app can only use folders picked in an open dialog. It keeps a security-scoped bookmark
  of each one, so Recent, open tabs and workspaces reopen after a restart (`src/main/folderAccess.ts`). A
  repository is opened by its top folder, and clones go into a folder picked with **Browse…**.
- **Your Git settings and SSH keys:** the app's home folder is its own container, so `~/.gitconfig` and
  `~/.ssh` aren't visible. **Settings → Git → Copy name and email from ~/.gitconfig…** takes your name and
  email. **Git services → SSH key → Use the keys in ~/.ssh…** copies your keys and `known_hosts` into the
  app's own `.ssh` folder, which its ssh uses. **Create an SSH key** makes a new one there.
- **Other programs:** editors and terminals open through macOS (`open -a`). External diff and merge tools
  (`git difftool` / `mergetool`) aren't offered, because they'd have to run inside the sandbox. Custom
  actions do run inside it, so some may not work.
- **Sign-in:** Git's askpass helper runs through Electron's helper app, which inherits the sandbox.
  Browser sign-in to GitLab and Gitea needs the `network.server` entitlement for its `127.0.0.1` redirect.
- **Updates** come from the App Store. The GitHub update check is off.

The sandbox entitlements are in `build/entitlements.mas.plist` (the app) and
`build/entitlements.mas.inherit.plist` (everything inside it, the bundled Git included). electron-builder
adds your Team ID and app group from the provisioning profile while signing. Xcode signs the app with
`macos/GitLantern.entitlements` instead: the same list with that group written in, which
`test/xcode.test.ts` keeps in step. `ITSAppUsesNonExemptEncryption` is set to false, so App Store Connect
doesn't ask about export compliance for each build.

### One-time setup

1. Join the [Apple Developer Program](https://developer.apple.com/programs/).
2. Install **Xcode** from the App Store and open it once to finish installing. Its compiler builds the
   bundled Git. Install [Node.js](https://nodejs.org) and Yarn 1 too, and run `yarn install` in the project
   folder: Xcode's build runs them.
3. **Certificates:** in Xcode, go to **Settings → Accounts**, sign in, then **Manage Certificates → +**. Add
   **Apple Distribution** and **Apple Development** (and **Mac Installer Distribution** if you'll also use
   `yarn dist:mas`).
4. **App ID:** on [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list), go
   to **Certificates, IDs & Profiles → Identifiers → +** and register an App ID with the explicit bundle ID
   `com.developerconcepts.gitlantern` (`appId` in `electron-builder.yml`). It needs no extra capabilities.
5. **App Store profile:** on the same site, under **Profiles → +**, create a **Mac App Store Connect**
   profile for that App ID and your Apple Distribution certificate. Name it exactly
   **GitLantern Mac App Store**: the project's Release configuration looks for it by that name. Then, in
   Xcode, go to **Settings → Accounts →** your team **→ Download Manual Profiles**.
6. **Your team in the project:** open the project with `yarn xcode`, select the **GitLantern** target, then
   **Signing & Capabilities**. Under both **Debug** and **Release**, choose your **Team**. Debug signs
   automatically, for running on your Mac. Release uses the Apple Distribution certificate and the profile
   above. This writes your team ID into the project file, which is fine to commit.
7. **App record:** in [App Store Connect](https://appstoreconnect.apple.com), go to **Apps → + → New App**.
   Choose macOS, the bundle ID above, a name, a primary language and an SKU (any ID you like, such as `gitlantern`).

For `yarn dist:mas` and `yarn dist:mas-dev` (without Xcode), electron-builder reads the profiles from files:
save the App Store profile as `build/embedded.provisionprofile`, and a **macOS App Development** profile
that includes your Mac as `build/development.provisionprofile`. Both are git-ignored, because they're tied
to your account.

### Test the sandboxed app

In Xcode, choose the **GitLantern** scheme and **My Mac**, then **Product → Run** (⌘R). The first build
takes a few minutes while it compiles Git; later ones reuse it. It builds for your Mac's processor only,
and starts the app inside the App Sandbox, signed for your Mac. (Without Xcode, `yarn dist:mas-dev` makes
the same build in `dist/mas-dev-arm64/`.)

Try what App Review will try, and what the sandbox affects:

- Open a repository, quit, start again: Recent and the open tabs come back.
- Clone over HTTPS, with and without a connected account, and push.
- Use your SSH keys, clone over SSH and push.
- Sign in to GitLab in the browser.
- Copy your name and email, then commit.
- Open a repository that uses Git LFS.
- Open in editor and Open in terminal.

If something is blocked, the sandbox logs it. To watch while you try:

```bash
log stream --style compact --predicate 'eventMessage CONTAINS "deny" AND eventMessage CONTAINS "GitLantern"'
```

### Release from Xcode

1. Raise `version` in `package.json`. Each upload needs a version App Store Connect hasn't had before.
   The version comes from there, not from Xcode's own version fields.
2. In Xcode, choose the **GitLantern** scheme and **Any Mac (Apple Silicon, Intel)**, then
   **Product → Archive**. It builds the app for both processors with the Release configuration, signs it
   with your Apple Distribution certificate, and opens the archive in the **Organizer** when it's done.
3. In the Organizer, select the archive and click **Distribute App**. Choose **App Store Connect**, then
   **Upload**. When Xcode asks about signing, choose **Manually manage signing** with your Apple
   Distribution certificate and the GitLantern Mac App Store profile. Xcode checks the app before it
   uploads. A warning about missing symbols (dSYMs) for Electron's frameworks is expected, and doesn't
   stop the upload.
4. App Store Connect emails you when the build has been processed (usually within half an hour). Then
   open the app's version page, pick the build under **Build**, and fill in the listing:
   - **Screenshots:** Mac sizes are 1280×800, 1440×900, 2560×1600 or 2880×1800. `yarn screenshots` makes
     1400×880 images, so resize or pad them.
   - **App Privacy:** GitLantern collects nothing itself. The AI commit message feature sends the staged
     changes to the provider the user sets up, with their own key, only when they use it.
   - **App Review notes:** say how to try it without an account, for example: "Choose Clone, paste
     https://github.com/octocat/Hello-World or any public repository, pick a folder with Browse…, then Clone."
5. Click **Add for Review**, then **Submit**.

Without Xcode, `yarn dist:mas` checks your certificates and profile files, builds and signs the same app,
and writes `dist/mas-universal/GitLantern-<version>-mas.pkg`. Upload that with Apple's
[Transporter](https://apps.apple.com/app/transporter/id1450874784) app instead of steps 2 and 3.

If the archive fails, Xcode's **Report navigator** (⌘9) shows each build step's output. The two
GitLantern steps print lines starting with `error:` when something's missing, such as Node.js or
`yarn install`.

### Licences of the bundled programs

The App Store version ships Git (GPL-2.0, with some LGPL-2.1 parts) and Git LFS (MIT). Their licences, and
the exact source each was built from, are in `GitLantern.app/Contents/Resources/git/licenses/`. The GPL
asks that whoever receives Git can get its source: keep a copy of the Git source tarball named there, for
example attached to each GitHub release. Whether the App Store's terms are compatible with the GPL is
disputed (the Free Software Foundation says they aren't), so get advice if that matters to you.

### Outside the App Store: notarised DMG

1. Join the [Apple Developer Program](https://developer.apple.com/programs/).
2. In Xcode, go to **Settings → Accounts → Manage Certificates**, and add a **Developer ID Application**
   certificate.
3. Create an app-specific password at [account.apple.com](https://account.apple.com) (Sign-In and
   Security). Your Team ID is under Membership details on developer.apple.com.
4. Build with notarisation (electron-builder notarises automatically when these are set):

   ```bash
   APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx APPLE_TEAM_ID=ABCDE12345 yarn dist:mac
   ```

5. Attach the DMG to a GitHub release. It opens without the Gatekeeper warning.
