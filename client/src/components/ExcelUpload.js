import React, { useState } from 'react';
import api, { downloadFile, errorMessage } from '../services/api';
import UploadReport from './UploadReport';

// Template download + file picker + upload + row-level validation report.
// `endpoint` is the master's base URL, e.g. '/cost-centers'.
export default function ExcelUpload({ endpoint, templateName, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const form = e.target;
    setUploading(true);
    setError('');
    setResult(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post(`${endpoint}/bulk-upload`, formData);
      setResult(res.data.data);
      if (res.data.data.passed > 0) onUploaded?.();
    } catch (err) {
      setError(errorMessage(err, 'Bulk upload failed.'));
    } finally {
      setUploading(false);
      setFile(null);
      form.reset();
    }
  };

  const handleTemplate = async () => {
    setError('');
    try {
      await downloadFile(`${endpoint}/template`, {}, templateName);
    } catch (err) {
      setError('Could not download the template.');
    }
  };

  return (
    <div className="upload-panel">
      <form className="excel-upload-form" onSubmit={handleSubmit}>
        <button type="button" className="btn btn-secondary" onClick={handleTemplate}>Download Template</button>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files[0])} />
        <button type="submit" className="btn btn-primary" disabled={!file || uploading}>
          {uploading ? 'Uploading...' : 'Upload & Validate'}
        </button>
      </form>
      {error && <div className="alert alert-error">{error}</div>}
      {result && <UploadReport result={result} onClose={() => setResult(null)} />}
    </div>
  );
}
