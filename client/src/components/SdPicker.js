import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import useDebounce from '../hooks/useDebounce';

// Type-ahead search for an SD Code (by SD Code, Lease ID, Agreement No. or landlord)
export default function SdPicker({ onSelect, placeholder = 'Search SD Code, Lease ID, Agreement No. or Landlord', autoFocus }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const term = useDebounce(q, 250);
  const box = useRef(null);

  useEffect(() => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    api.get('/sd-transactions/sd-search', { params: { q: term.trim() } })
      .then((res) => setResults(res.data.data))
      .catch(() => setResults([]));
  }, [term]);

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (sd) => {
    setQ('');
    setOpen(false);
    onSelect(sd);
  };

  return (
    <div className="sd-picker" ref={box}>
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault();
            choose(results[0]);
          }
        }}
      />
      {open && term.trim() && (
        <ul className="sd-picker-list">
          {results.length === 0 && <li className="empty">No matching SD Code</li>}
          {results.map((sd) => (
            <li key={sd.sd_id}>
              <button type="button" onClick={() => choose(sd)}>
                <strong>{sd.sd_code}</strong>
                <span>{[sd.lease_id, sd.agreement_no, sd.landlord_name, `Floor ${sd.floor}`, sd.cost_center_code].filter(Boolean).join(' · ')}</span>
                {(sd.landlord_status !== 'Active' || sd.building_status !== 'Active') && <em>Passive</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
