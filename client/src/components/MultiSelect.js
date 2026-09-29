import React, { useEffect, useMemo, useRef, useState } from 'react';

// Multi-select filter dropdown: tick one or more values, Select all / Clear,
// and search inside the list. value is an array of option values; an empty
// array means "no filter" and shows allLabel (e.g. "All SD Types").
// options = [{ value, label }] or plain strings.
export default function MultiSelect({ options, value, onChange, allLabel = 'All', noun = 'selected', disabled = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const root = useRef(null);
  const searchBox = useRef(null);

  const items = useMemo(
    () => (options || []).map((o) => (typeof o === 'object' ? { value: String(o.value), label: String(o.label) } : { value: String(o), label: String(o) })),
    [options]
  );
  const chosen = useMemo(() => {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return new Set(list.map(String));
  }, [value]);
  const shown = term.trim()
    ? items.filter((o) => o.label.toLowerCase().includes(term.trim().toLowerCase()))
    : items;

  // Close on a click outside or Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    searchBox.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => { if (!open) setTerm(''); }, [open]);

  const emit = (set) => onChange(items.filter((o) => set.has(o.value)).map((o) => o.value));
  const toggle = (v) => {
    const next = new Set(chosen);
    if (next.has(v)) next.delete(v); else next.add(v);
    emit(next);
  };
  // Select all / Clear act on the options currently listed (all, or the search matches)
  const selectAll = () => emit(new Set([...chosen, ...shown.map((o) => o.value)]));
  const clearAll = () => {
    if (!term.trim()) return onChange([]);
    const next = new Set(chosen);
    shown.forEach((o) => next.delete(o.value));
    return emit(next);
  };

  const picked = items.filter((o) => chosen.has(o.value));
  const summary = picked.length === 0 ? allLabel
    : picked.length === 1 ? picked[0].label
      : picked.length === items.length ? `All (${picked.length})`
        : `${picked.length} ${noun}`;
  const allShownChosen = shown.length > 0 && shown.every((o) => chosen.has(o.value));

  return (
    <div className={`multi-select${open ? ' open' : ''}${picked.length ? ' has-value' : ''} ${className}`.trim()} ref={root}>
      <button
        type="button" className="multi-select-toggle" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        title={picked.length > 1 ? picked.map((o) => o.label).join(', ') : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="multi-select-summary">{summary}</span>
        {picked.length > 1 && <span className="multi-select-count">{picked.length}</span>}
      </button>

      {open && (
        <div className="multi-select-panel">
          <input
            ref={searchBox} type="search" className="multi-select-search" placeholder="Search..."
            value={term} onChange={(e) => setTerm(e.target.value)}
          />
          <div className="multi-select-actions">
            <button type="button" onClick={selectAll} disabled={allShownChosen}>Select all</button>
            <button type="button" onClick={clearAll} disabled={!shown.some((o) => chosen.has(o.value))}>Clear</button>
          </div>
          <ul className="multi-select-list" role="listbox" aria-multiselectable="true">
            {shown.length === 0 && <li className="empty">No matches</li>}
            {shown.map((o) => (
              <li key={o.value}>
                <label className={chosen.has(o.value) ? 'checked' : undefined}>
                  <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} />
                  <span>{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
