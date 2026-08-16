# Shipping DizzyOS updates (no reinstall)

A NAS gets installed once and then lives for years, so DizzyOS installs
**versioned releases side by side** and switches between them with a symlink:

```
/opt/dizzyos/
├── releases/
│   ├── 0.2.0/          ← previous release, kept for rollback
│   └── 0.3.0/          ← new release
├── current -> releases/0.3.0
└── .install-complete
```

`dizzyos-server.service` runs `/opt/dizzyos/current/server/src/index.js`, so an
update is: unpack next to the running version → reconcile system packages →
flip the symlink → restart. Nothing is overwritten in place, so a bad release
is a symlink flip away from being undone.

**Your data is never inside a release.** Pool config, shares, container
definitions and update history live in `/var/lib/dizzyos`, and the storage pool
itself is on the drives. Updating and rolling back leave all of it alone.

## Why releases carry a `setup.sh`

The `spawn partprobe ENOENT` bug in 0.1.0 was not a code bug — the `parted`
package simply wasn't installed. A code-only updater could never have fixed it.

So every release ships a **`setup.sh`** that reconciles system packages, and it
re-runs on every update. It's idempotent (only installs what's missing), so
fixing that class of bug means adding a package name to
[iso/payload/setup.sh](iso/payload/setup.sh) and cutting a release.

## Publishing to GitHub (the distribution model)

Once DizzyOS lives in a public GitHub repo, **you publish a release and every
device finds it** — no new ISO, regardless of how old the device is.

### How devices discover updates — without you tracking anyone

Each NAS asks GitHub *"what's the newest release?"* and compares against its own
version locally. Nothing about the device is sent anywhere; there's no server
collecting version numbers, no user accounts, and no phone-home. A NAS that has
been offline for a year still sees the newest release the moment it checks,
because "latest" is resolved at check time rather than pushed.

Devices poll this stable URL, which GitHub always redirects to the newest
release's asset:

```
https://github.com/<owner>/<repo>/releases/latest/download/manifest.json
```

If a release has no `manifest.json` attached, the device falls back to the
GitHub Releases API and derives everything from the release itself (`.tar.gz`
asset, `.sha256` asset, release notes).

The check runs **once a day** plus one minute after boot. When something is
found, a banner appears on every dashboard page and the release notes are shown
before anything installs. Owners can turn automatic checking off, and the check
is entirely passive — nothing installs without a human clicking Install.

### Cutting a release

Two options, both one step:

```bash
# From your machine (needs: gh auth login)
cd /mnt/c/Users/Desktop/DizzyOS && ./scripts/publish-release.sh
```

```bash
# Or let CI do it — .github/workflows/release.yml builds and publishes on tag
git tag v0.3.0 && git push origin v0.3.0
```

Either path builds the package, computes the checksum, writes the manifest, and
attaches all three to a GitHub release. The CI workflow additionally refuses to
publish if the tag doesn't match `server/package.json` or if the tests fail.

### One-time setup on each NAS

Dashboard → **System Update** → *Update source* → enter `owner/repo` → Save.
(Or bake it in with `DIZZY_GITHUB_REPO=owner/repo` so new installs come
pre-configured.)

### Before you go public

The updater enforces HTTPS plus a **pinned SHA-256**, which is solid for your
own devices. If strangers will install DizzyOS, add a signing key so a release
can't be forged by anyone who gains write access to the repo or its assets —
worth doing before the first public announcement, not after.

## Publishing a release manually (no GitHub)

1. Bump `version` in [server/package.json](server/package.json).
2. Add any new system packages to [iso/payload/setup.sh](iso/payload/setup.sh).
3. Build the package (in WSL):
   ```bash
   cd /mnt/c/Users/Desktop/DizzyOS && ./scripts/make-release.sh
   ```
   You get `release/dizzyos-<version>.tar.gz` and a `release/manifest.json`
   containing the version, download URL and **sha256**.
4. Edit `manifest.json`: set `url` to wherever you host the tarball and write
   the `notes` (these appear in the dashboard before the user installs).

## Installing an update — three ways

**A. No hosting at all** — copy the file over and install it:
```bash
scp release/dizzyos-0.3.0.tar.gz dizzy@<nas-ip>:/tmp/
ssh dizzy@<nas-ip> 'sudo dizzyos-update /tmp/dizzyos-0.3.0.tar.gz'
```

**B. From the dashboard** — *System Update* page → paste the package URL or the
path on the NAS → Install. Progress shows inline and the page reconnects when
the new version comes up.

**C. One-click checking** — host `manifest.json` somewhere (GitHub Releases
works well) and set the URL once:
```bash
sudo systemctl edit dizzyos-server
# [Service]
# Environment=DIZZY_UPDATE_URL=https://your-host/dizzyos/manifest.json
```
The dashboard then shows available versions with their release notes.

## Rollback

Dashboard → *System Update* → **Roll back to <version>**, or:
```bash
sudo dizzyos-update --rollback
```
Instant, because the previous release is still on disk.

## Safety properties

- **Checksum enforced.** If the manifest pins a `sha256` and the download
  doesn't match, the install is refused before anything is unpacked.
- **Validated before swap.** A package missing `VERSION` or
  `server/src/index.js` is rejected; the running release is untouched.
- **Atomic switch.** The symlink flip is `ln -sfn` + `mv -T`, so `current`
  never points at a half-written directory.
- **Survives its own restart.** The swap runs in a detached helper, because the
  process performing the update is the one being restarted.
- **Confirmation required.** Every mutating endpoint needs `confirm=true`.

## When you still need a full reinstall

Only for changes below the application layer — a new Debian base version, or
different disk partitioning. Everything in DizzyOS itself (server, web GUI,
storage logic, system package requirements) ships as a normal update.
