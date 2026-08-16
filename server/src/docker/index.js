/**
 * Container Station: paste a docker-compose.yml, deploy it, manage lifecycle.
 *
 * Persistent volumes: every app gets a dedicated data directory (on the pool
 * when it exists). It is exported to the compose file as ${DIZZY_APP_DATA},
 * so `volumes: ["${DIZZY_APP_DATA}:/config"]` survives restarts and rebuilds.
 */
import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import { IS_LINUX, APPS_DIR, POOL_MOUNT } from '../config.js';
import { run, tryRun } from '../util/exec.js';

const docker = IS_LINUX
  ? new Docker({ socketPath: '/var/run/docker.sock' })
  : new Docker({ socketPath: '//./pipe/docker_engine' });

/**
 * Compose ships either as a docker CLI plugin (`docker compose`) or as a
 * standalone binary (`docker-compose`, which is what Debian packages).
 * Detect once and reuse.
 */
let composeCache = null;
async function composeCmd() {
  if (composeCache) return composeCache;
  if (await tryRun('docker', ['compose', 'version'])) composeCache = { cmd: 'docker', base: ['compose'] };
  else if (await tryRun('docker-compose', ['version'])) composeCache = { cmd: 'docker-compose', base: [] };
  else throw new Error('Docker Compose is not installed (need "docker compose" or "docker-compose")');
  return composeCache;
}

export async function available() {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function listContainers() {
  const list = await docker.listContainers({ all: true });
  return list.map(c => ({
    id: c.Id.slice(0, 12),
    name: (c.Names?.[0] || '').replace(/^\//, ''),
    image: c.Image,
    state: c.State,
    status: c.Status,
    ports: (c.Ports || [])
      .filter(p => p.PublicPort)
      .map(p => `${p.PublicPort}→${p.PrivatePort}/${p.Type}`),
    project: c.Labels?.['com.docker.compose.project'] || null,
  }));
}

export async function startContainer(id) {
  await docker.getContainer(id).start();
  return { ok: true };
}

export async function stopContainer(id) {
  await docker.getContainer(id).stop();
  return { ok: true };
}

export async function removeContainer(id) {
  await docker.getContainer(id).remove({ force: true });
  return { ok: true };
}

/** Deploy a pasted compose file as a named app with a persistent data dir. */
export async function deployApp({ name, compose }) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name || '')) {
    throw new Error('App name must be 1-32 chars: lowercase letters, numbers, dash, underscore');
  }
  if (!compose || !compose.trim()) throw new Error('Compose file content is required');

  const appDir = path.join(APPS_DIR, name);
  const dataDir = fs.existsSync(POOL_MOUNT) ? path.join(POOL_MOUNT, 'apps', name) : path.join(appDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const composeFile = path.join(appDir, 'docker-compose.yml');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(composeFile, compose);

  const { cmd, base } = await composeCmd();
  const { stdout, stderr } = await run(
    cmd, [...base, '-p', name, '-f', composeFile, 'up', '-d'],
    { env: { ...process.env, DIZZY_APP_DATA: dataDir } },
  );
  return { ok: true, name, dataDir, output: (stdout + stderr).trim() };
}

export async function removeApp(name) {
  const composeFile = path.join(APPS_DIR, name, 'docker-compose.yml');
  if (!fs.existsSync(composeFile)) throw new Error(`App "${name}" not found`);
  const { cmd, base } = await composeCmd();
  await run(cmd, [...base, '-p', name, '-f', composeFile, 'down']);
  return { ok: true }; // data dir is intentionally preserved
}
