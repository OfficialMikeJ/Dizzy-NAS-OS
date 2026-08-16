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

# 5. Manifest — edit "url" to wherever you host the tarball, and "notes"
cat > "$OUT/manifest.json" <<EOF
{
  "version": "$VERSION",
  "released": "$(date -u +%Y-%m-%d)",
  "url": "${RELEASE_URL:-https://example.com/dizzyos/$NAME.tar.gz}",
  "sha256": "$SHA",
  "notes": [
    "Describe what changed in this release here."
  ]
}
EOF

rm -rf "$STAGE"
echo
echo "[release] $TARBALL ($SIZE)"
echo "[release] sha256: $SHA"
echo "[release] manifest: $OUT/manifest.json  ← set \"url\" and \"notes\" before publishing"
echo
echo "Install it on the NAS without any hosting:"
echo "  scp $TARBALL dizzy@<nas-ip>:/tmp/"
echo "  ssh dizzy@<nas-ip> 'sudo dizzyos-update /tmp/$NAME.tar.gz'"
