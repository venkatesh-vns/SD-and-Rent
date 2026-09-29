import React, { useEffect, useRef, useState } from 'react';
import { DATE_PRESETS, presetRange, matchPreset, dmyToIso, isoToDmy } from '../utils/dateRanges';

// Date filter with quick ranges (Today, This Month, This Financial Year, ...)
// and a Custom range with From / To pickers. from and to are 'DD/MM/YYYY'
// strings ('' = open); onChange receives { from, to }.
export default function DateRangeFilter({ label = 'Date', from = '', to = '', onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [error, setError] = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const root = useRef(null);

  const active = Boolean(from || to);
  const preset = matchPreset(from, to);

  useEffect(() => {
    if (!open) return undefined;
    setCustom({ from: dmyToIso(from), to: dmyToIso(to) });
    setError('');
    // Open towards the left when there is no room on the right
    const box = root.current?.getBoundingClientRect();
    setAlignRight(Boolean(box && box.left + 540 > window.innerWidth));
    const onDown = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (range) => {
    onChange(range);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!custom.from && !custom.to) return setError('Choose a From date, a To date or both.');
    if (custom.from && custom.to && custom.from > custom.to) return setError('From date cannot be after To date.');
    return choose({ from: isoToDmy(custom.from), to: isoToDmy(custom.to) });
  };

  const summary = !active ? `${label}: all`
    : preset ? `${label}: ${preset.label}`
      : from && to ? `${from} – ${to}`
        : from ? `${label} from ${from}` : `${label} to ${to}`;

  return (
    <div className={`multi-select date-range${open ? ' open' : ''}${active ? ' has-value' : ''} ${className}`.trim()} ref={root}>
      <button
        type="button" className="multi-select-toggle" aria-haspopup="dialog" aria-expanded={open}
        title={active ? `${from || '…'} to ${to || '…'}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <svg className="date-range-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16v14H4V6Zm0 4h16M8 3v4M16 3v4" />
        </svg>
        <span className="multi-select-summary">{summary}</span>
      </button>

      {open && (
        <div className={`multi-select-panel date-range-panel${alignRight ? ' align-right' : ''}`} role="dialog" aria-label={`${label} range`}>
          <ul className="date-range-presets">
            <li>
              <button type="button" className={!active ? 'selected' : undefined} onClick={() => choose({ from: '', to: '' })}>
                <span>All dates</span>
              </button>
            </li>
            {DATE_PRESETS.map(([key, name]) => {
              const r = presetRange(key);
              return (
                <li key={key}>
                  <button type="button" className={preset?.key === key ? 'selected' : undefined} onClick={() => choose(r)}>
                    <span>{name}</span>
                    <small>{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</small>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={`date-range-custom${active && !preset ? ' selected' : ''}`}>
            <strong>Custom Date Range</strong>
            <div className="date-range-inputs">
              <label>
                From
                <input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              </label>
              <label>
                To
                <input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </label>
            </div>
            {error && <p className="date-range-error">{error}</p>}
            <button type="button" className="btn btn-primary btn-small" onClick={applyCustom}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
