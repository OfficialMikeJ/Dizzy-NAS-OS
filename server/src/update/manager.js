/**
 * DizzyOS update engine — versioned releases with atomic swap and rollback.
 *
 * Layout on the NAS:
 *   /opt/dizzyos/releases/0.2.0/   ← a full release (server, webui, setup.sh)
 *   /opt/dizzyos/releases/0.3.0/
 *   /opt/dizzyos/current -> releases/0.3.0
 *
 * Applying an update never mutates the running release: the new one is
 * unpacked alongside, its setup.sh reconciles SYSTEM packages (this is what
 * ships fixes like "parted was missing" — a code-only updater cannot), and
 * only then does the `current` symlink flip and the service restart.
 * The previous release stays on disk, so rollback is a symlink flip back.
 *
 * State (/var/lib/dizzyos) lives outside the release dirs and is never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  IS_LINUX, SIM, VERSION, APP_ROOT, RELEASES_DIR, CURRENT_LINK,
  DOWNLOAD_DIR, STATE_DIR, UPDATE_MANIFEST_URL,
} from '../config.js';
import { run, tryRun } from '../util/exec.js';
import { resolveLatest, isValidRepo, manifestUrlFor } from './github.js';

const HISTORY_FILE = path.join(STATE_DIR, 'update-history.json');
const CONFIG_FILE = path.join(STATE_DIR, 'update-config.json');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const FIRST_CHECK_DELAY_MS = 60 * 1000;        // let the box settle after boot

let progress = null;   // { phase, message, version, startedAt, error }
let checkTimer = null;

/* ── configuration (persisted, editable from the dashboard) ──────────── */

export function readConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch { /* first run */ }
  return {
    repo: saved.repo || process.env.DIZZY_GITHUB_REPO || null,
    autoCheck: saved.autoCheck !== false,
    lastCheck: saved.lastCheck || null,
    ...saved,
    // env override always wins for the raw manifest URL
    manifestUrl: UPDATE_MANIFEST_URL || saved.manifestUrl || null,
  };
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  if (next.repo && !isValidRepo(next.repo)) {
    throw new Error(`Invalid repository "${next.repo}" — expected owner/name, e.g. mikejtv/dizzyos`);
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

/* ── status ──────────────────────────────────────────────────────────── */

export function listReleases() {
  try {
    return fs.readdirSync(RELEASES_DIR)
      .filter(d => !d.startsWith('.') && fs.statSync(path.join(RELEASES_DIR, d)).isDirectory())
      .sort(compareVersions);
  } catch {
    return [];
  }
}

export function activeRelease() {
  try {
    return path.basename(fs.readlinkSync(CURRENT_LINK));
  } catch {
    return null;
  }
}

export function getStatus() {
  const cfg = readConfig();
  return {
    version: VERSION,
    active: activeRelease(),
    installed: listReleases(),
    repo: cfg.repo,
    manifestUrl: cfg.manifestUrl,
    autoCheck: cfg.autoCheck,
    lastCheck: cfg.lastCheck,
    // Applying updates needs the release layout + systemd; on a dev box we can
    // still check for updates, just not install them.
    canApply: IS_LINUX && !SIM && fs.existsSync(CURRENT_LINK),
    progress,
    history: readHistory(),
  };
}

/* ── checking ────────────────────────────────────────────────────────── */

/**
 * Ask where the newest release is and compare it against what's running.
 * Resolution order: explicit url → configured GitHub repo → manifest URL.
 * The result is cached so the dashboard can show it without re-fetching.
 */
export async function checkForUpdate({ url, repo } = {}) {
  const cfg = readConfig();
  const targetRepo = repo || cfg.repo;
  const targetUrl = url || cfg.manifestUrl;

  let manifest;
  if (url) {
    manifest = await fetchManifest(url);
  } else if (targetRepo) {
    manifest = await resolveLatest(targetRepo);
  } else if (targetUrl) {
    manifest = await fetchManifest(targetUrl);
  } else {
    throw new Error('No update source configured — set your GitHub repository (owner/name) first.');
  }

  const result = {
    ...manifest,
    current: VERSION,
    available: compareVersions(manifest.version, VERSION) > 0,
    checkedAt: new Date().toISOString(),
    repo: targetRepo || null,
  };
  try {
    writeConfig({ lastCheck: result });
  } catch { /* cache is best-effort */ }
  return result;
}

async function fetchManifest(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Update check failed: ${res.status} ${res.statusText}`);
  const manifest = await res.json();
  for (const field of ['version', 'url']) {
    if (!manifest[field]) throw new Error(`Manifest is missing "${field}"`);
  }
  return manifest;
}

/**
 * Background update checking. Runs shortly after boot and daily thereafter,
 * pushing the result to connected dashboards. Failures are logged and ignored —
 * a NAS without internet must keep working normally.
 */
export function startAutoCheck(io) {
  if (checkTimer) return;
  const tick = async () => {
    const cfg = readConfig();
    if (!cfg.autoCheck || (!cfg.repo && !cfg.manifestUrl)) return;
    try {
      const result = await checkForUpdate();
      if (result.available) {
        console.log(`[update] version ${result.version} is available (running ${VERSION})`);
      }
      io?.emit('update-check', result);
    } catch (err) {
      console.log(`[update] check failed: ${err.message}`);
    }
  };
  setTimeout(tick, FIRST_CHECK_DELAY_MS);
  checkTimer = setInterval(tick, CHECK_INTERVAL_MS);
}

/* ── applying ────────────────────────────────────────────────────────── */

/**
 * Install a release from a URL or a local .tar.gz already on the box.
 * Returns once the new release is staged and verified; the actual swap and
 * restart happen in a detached helper (this process is about to be replaced).
 */
export async function applyUpdate({ url, file, sha256, confirm = false } = {}) {
  if (!confirm) throw new Error('Updating restarts DizzyOS. Pass confirm=true to proceed.');
  if (!IS_LINUX || SIM) throw new Error('Updates can only be applied on the NAS itself');
  if (progress && !progress.error && progress.phase !== 'done') {
    throw new Error(`An update is already in progress (${progress.phase})`);
  }
  if (!url && !file) throw new Error('Provide either a url or a local file path');

  progress = { phase: 'starting', message: 'Preparing…', startedAt: new Date().toISOString() };
  try {
    // 1. Get the tarball
    let tarball = file;
    if (url) {
      setPhase('download', `Downloading ${url}`);
      tarball = await download(url);
    }
    if (!fs.existsSync(tarball)) throw new Error(`Update file not found: ${tarball}`);

    // 2. Verify integrity when the manifest pinned a hash
    if (sha256) {
      setPhase('verify', 'Verifying checksum…');
      const actual = await sha256File(tarball);
      if (actual !== sha256.toLowerCase()) {
        throw new Error(`Checksum mismatch — refusing to install (expected ${sha256}, got ${actual})`);
      }
    }

    // 3. Unpack beside the running release
    setPhase('extract', 'Unpacking release…');
    const staging = path.join(RELEASES_DIR, `.staging-${Date.now()}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    // --strip-components=1: tarballs wrap everything in dizzyos-<version>/
    await run('tar', ['-xzf', tarball, '-C', staging, '--strip-components=1']);

    const version = readVersion(staging);
    if (!version) throw new Error('Release is missing a VERSION file');
    if (!fs.existsSync(path.join(staging, 'server', 'src', 'index.js'))) {
      throw new Error('Release looks incomplete (no server/src/index.js)');
    }

    const target = path.join(RELEASES_DIR, version);
    if (version === activeRelease()) throw new Error(`Version ${version} is already running`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);

    // 4. Reconcile system dependencies for THIS release (apt packages, etc.)
    const setup = path.join(target, 'setup.sh');
    if (fs.existsSync(setup)) {
      setPhase('setup', 'Installing system dependencies…');
      await run('bash', [setup], { timeout: 30 * 60 * 1000 });
    }

    // 5. Hand off: swap the symlink and restart from outside this process
    setPhase('swap', `Switching to ${version} and restarting…`);
    recordHistory({ version, from: VERSION, at: new Date().toISOString(), action: 'update' });
    scheduleSwap(version);
    return { ok: true, version, note: 'DizzyOS is restarting into the new version.' };
  } catch (err) {
    progress = { ...progress, phase: 'error', error: err.message };
    throw err;
  }
}

/** Flip back to a previously installed release. */
export async function rollback({ version, confirm = false } = {}) {
  if (!confirm) throw new Error('Rollback restarts DizzyOS. Pass confirm=true to proceed.');
  if (!IS_LINUX || SIM) throw new Error('Rollback can only run on the NAS itself');

  const installed = listReleases();
  const target = version || installed.filter(v => v !== activeRelease()).pop();
  if (!target) throw new Error('No other release is installed to roll back to');
  if (!installed.includes(target)) throw new Error(`Release ${target} is not installed`);
  if (target === activeRelease()) throw new Error(`${target} is already active`);

  recordHistory({ version: target, from: VERSION, at: new Date().toISOString(), action: 'rollback' });
  setPhase('swap', `Rolling back to ${target}…`);
  scheduleSwap(target);
  return { ok: true, version: target, note: 'DizzyOS is restarting into the previous version.' };
}

/* ── internals ───────────────────────────────────────────────────────── */

function setPhase(phase, message) {
  progress = { ...progress, phase, message };
  console.log(`[update] ${phase}: ${message}`);
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const dest = path.join(DOWNLOAD_DIR, `dizzyos-${Date.now()}.tar.gz`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function readVersion(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim();
  } catch {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'server', 'package.json'), 'utf8')).version;
    } catch {
      return null;
    }
  }
}

/**
 * Swap and restart must outlive this process — systemctl restart kills us
 * mid-request. Detach a tiny script that waits for the HTTP reply to flush,
 * flips the symlink atomically (ln -sfn + mv), then restarts the unit.
 */
function scheduleSwap(version) {
  const script = path.join(DOWNLOAD_DIR, 'swap.sh');
  fs.writeFileSync(script, [
    '#!/bin/bash',
    'sleep 2',
    `ln -sfn "${path.join(RELEASES_DIR, version)}" "${CURRENT_LINK}.new"`,
    `mv -Tf "${CURRENT_LINK}.new" "${CURRENT_LINK}"`,
    'systemctl restart dizzyos-server',
    '',
  ].join('\n'));
  fs.chmodSync(script, 0o755);

  const child = spawn('setsid', ['bash', script], { detached: true, stdio: 'ignore' });
  child.unref();
}

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(-10);
  } catch {
    return [];
  }
}

function recordHistory(entry) {
  const all = readHistory();
  all.push(entry);
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(all, null, 2));
  } catch { /* history is best-effort */ }
}

/** Semver-ish compare: 0.10.0 > 0.9.0. Returns >0 if a is newer. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** Health probe used after a swap — is the new release actually serving? */
export async function selfCheck() {
  const unit = await tryRun('systemctl', ['is-active', 'dizzyos-server']);
  return { serviceActive: unit?.stdout.trim() === 'active', version: VERSION, active: activeRelease() };
}
