/**
 * Shared Folders: SMB (Samba) + NFS with instant discovery.
 *
 * Discovery comes from services installed by the ISO payload: wsdd2 makes
 * shares appear in Windows Explorer's Network view, avahi-daemon announces
 * them to macOS Finder. This module only manages share definitions.
 *
 * Linux: shares live under the pool mount; config is rendered to
 *   /etc/samba/dizzyos-shares.conf (smb.conf includes it) and /etc/exports.d/.
 * Sim: definitions persist to JSON and folders are created under server/var.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SIM, STATE_DIR, POOL_MOUNT } from '../config.js';
import { tryRun } from '../util/exec.js';

const STATE_FILE = path.join(STATE_DIR, 'shares.json');
const SMB_CONF = '/etc/samba/dizzyos-shares.conf';
const NFS_EXPORTS = '/etc/exports.d/dizzyos.exports';

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(shares) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(shares, null, 2));
}

export function listShares() {
  return load();
}

export async function createShare({ name, comment = '', smb = true, nfs = false, guestOk = true }) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name || '')) {
    throw new Error('Share name must be 1-32 chars: letters, numbers, dash, underscore');
  }
  const shares = load();
  if (shares.some(s => s.name === name)) throw new Error(`Share "${name}" already exists`);

  const sharePath = path.join(SIM ? path.join(STATE_DIR, 'shares') : POOL_MOUNT, name);
  fs.mkdirSync(sharePath, { recursive: true });
  if (!SIM) fs.chmodSync(sharePath, 0o777);

  const share = { name, path: sharePath, comment, smb, nfs, guestOk, createdAt: new Date().toISOString() };
  shares.push(share);
  save(shares);
  await applyConfig(shares);
  return share;
}

export async function deleteShare(name) {
  const shares = load();
  const idx = shares.findIndex(s => s.name === name);
  if (idx === -1) throw new Error(`Share "${name}" not found`);
  shares.splice(idx, 1); // definition only — files on disk are kept
  save(shares);
  await applyConfig(shares);
  return { ok: true };
}

async function applyConfig(shares) {
  if (SIM) return; // nothing to reload on the dev box

  const smbBlocks = shares.filter(s => s.smb).map(s => [
    `[${s.name}]`,
    `   path = ${s.path}`,
    `   comment = ${s.comment || 'DizzyOS share'}`,
    '   browseable = yes',
    '   writable = yes',
    `   guest ok = ${s.guestOk ? 'yes' : 'no'}`,
    '   create mask = 0666',
    '   directory mask = 0777',
  ].join('\n')).join('\n\n');
  fs.writeFileSync(SMB_CONF, `# Managed by DizzyOS — do not edit\n${smbBlocks}\n`);

  const nfsLines = shares.filter(s => s.nfs)
    .map(s => `${s.path} *(rw,sync,no_subtree_check,all_squash,anonuid=65534,anongid=65534)`)
    .join('\n');
  fs.mkdirSync(path.dirname(NFS_EXPORTS), { recursive: true });
  fs.writeFileSync(NFS_EXPORTS, `# Managed by DizzyOS\n${nfsLines}\n`);

  await tryRun('smbcontrol', ['all', 'reload-config']);
  await tryRun('exportfs', ['-ra']);
}
