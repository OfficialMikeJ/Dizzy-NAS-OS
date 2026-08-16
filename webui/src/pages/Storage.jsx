import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Storage() {
  const [drives, setDrives] = useState([]);
  const [pool, setPool] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    api('/storage/drives').then(setDrives).catch(e => setError(e.message));
    api('/storage/pool').then(setPool).catch(() => {});
    api('/storage/preview').then(setPreview).catch(() => {});
  };
  useEffect(() => {
    refresh();
    const t = setInterval(() => api('/storage/pool').then(setPool).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  const act = async (fn, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const createPool = () => act(
    () => api('/storage/pool', { method: 'POST', body: { confirm: true } }),
    'Create the pool? ALL DATA on the listed drives will be ERASED (they are formatted). This cannot be undone.',
  );
  const destroyPool = () => act(
    () => api('/storage/pool', { method: 'DELETE', body: { confirm: true } }),
    'Remove the pool? Drives are unmounted but NOT wiped — files stay on the individual disks.',
  );
  const syncNow = () => act(() => api('/storage/sync', { method: 'POST' }));
  const scrubNow = () => act(() => api('/storage/scrub', { method: 'POST' }));

  const plan = pool?.plan || preview;
  const roleOf = id =>
    plan?.parity?.id === id ? 'Parity' : plan?.data?.some(d => d.id === id) ? 'Data' : '—';

  return (
    <>
      <h1>Storage Pool</h1>
      <p className="subtitle">
        MergerFS glues mismatched drives into one volume — files stay whole on individual disks —
        while SnapRAID parity on the largest drive survives a single-drive failure.
      </p>

      {error && <div className="error-box">{error}</div>}

      <h2>Drives</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Device</th><th>Model</th><th>Capacity</th><th>Role</th></tr>
          </thead>
          <tbody>
            {drives.map(d => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>{d.name}</td>
                <td>{d.sizeGB} GB</td>
                <td>{roleOf(d.id)}</td>
              </tr>
            ))}
            {!drives.length && <tr><td colSpan="4" className="muted">No eligible drives found.</td></tr>}
          </tbody>
        </table>
      </div>

      {pool ? (
        <>
          <h2>Pool</h2>
          <div className="card">
            <p>
              Status: <strong>{pool.status}</strong> ·
              Usable: <strong>{(pool.plan.usableGB / 1024).toFixed(2)} TB</strong> ·
              Mounted at <span className="mono">{pool.mount}</span>
            </p>
            {pool.fs && (
              <p className="muted">{pool.fs.usedGB} GB used of {pool.fs.sizeGB} GB ({pool.fs.availGB} GB free)</p>
            )}

            <h2 style={{ marginTop: 14 }}>Data branches</h2>
            {(pool.branches || []).map(b => (
              <BranchMeter key={b.id} branch={b} isNext={pool.nextWrite === b.id} />
            ))}
            <p className="muted" style={{ fontSize: 12 }}>
              ➜ marks where the next file lands (Most Free Space policy). Parity drive:
              {' '}<span className="mono">{pool.plan.parity.id}</span> ({pool.plan.parity.sizeGB} GB).
            </p>

            <h2>SnapRAID protection</h2>
            {!pool.lastSync && (
              <div className="info-box">
                <strong>Parity has not been synced yet.</strong> Your files are pooled and readable,
                but they are not protected against a drive failure until the first sync finishes.
                Scrub stays unavailable until then — it verifies data against parity, so it needs
                parity to exist first.
              </div>
            )}
            <table>
              <tbody>
                <tr>
                  <td>Parity sync</td>
                  <td>{pool.schedule?.sync}</td>
                  <td><JobResult job={pool.lastSync} /></td>
                </tr>
                <tr>
                  <td>Data scrub</td>
                  <td>{pool.schedule?.scrub}</td>
                  <td><JobResult job={pool.lastScrub} /></td>
                </tr>
              </tbody>
            </table>

            {pool.job?.running && (
              <div className="info-box">
                snapraid {pool.job.type} running since {new Date(pool.job.startedAt).toLocaleTimeString()}…
                {pool.job.tail && <pre className="mono" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{pool.job.tail}</pre>}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn" onClick={syncNow} disabled={busy || pool.job?.running}>
                {pool.lastSync ? 'Sync now' : 'Run first sync'}
              </button>
              <button
                className="btn ghost"
                onClick={scrubNow}
                disabled={busy || pool.job?.running || !pool.lastSync}
                title={pool.lastSync ? 'Verify data against parity' : 'Run a parity sync first'}
              >
                Scrub now
              </button>
              <button className="btn danger" onClick={destroyPool} disabled={busy || pool.job?.running} style={{ marginLeft: 'auto' }}>
                Remove pool
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <h2>Create pool</h2>
          <div className="card">
            {preview && preview.viable ? (
              <>
                <div className="info-box">
                  <strong>{(preview.usableGB / 1024).toFixed(2)} TB</strong> usable of {(preview.rawGB / 1024).toFixed(2)} TB raw ·
                  parity on <span className="mono">{preview.parity.id}</span> ({preview.parity.sizeGB} GB, the largest drive) ·
                  {' '}{preview.data.length} data branches · survives a single-drive failure after the first sync
                </div>
                <p className="muted" style={{ fontSize: 12.5 }}>
                  Files are written whole to one disk at a time (never striped), so even in a multi-drive
                  disaster the surviving disks stay fully readable in any Linux machine.
                </p>
                <button className="btn" onClick={createPool} disabled={busy}>
                  {busy ? 'Creating…' : 'Create pool'}
                </button>
              </>
            ) : (
              <p className="muted">{preview?.reason || 'Scanning drives…'}</p>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Last run of a snapraid job, including why it failed. */
function JobResult({ job }) {
  if (!job) return <span className="muted">never run</span>;
  const failed = !job.result?.startsWith('OK');
  return (
    <>
      <span>{new Date(job.at).toLocaleString()} — {job.result}</span>
      {failed && job.log && (
        <details style={{ marginTop: 4 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>show error output</summary>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{job.log}</pre>
        </details>
      )}
      {failed && job.logFile && (
        <div className="muted" style={{ fontSize: 11 }}>full log: <span className="mono">{job.logFile}</span></div>
      )}
    </>
  );
}

/** Per-branch usage meter — fill and track share the same hue ramp. */
function BranchMeter({ branch, isNext }) {
  const pct = branch.sizeGB ? Math.min(100, Math.round((branch.usedGB / branch.sizeGB) * 100)) : 0;
  return (
    <div className="branch-row">
      <span className="branch-name">
        {isNext && <span title="next write target (MFS)" aria-label="next write target">➜ </span>}
        {branch.id} <span className="muted mono">{branch.branch}</span>
      </span>
      <span className="meter" role="img" aria-label={`${pct}% used`}>
        <span className="meter-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="branch-stats">
        {branch.offline ? 'offline' : `${branch.usedGB} / ${branch.sizeGB} GB`}
      </span>
    </div>
  );
}
