import React from 'react';

/** KPI stat tile: label, value, optional sub-line and status (icon + label + dot — never color alone). */
export default function StatTile({ label, value, sub, status }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
      {status && (
        <div className="status-chip">
          <span className="status-dot" style={{ background: status.color }} />
          <span aria-hidden="true">{status.icon}</span> {status.label}
        </div>
      )}
    </div>
  );
}
