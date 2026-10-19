import React from 'react';

// Generic reusable table for the master screens.
// columns = [{ key, label, badge?, align?, tone? }]; the 'status' column and any
// column with badge:true render as a coloured status badge; tone colours the
// header (see config/amounts.js). A row's cellClass[key] overrides a cell's class.
// Edit/Delete buttons show only when their handler is passed; `canDeleteRow`
// hides Delete on individual rows; `extraActions` renders more buttons per row.
// `freeze` keeps the column headings, the first column and the Actions column
// in view while the table scrolls (like Excel's freeze panes). row.rowClass styles a whole row.
export default function DataTable({ columns, rows, onEdit, editLabel = 'Edit', onDelete, canDeleteRow, extraActions, freeze = false }) {
  if (!rows || rows.length === 0) {
    return <p className="empty-state">No records found.</p>;
  }

  const hasActions = Boolean(onEdit || onDelete || extraActions);

  return (
    <div className={`table-wrap${freeze ? ' freeze' : ''}`}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={[col.align === 'right' ? 'num' : '', col.tone ? `tone-head tone-${col.tone}` : ''].filter(Boolean).join(' ') || undefined}
              >
                {col.label}
              </th>
            ))}
            {hasActions && <th className="actions-head">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.rowClass}>
              {columns.map((col) => (
                <td
                  key={col.key} className={row.cellClass?.[col.key] || (col.align === 'right' ? 'num' : undefined)}
                  // Full text on hover, for values cut short with "…" in frozen tables
                  title={typeof row[col.key] === 'string' && row[col.key] !== '—' ? row[col.key] : undefined}
                >
                  {(col.key === 'status' || col.badge) && typeof row[col.key] === 'string' ? (
                    <span className={`badge badge-${row[col.key]?.toLowerCase()}`}>{row[col.key]}</span>
                  ) : (
                    row[col.key]
                  )}
                </td>
              ))}
              {hasActions && (
                <td className="actions-cell">
                  {onEdit && <button className="btn btn-small" onClick={() => onEdit(row)}>{editLabel}</button>}
                  {extraActions && extraActions(row)}
                  {onDelete && (!canDeleteRow || canDeleteRow(row)) && <button className="btn btn-small btn-danger" onClick={() => onDelete(row)}>Delete</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
