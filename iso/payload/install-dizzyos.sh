#!/bin/bash
# DizzyOS first-boot installer.
#
# Runs ONCE on the freshly installed system via dizzyos-firstboot.service —
# deliberately NOT inside the debian-installer chroot, where apt is unreliable.
#
# Puts the ISO payload into the release layout that updates depend on:
#   /opt/dizzyos/releases/<version>/   ← this release
#   /opt/dizzyos/current -> releases/<version>
#
# Log: /var/log/dizzyos-install.log      Re-run: sudo /opt/dizzyos/install-dizzyos.sh
set -u

LOG=/var/log/dizzyos-install.log
exec > >(tee -a "$LOG") 2>&1
echo "=== DizzyOS first-boot install — $(date) ==="

ROOT=/opt/dizzyos
note() { echo "[dizzyos] $*"; }
warn() { echo "[dizzyos][WARN] $*"; }

# ── Wait for working networking + DNS (netinst needs the mirror) ─────────────
note "waiting for network…"
for i in $(seq 1 60); do
  getent hosts deb.debian.org >/dev/null 2>&1 && { note "network up after ${i}s"; break; }
  sleep 1
done
getent hosts deb.debian.org >/dev/null 2>&1 || warn "no DNS for deb.debian.org — package install will likely fail"

# ── Move the flat ISO payload into the release layout ───────────────────────
VERSION=$(cat "$ROOT/VERSION" 2>/dev/null || echo "0.0.0")
RELEASE="$ROOT/releases/$VERSION"
if [ ! -d "$RELEASE/server" ]; then
  note "staging release $VERSION"
  mkdir -p "$RELEASE"
  for item in server webui setup.sh dizzyos-server.service VERSION; do
    [ -e "$ROOT/$item" ] && cp -a "$ROOT/$item" "$RELEASE/"
  done
  # Keep the originals out of the way so /opt/dizzyos stays tidy
  for item in server webui; do
    [ -e "$ROOT/$item" ] && rm -rf "${ROOT:?}/$item"
  done
fi
ln -sfn "$RELEASE" "$ROOT/current"
note "active release: $(readlink "$ROOT/current")"

# ── System packages (same script every release re-runs on update) ───────────
if [ -x "$RELEASE/setup.sh" ] || [ -f "$RELEASE/setup.sh" ]; then
  bash "$RELEASE/setup.sh" || warn "setup.sh reported problems"
else
  warn "setup.sh missing from the release — system packages not installed"
fi
note "node version: $(node --version 2>&1 || echo MISSING)"

# ── Server dependencies ─────────────────────────────────────────────────────
if [ -d "$RELEASE/server/node_modules" ]; then
  note "using node_modules bundled on the ISO"
else
  note "installing server dependencies from npm…"
  (cd "$RELEASE/server" && npm install --omit=dev --no-audit --no-fund) || warn "npm install failed"
fi

# ── Services ────────────────────────────────────────────────────────────────
note "enabling services…"
if [ -f "$ROOT/dizzyos-update" ]; then
  install -m 755 "$ROOT/dizzyos-update" /usr/local/bin/dizzyos-update
fi
cp "$RELEASE/dizzyos-server.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dizzyos-server || warn "dizzyos-server failed to start"
for svc in docker smbd nmbd avahi-daemon nfs-server wsdd2 wsdd; do
  systemctl enable --now "$svc" >/dev/null 2>&1 || true
done

# ── Console banner with the dashboard URL ───────────────────────────────────
if ! grep -q "DizzyOS ready" /etc/issue 2>/dev/null; then
  cat >> /etc/issue <<'EOF'

  DizzyOS ready — open the dashboard at http://\4:8480
  (default login: dizzy / dizzyos)

EOF
fi

# ── Result ──────────────────────────────────────────────────────────────────
if systemctl is-active --quiet dizzyos-server; then
  touch "$ROOT/.install-complete"
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  note "SUCCESS — DizzyOS $VERSION at http://${IP:-<this-machine>}:8480"
  exit 0
fi

echo "[dizzyos][FATAL] dizzyos-server is not running. Log: $LOG"
echo "[dizzyos] service log: journalctl -u dizzyos-server -n 50"
echo "[dizzyos] retry with: sudo /opt/dizzyos/install-dizzyos.sh"
exit 1
