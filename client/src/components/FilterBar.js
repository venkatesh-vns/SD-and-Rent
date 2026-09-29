import React from 'react';
import MultiSelect from './MultiSelect';

const STATUSES = ['Active', 'Inactive'];

// Search box + Active/Inactive filter (one or both) + optional Export button.
// status is an array of the chosen statuses (empty = all).
export default function FilterBar({ search, status, onChange, onExport, placeholder }) {
  return (
    <div className="filter-bar">
      <input
        type="search"
        value={search}
        placeholder={placeholder || 'Search...'}
        onChange={(e) => onChange({ search: e.target.value, status })}
      />
      <MultiSelect allLabel="All statuses" noun="statuses" options={STATUSES} value={status} onChange={(v) => onChange({ search, status: v })} />
      {onExport && <button type="button" className="btn btn-secondary" onClick={onExport}>Export to Excel</button>}
    </div>
  );
}
