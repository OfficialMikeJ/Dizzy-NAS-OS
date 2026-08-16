#!/bin/bash
# DizzyOS system dependency reconciliation.
#
# Ships INSIDE every release and re-runs on every update. This is how a
# release fixes system-level bugs (e.g. "partprobe missing" → add parted):
# add the package here and the next update installs it. Must be idempotent —
# it runs on first boot and again on each update.
set -u
export DEBIAN_FRONTEND=noninteractive

echo "[setup] reconciling system packages…"
fail=0

apt_retry() {
  for i in 1 2 3; do
    apt-get "$@" && return 0
    echo "[setup] apt attempt $i failed: $* — retrying in 10s"
    sleep 10
  done
  return 1
}

need() {
  # Install only what's missing, so re-runs are fast and quiet.
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  [ ${#missing[@]} -eq 0 ] && return 0
  echo "[setup] installing: ${missing[*]}"
  apt_retry install -y --no-install-recommends "${missing[@]}" || {
    echo "[setup][WARN] failed to install: ${missing[*]}"; fail=1;
  }
}

# One of these names exists depending on the Debian release.
need_any() {
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 && return 0
  done
  for pkg in "$@"; do
    apt-get install -y --no-install-recommends "$pkg" >/dev/null 2>&1 && {
      echo "[setup] installed $pkg"; return 0;
    }
  done
  echo "[setup][WARN] none available: $*"
  fail=1
}

apt_retry update || echo "[setup][WARN] apt-get update failed — using cached lists"

# Storage: mergerfs pooling + snapraid parity + partitioning tools.
# parted supplies partprobe; e2fsprogs supplies mkfs.ext4; both are required
# by pool creation and were the cause of the 0.1.0 "spawn partprobe ENOENT" bug.
need mergerfs snapraid gdisk parted e2fsprogs util-linux smartmontools

# File sharing + discovery
need samba avahi-daemon nfs-kernel-server
need_any wsdd2 wsdd

# Containers
need docker.io
need_any docker-compose-v2 docker-compose

# Runtime
need nodejs
command -v node >/dev/null 2>&1 || {
  echo "[setup] node missing — trying NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt_retry install -y nodejs
}

# Samba must include our managed share definitions
touch /etc/samba/dizzyos-shares.conf 2>/dev/null || true
if [ -f /etc/samba/smb.conf ] && ! grep -q "dizzyos-shares.conf" /etc/samba/smb.conf; then
  sed -i '/^\[global\]/a \   include = /etc/samba/dizzyos-shares.conf' /etc/samba/smb.conf
fi

[ "$fail" -eq 0 ] && echo "[setup] OK" || echo "[setup] finished with warnings"
exit 0
