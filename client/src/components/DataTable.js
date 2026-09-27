import React from 'react';

// Generic reusable table for the master screens.
// columns = [{ key, label, badge?, align? }]; the 'status' column and any
// column with badge:true render as a coloured status badge.
// Edit/Delete buttons show only when their handler is passed; `canDeleteRow`
// hides Delete on individual rows; `extraActions` renders more buttons per row.
export default function DataTable({ columns, rows, onEdit, editLabel = 'Edit', onDelete, canDeleteRow, extraActions }) {
  if (!rows || rows.length === 0) {
    return <p className="empty-state">No records found.</p>;
  }

  const hasActions = Boolean(onEdit || onDelete || extraActions);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.align === 'right' ? 'num' : undefined}>{col.label}</th>
            ))}
            {hasActions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key} className={col.align === 'right' ? 'num' : undefined}>
                  {col.key === 'status' || col.badge ? (
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
