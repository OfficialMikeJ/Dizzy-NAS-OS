import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const IS_LINUX = process.platform === 'linux';

// Simulation mode: automatic on non-Linux, or forced with DIZZY_SIM=1
export const SIM = !IS_LINUX || process.env.DIZZY_SIM === '1';

export const SERVER_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
export const WEBUI_DIST = path.join(REPO_ROOT, 'webui', 'dist');

export const STATE_DIR = SIM
  ? path.join(SERVER_ROOT, 'var')
  : (process.env.DIZZY_STATE_DIR || '/var/lib/dizzyos');

export const APPS_DIR = path.join(STATE_DIR, 'apps');

// Update layout: /opt/dizzyos/{releases/<version>, current -> releases/<v>}
export const APP_ROOT = SIM ? path.join(STATE_DIR, 'app') : '/opt/dizzyos';
export const RELEASES_DIR = path.join(APP_ROOT, 'releases');
export const CURRENT_LINK = path.join(APP_ROOT, 'current');
export const DOWNLOAD_DIR = path.join(STATE_DIR, 'updates');

// Where to look for new releases. Set DIZZY_UPDATE_URL to a manifest JSON
// (e.g. a GitHub Releases asset) to enable one-click updates.
export const UPDATE_MANIFEST_URL = process.env.DIZZY_UPDATE_URL || null;

export const VERSION = JSON.parse(
  fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'),
).version;
export const POOL_MOUNT = SIM ? path.join(STATE_DIR, 'pool') : '/mnt/pool';

export const PORT = Number(process.env.DIZZY_PORT || 8480);

for (const dir of [STATE_DIR, APPS_DIR, DOWNLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
