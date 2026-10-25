# Releasing Git Steve

Every build is a [Yarn](https://classic.yarnpkg.com) command. Install Yarn 1 once (`npm install -g yarn`,
or `corepack enable`), then run `yarn install` in the project folder.

| Command | Builds | Run it on | Output in `dist/` |
|---|---|---|---|
| `yarn dist:win` | Windows installer to share directly (NSIS) | Windows | `Git Steve Setup <version>.exe` |
| `yarn dist:mac` | macOS disk image to share directly | Mac | `Git Steve-<version>.dmg` |
| `yarn dist:msstore` | **Microsoft Store** packages, x64 and ARM64 | Windows 10 / 11 | `Git Steve-<version>-x64.appx`, `…-arm64.appx` |
| `yarn dist:msstore-test` | The Store package, installable on your own PC for testing | Windows 11 | `Git Steve-<version>-x64-test.appx` |
| `yarn dist:mas` | **Mac App Store** package (Apple silicon + Intel) | Mac | `mas-universal/Git Steve-<version>-mas.pkg` |
| `yarn dist:mas-dev` | Sandboxed build that runs on your own Mac, for testing | Mac | `mas-dev…/Git Steve.app` |

The store commands check your setup first and stop with a message saying what's missing.

**Before every release:**

1. Raise `version` in `package.json`. Both stores reject an upload whose version isn't higher than
   the last one.
2. Run `yarn typecheck` and `yarn test`.

The app icon is `build/icon.png` (macOS) and `build/icon.ico` (Windows). The Store tile images are in
`build/appx/`. `scripts/make_icons.py` draws all of them; change it and run `python scripts/make_icons.py`
(needs [Pillow](https://pypi.org/project/pillow/)) to update them together.

---

## Microsoft Store

You don't need a code-signing certificate: Microsoft signs Store packages for you. Users get Git Steve
with no SmartScreen warning, and updates come through the Store.

### One-time setup

1. **Create a developer account** in [Partner Center](https://partner.microsoft.com/dashboard)
   (Apps and games). Check the sign-up page for the current fee.
2. **Reserve the name.** Go to **Apps and games → New product → MSIX or PWA app**, and reserve
   *Git Steve*. If the name is taken, reserve another one and change `appx.displayName` in
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
Add-AppxPackage -Path "dist\Git Steve-0.1.0-x64-test.appx" -AllowUnsigned
```

That package is unsigned, so Windows only installs it with `-AllowUnsigned` and it can't be uploaded.
It installs for all users. Remove it afterwards with
`Get-AppxPackage *GitSteve* -AllUsers | Remove-AppxPackage -AllUsers`.

### Submit

1. In Partner Center, open the app and click **Start your submission**.
2. **Packages:** drag in both `.appx` files from `dist/`.
3. **Properties:** category *Developer tools*. In **System requirements**, note that Git for Windows must be
   installed.
4. **Store listings:** description, and at least one screenshot. The images in `docs/screenshots/`
   work. Mention in the description that Git must be installed.
5. **Privacy policy URL:** required, because Git Steve stores access tokens. Explain what's stored and
   that it stays on the user's computer (see "Where your data lives" in the README).
6. **Restricted capability:** Partner Center asks why the app uses `runFullTrust`. Every desktop app
   packaged this way declares it. A suitable answer: "Desktop Git client: runs Git and SSH on the user's
   computer."
7. **Age ratings** and **Pricing and availability**, then **Submit to the Store**.

Certification usually takes a few days. Partner Center emails you with the result.

### How the Store version differs

- **Settings location:** Windows stores files the app creates in AppData in a private per-app folder,
  `%LOCALAPPDATA%\Packages\<package family name>\LocalCache\Roaming\Git Steve`. Uninstalling the app
  deletes it.
- **Sign-in helper:** other programs can't always see that private folder, so the sign-in helper that Git
  runs ships inside the app instead of being written to AppData (`resources/askpass.cmd`). Every packaged
  Windows build uses it.
- **Git:** Git isn't bundled, so users still install Git for Windows themselves.

---

## Mac App Store

> **Not ready for submission yet.** `yarn dist:mas` builds and signs a correct Mac App Store package,
> but Apple requires every App Store app to run inside the **App Sandbox**, and Git Steve can't do its
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
   explicit bundle ID `com.developerconcepts.gitsteve` (`appId` in `electron-builder.yml`).
3. **Profiles:** on the same site, under **Profiles**, create the following and save them with these exact names:
   - **Mac App Store Connect** (distribution) → `build/embedded.provisionprofile`
   - **macOS App Development**, including your Mac → `build/development.provisionprofile`

   Both are git-ignored, because they're tied to your account.
4. **App record:** in [App Store Connect](https://appstoreconnect.apple.com), go to **Apps → + → New App**
   (macOS). Pick the bundle ID above.
5. Build with `yarn dist:mas-dev` and test the sandboxed app on your Mac. Then run `yarn dist:mas`.
6. Upload `dist/mas-universal/Git Steve-<version>-mas.pkg` with Apple's
   [Transporter](https://apps.apple.com/app/transporter/id1450874784) app. Then pick the build in App Store
   Connect, fill in the listing, and submit it for review.

The sandbox entitlements are in `build/entitlements.mas.plist` (the app) and
`build/entitlements.mas.inherit.plist` (Electron's helpers). electron-builder adds your Team ID and app
group from the provisioning profile while signing. App Store Connect also asks an export-compliance
question about encryption for each build.
