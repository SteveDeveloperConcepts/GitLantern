#!/usr/bin/env bash
# Builds the Git that the Mac App Store version of GitLantern carries inside its app, into build/mas-git
# (git-ignored). Apple's /usr/bin/git refuses to run inside the App Sandbox, and Git from Homebrew or Xcode
# is outside the folders a sandboxed app may use, so that version brings its own.
#
# One universal (Apple silicon and Intel) git, relocatable (RUNTIME_PREFIX: it finds its helper programs
# next to itself), linked against macOS's own libraries only, plus Git LFS. `yarn dist:mas` runs this, and
# it does nothing when build/mas-git already has these versions (--force builds again). Needs a Mac with
# Xcode or its command line tools.
#
# What it makes (src/main/git/resolveGit.ts runs libexec/git-core/git):
#   libexec/git-core/git       the one git binary
#   libexec/git-core/…         git's helper programs and scripts, and git-lfs
#   share/git-core/templates   what `git init` copies into a new repository
#   etc/gitconfig              system-wide settings: the Git LFS filter
#   licenses/                  Git's and Git LFS's licences, and where their source is
set -euo pipefail

GIT_VERSION=2.56.0
GIT_SHA256=26c56c296b38c0695b26fa95f475f1d01704d2d38e73465ca30b0b2f5dc789d3
LFS_VERSION=3.8.0
LFS_SHA256_ARM64=caff76a7d070d8160c89bc39b6e85d98f24135b6fed038a3b4de2590d25102d8
LFS_SHA256_AMD64=f1c17aeca0b4eaab9ea606226477dbed3b84b56fe0811a9f967d2ea2b2393c53
# Electron's own minimum.
MACOS_MIN=12.0

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/build/mas-git"
core="$out/libexec/git-core"
stamp="git $GIT_VERSION, git-lfs $LFS_VERSION, macOS $MACOS_MIN"

fail() {
  echo "✖ $1" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "The Mac App Store Git is built on a Mac."
if [ "${1:-}" != --force ] && [ -f "$out/VERSION" ] && [ "$(cat "$out/VERSION")" = "$stamp" ]; then
  echo "✔ build/mas-git already has $stamp"
  exit 0
fi
xcrun --find clang >/dev/null 2>&1 || fail "Install Xcode's command line tools first: xcode-select --install"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Download $1 to $2 and check it against the SHA-256 $3.
fetch() {
  curl -fsSL --retry 3 -o "$2" "$1"
  echo "$3  $2" | shasum -a 256 -c - >/dev/null || fail "$1 doesn't have the expected SHA-256"
}

echo "• Building Git $GIT_VERSION"
fetch "https://mirrors.edge.kernel.org/pub/software/scm/git/git-$GIT_VERSION.tar.xz" "$work/git.tar.xz" "$GIT_SHA256"
tar -xJf "$work/git.tar.xz" -C "$work"
src="$work/git-$GIT_VERSION"
arch_flags="-arch arm64 -arch x86_64 -mmacosx-version-min=$MACOS_MIN"
make_args=(
  prefix=/
  RUNTIME_PREFIX=YesPlease
  CFLAGS="-O2 $arch_flags"
  LDFLAGS="$arch_flags"
  # The compiler can't write dependency files when it builds for two architectures at once.
  COMPUTE_HEADER_DEPENDENCIES=no
  # Only libraries that come with macOS: none from Homebrew, Fink or MacPorts, and the system's curl.
  NO_HOMEBREW=YesPlease
  NO_FINK=YesPlease
  NO_DARWIN_PORTS=YesPlease
  CURL_CONFIG=/usr/bin/curl-config
  # Nothing GitLantern runs needs these, and each would bring more to ship.
  NO_RUST=YesPlease
  NO_GETTEXT=YesPlease
  NO_PERL=YesPlease
  NO_PYTHON=YesPlease
  NO_TCLTK=YesPlease
  NO_EXPAT=YesPlease
  # No dashed copies of the built-in commands, and no hard links (the app bundle can't have them).
  SKIP_DASHED_BUILT_INS=YesPlease
  NO_INSTALL_HARDLINKS=YesPlease
  INSTALL_STRIP=-s
)
make -C "$src" -j "$(sysctl -n hw.ncpu)" "${make_args[@]}" all >/dev/null
make -C "$src" "${make_args[@]}" DESTDIR="$work/stage" install >/dev/null
stage="$work/stage"

rm -rf "$out"
mkdir -p "$out/libexec" "$out/share/git-core" "$out/etc" "$out/licenses"
cp -R "$stage/libexec/git-core" "$core"
cp -R "$stage/share/git-core/templates" "$out/share/git-core/templates"
# bin/ isn't shipped: the app runs git from libexec/git-core, where git looks for its helpers first.
rm -f "$core/git"
cp "$stage/bin/git" "$core/git"
# Servers, mail, and the stubs left for the Perl and Python commands: GitLantern uses none of them.
for name in git-daemon git-http-backend git-http-push git-imap-send git-shell scalar git-cvsserver \
  git-remote-ftp git-remote-ftps git-instaweb git-archimport git-cvsexportcommit git-cvsimport \
  git-send-email git-svn git-p4 git-citool git-gui git-gui--askpass gitk; do
  rm -rf "${core:?}/$name"
done
# Git's transports start these by their dashed names (a clone of a local repository runs git-upload-pack):
# one-line scripts into the one binary instead of a copy of it each. Removed first, as any of them may be a
# link, and writing through a link would overwrite what it points to.
for command in upload-pack receive-pack upload-archive; do
  rm -f "$core/git-$command"
  printf '#!/bin/sh\nexec "${0%%/*}/git" %s "$@"\n' "$command" >"$core/git-$command"
  chmod 755 "$core/git-$command"
done
rm -f "$core/git-remote-https"
printf '#!/bin/sh\nexec "${0%%/*}/git-remote-http" "$@"\n' >"$core/git-remote-https"
chmod 755 "$core/git-remote-https"
cp "$src/COPYING" "$out/licenses/git-COPYING"
if [ -f "$src/LGPL-2.1" ]; then cp "$src/LGPL-2.1" "$out/licenses/git-LGPL-2.1"; fi

echo "• Adding Git LFS $LFS_VERSION"
for arch in arm64 amd64; do
  sum="LFS_SHA256_$(echo "$arch" | tr '[:lower:]' '[:upper:]')"
  fetch "https://github.com/git-lfs/git-lfs/releases/download/v$LFS_VERSION/git-lfs-darwin-$arch-v$LFS_VERSION.zip" "$work/lfs-$arch.zip" "${!sum}"
  mkdir "$work/lfs-$arch"
  unzip -q "$work/lfs-$arch.zip" -d "$work/lfs-$arch"
done
lfs_arm64=$(find "$work/lfs-arm64" -type f -name git-lfs | head -1 || true)
lfs_amd64=$(find "$work/lfs-amd64" -type f -name git-lfs | head -1 || true)
[ -n "$lfs_arm64" ] && [ -n "$lfs_amd64" ] || fail "The Git LFS downloads have no git-lfs program in them"
lipo -create "$lfs_arm64" "$lfs_amd64" -output "$core/git-lfs"
chmod 755 "$core/git-lfs"
licence=$(find "$work/lfs-arm64" -type f -name 'LICENSE*' | head -1 || true)
if [ -n "$licence" ]; then
  cp "$licence" "$out/licenses/git-lfs-LICENSE.md"
else
  curl -fsSL --retry 3 -o "$out/licenses/git-lfs-LICENSE.md" "https://raw.githubusercontent.com/git-lfs/git-lfs/v$LFS_VERSION/LICENSE.md"
fi

cat >"$out/etc/gitconfig" <<'EOF'
# System-wide settings of the Git inside GitLantern. Your own ~/.gitconfig and each repository's config
# come after these. Git LFS is built in, so its filter is always on, as in Git for Windows.
[filter "lfs"]
	clean = git-lfs clean -- %f
	smudge = git-lfs smudge -- %f
	process = git-lfs filter-process
	required = true
EOF

cat >"$out/licenses/README" <<EOF
GitLantern runs these programs, which aren't part of GitLantern itself.

Git $GIT_VERSION
  GNU General Public License version 2 (git-COPYING); some parts are under the LGPL 2.1 (git-LGPL-2.1).
  Built unchanged from https://mirrors.edge.kernel.org/pub/software/scm/git/git-$GIT_VERSION.tar.xz
  by scripts/build-mas-git.sh in GitLantern's source: https://github.com/SteveDeveloperConcepts/GitLantern

Git LFS $LFS_VERSION
  MIT License (git-lfs-LICENSE.md).
  From https://github.com/git-lfs/git-lfs/releases/tag/v$LFS_VERSION
EOF

echo "• Checking it"
[ -z "$(find "$out" -type l)" ] || fail "build/mas-git has symbolic links: $(find "$out" -type l | tr '\n' ' ')"
while IFS= read -r -d '' file; do
  [[ "$(file -b "$file")" == Mach-O* ]] || continue
  name="${file#"$out"/}"
  archs=" $(lipo -archs "$file") "
  [[ "$archs" == *" arm64 "* && "$archs" == *" x86_64 "* ]] || fail "$name isn't universal:$archs"
  # Libraries are listed indented, under a heading per architecture.
  foreign=$(otool -L "$file" | grep -E '^[[:space:]]' | awk '{print $1}' | grep -v -E '^(/usr/lib/|/System/Library/)' || true)
  [ -z "$foreign" ] || fail "$name needs libraries that don't come with macOS: $foreign"
  # strip leaves the linker's signature invalid, and Apple silicon won't start a binary without a valid
  # one. This ad-hoc signature is for the checks below; electron-builder signs them all with the app.
  codesign --force --sign - "$file" 2>/dev/null || fail "Couldn't sign $name"
done < <(find "$out" -type f -perm -u+x -print0)

git="$core/git"
# Your own Git settings stay out of the checks (the system file, etc/gitconfig, is the one built here).
export GIT_CONFIG_GLOBAL=/dev/null
exec_path=$("$git" --exec-path) || fail "The git built here doesn't start"
[ "$(cd "$exec_path" && pwd -P)" = "$(cd "$core" && pwd -P)" ] || fail "git doesn't find its helpers next to itself: $exec_path"
"$git" lfs version >/dev/null || fail "git lfs doesn't run"
smoke="$work/smoke"
"$git" init -q -b main "$smoke/a"
[ -f "$smoke/a/.git/hooks/pre-commit.sample" ] || fail "git init didn't find its templates"
"$git" -C "$smoke/a" -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m test
# --no-local goes through git-upload-pack, as a fetch from another folder does.
"$git" clone -q --no-local "$smoke/a" "$smoke/b" || fail "a clone of a local repository failed"
# HTTPS through git-remote-https and macOS's curl.
GIT_TERMINAL_PROMPT=0 "$git" ls-remote https://github.com/git/git HEAD >/dev/null || fail "git can't reach https://github.com"

echo "$stamp" >"$out/VERSION"
echo "✔ build/mas-git: $("$git" --version), $("$git" lfs version | cut -d' ' -f1), $(du -sh "$out" | cut -f1)"
