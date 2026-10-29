#!/usr/bin/env bash
# Build phase of the "Electron app" target in GitLantern.xcodeproj. It builds GitLantern's Mac App Store
# version, unsigned, into dist/xcode: the bundled Git (scripts/build-mas-git.sh), the JavaScript, then the
# app (electron-builder). The GitLantern target then puts that app into the one Xcode builds and signs it
# (embed-electron.sh). Archive builds for Apple silicon and Intel; Build and Run only for this Mac, which
# is quicker.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/dist/xcode"

fail() {
  # Xcode lists lines that start with "error:" as build errors.
  echo "error: $1" >&2
  exit 1
}

# Xcode starts build scripts with a short PATH, so look for Node.js where it's usually installed.
tools=/usr/bin:/bin:/usr/sbin:/sbin
for dir in /usr/local/bin /opt/homebrew/bin "$HOME/.volta/bin"; do
  if [ -x "$dir/node" ]; then tools="$dir:$tools"; fi
done
if ! PATH="$tools" command -v node >/dev/null; then
  nvm_node=$(
    set +eu
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 && nvm which default 2>/dev/null
  ) || true
  if [ -n "$nvm_node" ] && [ -x "$nvm_node" ]; then tools="$(dirname "$nvm_node"):$tools"; fi
fi
PATH="$tools" command -v node >/dev/null || fail "Xcode can't find Node.js. Install it (https://nodejs.org, or brew install node), then build again."
[ -d "$root/node_modules" ] || fail "Run yarn install in $root first, then build again."

# Xcode's build settings arrive as environment variables, and make, Node and electron-builder would take
# some of them (SDKROOT, ARCHS…) as their own. So each step gets a plain environment.
run() {
  env -i HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-}" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
    PATH="$tools" "$@"
}

cd "$root"
name=$(run node -p "require('./package.json').productName")
run bash scripts/build-mas-git.sh
run node_modules/.bin/electron-vite build
if [ "${ACTION:-build}" = install ]; then
  arch=--universal
elif [ "$(uname -m)" = arm64 ]; then
  arch=--arm64
else
  arch=--x64
fi
rm -rf "$out"
# No signature: the GitLantern target signs it with the certificate Xcode picks.
run node_modules/.bin/electron-builder --mac mas "$arch" --publish never -c.mac.identity=null -c.directories.output=dist/xcode

built=$(find "$out" -maxdepth 2 -type d -name "$name.app" | head -1 || true)
[ -n "$built" ] || fail "electron-builder made no $name.app in dist/xcode"
mkdir -p "$out/app"
mv "$built" "$out/app/$name.app"
# Xcode makes the app's Info.plist from this copy (INFOPLIST_FILE), and fills in your team: Electron's App
# Store version reads ElectronTeamID.
cp "$out/app/$name.app/Contents/Info.plist" "$out/Info.plist"
/usr/libexec/PlistBuddy -c 'Delete :ElectronTeamID' "$out/Info.plist" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c 'Add :ElectronTeamID string $(DEVELOPMENT_TEAM)' "$out/Info.plist"
echo "Built $name.app ($arch) for Xcode"
