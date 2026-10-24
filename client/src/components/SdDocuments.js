import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import api, { downloadFile, errorMessage } from '../services/api';
import { formatDateTime } from '../utils/format';

const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const EMPTY = { documentType: '', title: '', remarks: '', file: null };

// Documents (PDF / Word) of one SD Code: upload, view in a new tab, download,
// new versions with history, delete with a reason. rights = { upload, remove }.
export default function SdDocuments({ sd, rights, onClose, onChanged }) {
  const [docs, setDocs] = useState([]);
  const [meta, setMeta] = useState({ types: [], maxMb: 20 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [history, setHistory] = useState({}); // document group -> versions (when open)
  const [deleting, setDeleting] = useState(null);
  const [reason, setReason] = useState('');
  const fileInput = useRef(null);
  const versionInput = useRef(null);
  const versionFor = useRef(null);

  const say = (type, text) => setMessage({ type, text });
  const load = useCallback(async () => {
    try {
      setDocs((await api.get('/sd-documents', { params: { sdId: sd.sd_id } })).data.data);
    } catch (err) {
      say('error', errorMessage(err, 'Could not load the documents.'));
    } finally {
      setLoading(false);
    }
  }, [sd.sd_id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/sd-documents/types').then((r) => setMeta(r.data.data)).catch(() => {}); }, []);

  const changed = async () => { setHistory({}); await load(); onChanged?.(); };

  // Picked files are checked here first (the server checks again, by content)
  const checkPicked = (file) => {
    if (!file) return 'Choose a PDF or Word file.';
    if (!/\.(pdf|docx?)$/i.test(file.name)) return 'Only PDF (.pdf) and Word (.doc, .docx) documents can be attached.';
    if (file.size > meta.maxMb * 1048576) return `The file is too large. The limit is ${meta.maxMb} MB.`;
    return null;
  };

  const upload = async (e) => {
    e.preventDefault();
    const problem = !form.documentType ? 'Choose the Document Type.' : checkPicked(form.file);
    if (problem) return say('error', problem);
    const body = new FormData();
    body.append('sdId', sd.sd_id);
    body.append('documentType', form.documentType);
    body.append('title', form.title);
    body.append('remarks', form.remarks);
    body.append('file', form.file);
    setBusy('upload');
    try {
      const res = await api.post('/sd-documents', body);
      say('success', res.data.message);
      setForm(EMPTY);
      if (fileInput.current) fileInput.current.value = '';
      await changed();
    } catch (err) {
      say('error', errorMessage(err, 'Upload failed.'));
    } finally {
      setBusy('');
    }
    return undefined;
  };

  const newVersion = async (file) => {
    const doc = versionFor.current;
    if (!doc || !file) return;
    const problem = checkPicked(file);
    if (problem) { say('error', problem); return; }
    const remarks = window.prompt(`New version of "${doc.title}" from ${file.name}.\nRemarks (optional):`, '');
    if (remarks === null) return;
    const body = new FormData();
    body.append('remarks', remarks);
    body.append('file', file);
    setBusy(`v${doc.document_id}`);
    try {
      say('success', (await api.post(`/sd-documents/${doc.document_id}/versions`, body)).data.message);
      await changed();
    } catch (err) {
      say('error', errorMessage(err, 'Upload failed.'));
    } finally {
      setBusy('');
    }
  };

  // The tab is opened at once (inside the click, so it is not blocked as a pop-up)
  // and pointed at a signed link that is valid for two minutes
  const view = async (doc) => {
    const tab = window.open('', '_blank');
    try {
      const { url } = (await api.post(`/sd-documents/${doc.document_id}/view-link`)).data.data;
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (err) {
      tab?.close();
      say('error', errorMessage(err, 'Could not open the document.'));
    }
  };

  const download = (doc) => downloadFile(`/sd-documents/${doc.document_id}/download`, {}, doc.file_name)
    .catch(() => say('error', 'Download failed. The document may have been deleted; refresh the list.'));

  const toggleHistory = async (doc) => {
    if (history[doc.group_id]) { setHistory(({ [doc.group_id]: _, ...rest }) => rest); return; }
    try {
      const rows = (await api.get(`/sd-documents/${doc.document_id}/versions`)).data.data;
      setHistory((h) => ({ ...h, [doc.group_id]: rows }));
    } catch (err) {
      say('error', errorMessage(err, 'Could not load the versions.'));
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return say('error', 'Enter the reason for deleting the document.');
    setBusy('delete');
    try {
      say('success', (await api.delete(`/sd-documents/${deleting.document_id}`, { data: { reason } })).data.message);
      setDeleting(null);
      setReason('');
      await changed();
    } catch (err) {
      say('error', errorMessage(err, 'Delete failed.'));
    } finally {
      setBusy('');
    }
    return undefined;
  };

  const fileCell = (d) => (
    <span className="doc-file">
      <span className={`doc-badge doc-${d.file_ext}`}>{d.file_ext.toUpperCase()}</span>
      <span className="doc-file-name" title={d.file_name}>{d.file_name}</span>
      <small>{size(Number(d.size_bytes))}</small>
    </span>
  );
  const fileActions = (d) => (
    <>
      {d.file_ext === 'pdf'
        ? <button type="button" className="btn btn-small btn-outline" onClick={() => view(d)}>View</button>
        : <button type="button" className="btn btn-small btn-outline" disabled title="Word documents open in Word: use Download">View</button>}
      <button type="button" className="btn btn-small btn-outline" onClick={() => download(d)}>Download</button>
    </>
  );

  return (
    <Modal title={`Documents - ${sd.sd_code}`} onClose={onClose} wide>
      <p className="hint doc-intro">
        {[sd.lease_id, sd.agreement_no, sd.cost_center_name, sd.floor && `Floor ${sd.floor}`, sd.landlord_name].filter(Boolean).join(' · ')}
      </p>
      {message && <div className={`doc-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}

      {rights.upload && (
        <form className="doc-upload" onSubmit={upload}>
          <h4 className="form-section first">Upload a document <small>PDF or Word (.pdf, .doc, .docx), up to {meta.maxMb} MB</small></h4>
          <div className="form-grid three">
            <div>
              <label htmlFor="docType">Document Type <span className="req" aria-hidden="true">*</span></label>
              <select id="docType" required value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}>
                <option value="">Select Document Type</option>
                {meta.types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="docTitle">Title</label>
              <input id="docTitle" type="text" maxLength={200} placeholder="Defaults to the file name" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label htmlFor="docRemarks">Remarks</label>
              <input id="docRemarks" type="text" maxLength={500} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
          <div className="doc-upload-row">
            <input ref={fileInput} id="docFile" type="file" accept={ACCEPT} onChange={(e) => setForm({ ...form, file: e.target.files[0] || null })} />
            <button type="submit" className="btn btn-primary" disabled={busy === 'upload'}>{busy === 'upload' ? 'Uploading...' : 'Upload'}</button>
          </div>
        </form>
      )}

      <h4 className={`form-section${rights.upload ? '' : ' first'}`}>Attached documents <small>{loading ? '' : `${docs.length} document${docs.length === 1 ? '' : 's'}`}</small></h4>
      {loading ? <p>Loading...</p> : docs.length === 0 ? <p className="empty-state">No documents attached to {sd.sd_code} yet.</p> : (
        <div className="table-wrap">
          <table className="data-table compact doc-table">
            <thead>
              <tr><th>Document Type</th><th>Title</th><th>Version</th><th>File</th><th>Uploaded</th><th className="actions-head">Actions</th></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <React.Fragment key={d.group_id}>
                  <tr>
                    <td>{d.document_type}</td>
                    <td><strong>{d.title}</strong>{d.remarks && <small className="doc-remarks">{d.remarks}</small>}</td>
                    <td>
                      <span className="doc-version">v{d.version_no}</span>
                      {d.versions > 1 && (
                        <button type="button" className="link-button doc-history-toggle" onClick={() => toggleHistory(d)} aria-expanded={Boolean(history[d.group_id])}>
                          {history[d.group_id] ? 'Hide history' : `History (${d.versions})`}
                        </button>
                      )}
                    </td>
                    <td>{fileCell(d)}</td>
                    <td className="doc-when">{d.uploaded_by}<small>{formatDateTime(d.uploaded_date)}</small></td>
                    <td className="doc-actions">
                      {fileActions(d)}
                      {rights.upload && (
                        <button type="button" className="btn btn-small btn-outline" disabled={busy === `v${d.document_id}`}
                          onClick={() => { versionFor.current = d; versionInput.current.value = ''; versionInput.current.click(); }}>
                          {busy === `v${d.document_id}` ? 'Uploading...' : 'New version'}
                        </button>
                      )}
                      {rights.remove && <button type="button" className="btn btn-small btn-danger-outline" onClick={() => { setDeleting(d); setReason(''); }}>Delete</button>}
                    </td>
                  </tr>
                  {deleting?.group_id === d.group_id && (
                    <tr className="doc-delete-row">
                      <td colSpan={6}>
                        <form onSubmit={remove} className="doc-delete">
                          <label htmlFor="docReason">Delete "{d.title}" and all {d.versions} version{d.versions === 1 ? '' : 's'}? Reason <span className="req" aria-hidden="true">*</span></label>
                          <input id="docReason" type="text" maxLength={500} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Uploaded to the wrong SD Code" />
                          <button type="submit" className="btn btn-small btn-danger" disabled={busy === 'delete'}>Delete</button>
                          <button type="button" className="btn btn-small btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
                        </form>
                      </td>
                    </tr>
                  )}
                  {(history[d.group_id] || []).map((v) => (
                    <tr key={v.document_id} className="doc-version-row">
                      <td />
                      <td>{v.remarks || <span className="muted">—</span>}</td>
                      <td><span className={`doc-version${v.is_latest ? ' latest' : ''}`}>v{v.version_no}</span>{v.is_latest && <small className="doc-latest">latest</small>}</td>
                      <td>{fileCell(v)}</td>
                      <td className="doc-when">{v.uploaded_by}<small>{formatDateTime(v.uploaded_date)}</small></td>
                      <td className="doc-actions">{fileActions(v)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <input ref={versionInput} type="file" accept={ACCEPT} hidden onChange={(e) => newVersion(e.target.files[0])} />
      <p className="hint doc-footnote">Every upload, new version, view, download and delete is recorded in the Audit Log. Deleted documents are kept, with their reason, for the audit trail.</p>
    </Modal>
  );
}
