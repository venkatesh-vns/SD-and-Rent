import React from 'react';

// Search box + Active/Inactive filter + optional Export button
export default function FilterBar({ search, status, onChange, onExport, placeholder }) {
  return (
    <div className="filter-bar">
      <input
        type="search"
        value={search}
        placeholder={placeholder || 'Search...'}
        onChange={(e) => onChange({ search: e.target.value, status })}
      />
      <select value={status} onChange={(e) => onChange({ search, status: e.target.value })}>
        <option value="">All statuses</option>
        <option value="Active">Active</option>
        <option value="Inactive">Inactive</option>
      </select>
      {onExport && <button type="button" className="btn btn-secondary" onClick={onExport}>Export to Excel</button>}
    </div>
  );
}
