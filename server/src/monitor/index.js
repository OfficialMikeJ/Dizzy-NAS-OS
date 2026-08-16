import si from 'systeminformation';
import { IS_LINUX, SIM } from '../config.js';
import { tryRun } from '../util/exec.js';

const SAMPLE_MS = 2000;
const HISTORY_LEN = 90; // 3 minutes at 2s cadence
const DISK_REFRESH_TICKS = 15; // re-read disk list/temps every 30s

const history = [];
let disksCache = [];
let tick = 0;
let timer = null;

export function getHistory() {
  return history;
}

export function getDisks() {
  return disksCache;
}

/** Per-drive temperature. Linux: smartctl JSON. Sim: plausible wobble. */
async function diskTemp(devName) {
  if (SIM) {
    return Math.round(28 + 6 * Math.sin(Date.now() / 60000 + devName.length) + Math.random() * 2);
  }
  if (!IS_LINUX) return null;
  const res = await tryRun('smartctl', ['-A', '-j', `/dev/${devName}`]);
  if (!res) return null;
  try {
    const j = JSON.parse(res.stdout);
    return j.temperature?.current ?? null;
  } catch {
    return null;
  }
}

async function refreshDisks() {
  if (SIM) {
    // Mirror the simulated AnyRaid drive bay (mixed-capacity Intel DC SSDs)
    const { listDrives } = await import('../storage/manager.js');
    const drives = await listDrives();
    disksCache = await Promise.all(drives.map(async d => ({
      dev: d.id,
      model: d.name,
      sizeGB: d.sizeGB,
      tempC: await diskTemp(d.id),
    })));
    return;
  }
  const layout = await si.diskLayout();
  disksCache = await Promise.all(layout.map(async d => {
    const devName = (d.device || '').replace('/dev/', '');
    return {
      dev: devName,
      model: d.name || d.vendor || 'Unknown',
      sizeGB: Math.round(d.size / 1e9),
      tempC: devName ? await diskTemp(devName) : null,
    };
  }));
}

async function sample() {
  tick += 1;
  if (tick % DISK_REFRESH_TICKS === 1) {
    await refreshDisks().catch(() => {});
  }
  const [speed, load, mem] = await Promise.all([
    si.cpuCurrentSpeed(),
    si.currentLoad(),
    si.mem(),
  ]);
  return {
    t: Date.now(),
    cpu: {
      ghz: speed.avg || 0,
      ghzMax: speed.max || 0,
      cores: (speed.cores || []).map(c => Math.round(c * 100) / 100),
      loadPct: Math.round(load.currentLoad * 10) / 10,
    },
    mem: {
      totalMB: Math.round(mem.total / 1048576),
      usedMB: Math.round(mem.active / 1048576),
      pct: Math.round((mem.active / mem.total) * 1000) / 10,
    },
    disks: disksCache,
  };
}

export function start(io) {
  if (timer) return;
  const loop = async () => {
    try {
      const s = await sample();
      history.push(s);
      if (history.length > HISTORY_LEN) history.shift();
      io.emit('stats', s);
    } catch (err) {
      console.error('[monitor] sample failed:', err.message);
    }
  };
  loop();
  timer = setInterval(loop, SAMPLE_MS);
}
