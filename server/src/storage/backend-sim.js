import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';
import { planPool, validatePlan, pickWriteTarget } from './planner.js';

const STATE_FILE = path.join(STATE_DIR, 'storage.json');

// Simulated drive bay: mixed-capacity 2.5" Intel DC SATA SSDs (per README)
const DEFAULT_DRIVES = [
  { id: 'sim-sda', name: 'Intel SSD DC S3610 480GB', sizeGB: 480 },
  { id: 'sim-sdb', name: 'Intel SSD DC S4510 960GB', sizeGB: 960 },
  { id: 'sim-sdc', name: 'Intel SSD DC S3520 240GB', sizeGB: 240 },
  { id: 'sim-sdd', name: 'Intel SSD DC S4500 480GB', sizeGB: 480 },
];

const SCHEDULE = {
  sync: 'Nightly at 03:00',
  scrub: 'Weekly, Sunday at 04:00',
};

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { drives: DEFAULT_DRIVES, pool: null };
  }
}

function save(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function listDrives() {
  return load().drives;
}

export async function getPool() {
  const state = load();
  if (!state.pool) return null;
  const pool = state.pool;
  const branches = pool.branches.map(b => ({ ...b, freeGB: b.sizeGB - b.usedGB }));
  return {
    ...pool,
    branches,
    nextWrite: pickWriteTarget(branches).id,
    schedule: SCHEDULE,
  };
}

export async function createPool({ confirm = false } = {}) {
  const state = load();
  if (state.pool) throw new Error('A pool already exists — destroy it first');
  const plan = planPool(state.drives);
  validatePlan(plan);
  if (!confirm) throw new Error('Pool creation formats the drives. Pass confirm=true to proceed.');
  state.pool = {
    plan,
    status: 'online',
    mount: '/mnt/pool (simulated)',
    createdAt: new Date().toISOString(),
    branches: plan.data.map((d, i) => ({
      id: d.id,
      branch: `/mnt/disks/d${i + 1}`,
      sizeGB: d.sizeGB,
      usedGB: Math.round(d.sizeGB * (0.1 + 0.2 * Math.random())),
    })),
    lastSync: null,
    lastScrub: null,
  };
  save(state);
  return getPool();
}

export async function destroyPool({ confirm = false } = {}) {
  if (!confirm) throw new Error('Pass confirm=true to remove the pool.');
  const state = load();
  state.pool = null;
  save(state);
  return { ok: true };
}

export async function syncNow() {
  const state = load();
  if (!state.pool) throw new Error('No pool');
  state.pool.lastSync = {
    at: new Date().toISOString(),
    durationSec: 2,
    result: 'OK — parity is up to date (simulated)',
  };
  save(state);
  return state.pool.lastSync;
}

export async function scrubNow() {
  const state = load();
  if (!state.pool) throw new Error('No pool');
  // Mirrors the real backend: scrub checks data against parity from a sync.
  if (!state.pool.lastSync) {
    throw new Error(
      'Parity has never been synced, so there is nothing to scrub yet. ' +
      'Run "Sync now" first — it computes the parity that scrub checks against.',
    );
  }
  state.pool.lastScrub = {
    at: new Date().toISOString(),
    durationSec: 4,
    result: 'OK — 0 errors detected (simulated)',
  };
  save(state);
  return state.pool.lastScrub;
}
