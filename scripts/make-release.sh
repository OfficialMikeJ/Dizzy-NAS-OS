#!/bin/bash
# Build a DizzyOS update package: dizzyos-<version>.tar.gz + manifest.json
#
#   wsl -d Ubuntu
#   cd /mnt/c/Users/Desktop/DizzyOS && ./scripts/make-release.sh
#
# Bump the version in server/package.json first. Output lands in release/.
# Host the two files anywhere reachable (GitHub Releases, a web server, even
# a share) and point the NAS at the manifest URL.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/release"
VERSION=$(node -p "require('$REPO/server/package.json').version")
NAME="dizzyos-$VERSION"
STAGE="$OUT/$NAME"

echo "[release] building DizzyOS $VERSION"
rm -rf "$STAGE"
mkdir -p "$STAGE/server" "$STAGE/webui"

# 1. Web UI
if [ ! -d "$REPO/webui/dist" ] || [ -n "${REBUILD_UI:-}" ]; then
  echo "[release] building web UI"
  (cd "$REPO/webui" && npm install --no-audit --no-fund >/dev/null && npm run build >/dev/null)
fi
cp -r "$REPO/webui/dist" "$STAGE/webui/dist"

# 2. Server + Linux-built production dependencies
cp -r "$REPO/server/src" "$REPO/server/package.json" "$STAGE/server/"
echo "[release] installing production dependencies (linux)"
(cd "$STAGE/server" && npm install --omit=dev --no-audit --no-fund >/dev/null)

# 3. Release metadata + system setup script
cp "$REPO/iso/payload/setup.sh" "$REPO/iso/payload/dizzyos-server.service" "$STAGE/"
echo "$VERSION" > "$STAGE/VERSION"

# 4. Pack
TARBALL="$OUT/$NAME.tar.gz"
rm -f "$TARBALL"
tar -czf "$TARBALL" -C "$OUT" "$NAME"
SHA=$(sha256sum "$TARBALL" | cut -d' ' -f1)
SIZE=$(du -h "$TARBALL" | cut -f1)

# 5. Release notes. These are what the dashboard shows a NAS owner before
#    they install, so never ship a placeholder: use $NOTES if given, else
#    derive them from the commits since the previous tag.
if [ -n "${NOTES:-}" ]; then
  NOTE_SRC="$NOTES"
else
  PREV_TAG=$(git -C "$REPO" describe --tags --abbrev=0 2>/dev/null || true)
  RANGE=${PREV_TAG:+$PREV_TAG..HEAD}
  NOTE_SRC=$(git -C "$REPO" log --no-merges --format='%s' ${RANGE:-HEAD} 2>/dev/null | head -10)
  [ -n "$NOTE_SRC" ] || NOTE_SRC="Maintenance release"
fi

# Build the manifest with node so quoting/escaping in notes can't corrupt it.
NOTES_RAW="$NOTE_SRC" \
MF_VERSION="$VERSION" \
MF_URL="${RELEASE_URL:-https://example.com/dizzyos/$NAME.tar.gz}" \
MF_SHA="$SHA" \
MF_DATE="$(date -u +%Y-%m-%d)" \
node -e '
  const notes = (process.env.NOTES_RAW || "")
    .split("\n")
    .map(l => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  process.stdout.write(JSON.stringify({
    version: process.env.MF_VERSION,
    released: process.env.MF_DATE,
    url: process.env.MF_URL,
    sha256: process.env.MF_SHA,
    notes: notes.length ? notes : ["Maintenance release"],
  }, null, 2) + "\n");
' > "$OUT/manifest.json"

# Checksum file published alongside, so the package can be verified by hand.
(cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")

rm -rf "$STAGE"
echo
echo "[release] $TARBALL ($SIZE)"
echo "[release] sha256: $SHA"
echo "[release] manifest: $OUT/manifest.json"
echo "[release] notes:"
node -p "require('$OUT/manifest.json').notes.map(n => '            - ' + n).join('\n')"
echo
echo "Install it on the NAS without any hosting:"
echo "  scp $TARBALL dizzy@<nas-ip>:/tmp/"
echo "  ssh dizzy@<nas-ip> 'sudo dizzyos-update /tmp/$NAME.tar.gz'"
