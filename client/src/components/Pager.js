import React from 'react';

// "Showing 51-100 of 340" + Previous / Next
export default function Pager({ page, pageSize, total, onChange }) {
  if (total === 0) return null;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="pager">
      <span>Showing {from}–{to} of {total}</span>
      <div>
        <button type="button" className="btn btn-small btn-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <span className="pager-page">Page {page} of {pages}</span>
        <button type="button" className="btn btn-small btn-secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
