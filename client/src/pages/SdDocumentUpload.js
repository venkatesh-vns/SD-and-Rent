import React, { useCallback, useEffect, useRef, useState } from 'react';
import Navbar from '../components/Navbar';
import Pager from '../components/Pager';
import SearchSelect from '../components/SearchSelect';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import { formatDateTime } from '../utils/format';

const DOC_ACCEPT = '.pdf,.doc,.docx';
const PARALLEL = 3;
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
const segments = (p) => norm(p).split('/').filter(Boolean);

// Matches a template File Path to one of the chosen files: by file name, and when
// several chosen files share the name, by the most matching folders at the end.
function matchFile(filePath, chosen) {
  const want = segments(filePath);
  const name = want[want.length - 1];
  const same = chosen.filter((c) => c.segs[c.segs.length - 1] === name);
  const shown = String(filePath || '').split(/[\\/]/).pop() || 'The file';
  if (same.length <= 1) return same[0] ? { file: same[0].file } : { error: `${shown} was not among the chosen files.` };
  const score = (c) => { let n = 0; while (n < Math.min(c.segs.length, want.length) && c.segs[c.segs.length - 1 - n] === want[want.length - 1 - n]) n += 1; return n; };
  const ranked = same.map((c) => ({ c, s: score(c) })).sort((x, y) => y.s - x.s);
  if (ranked[0].s > ranked[1].s) return { file: ranked[0].c.file };
  return { error: `Several chosen files are named ${shown}; give the full File Path so the folder tells them apart.` };
}

const StatusBadge = ({ status }) => <span className={`doc-status doc-status-${status.toLowerCase()}`}>{status}</span>;

export default function SdDocumentUpload() {
  const { can, user } = useAuth();
  const canUpload = can(SCREENS.SD_DOCUMENT_UPLOAD, 'upload');
  const isAdmin = Boolean(user?.isAdmin);
  const [settings, setSettings] = useState({ types: [], maxMb: 20, serverFolders: [] });
  const [template, setTemplate] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [progress, setProgress] = useState(null); // { done, total }
  const [batch, setBatch] = useState(null);
  const [rowFilter, setRowFilter] = useState('All');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState({ rows: [], total: 0 });
  const [page, setPage] = useState(1);
  const [del, setDel] = useState({ mode: 'batch', batchId: '', date: '', reason: '', preview: null, busy: false });
  const [deletable, setDeletable] = useState([]);
  const templateInput = useRef(null);
  const folderInput = useRef(null);
  const filesInput = useRef(null);

  useEffect(() => { api.get('/sd-document-batches/settings').then((r) => setSettings(r.data.data)).catch(() => {}); }, []);
  const loadHistory = useCallback(async () => {
    try {
      const r = await api.get('/sd-document-batches', { params: { page } });
      setHistory({ rows: r.data.data, total: r.data.total });
    } catch (err) {
      setError(errorMessage(err, 'Could not load the upload history.'));
    }
  }, [page]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  const loadDeletable = useCallback(() => {
    if (!isAdmin) return;
    api.get('/sd-document-batches', { params: { pageSize: 200 } })
      .then((r) => setDeletable(r.data.data.filter((b) => b.status !== 'Deleted')))
      .catch(() => {});
  }, [isAdmin]);
  useEffect(() => { loadDeletable(); }, [loadDeletable]);

  const pickDocs = (list) => {
    const files = [...list].filter((f) => /\.(pdf|docx?)$/i.test(f.name));
    setChosen(files.map((file) => ({ file, segs: segments(file.webkitRelativePath || file.name) })));
  };

  const start = async () => {
    setError('');
    setNotice('');
    if (!template) { setError('Choose the filled template (.xlsx).'); return; }
    setProgress({ done: 0, total: 0 });
    try {
      const form = new FormData();
      form.append('file', template);
      let b = (await api.post('/sd-document-batches', form)).data.data;
      setBatch(b);
      setRowFilter('All');
      const pending = b.rows.filter((r) => r.status === 'Pending');
      const notFound = [];
      const jobs = [];
      pending.forEach((r) => {
        const m = matchFile(r.file_path, chosen);
        if (m.file) jobs.push({ r, file: m.file }); else notFound.push({ rowNo: r.row_no, message: m.error });
      });
      setProgress({ done: 0, total: jobs.length });
      let done = 0;
      const next = async () => {
        while (jobs.length) {
          const { r, file } = jobs.shift();
          const body = new FormData();
          body.append('file', file, file.name);
          try {
            const updated = (await api.post(`/sd-document-batches/${b.batch_id}/rows/${r.row_no}/file`, body)).data.data;
            setBatch((cur) => ({ ...cur, rows: cur.rows.map((x) => (x.row_no === updated.row_no ? { ...x, ...updated } : x)) }));
          } catch (err) {
            notFound.push({ rowNo: r.row_no, message: errorMessage(err, 'Upload failed.') });
          }
          done += 1;
          setProgress({ done, total: jobs.length + done });
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, next));
      b = (await api.post(`/sd-document-batches/${b.batch_id}/complete`, { notFound })).data.data;
      setBatch(b);
      setNotice(`${b.batch_no}: ${b.success_rows} of ${b.total_rows} document${b.total_rows === 1 ? '' : 's'} uploaded${b.failed_rows ? `, ${b.failed_rows} failed (see the reasons below)` : ''}.`);
      setTemplate(null);
      setChosen([]);
      [templateInput, folderInput, filesInput].forEach((i) => { if (i.current) i.current.value = ''; });
      setPage(1);
      loadHistory();
      loadDeletable();
    } catch (err) {
      setError(errorMessage(err, 'The upload could not be started.'));
    } finally {
      setProgress(null);
    }
  };

  const openBatch = async (id) => {
    try {
      setBatch((await api.get(`/sd-document-batches/${id}`)).data.data);
      setRowFilter('All');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(errorMessage(err, 'Could not open the batch.'));
    }
  };

  const criteria = () => (del.mode === 'batch' ? { batchId: del.batchId } : { date: del.date });
  const preview = async () => {
    setError('');
    try {
      const p = (await api.post('/sd-document-batches/bulk-delete/preview', criteria())).data.data;
      setDel((d) => ({ ...d, preview: p }));
    } catch (err) {
      setError(errorMessage(err, 'Nothing to delete.'));
      setDel((d) => ({ ...d, preview: null }));
    }
  };
  const bulkDelete = async (e) => {
    e.preventDefault();
    if (!del.reason.trim()) { setError('Enter the reason for the bulk delete.'); return; }
    setDel((d) => ({ ...d, busy: true }));
    try {
      const res = await api.post('/sd-document-batches/bulk-delete', { ...criteria(), reason: del.reason });
      setNotice(res.data.message);
      setError('');
      setDel({ mode: del.mode, batchId: '', date: '', reason: '', preview: null, busy: false });
      loadHistory();
      loadDeletable();
      if (batch) openBatch(batch.batch_id);
    } catch (err) {
      setError(errorMessage(err, 'Bulk delete failed.'));
      setDel((d) => ({ ...d, busy: false }));
    }
  };

  const shownRows = batch ? batch.rows.filter((r) => rowFilter === 'All' || r.status === rowFilter) : [];
  const count = (s) => (batch ? batch.rows.filter((r) => r.status === s).length : 0);
  const busy = Boolean(progress);

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <h1>SD Document Upload</h1>
          <button type="button" className="btn btn-secondary" onClick={() => downloadFile('/sd-document-batches/template', {}, 'SD_Document_Upload_Template.xlsx').catch(() => setError('Template download failed.'))}>
            Download Template
          </button>
        </div>
        <p className="hint">
          Bulk upload of PDF / Word documents (.pdf, .doc, .docx, up to {settings.maxMb} MB each) to SD records. Fill the template with
          S.No, SD Code / SD ID, Document Type and File Path. To delete one document, use SD Master &gt; Documents.
        </p>
        {error && <div className="doc-message error" role="alert">{error}</div>}
        {notice && <div className="doc-message success" role="status">{notice}</div>}

        {canUpload && (
          <section className="card bulk-doc-card">
            <h3>Bulk upload</h3>
            <div className="bulk-doc-steps">
              <div>
                <label htmlFor="docTemplate">1. Filled template (.xlsx)</label>
                <input ref={templateInput} id="docTemplate" type="file" accept=".xlsx" disabled={busy} onChange={(e) => setTemplate(e.target.files[0] || null)} />
              </div>
              <div>
                <label htmlFor="docFolder">2. The documents: choose their folder, or the files</label>
                <div className="bulk-doc-pick">
                  <input ref={folderInput} id="docFolder" type="file" webkitdirectory="" directory="" multiple disabled={busy} onChange={(e) => pickDocs(e.target.files)} />
                  <span>or</span>
                  <input ref={filesInput} type="file" multiple accept={DOC_ACCEPT} disabled={busy} aria-label="Choose document files" onChange={(e) => pickDocs(e.target.files)} />
                </div>
                <small className="hint">{chosen.length ? `${chosen.length} PDF / Word file${chosen.length === 1 ? '' : 's'} chosen. ` : ''}Each File Path in the template is matched to these files by file name.</small>
                {settings.serverFolders.length > 0 && (
                  <small className="hint">Files under {settings.serverFolders.join(', ')} are read by the server directly; no need to choose them.</small>
                )}
              </div>
            </div>
            <div className="bulk-doc-go">
              <button type="button" className="btn btn-primary" disabled={busy || !template} onClick={start}>{busy ? 'Uploading...' : 'Upload & Process'}</button>
              {progress && (
                <div className="bulk-doc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                  <div style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 5}%` }} />
                  <span>{progress.total ? `Uploading ${progress.done} of ${progress.total}` : 'Reading the template...'}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {batch && (
          <section className="card bulk-doc-card">
            <div className="bulk-doc-result-head">
              <h3>{batch.batch_no} <small>{batch.template_name} · {batch.uploaded_by} · {formatDateTime(batch.uploaded_date)}</small></h3>
              <StatusBadge status={batch.status} />
            </div>
            <div className="bulk-doc-filters" role="tablist">
              {['All', 'Success', 'Failed', 'Pending', 'Deleted'].filter((s) => s === 'All' || count(s)).map((s) => (
                <button key={s} type="button" role="tab" aria-selected={rowFilter === s} className={`chip${rowFilter === s ? ' active' : ''}`} onClick={() => setRowFilter(s)}>
                  {s} ({s === 'All' ? batch.rows.length : count(s)})
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>S.No</th><th>SD Code / SD ID</th><th>Document Type</th><th>File Path</th><th>Status</th><th>Details</th></tr></thead>
                <tbody>
                  {shownRows.map((r) => (
                    <tr key={r.row_no}>
                      <td>{r.s_no || r.row_no - 1}</td>
                      <td>{r.sd_code || r.sd_ref || '—'}</td>
                      <td>{r.document_type || '—'}</td>
                      <td className="bulk-doc-path" title={r.file_path}>{r.file_path || '—'}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="bulk-doc-msg">{r.message || (r.status === 'Pending' ? 'Waiting...' : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="card bulk-doc-card bulk-doc-delete">
            <h3>Bulk delete <small>administrators only - removes the documents of a wrong upload so it can be uploaded again</small></h3>
            <div className="bulk-doc-steps">
              <div>
                <label htmlFor="delMode">Delete by</label>
                <select id="delMode" value={del.mode} onChange={(e) => setDel({ ...del, mode: e.target.value, preview: null })}>
                  <option value="batch">Upload Batch Number</option>
                  <option value="date">Upload Date</option>
                </select>
              </div>
              {del.mode === 'batch' ? (
                <div>
                  <label htmlFor="delBatch">Upload Batch Number</label>
                  <SearchSelect id="delBatch" placeholder="Select or type to search a batch" value={del.batchId}
                    options={deletable.map((b) => ({ value: b.batch_id, label: `${b.batch_no} · ${formatDateTime(b.uploaded_date)} · ${b.uploaded_by} · ${b.active_documents} document(s)` }))}
                    onChange={(v) => setDel({ ...del, batchId: v, preview: null })} />
                </div>
              ) : (
                <div>
                  <label htmlFor="delDate">Upload Date</label>
                  <input id="delDate" type="date" value={del.date} onChange={(e) => setDel({ ...del, date: e.target.value, preview: null })} />
                </div>
              )}
              <div className="bulk-doc-go">
                <button type="button" className="btn btn-secondary" disabled={del.mode === 'batch' ? !del.batchId : !del.date} onClick={preview}>Check</button>
              </div>
            </div>
            {del.preview && (
              <form className="bulk-doc-confirm" onSubmit={bulkDelete}>
                <p>
                  <strong>{del.preview.documents}</strong> document{del.preview.documents === 1 ? '' : 's'} from{' '}
                  {del.preview.batches.map((b) => b.batch_no).join(', ')} will be deleted (kept, with the reason, for the audit trail).
                </p>
                {del.preview.skipped.length > 0 && (
                  <ul className="bulk-doc-skipped">{del.preview.skipped.map((s) => <li key={s.group_id}>Skipped: {s.reason}</li>)}</ul>
                )}
                <label htmlFor="delReason">Reason <span className="req" aria-hidden="true">*</span></label>
                <div className="bulk-doc-pick">
                  <input id="delReason" type="text" maxLength={400} value={del.reason} placeholder="e.g. Wrong files uploaded; will upload again" onChange={(e) => setDel({ ...del, reason: e.target.value })} />
                  <button type="submit" className="btn btn-danger" disabled={del.busy || del.preview.documents === 0}>{del.busy ? 'Deleting...' : 'Delete documents'}</button>
                </div>
              </form>
            )}
          </section>
        )}

        <section className="card bulk-doc-card">
          <h3>Upload history</h3>
          {history.rows.length === 0 ? <p className="empty-state">No bulk uploads yet.</p> : (
            <>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th>Batch No.</th><th>Uploaded</th><th>By</th><th>Template</th><th className="num">Rows</th><th className="num">Success</th><th className="num">Failed</th><th className="num">Documents now</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.rows.map((b) => (
                      <tr key={b.batch_id}>
                        <td><button type="button" className="link-button" onClick={() => openBatch(b.batch_id)}>{b.batch_no}</button></td>
                        <td>{formatDateTime(b.uploaded_date)}</td>
                        <td>{b.uploaded_by}</td>
                        <td className="bulk-doc-path" title={b.template_name}>{b.template_name}</td>
                        <td className="num">{b.total_rows}</td>
                        <td className="num">{b.success_rows}</td>
                        <td className="num">{b.failed_rows}</td>
                        <td className="num">{b.active_documents}</td>
                        <td><StatusBadge status={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={20} total={history.total} onChange={setPage} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
