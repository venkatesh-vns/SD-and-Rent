import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorMessage } from '../services/api';
import UploadReport from './UploadReport';

// Bulk Edit of existing records: download them (current filters) into Excel,
// change them, upload the file. `endpoint` is the master's base URL, e.g. '/rent/rules';
// `noun` names the records ('rules' / 'waivers').
export default function BulkEdit({ endpoint, query, fileName, noun, onUploaded }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleDownload = async () => {
    setError('');
    try {
      await downloadFile(`${endpoint}/bulk-edit`, query, fileName);
    } catch (err) {
      setError('Could not download the records.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const form = e.target;
    setBusy(true);
    setError('');
    setResult(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post(`${endpoint}/bulk-edit`, formData);
      setResult(res.data.data);
      if (res.data.data.passed > 0) onUploaded?.();
    } catch (err) {
      setError(errorMessage(err, 'Bulk Edit upload failed.'));
    } finally {
      setBusy(false);
      setFile(null);
      form.reset();
    }
  };

  return (
    <details className="bulk-edit">
      <summary>Bulk Edit <span className="hint">change many existing {noun} at once in Excel</span></summary>
      <ol className="bulk-edit-steps">
        <li>If the Rent Schedule is already generated for the months you will change, delete those lines first in <Link to="/rent/schedule">Rent Schedule</Link> (Delete Schedule).</li>
        <li>Download the {noun} (the filters below apply), change them in Excel, and upload the file here. Unchanged rows are skipped.</li>
        <li>Regenerate the Rent Schedule for the deleted period.</li>
      </ol>
      <form className="excel-upload-form" onSubmit={handleSubmit}>
        <button type="button" className="btn btn-secondary" onClick={handleDownload}>Download for Bulk Edit</button>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files[0])} />
        <button type="submit" className="btn btn-primary" disabled={!file || busy}>{busy ? 'Uploading...' : 'Upload Bulk Edit'}</button>
      </form>
      {error && <div className="alert alert-error">{error}</div>}
      {result && <UploadReport result={result} onClose={() => setResult(null)} />}
    </details>
  );
}
