import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Shares() {
  const [shares, setShares] = useState([]);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [smb, setSmb] = useState(true);
  const [nfs, setNfs] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => api('/shares').then(setShares).catch(e => setError(e.message));
  useEffect(refresh, []);

  const create = async e => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/shares', { method: 'POST', body: { name, comment, smb, nfs } });
      setName('');
      setComment('');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async shareName => {
    if (!window.confirm(`Remove share "${shareName}"? Files on disk are kept.`)) return;
    try {
      await api(`/shares/${shareName}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1>Shared Folders</h1>
      <p className="subtitle">SMB shares appear in Windows Explorer and macOS Finder automatically (wsdd2 + Avahi discovery).</p>

      {error && <div className="error-box">{error}</div>}

      <h2>Create a share</h2>
      <div className="card">
        <form onSubmit={create}>
          <div className="form-row">
            <div>
              <label htmlFor="share-name">Name</label>
              <input id="share-name" type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="media" required pattern="[A-Za-z0-9_-]{1,32}" />
            </div>
            <div>
              <label htmlFor="share-comment">Description (optional)</label>
              <input id="share-comment" type="text" value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Movies and music" />
            </div>
          </div>
          <div className="check-row">
            <label><input type="checkbox" checked={smb} onChange={e => setSmb(e.target.checked)} /> SMB (Windows / Mac)</label>
            <label><input type="checkbox" checked={nfs} onChange={e => setNfs(e.target.checked)} /> NFS (Linux / Mac)</label>
          </div>
          <button className="btn" disabled={busy || (!smb && !nfs)}>Create share</button>
        </form>
      </div>

      <h2>Shares</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Path</th><th>Protocols</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {shares.map(s => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td className="mono">{s.path}</td>
                <td>{[s.smb && 'SMB', s.nfs && 'NFS'].filter(Boolean).join(' + ')}</td>
                <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                <td><button className="btn ghost small" onClick={() => remove(s.name)}>Remove</button></td>
              </tr>
            ))}
            {!shares.length && <tr><td colSpan="5" className="muted">No shares yet — create one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
