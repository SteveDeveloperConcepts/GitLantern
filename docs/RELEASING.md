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
| `yarn dist:mas` | **Mac App Store** package (Apple silicon + Intel) | Mac | `mas-universal/GitLantern-<version>-mas.pkg` |
| `yarn dist:mas-dev` | Sandboxed build that runs on your own Mac, for testing | Mac | `mas-dev…/GitLantern.app` |

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

> **Not ready for submission yet.** `yarn dist:mas` builds and signs a correct Mac App Store package,
> but Apple requires every App Store app to run inside the **App Sandbox**, and GitLantern can't do its
> main job there yet:
>
> - **Git won't start.** Apple's `/usr/bin/git` refuses to run inside a sandboxed app. Git installed by
>   Homebrew or Xcode sits outside the folders a sandboxed app may use. The app would need its own copy
>   of Git inside the bundle. Git is GPL-2.0 software, and whether GPL code may be distributed through the
>   App Store is legally disputed, so get advice before shipping it that way.
> - **Your settings and keys aren't visible.** In the sandbox, the home folder is the app's own container.
>   Your `~/.gitconfig` (the name and email on your commits), `~/.ssh` keys and `known_hosts` can't be
>   seen.
> - **Recent repositories don't reopen.** The sandbox only allows folders picked in the open dialog,
>   until the app is restarted. Remembering them needs security-scoped bookmarks. The entitlement is
>   already set; the code isn't written.
> - **The sign-in helper** should run through Electron's helper app, which has the sandbox-inherit
>   entitlement, rather than the main app binary.
>
> Until that's done, ship the Mac version directly instead: a **Developer ID-signed, notarised DMG** from
> `yarn dist:mac` (below). Most desktop Git clients for the Mac are distributed this way.

### Recommended for now: notarised DMG

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

### Mac App Store setup, for when the app is sandbox-ready

1. **Certificates:** in Xcode, go to **Settings → Accounts → Manage Certificates**. Add **Apple Distribution**
   and **Mac Installer Distribution**. Add **Apple Development** too, for `dist:mas-dev`.
2. **App ID:** on developer.apple.com, go to **Certificates, IDs & Profiles → Identifiers**. Register the
   explicit bundle ID `com.developerconcepts.gitlantern` (`appId` in `electron-builder.yml`).
3. **Profiles:** on the same site, under **Profiles**, create the following and save them with these exact names:
   - **Mac App Store Connect** (distribution) → `build/embedded.provisionprofile`
   - **macOS App Development**, including your Mac → `build/development.provisionprofile`

   Both are git-ignored, because they're tied to your account.
4. **App record:** in [App Store Connect](https://appstoreconnect.apple.com), go to **Apps → + → New App**
   (macOS). Pick the bundle ID above.
5. Build with `yarn dist:mas-dev` and test the sandboxed app on your Mac. Then run `yarn dist:mas`.
6. Upload `dist/mas-universal/GitLantern-<version>-mas.pkg` with Apple's
   [Transporter](https://apps.apple.com/app/transporter/id1450874784) app. Then pick the build in App Store
   Connect, fill in the listing, and submit it for review.

The sandbox entitlements are in `build/entitlements.mas.plist` (the app) and
`build/entitlements.mas.inherit.plist` (Electron's helpers). electron-builder adds your Team ID and app
group from the provisioning profile while signing. App Store Connect also asks an export-compliance
question about encryption for each build.
