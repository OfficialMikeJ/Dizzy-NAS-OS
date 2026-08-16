# DizzyOS — Development Plan

Target: a custom NAS OS per [README.md](README.md) — web dashboard, MergerFS storage
pooling with SnapRAID redundancy, Docker container station, delivered as a bootable
`custom-nas-os.iso` built on Debian Stable (netinst + preseed).

## Architecture Overview

DizzyOS is a set of services layered on top of stock Debian Stable:

```
┌─────────────────────────────────────────────────────────┐
│  Web GUI (React + Vite → static bundle)                 │
│  served by ↓ over HTTP + WebSocket                      │
├─────────────────────────────────────────────────────────┤
│  dizzyos-server (Node.js, Express + Socket.IO)          │
│  ├─ monitor/   real-time CPU GHz / RAM / drive temps    │
│  ├─ shares/    SMB (Samba+wsdd) & NFS share manager     │
│  ├─ storage/   MergerFS pool + SnapRAID orchestration   │
│  ├─ docker/    Container Station (dockerode + compose)  │
│  └─ update/    versioned releases, atomic swap+rollback │
├─────────────────────────────────────────────────────────┤
│  Debian Stable · MergerFS · SnapRAID · Docker           │
└─────────────────────────────────────────────────────────┘
```

**One codebase, two modes.** On Linux the modules drive the real system
(`/proc`, `smartctl`, `mergerfs`, `snapraid`, `smbd`, `dockerd`). On Windows
(dev machine) the same server runs with a simulation backend — mock drives,
in-memory shares — so the UI can be developed rapidly. WSL2 Ubuntu is the
integration-test environment and the ISO build factory.

## Storage Design (MergerFS + SnapRAID)

- **Role assignment** (`server/src/storage/planner.js`, pure + unit-tested):
  the largest drive becomes the dedicated **SnapRAID parity** drive (parity
  must be ≥ every data drive); every other drive is formatted ext4 and mounted
  as a branch under `/mnt/disks/dN`.
- **Pooling**: MergerFS unions the branches at **`/mnt/pool`** with
  `category.create=mfs` — new files land whole on the branch with the **Most
  Free Space**, never striped, so surviving disks stay readable even in a
  multi-drive disaster.
- **Redundancy**: `/etc/snapraid.conf` is generated (parity file on the parity
  drive, content lists on every branch). systemd timers run `snapraid sync`
  **nightly at 03:00** and `snapraid scrub` (silent-rot check) **weekly on
  Sunday at 04:00**. The UI can also trigger sync/scrub on demand and shows
  job progress.
- **Non-destructive teardown**: removing the pool unmounts and unwires —
  files stay on the ext4 branches.
- Execution backends are swappable: `backend-linux.js` (real formatting,
  mounts, snapraid jobs) vs `backend-sim.js` (JSON-state simulation for dev).

## ISO Pipeline

Debian's kickstart equivalent is a **preseed** (`iso/preseed/preseed.cfg`):
unattended locale/network/user setup, an `early_command` that picks the
**smallest disk** for the OS (big drives stay for the pool), LVM auto-
partitioning, and a `late_command` that copies the DizzyOS payload off the ISO
and installs it in-target (mergerfs, snapraid, Docker, Samba/NFS/Avahi/wsdd,
Node 22, systemd units).

`iso/build.sh` (runs in WSL): uses the already-downloaded
`debian-13.6.0-amd64-netinst.iso` from Windows Downloads (override with
`ISO_PATH=`), extracts it with xorriso, injects preseed + payload, patches
isolinux/GRUB for zero-touch boot, repacks as `custom-nas-os.iso` (BIOS+UEFI).
Note: netinst pulls packages from `deb.debian.org` during install, so the
target machine needs network.

## Repo Layout

```
DizzyOS/
├── server/          Node.js backend (Express, Socket.IO, dockerode, systeminformation)
├── webui/           React + Vite dashboard (dark NAS admin theme)
├── iso/             build.sh, preseed/, payload/ (systemd units, installer)
└── scripts/         dev helpers
```

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Environment setup (Windows + WSL toolchain) | ✅ done |
| 2 | Scaffold monorepo; backend skeleton + real-time system monitor | ✅ done |
| 3 | Web GUI: dashboard with live CPU/RAM/temp graphs | ✅ done |
| 4 | Shared Folders: SMB/NFS create + network discovery | ✅ done (Linux backend ready; needs VM validation) |
| 5 | Storage: MergerFS+SnapRAID planner, sim + Linux backends, schedules | ✅ done; Linux backend needs hardware/VM validation |
| 6 | Docker Container Station: deploy/start/stop, persistent volumes | ✅ done (verified against WSL dockerd) |
| 7 | ISO build pipeline (Debian netinst + preseed) → `custom-nas-os.iso` | ✅ scripts done; needs a WSL build run + VM boot test |
| 8 | Update system: versioned releases, atomic swap, rollback | ✅ done, integration-tested — see [UPDATING.md](UPDATING.md) |
| 9 | Integration testing: VM pool exercises, ISO boot test | ⬜ in progress |

## Dev Workflow

```bash
# Windows dev (simulated hardware):
cd server && npm run dev          # backend on :8480 (sim mode auto-detected)
cd webui  && npm run dev          # Vite dev server on :5173, proxies to :8480

# Production-style: build UI once, server serves it
cd webui && npm run build && cd ../server && npm start   # everything on :8480

# WSL integration (real /proc, real docker):
wsl -d Ubuntu
cd /mnt/c/Users/Desktop/DizzyOS/server && npm start

# Build the ISO (inside WSL, uses the Debian netinst from Downloads):
cd /mnt/c/Users/Desktop/DizzyOS/iso && sudo ./build.sh
```
