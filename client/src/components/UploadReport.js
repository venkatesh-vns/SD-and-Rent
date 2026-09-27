import React, { useState } from 'react';
import { downloadFile } from '../services/api';

// Validation result of one bulk upload: summary line + row-level table
export default function UploadReport({ result, onClose }) {
  const [showPassed, setShowPassed] = useState(false);
  const rows = showPassed ? result.report : result.report.filter((r) => r.status === 'Failed');

  return (
    <div className={`upload-report ${result.failed > 0 ? 'has-errors' : ''}`}>
      <div className="upload-report-header">
        <strong>
          {result.totalRows} row(s): {result.passed} saved, {result.failed} failed
        </strong>
        <div>
          <label className="inline-check">
            <input type="checkbox" checked={showPassed} onChange={(e) => setShowPassed(e.target.checked)} />
            Show passed rows
          </label>
          <button
            type="button"
            className="btn btn-small btn-secondary"
            onClick={() => downloadFile(`/uploads/${result.batchId}/report`, {}, 'UploadReport.xlsx')}
          >
            Download report
          </button>
          <button type="button" className="btn btn-small btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr><th>Row</th><th>Key</th><th>Field</th><th>Uploaded Value</th><th>Status</th><th>Error</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.row}</td>
                  <td>{r.key}</td>
                  <td>{r.field}</td>
                  <td>{r.value}</td>
                  <td><span className={`badge badge-${r.status === 'Passed' ? 'active' : 'inactive'}`}>{r.status}</span></td>
                  <td>{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
