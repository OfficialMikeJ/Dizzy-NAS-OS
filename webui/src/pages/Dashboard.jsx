import React, { useEffect, useState } from 'react';
import { api, socket } from '../api.js';
import LineChart from '../components/LineChart.jsx';
import StatTile from '../components/StatTile.jsx';

const HISTORY_LEN = 90;

function tempStatus(t) {
  if (t == null) return { icon: '–', label: 'No sensor', color: 'var(--muted)' };
  if (t < 45) return { icon: '✓', label: 'Normal', color: 'var(--status-good)' };
  if (t < 55) return { icon: '⚠', label: 'Warm', color: 'var(--status-warning)' };
  if (t < 65) return { icon: '!', label: 'Hot', color: 'var(--status-serious)' };
  return { icon: '‼', label: 'Critical', color: 'var(--status-critical)' };
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export default function Dashboard({ info }) {
  const [samples, setSamples] = useState([]);

  useEffect(() => {
    api('/system/history').then(({ history }) => setSamples(history)).catch(() => {});
    const onStats = s => setSamples(prev => [...prev.slice(-(HISTORY_LEN - 1)), s]);
    socket.on('stats', onStats);
    return () => socket.off('stats', onStats);
  }, []);

  const latest = samples[samples.length - 1];
  const labels = samples.map(s => new Date(s.t).toLocaleTimeString([], { hour12: false }));
  const ghz = samples.map(s => s.cpu.ghz);
  const load = samples.map(s => s.cpu.loadPct);
  const memPct = samples.map(s => s.mem.pct);

  return (
    <>
      <h1>System Monitor</h1>
      <p className="subtitle">
        {info ? `${info.cpu.brand} · ${info.cpu.cores} threads · ${(info.mem.totalMB / 1024).toFixed(1)} GB RAM` : 'Loading…'}
      </p>

      <div className="grid cols-4">
        <StatTile
          label="CPU speed"
          value={latest ? `${latest.cpu.ghz.toFixed(2)} GHz` : '—'}
          sub={info?.cpu.maxGhz ? `max ${info.cpu.maxGhz.toFixed(1)} GHz` : undefined}
        />
        <StatTile label="CPU load" value={latest ? `${latest.cpu.loadPct.toFixed(1)}%` : '—'} />
        <StatTile
          label="Memory used"
          value={latest ? `${(latest.mem.usedMB / 1024).toFixed(1)} GB` : '—'}
          sub={latest ? `${latest.mem.pct.toFixed(1)}% of ${(latest.mem.totalMB / 1024).toFixed(1)} GB` : undefined}
        />
        <StatTile label="Uptime" value={info ? fmtUptime(info.uptimeSec) : '—'} />
      </div>

      <h2>Real-time graphs</h2>
      <div className="grid cols-2">
        <LineChart
          title="CPU speed"
          unit=" GHz"
          series={[{ name: 'CPU speed', color: 'var(--series-1)', values: ghz }]}
          labels={labels}
          yMax={Math.max(4, info?.cpu.maxGhz || 0)}
          format={v => Number(v).toFixed(2)}
        />
        <LineChart
          title="CPU load"
          unit="%"
          series={[{ name: 'CPU load', color: 'var(--series-2)', values: load }]}
          labels={labels}
          yMax={100}
          format={v => Math.round(v)}
        />
        <LineChart
          title="Memory usage"
          unit="%"
          series={[{ name: 'Memory', color: 'var(--series-3)', values: memPct }]}
          labels={labels}
          yMax={100}
          format={v => Math.round(v)}
        />
      </div>

      <h2>Drive temperatures</h2>
      <div className="grid cols-4">
        {(latest?.disks || []).map(d => (
          <StatTile
            key={d.dev}
            label={d.model}
            value={d.tempC != null ? `${d.tempC}°C` : '—'}
            sub={`${d.dev} · ${d.sizeGB} GB`}
            status={tempStatus(d.tempC)}
          />
        ))}
        {!latest?.disks?.length && <p className="muted">No drives detected yet.</p>}
      </div>
    </>
  );
}
