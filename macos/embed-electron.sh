#!/usr/bin/env bash
# Build phase of the GitLantern target in GitLantern.xcodeproj. It puts the Electron app that
# build-electron.sh made into the app Xcode is building, then signs everything inside it with the
# certificate Xcode signs with, and the entitlements that inherit the App Sandbox. Xcode itself signs the
# app last, with GitLantern.entitlements and your provisioning profile.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
built="$root/dist/xcode/app/$PRODUCT_NAME.app/Contents"
dest="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH"

fail() {
  echo "error: $1" >&2
  exit 1
}

[ -d "$built" ] || fail "There's no dist/xcode/app/$PRODUCT_NAME.app. The Electron app target builds it: build the GitLantern scheme."
mkdir -p "$dest"
# All of it except what Xcode makes itself: the Info.plist (made from Electron's), PkgInfo, the
# provisioning profile and the app's own signature.
rsync -a --delete --exclude /Info.plist --exclude /PkgInfo --exclude /embedded.provisionprofile --exclude /_CodeSignature \
  "$built/" "$dest/"

identity="${EXPANDED_CODE_SIGN_IDENTITY:-}"
if [ "${CODE_SIGNING_ALLOWED:-YES}" != YES ] || [ -z "$identity" ]; then
  echo "warning: Code signing is off, so this app won't start in the App Sandbox. Choose your team under Signing & Capabilities."
  exit 0
fi
flags=(--force --sign "$identity" --entitlements "$root/build/entitlements.mas.inherit.plist")
# Like Xcode's own Debug signatures, without asking Apple's timestamp server.
if [ "${CONFIGURATION:-}" = Debug ]; then flags+=(--timestamp=none); fi

# codesign works from the inside out: every program and library first (the bundled Git, and those inside
# Electron's framework and helper apps), then the bundles that hold them, the deepest first.
list=$(mktemp)
trap 'rm -f "$list"' EXIT
while IFS= read -r -d '' file; do
  if [[ "$(file -b "$file")" == Mach-O* ]]; then printf '%s\n' "$file" >>"$list"; fi
done < <(find "$dest/Frameworks" "$dest/Resources" -type f -print0)
find "$dest/Frameworks" -type d \( -name '*.app' -o -name '*.framework' \) >>"$list"
awk -F/ '{ print NF "\t" $0 }' "$list" | sort -rn | cut -f2- | while IFS= read -r item; do
  /usr/bin/codesign "${flags[@]}" "$item" || fail "Couldn't sign ${item#"$dest"/}"
done
echo "Signed what's inside $PRODUCT_NAME.app with ${EXPANDED_CODE_SIGN_IDENTITY_NAME:-$identity}"
