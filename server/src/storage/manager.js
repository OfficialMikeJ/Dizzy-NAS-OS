import { SIM } from '../config.js';
import { planPool } from './planner.js';

const backend = SIM
  ? await import('./backend-sim.js')
  : await import('./backend-linux.js');

export const listDrives = backend.listDrives;
export const getPool = backend.getPool;
export const createPool = backend.createPool;
export const destroyPool = backend.destroyPool;
export const syncNow = backend.syncNow;
export const scrubNow = backend.scrubNow;

/** Dry-run: role assignment + capacity for the current drive bay. */
export async function previewPool() {
  const drives = await listDrives();
  return planPool(drives);
}
