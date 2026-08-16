import React, { useEffect, useState } from 'react';
import { api, socket } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Storage from './pages/Storage.jsx';
import Shares from './pages/Shares.jsx';
import Containers from './pages/Containers.jsx';
import Updates from './pages/Updates.jsx';

const PAGES = [
  { key: 'dashboard', label: 'Dashboard', icon: '▤', el: Dashboard },
  { key: 'storage', label: 'Storage Pool', icon: '◫', el: Storage },
  { key: 'shares', label: 'Shared Folders', icon: '⇄', el: Shares },
  { key: 'containers', label: 'Container Station', icon: '▣', el: Containers },
  { key: 'updates', label: 'System Update', icon: '⟳', el: Updates },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [info, setInfo] = useState(null);
  const [pending, setPending] = useState(null); // an available update

  useEffect(() => {
    api('/system/info').then(setInfo).catch(() => {});
    // Surface an update found by the daily background check
    api('/update/status')
      .then(s => { if (s.lastCheck?.available) setPending(s.lastCheck); })
      .catch(() => {});
    const onCheck = r => setPending(r?.available ? r : null);
    socket.on('update-check', onCheck);
    return () => socket.off('update-check', onCheck);
  }, []);

  const Active = PAGES.find(p => p.key === page).el;

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">Dizzy<span>OS</span></div>
        {PAGES.map(p => (
          <button
            key={p.key}
            className={`nav-item ${page === p.key ? 'active' : ''}`}
            onClick={() => setPage(p.key)}
          >
            <span aria-hidden="true">{p.icon}</span> {p.label}
          </button>
        ))}
        <div className="sidebar-foot">
          {info && (
            <>
              {info.hostname}<br />
              <span className="mono">v{info.version}</span><br />
              {info.simMode
                ? <span className="badge sim">SIMULATION</span>
                : <span className="badge">LIVE</span>}
            </>
          )}
        </div>
      </nav>
      <main className="main">
        {pending && page !== 'updates' && (
          <div className="update-banner">
            <span>
              <strong>DizzyOS {pending.version} is available</strong>
              {info?.version && <span className="muted"> — you are running {info.version}</span>}
            </span>
            <button className="btn small" onClick={() => setPage('updates')}>View update</button>
          </div>
        )}
        <Active info={info} />
      </main>
    </div>
  );
}
