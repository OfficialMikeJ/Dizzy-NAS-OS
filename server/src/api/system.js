import { Router } from 'express';
import os from 'node:os';
import si from 'systeminformation';
import { SIM, VERSION } from '../config.js';
import { getHistory, getDisks } from '../monitor/index.js';

export const systemRouter = Router();

systemRouter.get('/info', async (_req, res) => {
  const [osInfo, cpu, mem] = await Promise.all([si.osInfo(), si.cpu(), si.mem()]);
  res.json({
    hostname: os.hostname(),
    version: VERSION,
    simMode: SIM,
    os: { distro: osInfo.distro, release: osInfo.release, kernel: osInfo.kernel, arch: osInfo.arch },
    cpu: {
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      baseGhz: Number(cpu.speed) || 0,
      maxGhz: Number(cpu.speedMax) || 0,
    },
    mem: { totalMB: Math.round(mem.total / 1048576) },
    uptimeSec: os.uptime(),
  });
});

systemRouter.get('/history', (_req, res) => {
  res.json({ history: getHistory(), disks: getDisks() });
});
