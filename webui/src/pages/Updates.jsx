import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Updates() {
  const [status, setStatus] = useState(null);
  const [check, setCheck] = useState(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const refresh = () => api('/update/status').then(setStatus).catch(e => setError(e.message));
  useEffect(refresh, []);

  // After a swap the server restarts; poll until it answers again.
  useEffect(() => {
    if (!restarting) return;
    const t = setInterval(async () => {
      try {
        const s = await api('/update/status');
        setStatus(s);
        setRestarting(false);
        setCheck(null);
      } catch { /* still down — keep waiting */ }
    }, 2000);
    return () => clearInterval(t);
  }, [restarting]);

  const runCheck = async () => {
    setBusy(true);
    setError(null);
    try {
      setCheck(await api(`/update/check${url ? `?url=${encodeURIComponent(url)}` : ''}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const install = async (body, confirmMsg) => {
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    try {
      await api('/update/apply', { method: 'POST', body: { ...body, confirm: true } });
      setRestarting(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async version => {
    if (!window.confirm(`Roll back to ${version}? DizzyOS will restart.`)) return;
    setBusy(true);
    try {
      await api('/update/rollback', { method: 'POST', body: { version, confirm: true } });
      setRestarting(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>System Update</h1>
      <p className="subtitle">
        Updates install alongside the running version and swap over atomically — if one misbehaves,
        roll back to the previous release without reinstalling.
      </p>

      {error && <div className="error-box">{error}</div>}
      {restarting && (
        <div className="info-box">DizzyOS is restarting into the new version — this page reconnects automatically…</div>
      )}

      <div className="grid cols-4">
        <div className="card tile">
          <div className="tile-label">Running version</div>
          <div className="tile-value">{status?.version || '—'}</div>
          {status?.active && <div className="tile-sub">release {status.active}</div>}
        </div>
        <div className="card tile">
          <div className="tile-label">Installed releases</div>
          <div className="tile-value">{status?.installed?.length ?? 0}</div>
          <div className="tile-sub">{status?.installed?.join(', ') || 'none staged'}</div>
        </div>
      </div>

      <h2>Update source</h2>
      <div className="card">
        <RepoConfig status={status} onSaved={setStatus} onError={setError} />
      </div>

      <h2>Check for updates</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {status?.autoCheck
            ? 'DizzyOS checks daily on its own; this button checks right now.'
            : 'Automatic checking is off — check manually here.'}
          {status?.lastCheck?.checkedAt && ` Last checked ${new Date(status.lastCheck.checkedAt).toLocaleString()}.`}
        </p>
        <label htmlFor="manifest">Override URL (optional)</label>
        <input
          id="manifest"
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={status?.manifestUrl || 'leave blank to use the repository above'}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button className="btn ghost" onClick={runCheck} disabled={busy}>Check now</button>
        </div>

        {check && (
          <div className="info-box" style={{ marginTop: 12 }}>
            {check.available ? (
              <>
                <strong>Version {check.version} is available</strong> (you have {check.current}).
                {Array.isArray(check.notes) && (
                  <ul style={{ margin: '8px 0 0 18px' }}>
                    {check.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    disabled={busy || !status?.canApply}
                    onClick={() => install(
                      { url: check.url, sha256: check.sha256 },
                      `Install DizzyOS ${check.version}? Services restart; storage and shares are untouched.`,
                    )}
                  >
                    Install {check.version}
                  </button>
                </div>
              </>
            ) : (
              <>You are running the latest version ({check.current}).</>
            )}
          </div>
        )}
      </div>

      <h2>Install a package file</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          No hosting needed — copy a <span className="mono">.tar.gz</span> to the NAS and give its path,
          or paste a direct download URL.
        </p>
        <ManualInstall onInstall={install} disabled={busy || !status?.canApply} />
        {status && !status.canApply && (
          <p className="muted" style={{ fontSize: 12 }}>
            Updates can only be applied on the NAS itself (this looks like a development machine).
          </p>
        )}
      </div>

      {status?.installed?.length > 1 && (
        <>
          <h2>Rollback</h2>
          <div className="card">
            <table>
              <thead><tr><th>Release</th><th>State</th><th></th></tr></thead>
              <tbody>
                {status.installed.map(v => (
                  <tr key={v}>
                    <td>{v}</td>
                    <td>{v === status.active ? 'active' : 'installed'}</td>
                    <td>
                      {v !== status.active && (
                        <button className="btn ghost small" onClick={() => rollback(v)} disabled={busy}>
                          Roll back to {v}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {status?.history?.length > 0 && (
        <>
          <h2>History</h2>
          <div className="card">
            <table>
              <thead><tr><th>When</th><th>Action</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                {[...status.history].reverse().map((h, i) => (
                  <tr key={i}>
                    <td>{new Date(h.at).toLocaleString()}</td>
                    <td>{h.action}</td>
                    <td>{h.from}</td>
                    <td>{h.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** Where this NAS looks for new releases. */
function RepoConfig({ status, onSaved, onError }) {
  const [repo, setRepo] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setRepo(status?.repo || ''); }, [status?.repo]);

  const save = async patch => {
    setSaving(true);
    onError(null);
    try {
      onSaved(await api('/update/config', { method: 'POST', body: patch }));
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <label htmlFor="repo">GitHub repository</label>
      <input
        id="repo"
        type="text"
        value={repo}
        onChange={e => setRepo(e.target.value)}
        placeholder="owner/dizzyos"
      />
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        This NAS asks GitHub for the newest release and compares it locally — nothing about
        this machine is sent anywhere.
      </p>
      <div className="check-row">
        <label>
          <input
            type="checkbox"
            checked={status?.autoCheck ?? true}
            onChange={e => save({ autoCheck: e.target.checked })}
          />
          Check for updates daily
        </label>
      </div>
      <button className="btn ghost" onClick={() => save({ repo })} disabled={saving || repo === (status?.repo || '')}>
        {saving ? 'Saving…' : 'Save repository'}
      </button>
    </>
  );
}

function ManualInstall({ onInstall, disabled }) {
  const [value, setValue] = useState('');
  const isUrl = /^https?:\/\//i.test(value.trim());
  return (
    <>
      <label htmlFor="pkg">Package URL or path on the NAS</label>
      <input
        id="pkg"
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="/tmp/dizzyos-0.3.0.tar.gz"
      />
      <button
        className="btn"
        style={{ marginTop: 10 }}
        disabled={disabled || !value.trim()}
        onClick={() => onInstall(
          isUrl ? { url: value.trim() } : { file: value.trim() },
          'Install this package? DizzyOS will restart. Storage and shares are untouched.',
        )}
      >
        Install package
      </button>
    </>
  );
}
