#!/bin/bash
# DizzyOS ISO builder — run inside WSL Ubuntu (or any Linux with xorriso).
#
#   cd /mnt/c/Users/Desktop/DizzyOS/iso && sudo ./build.sh
#
# Takes a stock Debian netinst ISO, injects the preseed + DizzyOS payload
# (server + built web UI + installer), patches the boot menus for zero-touch
# install, and repacks a BIOS+UEFI bootable custom-nas-os.iso.
#
# The base ISO is looked for in this order:
#   1. $ISO_PATH (env override)
#   2. the already-downloaded copy in Windows Downloads
#   3. any debian-*-netinst.iso in iso/cache/
set -euo pipefail

DEFAULT_LOCAL_ISO="/mnt/c/Users/Desktop/Downloads/debian-13.6.0-amd64-netinst.iso"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
CACHE="$HERE/cache"
WORK="$HERE/work"
OUT="$HERE/out"
EXTRACT="$WORK/iso"

command -v xorriso >/dev/null || { echo "xorriso is required (apt install xorriso)"; exit 1; }

# ── 1. Locate the base ISO ───────────────────────────────────────────────────
BASE_ISO="${ISO_PATH:-}"
if [ -z "$BASE_ISO" ] && [ -f "$DEFAULT_LOCAL_ISO" ]; then
  BASE_ISO="$DEFAULT_LOCAL_ISO"
fi
if [ -z "$BASE_ISO" ]; then
  BASE_ISO="$(ls -1 "$CACHE"/debian-*-netinst.iso 2>/dev/null | head -n1 || true)"
fi
[ -n "$BASE_ISO" ] && [ -f "$BASE_ISO" ] || {
  echo "No Debian netinst ISO found. Set ISO_PATH=/path/to/debian-netinst.iso"; exit 1;
}
echo "[build] base ISO: $BASE_ISO"

mkdir -p "$CACHE" "$OUT"
rm -rf "$WORK"
mkdir -p "$EXTRACT"

# ── 2. Web UI build ──────────────────────────────────────────────────────────
if [ ! -d "$REPO/webui/dist" ]; then
  echo "[build] webui/dist missing — building it"
  command -v npm >/dev/null || { echo "npm required to build the web UI"; exit 1; }
  (cd "$REPO/webui" && npm install --no-audit --no-fund && npm run build)
fi

# ── 3. Extract the stock ISO + capture its exact boot/repack arguments ──────
echo "[build] extracting base ISO"
xorriso -osirrox on -indev "$BASE_ISO" -extract / "$EXTRACT" 2>/dev/null
chmod -R u+w "$EXTRACT"
xorriso -indev "$BASE_ISO" -report_el_torito as_mkisofs > "$WORK/mkisofs_args.txt" 2>/dev/null

# ── 4. Inject preseed + payload ──────────────────────────────────────────────
echo "[build] injecting preseed and DizzyOS payload"
cp "$HERE/preseed/preseed.cfg" "$EXTRACT/preseed.cfg"

PAYLOAD="$EXTRACT/dizzyos"
mkdir -p "$PAYLOAD/server" "$PAYLOAD/webui"
cp -r "$REPO/server/src" "$REPO/server/package.json" "$PAYLOAD/server/"
cp -r "$REPO/webui/dist" "$PAYLOAD/webui/dist"
cp "$HERE/payload/install-dizzyos.sh" \
   "$HERE/payload/setup.sh" \
   "$HERE/payload/dizzyos-update" \
   "$HERE/payload/dizzyos-server.service" \
   "$HERE/payload/dizzyos-firstboot.service" "$PAYLOAD/"
chmod +x "$PAYLOAD/install-dizzyos.sh" "$PAYLOAD/setup.sh" "$PAYLOAD/dizzyos-update"
node -p "require('$REPO/server/package.json').version" > "$PAYLOAD/VERSION" 2>/dev/null \
  || grep -oP '"version":\s*"\K[^"]+' "$REPO/server/package.json" > "$PAYLOAD/VERSION"
echo "[build] release version: $(cat "$PAYLOAD/VERSION")"

# Bundle Linux-built production dependencies so first boot needs no npm network.
# (Built here in WSL/Linux, so native-optional deps resolve for the target.)
echo "[build] bundling server node_modules (Linux build)"
DEPS="$WORK/deps"
mkdir -p "$DEPS"
cp "$REPO/server/package.json" "$DEPS/"
if (cd "$DEPS" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1); then
  cp -r "$DEPS/node_modules" "$PAYLOAD/server/node_modules"
  echo "[build] bundled $(du -sh "$PAYLOAD/server/node_modules" | cut -f1) of dependencies"
else
  echo "[build] WARNING: dependency bundling failed — first boot will npm install over the network"
fi

# ── 5. Zero-touch boot menus (BIOS isolinux + UEFI grub) ─────────────────────
echo "[build] patching boot menus for unattended install"
PRESEED_ARGS="auto=true priority=critical preseed/file=/cdrom/preseed.cfg"

if [ -f "$EXTRACT/isolinux/txt.cfg" ]; then
  sed -i "s|append |append $PRESEED_ARGS |" "$EXTRACT/isolinux/txt.cfg"
  sed -i 's/^timeout .*/timeout 30/' "$EXTRACT/isolinux/isolinux.cfg" || true
fi
if [ -f "$EXTRACT/boot/grub/grub.cfg" ]; then
  sed -i "s|/install.amd/vmlinuz|/install.amd/vmlinuz $PRESEED_ARGS|g" "$EXTRACT/boot/grub/grub.cfg"
  sed -i 's/^set timeout=.*/set timeout=3/' "$EXTRACT/boot/grub/grub.cfg" || true
fi

# ── 6. Repack ────────────────────────────────────────────────────────────────
echo "[build] repacking custom-nas-os.iso"
# Hyper-V (or a mounted drive) locks an ISO that is attached to a VM, so the
# old file can be undeletable. Fall back to the next free name instead of dying.
OUT_ISO="$OUT/custom-nas-os.iso"
n=1
while [ -e "$OUT_ISO" ] && ! rm -f "$OUT_ISO" 2>/dev/null; do
  n=$((n + 1))
  OUT_ISO="$OUT/custom-nas-os-v${n}.iso"
  echo "[build] previous ISO is locked (attached to a VM?) — writing $OUT_ISO instead"
done
# mkisofs_args.txt references boot images inside the original ISO by interval,
# so $BASE_ISO must stay at the same path while repacking.
eval "xorriso -as mkisofs $(tr '\n' ' ' < "$WORK/mkisofs_args.txt") -o '$OUT_ISO' -V 'DIZZYOS' '$EXTRACT'"

echo
echo "[build] DONE → $OUT_ISO"
du -h "$OUT_ISO"
echo "Write it to USB with Rufus/balenaEtcher and boot — install is fully unattended."
echo "NOTE: netinst needs a network connection during install (packages come from deb.debian.org)."
echo "WARNING: booting this ISO wipes the smallest disk in the machine automatically."
