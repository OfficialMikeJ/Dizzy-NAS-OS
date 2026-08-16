import React, { useMemo, useRef, useState } from 'react';

const W = 600;
const PAD_L = 40;
const PAD_R = 14;
const PAD_T = 8;
const AXIS_H = 20;

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

/**
 * Streaming line chart per the dataviz spec: 2px line, ~10% area wash for a
 * single series, solid hairline grid, crosshair tooltip listing every series,
 * end marker with a 2px surface ring, and a table-view twin (never
 * tooltip-gated). No legend when only one series — the card title names it.
 */
export default function LineChart({ title, series, labels, unit = '', yMax: yMaxProp, height = 170, format = v => v }) {
  const [hover, setHover] = useState(null); // data index under the crosshair
  const [tableView, setTableView] = useState(false);
  const wrapRef = useRef(null);

  const plotH = height - AXIS_H - PAD_T;
  const n = labels.length;
  const yMax = yMaxProp ?? niceCeil(Math.max(1, ...series.flatMap(s => s.values)));

  const x = i => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const y = v => PAD_T + plotH - (Math.min(v, yMax) / yMax) * plotH;

  const paths = useMemo(() => series.map(s => ({
    ...s,
    line: s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''),
    area: `M${x(0).toFixed(1)},${(PAD_T + plotH).toFixed(1)}` +
      s.values.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') +
      `L${x(n - 1).toFixed(1)},${(PAD_T + plotH).toFixed(1)}Z`,
  })), [series, n, yMax, plotH]);

  const onMove = e => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (px - PAD_L) / (W - PAD_L - PAD_R);
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };
  const onKey = e => {
    if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? n - 1) - 1));
    if (e.key === 'ArrowRight') setHover(h => Math.min(n - 1, (h ?? 0) + 1));
    if (e.key === 'Escape') setHover(null);
  };

  const last = series[0]?.values[n - 1];
  const gridYs = [0.25, 0.5, 0.75].map(f => PAD_T + plotH * f);
  const multi = series.length > 1;

  if (n === 0) return <div className="card chart-card"><div className="chart-title">{title}</div><p className="muted">Waiting for data…</p></div>;

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          {last != null && <span className="chart-now">{format(last)}{unit}</span>}
          <button className="chart-toggle" onClick={() => setTableView(t => !t)}>
            {tableView ? 'chart' : 'table'}
          </button>
        </span>
      </div>

      {multi && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 6 }}>
          {series.map(s => (
            <span key={s.name} className="status-chip">
              <span style={{ width: 12, height: 2, background: s.color, borderRadius: 1 }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      {tableView ? (
        <div style={{ maxHeight: height, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr><th>Time</th>{series.map(s => <th key={s.name}>{s.name}{unit && ` (${unit.trim()})`}</th>)}</tr>
            </thead>
            <tbody>
              {labels.map((l, i) => i % 5 === 0 && (
                <tr key={i}><td>{l}</td>{series.map(s => <td key={s.name}>{format(s.values[i])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" ref={wrapRef}>
          <svg
            viewBox={`0 0 ${W} ${height}`}
            style={{ width: '100%', display: 'block', touchAction: 'none', outline: 'none' }}
            role="img"
            aria-label={title}
            tabIndex={0}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
          >
            {gridYs.map(gy => (
              <line key={gy} x1={PAD_L} x2={W - PAD_R} y1={gy} y2={gy} stroke="var(--grid)" strokeWidth="1" />
            ))}
            <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--baseline)" strokeWidth="1" />

            {[yMax, yMax / 2, 0].map(v => (
              <text key={v} x={PAD_L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">
                {format(v)}
              </text>
            ))}
            <text x={PAD_L} y={height - 4} fontSize="10" fill="var(--muted)">{labels[0]}</text>
            <text x={W - PAD_R} y={height - 4} textAnchor="end" fontSize="10" fill="var(--muted)">{labels[n - 1]}</text>

            {!multi && <path d={paths[0].area} fill={paths[0].color} opacity="0.1" />}
            {paths.map(p => (
              <path key={p.name} d={p.line} fill="none" stroke={p.color} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {paths.map(p => (
              <circle key={p.name} cx={x(n - 1)} cy={y(p.values[n - 1])} r="4"
                fill={p.color} stroke="var(--surface)" strokeWidth="2" />
            ))}

            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke="var(--baseline)" strokeWidth="1" />
                {series.map(s => (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4"
                    fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>

          {hover != null && (
            <div
              className="chart-tooltip"
              style={{
                left: `${(x(hover) / W) * 100}%`,
                top: 6,
                transform: x(hover) > W * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
              }}
            >
              <div className="tt-time">{labels[hover]}</div>
              {series.map(s => (
                <div className="tt-row" key={s.name}>
                  <span className="tt-key" style={{ background: s.color }} />
                  <span className="tt-val">{format(s.values[hover])}{unit}</span>
                  {multi && <span className="tt-name">{s.name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
