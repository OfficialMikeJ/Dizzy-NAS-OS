import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const EXAMPLE = `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    ports:
      - "8081:80"
    volumes:
      - "\${DIZZY_APP_DATA}:/srv"
    restart: unless-stopped
`;

export default function Containers() {
  const [status, setStatus] = useState(null);
  const [containers, setContainers] = useState([]);
  const [name, setName] = useState('');
  const [compose, setCompose] = useState(EXAMPLE);
  const [error, setError] = useState(null);
  const [deployOut, setDeployOut] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    api('/docker/status').then(setStatus).catch(() => setStatus({ available: false }));
    api('/docker/containers').then(setContainers).catch(() => setContainers([]));
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const action = async (fn, ...args) => {
    setError(null);
    try {
      await fn(...args);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const deploy = async e => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDeployOut(null);
    try {
      const res = await api('/docker/apps', { method: 'POST', body: { name, compose } });
      setDeployOut(`Deployed "${res.name}". Persistent data: ${res.dataDir}`);
      setName('');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Container Station</h1>
      <p className="subtitle">Paste a compose file, deploy it, manage lifecycle. App data survives restarts via ${'{DIZZY_APP_DATA}'}.</p>

      {status && !status.available && (
        <div className="error-box">
          Docker engine is not reachable on this machine. On the dev box, run the server inside WSL
          (<span className="mono">wsl -d Ubuntu</span>) where dockerd is running — on a deployed NAS this is automatic.
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      {deployOut && <div className="info-box">{deployOut}</div>}

      <h2>Deploy an app</h2>
      <div className="card">
        <form onSubmit={deploy}>
          <div className="form-row">
            <div>
              <label htmlFor="app-name">App name</label>
              <input id="app-name" type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="filebrowser" required pattern="[a-z0-9][a-z0-9_-]{0,31}" />
            </div>
          </div>
          <label htmlFor="compose">docker-compose.yml</label>
          <textarea id="compose" value={compose} onChange={e => setCompose(e.target.value)} spellCheck="false" />
          <div className="info-box">
            Use <span className="mono">${'{DIZZY_APP_DATA}'}</span> in volumes for automatic persistent storage —
            it maps to the app's folder on the storage pool.
          </div>
          <button className="btn" disabled={busy || !status?.available}>{busy ? 'Deploying…' : 'Deploy'}</button>
        </form>
      </div>

      <h2>Containers</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Image</th><th>State</th><th>Ports</th><th></th></tr>
          </thead>
          <tbody>
            {containers.map(c => (
              <tr key={c.id}>
                <td>{c.name}{c.project ? <span className="muted"> · {c.project}</span> : null}</td>
                <td className="mono">{c.image}</td>
                <td>
                  <span className="status-chip">
                    <span className="status-dot" style={{
                      background: c.state === 'running' ? 'var(--status-good)' : 'var(--muted)',
                    }} />
                    {c.status}
                  </span>
                </td>
                <td className="mono">{c.ports.join(', ')}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {c.state === 'running'
                    ? <button className="btn ghost small" onClick={() => action(id => api(`/docker/containers/${id}/stop`, { method: 'POST' }), c.id)}>Stop</button>
                    : <button className="btn ghost small" onClick={() => action(id => api(`/docker/containers/${id}/start`, { method: 'POST' }), c.id)}>Start</button>}
                  {' '}
                  <button className="btn ghost small" onClick={() => {
                    if (window.confirm(`Remove container ${c.name}?`)) {
                      action(id => api(`/docker/containers/${id}`, { method: 'DELETE' }), c.id);
                    }
                  }}>Remove</button>
                </td>
              </tr>
            ))}
            {!containers.length && <tr><td colSpan="5" className="muted">No containers.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
