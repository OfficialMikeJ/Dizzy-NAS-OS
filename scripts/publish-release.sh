#!/bin/bash
# Publish a DizzyOS release to GitHub. Every NAS that checks in afterwards
# sees it and offers the update — no new ISO, no matter how old the device is.
#
#   wsl -d Ubuntu
#   cd /mnt/c/Users/Desktop/DizzyOS && ./scripts/publish-release.sh
#
# Requires: gh (authenticated — run `gh auth login` once).
# Bump the version in server/package.json first; add any new system packages
# to iso/payload/setup.sh so the update can fix system-level bugs too.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$REPO_DIR/server/package.json').version")
TAG="v$VERSION"
NAME="dizzyos-$VERSION"
OUT="$REPO_DIR/release"

# The package must be built on Linux (native node_modules), but gh is often
# only installed on the Windows side when developing under WSL. Windows PATH
# interop makes gh.exe callable from here, so use whichever exists.
GH=$(command -v gh || command -v gh.exe || true)
[ -n "$GH" ] || { echo "gh CLI is required: https://cli.github.com (install in WSL, or on Windows for interop)"; exit 1; }
"$GH" auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first"; exit 1; }

SLUG="${GITHUB_REPO:-$("$GH" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null | tr -d '\r' || true)}"
[ -n "$SLUG" ] || { echo "Set GITHUB_REPO=owner/name (no git remote detected)"; exit 1; }
echo "[publish] $SLUG — DizzyOS $VERSION"

if "$GH" release view "$TAG" --repo "$SLUG" >/dev/null 2>&1; then
  echo "[publish] release $TAG already exists. Bump the version or delete it:"
  echo "          gh release delete $TAG --repo $SLUG --yes"
  exit 1
fi

# 1. Build the package (tarball + sha256 + manifest)
RELEASE_URL="https://github.com/$SLUG/releases/download/$TAG/$NAME.tar.gz" \
  "$REPO_DIR/scripts/make-release.sh"

TARBALL="$OUT/$NAME.tar.gz"
SHA=$(sha256sum "$TARBALL" | cut -d' ' -f1)
echo "$SHA  $NAME.tar.gz" > "$OUT/$NAME.tar.gz.sha256"

# 2. Release notes: NOTES env, else the notes already in manifest.json
NOTES="${NOTES:-$(node -p "require('$OUT/manifest.json').notes.map(n=>'- '+n).join('\n')" 2>/dev/null || echo '- Maintenance release')}"
BODY=$(cat <<EOF
$NOTES

**Install from the dashboard:** System Update → Check → Install.
Existing installs keep their storage pool, shares and containers; the previous
release stays on disk for one-click rollback.

sha256: \`$SHA\`
EOF
)

# 3. Publish. manifest.json is what devices poll via the stable
#    /releases/latest/download/manifest.json URL, so it must be attached.
echo "[publish] creating $TAG"
"$GH" release create "$TAG" \
  "$TARBALL" \
  "$OUT/$NAME.tar.gz.sha256" \
  "$OUT/manifest.json" \
  --repo "$SLUG" \
  --target main \
  --title "DizzyOS $VERSION" \
  --notes "$BODY"

echo
echo "[publish] done — https://github.com/$SLUG/releases/tag/$TAG"
echo "[publish] devices poll: https://github.com/$SLUG/releases/latest/download/manifest.json"
