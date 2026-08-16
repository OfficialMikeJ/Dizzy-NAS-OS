/**
 * Real MergerFS + SnapRAID executor.
 *
 * createPool: format data drives → mount as /mnt/disks/dN branches → merge
 * into /mnt/pool (MergerFS, category.create=mfs) → largest drive formatted
 * as /mnt/parity1 → /etc/snapraid.conf → systemd timers for nightly sync
 * (03:00) and weekly scrub (Sun 04:00).
 *
 * DESTRUCTIVE on create (formats drives) — gated behind confirm=true, and
 * the OS drive is always excluded. Destroy is non-destructive to data disks:
 * it unmounts and unwires, files stay on the ext4 branches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { STATE_DIR, POOL_MOUNT } from '../config.js';
import { run, tryRun } from '../util/exec.js';
import { planPool, validatePlan, pickWriteTarget } from './planner.js';

const META_FILE = path.join(STATE_DIR, 'storage.json');
const CONTENT_FILE = path.join(STATE_DIR, 'snapraid.content');
const SNAPRAID_CONF = '/etc/snapraid.conf';
const DISKS_ROOT = '/mnt/disks';
const PARITY_MOUNT = '/mnt/parity1';
const FSTAB_TAG = '# dizzyos-pool';

const SCHEDULE = {
  sync: 'Nightly at 03:00 (systemd timer)',
  scrub: 'Weekly, Sunday at 04:00 (systemd timer)',
};

// One snapraid job at a time; survives only for the server's lifetime
let job = null;

export async function listDrives() {
  const { stdout } = await run('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,MODEL,TYPE,TRAN,MOUNTPOINTS']);
  const tree = JSON.parse(stdout);
  const osDisks = new Set();
  const collectOsDisk = (node, top) => {
    const mounts = (node.mountpoints || []).filter(Boolean);
    if (mounts.some(m => m === '/' || m === '/boot' || m === '/boot/efi')) osDisks.add(top);
    for (const child of node.children || []) collectOsDisk(child, top);
  };
  for (const d of tree.blockdevices || []) collectOsDisk(d, d.name);

  return (tree.blockdevices || [])
    .filter(d => d.type === 'disk' && !osDisks.has(d.name))
    .map(d => ({
      id: d.name,
      name: (d.model || 'Unknown').trim(),
      sizeGB: Math.floor(Number(d.size) / 1e9),
      tran: d.tran || null,
    }));
}

export async function getPool() {
  const meta = readMeta();
  if (!meta.pool) return null;
  const pool = { ...meta.pool, schedule: SCHEDULE, job: jobStatus() };

  const branches = [];
  for (const b of meta.pool.branches) {
    const df = await tryRun('df', ['-B1', '--output=size,used,avail', b.branch]);
    if (df) {
      const [size, used, avail] = df.stdout.trim().split('\n').pop().trim().split(/\s+/).map(Number);
      branches.push({ ...b, sizeGB: Math.round(size / 1e9), usedGB: Math.round(used / 1e9), freeGB: Math.round(avail / 1e9) });
    } else {
      branches.push({ ...b, freeGB: 0, offline: true });
    }
  }
  pool.branches = branches;
  if (branches.some(b => !b.offline)) {
    pool.nextWrite = pickWriteTarget(branches.filter(b => !b.offline)).id;
  }

  const poolDf = await tryRun('df', ['-B1', '--output=size,used,avail', POOL_MOUNT]);
  if (poolDf) {
    const [size, used, avail] = poolDf.stdout.trim().split('\n').pop().trim().split(/\s+/).map(Number);
    pool.fs = { sizeGB: Math.round(size / 1e9), usedGB: Math.round(used / 1e9), availGB: Math.round(avail / 1e9) };
  }
  return pool;
}

export async function createPool({ confirm = false } = {}) {
  if (!confirm) throw new Error('Pool creation FORMATS the drives. Pass confirm=true to proceed.');
  if (readMeta().pool) throw new Error('A pool already exists');

  const drives = await listDrives();
  const plan = planPool(drives);
  validatePlan(plan);

  // 1. Data branches: one big ext4 partition per drive, mounted under /mnt/disks
  const branches = [];
  for (let i = 0; i < plan.data.length; i++) {
    const d = plan.data[i];
    const label = `dizzy-d${i + 1}`;
    const mnt = `${DISKS_ROOT}/d${i + 1}`;
    await formatDrive(d.id, label);
    fs.mkdirSync(mnt, { recursive: true });
    appendFstab(`LABEL=${label} ${mnt} ext4 defaults,nofail 0 2 ${FSTAB_TAG}`);
    await run('mount', [mnt]);
    branches.push({ id: d.id, branch: mnt, label, sizeGB: d.sizeGB });
  }

  // 2. Parity drive
  await formatDrive(plan.parity.id, 'dizzy-par1');
  fs.mkdirSync(PARITY_MOUNT, { recursive: true });
  appendFstab(`LABEL=dizzy-par1 ${PARITY_MOUNT} ext4 defaults,nofail 0 2 ${FSTAB_TAG}`);
  await run('mount', [PARITY_MOUNT]);

  // 3. MergerFS union of the branches, MFS create policy
  fs.mkdirSync(POOL_MOUNT, { recursive: true });
  appendFstab(
    `${DISKS_ROOT}/d* ${POOL_MOUNT} fuse.mergerfs ` +
    'defaults,nofail,allow_other,category.create=mfs,moveonenospc=true,minfreespace=4G,fsname=dizzypool ' +
    `0 0 ${FSTAB_TAG}`,
  );
  await run('mount', [POOL_MOUNT]);

  // 4. SnapRAID config
  const conf = [
    '# Managed by DizzyOS — do not edit',
    `parity ${PARITY_MOUNT}/snapraid.parity`,
    `content ${CONTENT_FILE}`,
    ...branches.map(b => `content ${b.branch}/.snapraid.content`),
    ...branches.map((b, i) => `data d${i + 1} ${b.branch}`),
    'exclude *.unrecoverable',
    'exclude lost+found/',
    'exclude .snapraid.content',
    'autosave 100',
  ].join('\n');
  fs.writeFileSync(SNAPRAID_CONF, conf + '\n');

  // 5. Schedule: nightly sync, weekly scrub
  installTimers();
  await run('systemctl', ['daemon-reload']);
  await run('systemctl', ['enable', '--now', 'dizzy-snapraid-sync.timer', 'dizzy-snapraid-scrub.timer']);

  const pool = {
    plan,
    status: 'online',
    mount: POOL_MOUNT,
    parityMount: PARITY_MOUNT,
    createdAt: new Date().toISOString(),
    branches,
    lastSync: null,
    lastScrub: null,
  };
  writeMeta({ pool });
  return getPool();
}

export async function destroyPool({ confirm = false } = {}) {
  if (!confirm) throw new Error('Pass confirm=true to remove the pool.');
  const meta = readMeta();
  if (!meta.pool) return { ok: true };
  if (job?.running) throw new Error('A snapraid job is running — wait for it to finish');

  await tryRun('systemctl', ['disable', '--now', 'dizzy-snapraid-sync.timer', 'dizzy-snapraid-scrub.timer']);
  await tryRun('umount', [POOL_MOUNT]);
  for (const b of meta.pool.branches) await tryRun('umount', [b.branch]);
  await tryRun('umount', [PARITY_MOUNT]);
  stripFstab();
  await tryRun('rm', ['-f', SNAPRAID_CONF]);
  writeMeta({ pool: null });
  return { ok: true, note: 'Drives were unmounted, not wiped — files remain on the ext4 branches.' };
}

export async function syncNow() {
  return startJob('sync', ['sync']);
}

export async function scrubNow() {
  requireSynced();
  // -o 0: an on-demand scrub should verify something now. The weekly timer
  // keeps -o 10 so it rotates through older blocks instead of re-checking
  // whatever was just written.
  return startJob('scrub', ['scrub', '-p', '12', '-o', '0']);
}

/**
 * Scrub verifies data against hashes recorded by sync, so it cannot run on a
 * pool that has never been synced — snapraid exits 1 with "No content file".
 * Fail early with an explanation instead of surfacing a bare exit code.
 */
function requireSynced() {
  const meta = readMeta();
  if (!meta.pool) throw new Error('No pool');
  const synced = meta.pool.lastSync?.result?.startsWith('OK') || fs.existsSync(CONTENT_FILE);
  if (!synced) {
    throw new Error(
      'Parity has never been synced, so there is nothing to scrub yet. ' +
      'Run "Sync now" first — it computes the parity that scrub checks against.',
    );
  }
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function startJob(type, args) {
  const meta = readMeta();
  if (!meta.pool) throw new Error('No pool');
  if (job?.running) throw new Error(`A snapraid ${job.type} is already running`);

  const logFile = path.join(STATE_DIR, `snapraid-${type}.log`);
  const out = fs.openSync(logFile, 'w');
  const child = spawn('snapraid', args, { stdio: ['ignore', out, out] });
  job = { type, running: true, startedAt: new Date().toISOString(), logFile, exitCode: null };

  child.on('exit', code => {
    job = { ...job, running: false, exitCode: code, finishedAt: new Date().toISOString() };
    const m = readMeta();
    if (m.pool) {
      const record = {
        at: job.finishedAt,
        result: code === 0 ? `OK (snapraid ${type} exit 0)` : `FAILED — exit ${code}`,
        // Keep the tail so the dashboard can show WHY it failed; an exit code
        // alone means an SSH session to find out anything useful.
        log: code === 0 ? null : tailOf(logFile, 15),
        logFile,
      };
      if (type === 'sync') m.pool.lastSync = record;
      else m.pool.lastScrub = record;
      writeMeta(m);
    }
  });
  return jobStatus();
}

function tailOf(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-lines).join('\n');
  } catch {
    return null;
  }
}

function jobStatus() {
  if (!job) return null;
  let tail = '';
  try {
    const txt = fs.readFileSync(job.logFile, 'utf8');
    tail = txt.split('\n').slice(-5).join('\n');
  } catch { /* log not there yet */ }
  return { ...job, tail };
}

async function formatDrive(devName, label) {
  const dev = `/dev/${devName}`;
  await run('wipefs', ['-a', dev]);
  await run('sgdisk', ['--zap-all', dev]);
  await run('sgdisk', ['-n', '1:0:0', '-t', '1:8300', dev]);
  const part = partitionPath(devName, 1);
  await settlePartition(dev, part);
  await run('mkfs.ext4', ['-F', '-L', label, '-m', '1', part]);
}

/** sda + 1 → /dev/sda1, nvme0n1 + 1 → /dev/nvme0n1p1 */
function partitionPath(disk, n) {
  return `/dev/${/\d$/.test(disk) ? `${disk}p${n}` : `${disk}${n}`}`;
}

/**
 * Get the kernel to adopt the new partition table, then wait for the device
 * node to actually appear before formatting it.
 *
 * partprobe is the usual tool but it lives in the `parted` package, which a
 * minimal Debian may not have — and sgdisk already asks the kernel to re-read
 * the table. So every nudge here is best-effort; what we actually assert is
 * that the partition node showed up. This also closes a real race: udev can
 * take a moment to create the node even when partprobe exists.
 */
async function settlePartition(dev, partPath) {
  await tryRun('partprobe', [dev]);
  await tryRun('blockdev', ['--rereadpt', dev]);
  await tryRun('udevadm', ['settle', '--timeout=10']);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(partPath)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(
    `Partition ${partPath} never appeared after partitioning ${dev}. ` +
    'Try: sudo apt install -y parted udev',
  );
}

function appendFstab(line) {
  const fstab = fs.readFileSync('/etc/fstab', 'utf8');
  if (!fstab.includes(line)) fs.appendFileSync('/etc/fstab', `${line}\n`);
}

function stripFstab() {
  const fstab = fs.readFileSync('/etc/fstab', 'utf8');
  const kept = fstab.split('\n').filter(l => !l.includes(FSTAB_TAG));
  fs.writeFileSync('/etc/fstab', kept.join('\n'));
}

function installTimers() {
  const units = {
    'dizzy-snapraid-sync.service': [
      '[Unit]', 'Description=DizzyOS SnapRAID nightly parity sync',
      '[Service]', 'Type=oneshot', 'ExecStart=/usr/bin/snapraid sync', 'Nice=10', 'IOSchedulingClass=idle',
    ],
    'dizzy-snapraid-sync.timer': [
      '[Unit]', 'Description=Nightly SnapRAID sync at 03:00',
      '[Timer]', 'OnCalendar=*-*-* 03:00:00', 'Persistent=true', 'RandomizedDelaySec=300',
      '[Install]', 'WantedBy=timers.target',
    ],
    'dizzy-snapraid-scrub.service': [
      '[Unit]', 'Description=DizzyOS SnapRAID weekly scrub (silent-corruption check)',
      '[Service]', 'Type=oneshot',
      // Skip cleanly until the first sync exists — scrub has nothing to
      // compare against before then, and a failed unit every week is noise.
      `ExecCondition=/usr/bin/test -f ${CONTENT_FILE}`,
      'ExecStart=/usr/bin/snapraid scrub -p 12 -o 10', 'Nice=10', 'IOSchedulingClass=idle',
    ],
    'dizzy-snapraid-scrub.timer': [
      '[Unit]', 'Description=Weekly SnapRAID scrub, Sunday 04:00',
      '[Timer]', 'OnCalendar=Sun *-*-* 04:00:00', 'Persistent=true', 'RandomizedDelaySec=600',
      '[Install]', 'WantedBy=timers.target',
    ],
  };
  for (const [name, lines] of Object.entries(units)) {
    fs.writeFileSync(`/etc/systemd/system/${name}`, lines.join('\n') + '\n');
  }
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return { pool: null };
  }
}

function writeMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}
