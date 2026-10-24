import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Single-choice dropdown with search: type in the box to filter the list, pick
// with the mouse or the arrow keys + Enter; Escape / Tab / clicking away keeps
// the current choice. Behaves like a <select> for forms: value is the chosen
// option's value ('' = nothing chosen), onChange(value), and `required` stops
// the form from being saved while nothing is chosen.
// options = [{ value, label }]
export default function SearchSelect({ id, options, value, onChange, placeholder = 'Select', disabled = false, required = false }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const root = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const listId = useId();

  const items = useMemo(() => (options || []).map((o) => ({ value: String(o.value), label: String(o.label) })), [options]);
  const chosen = items.find((o) => o.value === String(value ?? '')) || null;
  const shown = term.trim() ? items.filter((o) => o.label.toLowerCase().includes(term.trim().toLowerCase())) : items;

  const close = () => { setOpen(false); setTerm(''); };
  const pick = (o) => {
    if (o && o.value !== String(value ?? '')) onChange(o.value);
    close();
  };

  // The list is placed against the window (position: fixed) so a scrolling pop-up
  // cannot cut it off; it opens upwards when there is no room below.
  const place = () => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 220 && r.top > below;
    setPos({ left: r.left, width: r.width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, maxHeight: Math.max(140, Math.min(280, (up ? r.top : below) - 16)) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!root.current?.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Start on the current choice; keep the highlighted row in view
  useEffect(() => {
    if (open) setActive(Math.max(0, shown.findIndex((o) => o === chosen)));
  }, [open, term]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => Math.min(shown.length - 1, Math.max(0, a + step)));
    } else if (e.key === 'Enter') {
      if (open) { e.preventDefault(); pick(shown[active]); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); close(); }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div className={`search-select${open ? ' open' : ''}${chosen ? ' has-value' : ''}`} ref={root}>
      <input
        ref={input} id={id} type="text" autoComplete="off" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        disabled={disabled} required={required} placeholder={open && chosen ? chosen.label : placeholder} title={chosen?.label}
        value={open ? term : chosen?.label || ''}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && pos && (
        <ul ref={list} id={listId} className="search-select-list" role="listbox" style={pos}>
          {shown.length === 0 && <li className="empty">No matches</li>}
          {shown.map((o, i) => (
            <li
              key={o.value} role="option" aria-selected={o === chosen}
              className={`${i === active ? 'active' : ''}${o === chosen ? ' chosen' : ''}`.trim() || undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
