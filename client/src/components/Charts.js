import React, { useEffect, useRef, useState } from 'react';
import { formatAmount } from '../utils/format';

// Small dependency-free SVG charts for the SD Dashboard.
// Amounts are labelled in the Indian style (K, L = lakh, Cr = crore).

export function compactAmount(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e9 ? 0 : 2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs >= 1e7 ? 0 : 2)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

// Round the axis maximum up to a tidy number (1, 2, 2.5, 5 x 10^n)
function niceMax(max) {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const f = max / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

/**
 * Donut chart. data = [{ label, value, color }]. valueFormat formats the
 * legend and tooltip values; center = { label, value } in the hole.
 */
export function DonutChart({ data, size = 180, thickness = 30, center, valueFormat = (v) => v, empty = 'No data' }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + Math.max(Number(d.value) || 0, 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = hover !== null ? data[hover] : null;

  return (
    <div className="donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img"
        aria-label={data.map((d) => `${d.label}: ${valueFormat(d.value)}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        {total > 0 && data.map((d, i) => {
          const v = Math.max(Number(d.value) || 0, 0);
          const len = (v / total) * c;
          const seg = (
            <circle
              key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={d.color} strokeWidth={hover === i ? thickness + 6 : thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              className="donut-seg"
            >
              <title>{`${d.label}: ${valueFormat(d.value)} (${((v / total) * 100).toFixed(1)}%)`}</title>
            </circle>
          );
          offset += len;
          return seg;
        })}
        <text x="50%" y="46%" textAnchor="middle" className="donut-center-label">{shown ? shown.label : center?.label}</text>
        <text x="50%" y="58%" textAnchor="middle" className="donut-center-value">
          {shown ? valueFormat(shown.value) : total > 0 ? center?.value : empty}
        </text>
      </svg>
      <ul className="chart-legend">
        {data.map((d, i) => (
          <li key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'hover' : undefined}>
            <span className="swatch" style={{ background: d.color }} />
            <span className="legend-label">{d.label}</span>
            <span className="legend-value">{valueFormat(d.value)}</span>
            {total > 0 && <span className="legend-pct">{((Math.max(Number(d.value) || 0, 0) / total) * 100).toFixed(0)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Grouped bar chart. rows = [{ key, label, ...values }], series = [{ key,
 * label, color }]. onSelect(row) makes each group clickable (drill-down).
 */
export function BarChart({ rows, series, onSelect, height = 260, selectHint }) {
  const [hover, setHover] = useState(null);
  // Fill the card: size the groups from the container width
  const box = useRef(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    if (!box.current) return undefined;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.floor(e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  // Axis: tidy steps that always include zero
  const values = rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0));
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const step = niceMax((hi - lo) / 4 || 1);
  const floor = Math.floor(lo / step) * step;
  const top = Math.max(Math.ceil(hi / step) * step, floor + step);
  const range = top - floor;
  const pad = { top: 12, right: 12, bottom: 54, left: 70 };
  const groupW = Math.min(190, Math.max(56, ((boxW || 720) - pad.left - pad.right) / Math.max(rows.length, 1)));
  const width = pad.left + pad.right + groupW * rows.length;
  const plotH = height - pad.top - pad.bottom;
  const y = (v) => pad.top + plotH - ((v - floor) / range) * plotH;
  const barW = Math.max(6, Math.min(28, (groupW - 16) / series.length));
  const ticks = [];
  for (let t = floor; t <= top + step / 2; t += step) ticks.push(t);
  const clip = (s) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);

  return (
    <div className="bar-chart" ref={box}>
      {!rows.length ? <p className="empty-state">No data for the selected filters.</p> : (
      <>
      <ul className="chart-legend inline">
        {series.map((s) => (
          <li key={s.key}><span className="swatch" style={{ background: s.color }} /><span className="legend-label">{s.label}</span></li>
        ))}
      </ul>
      <div className="bar-chart-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Bar chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{compactAmount(t)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const gx = pad.left + i * groupW;
            const start = gx + (groupW - barW * series.length) / 2;
            return (
              <g
                key={r.key} className={`bar-group${onSelect ? ' clickable' : ''}${hover === i ? ' hover' : ''}`}
                onClick={onSelect ? () => onSelect(r) : undefined}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              >
                <rect x={gx + 2} y={pad.top} width={groupW - 4} height={plotH} className="bar-hit" rx="6" />
                {series.map((s, j) => {
                  const v = Number(r[s.key]) || 0;
                  const top = y(Math.max(v, 0));
                  const h = Math.max(Math.abs(y(v) - y(0)), v ? 1 : 0);
                  return (
                    <rect key={s.key} x={start + j * barW} y={v >= 0 ? top : y(0)} width={barW - 2} height={h} rx="2" fill={s.color}>
                      <title>{`${r.label} · ${s.label}: ₹${formatAmount(v)}`}</title>
                    </rect>
                  );
                })}
                <text x={gx + groupW / 2} y={height - pad.bottom + 18} textAnchor="middle" className="chart-axis strong">
                  <title>{r.label}</title>
                  {clip(r.label)}
                </text>
                {r.sub && <text x={gx + groupW / 2} y={height - pad.bottom + 33} textAnchor="middle" className="chart-axis">{r.sub}</text>}
              </g>
            );
          })}
          <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} className="chart-zero" />
        </svg>
      </div>
      {onSelect && selectHint && <p className="hint chart-hint">{selectHint}</p>}
      </>
      )}
    </div>
  );
}
