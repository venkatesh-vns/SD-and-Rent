// SD Document Upload: bulk upload of SD Master documents from a template.
//
//  1. The template (S.No, SD Code / SD ID, Document Type, File Path) is read and
//     every row checked; the batch (DOCB000001...) and its rows are saved, rows
//     with problems as Failed.
//  2. Each valid row's file is then uploaded against its SD record:
//     - normally the browser sends it: the user picks the documents' folder (or the
//       files) with the template and each File Path is matched to a picked file;
//     - a File Path inside a shared folder the server may read (DOCUMENT_IMPORT_ROOTS,
//       e.g. \\fileserver\SD Documents) is read by the server itself.
//     Every document goes through the same checks as a single upload (PDF / Word by
//     content, size, no duplicates).
//  3. The batch is completed: rows whose file was not found are Failed.
//  Administrators can bulk delete a batch, or every batch of an upload date.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logAudit } = require('../utils/audit');
const { readSheet } = require('../utils/excel');
const docs = require('./sdDocumentService');

const HEADERS = ['S.No', 'SD Code / SD ID', 'Document Type', 'File Path'];
const MAX_ROWS = 2000;
const STALE_HOURS = 2;

const text = (v) => String(v ?? '').trim();
const fileNameOf = (p) => text(p).split(/[\\/]/).pop();
const importRoots = () => String(process.env.DOCUMENT_IMPORT_ROOTS || '').split(';').map((r) => r.trim()).filter(Boolean);

// Template with a Document Type drop-down and an instructions sheet
async function template() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SD Documents', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(HEADERS).font = { bold: true };
  ws.columns = [{ width: 8 }, { width: 18 }, { width: 24 }, { width: 70 }];
  ws.dataValidations.add(`C2:C${MAX_ROWS + 1}`, {
    type: 'list', allowBlank: false, showErrorMessage: true, errorTitle: 'Document Type', error: 'Choose a Document Type from the list.',
    formulae: [`"${docs.DOCUMENT_TYPES.join(',')}"`],
  });
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 22 }, { width: 100 }];
  [
    ['Column', 'What to enter'],
    ['S.No', 'Serial number of the row (any number; shown in the upload result).'],
    ['SD Code / SD ID', 'The SD Code (e.g. SD000017) or the SD ID of the SD record.'],
    ['Document Type', docs.DOCUMENT_TYPES.join(', ')],
    ['File Path', 'Full path of the PDF / Word file, e.g. D:\\SD Documents\\SD000017\\Lease Agreement.pdf'],
    [],
    ['How to upload', '1. Fill one row per document (only .pdf, .doc, .docx; up to the size limit shown on the screen).'],
    ['', '2. In SD Document Upload choose this template AND the folder that holds the documents (or the files themselves).'],
    ['', '3. Each File Path is matched to the chosen files by its file name (and folders when two files share a name).'],
    ['', 'Files in a shared folder that the server is set up to read are picked up from the File Path directly.'],
    ['', '4. Each row shows Success or Failed with the reason. Documents appear in SD Master > Documents.'],
  ].forEach((r, i) => { const row = help.addRow(r); if (i === 0) row.font = { bold: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// SD records by SD Code or SD ID
async function findSds(refs) {
  const codes = [...new Set(refs.map((r) => r.toUpperCase()).filter((r) => /^SD\d+$/.test(r)))];
  const ids = [...new Set(refs.filter((r) => /^\d+$/.test(r)).map(Number))];
  const rows = (await pool.query(
    'SELECT sd_id, sd_code FROM sd_master WHERE UPPER(sd_code) = ANY($1) OR sd_id = ANY($2::int[])', [codes, ids]
  )).rows;
  const map = new Map();
  rows.forEach((r) => { map.set(r.sd_code.toUpperCase(), r); map.set(String(r.sd_id), r); });
  return map;
}

// Reads and checks the template, saves the batch and its rows
async function createBatch({ templatePath, templateName, by }) {
  let sheet;
  try {
    sheet = await readSheet(templatePath);
  } finally {
    fs.rmSync(templatePath, { force: true });
  }
  const { headers } = sheet;
  const missing = HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) throw httpError(400, `The file is missing column(s): ${missing.join(', ')}. Download the template and try again.`);
  const rows = sheet.rows.filter(({ values }) => HEADERS.some((h) => text(values[h])));
  if (!rows.length) throw httpError(400, 'The template has no rows.');
  if (rows.length > MAX_ROWS) throw httpError(400, `A batch can have up to ${MAX_ROWS} rows; split the file.`);

  const sds = await findSds(rows.map(({ values }) => text(values['SD Code / SD ID'])));
  const types = new Map(docs.DOCUMENT_TYPES.map((t) => [t.toLowerCase(), t]));
  const seen = new Map();
  const checked = rows.map(({ rowNumber, values }) => {
    const ref = text(values['SD Code / SD ID']);
    const filePath = text(values['File Path']);
    const type = types.get(text(values['Document Type']).toLowerCase());
    const sd = sds.get(ref.toUpperCase());
    const r = { rowNo: rowNumber, sNo: text(values['S.No']).slice(0, 20), sdRef: ref.slice(0, 50), sd, type: type || text(values['Document Type']).slice(0, 40), filePath: filePath.slice(0, 1000) };
    const problems = [];
    if (!ref) problems.push('SD Code / SD ID is required.');
    else if (!sd) problems.push(`SD Code / SD ID "${ref}" was not found in SD Master.`);
    if (!type) problems.push(`Document Type must be one of: ${docs.DOCUMENT_TYPES.join(', ')}.`);
    if (!filePath) problems.push('File Path is required.');
    else if (!/\.(pdf|docx?)$/i.test(filePath)) problems.push('Only PDF (.pdf) and Word (.doc, .docx) documents can be uploaded.');
    const key = sd && `${sd.sd_id}|${filePath.toLowerCase()}`;
    if (key && seen.has(key)) problems.push(`Same SD Code and File Path as row ${seen.get(key)}.`);
    else if (key) seen.set(key, rowNumber);
    return { ...r, problem: problems.join(' ') };
  });

  const batch = await withTransaction(async (db) => {
    const b = (await db.query(
      'INSERT INTO sd_document_batches (template_name, total_rows, uploaded_by) VALUES ($1, $2, $3) RETURNING *',
      [docs.cleanName(templateName), checked.length, by]
    )).rows[0];
    for (const r of checked) {
      await db.query(
        `INSERT INTO sd_document_batch_rows (batch_id, row_no, s_no, sd_ref, sd_id, sd_code, document_type, file_path, status, message, processed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [b.batch_id, r.rowNo, r.sNo, r.sdRef, r.sd?.sd_id || null, r.sd?.sd_code || null, r.type, r.filePath,
          r.problem ? 'Failed' : 'Pending', r.problem || null, r.problem ? new Date() : null]
      );
    }
    return b;
  });

  // Files in an allowed shared folder are read by the server now
  for (const r of checked.filter((x) => !x.problem)) {
    const file = serverFile(r.filePath);
    if (file) await processRow({ batchId: batch.batch_id, rowNo: r.rowNo, file, by });
  }
  return getBatch(batch.batch_id);
}

// A File Path inside DOCUMENT_IMPORT_ROOTS that exists: { originalname, buffer, size }
function serverFile(filePath) {
  const roots = importRoots();
  if (!roots.length || !path.isAbsolute(filePath)) return null;
  const full = path.resolve(filePath);
  const inside = roots.some((root) => {
    const r = path.resolve(root);
    return full.toLowerCase().startsWith((r.endsWith(path.sep) ? r : r + path.sep).toLowerCase());
  });
  if (!inside) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) return null;
    if (st.size > docs.maxMb() * 1024 * 1024) return { originalname: path.basename(full), buffer: Buffer.alloc(0), size: st.size };
    const buffer = fs.readFileSync(full);
    return { originalname: path.basename(full), buffer, size: buffer.length };
  } catch {
    return null;
  }
}

async function batchFor(batchId, db = pool) {
  const b = (await db.query('SELECT * FROM sd_document_batches WHERE batch_id = $1', [batchId])).rows[0];
  if (!b) throw httpError(404, 'Upload batch not found.');
  return b;
}

// Uploads one row's file against its SD record; the row becomes Success or Failed
async function processRow({ batchId, rowNo, file, by }) {
  const b = await batchFor(batchId);
  if (b.status !== 'In Progress') throw httpError(409, `Batch ${b.batch_no} is already ${b.status.toLowerCase()}.`);
  const row = (await pool.query('SELECT * FROM sd_document_batch_rows WHERE batch_id = $1 AND row_no = $2', [batchId, rowNo])).rows[0];
  if (!row) throw httpError(404, 'Row not found in this batch.');
  if (row.status !== 'Pending') return row;
  let status = 'Success';
  let message = null;
  let documentId = null;
  try {
    if (file.size > docs.maxMb() * 1024 * 1024) throw httpError(400, `The file is too large. The limit is ${docs.maxMb()} MB.`);
    const doc = await docs.upload({
      sdId: row.sd_id, documentType: row.document_type, title: null,
      remarks: `Bulk upload ${b.batch_no}${row.s_no ? `, S.No ${row.s_no}` : ''}`, file, by, batchId,
    });
    documentId = doc.document_id;
    message = `Uploaded as "${doc.title}"`;
  } catch (err) {
    if (!err.status || err.status >= 500) throw err;
    status = 'Failed';
    message = err.message.slice(0, 500);
  }
  return (await pool.query(
    `UPDATE sd_document_batch_rows SET status = $3, message = $4, document_id = $5, processed_date = NOW()
     WHERE batch_id = $1 AND row_no = $2 RETURNING *`,
    [batchId, rowNo, status, message, documentId]
  )).rows[0];
}

// Ends the batch: rows still Pending fail with the reason given (file not chosen) or as interrupted
async function complete({ batchId, notFound = [], by }) {
  return withTransaction(async (db) => {
    const b = (await db.query('SELECT * FROM sd_document_batches WHERE batch_id = $1 FOR UPDATE', [batchId])).rows[0];
    if (!b) throw httpError(404, 'Upload batch not found.');
    if (b.status !== 'In Progress') return b;
    for (const n of notFound) {
      await db.query(
        `UPDATE sd_document_batch_rows SET status = 'Failed', message = $3, processed_date = NOW()
         WHERE batch_id = $1 AND row_no = $2 AND status = 'Pending'`,
        [batchId, Number(n.rowNo), String(n.message || 'The file was not found among the chosen files.').slice(0, 500)]
      );
    }
    await db.query(
      `UPDATE sd_document_batch_rows SET status = 'Failed', message = 'Not uploaded: the upload was stopped before this file was sent.', processed_date = NOW()
       WHERE batch_id = $1 AND status = 'Pending'`, [batchId]
    );
    const done = (await db.query(
      `UPDATE sd_document_batches b SET status = 'Completed', completed_date = NOW(),
              success_rows = (SELECT COUNT(*) FROM sd_document_batch_rows r WHERE r.batch_id = b.batch_id AND r.status = 'Success'),
              failed_rows  = (SELECT COUNT(*) FROM sd_document_batch_rows r WHERE r.batch_id = b.batch_id AND r.status = 'Failed')
       WHERE batch_id = $1 RETURNING *`, [batchId]
    )).rows[0];
    await logAudit({ tableName: 'sd_document_batches', recordId: batchId, action: 'DOC_BULK_UPLOAD', actionBy: by,
      details: `${done.batch_no} (${done.template_name}): ${done.total_rows} rows, ${done.success_rows} uploaded, ${done.failed_rows} failed` }, db);
    return done;
  });
}

// Batches left In Progress (browser closed) are completed after a while
async function closeStale() {
  const stale = (await pool.query(
    `SELECT batch_id, uploaded_by FROM sd_document_batches WHERE status = 'In Progress' AND uploaded_date < NOW() - make_interval(hours => $1)`, [STALE_HOURS]
  )).rows;
  for (const s of stale) await complete({ batchId: s.batch_id, by: s.uploaded_by });
}

async function list({ page = 1, pageSize = 20, date = null } = {}) {
  await closeStale();
  const where = date ? 'WHERE uploaded_date::date = $1::date' : '';
  const params = date ? [date] : [];
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM sd_document_batches ${where}`, params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT b.*, (SELECT COUNT(*)::int FROM sd_document_master d WHERE d.batch_id = b.batch_id AND d.status = 'Active') AS active_documents
     FROM sd_document_batches b ${where} ORDER BY b.batch_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (Math.max(page, 1) - 1) * pageSize]
  )).rows;
  return { rows, total };
}

async function getBatch(batchId) {
  const batch = await batchFor(batchId);
  const rows = (await pool.query(
    `SELECT r.*, d.title AS document_title FROM sd_document_batch_rows r
     LEFT JOIN sd_document_master d ON d.document_id = r.document_id
     WHERE r.batch_id = $1 ORDER BY r.row_no`, [batchId]
  )).rows;
  return { ...batch, rows };
}

// Documents a bulk delete would remove: those first uploaded by the chosen batches.
// A document that has since had a new version uploaded outside the batch is
// skipped (it must be deleted from SD Master > Documents).
async function deletePlan({ batchId, date }, db = pool) {
  if (!batchId && !date) throw httpError(400, 'Choose an Upload Batch Number or an Upload Date.');
  const batches = (await db.query(
    `SELECT * FROM sd_document_batches WHERE status <> 'Deleted' AND ${batchId ? 'batch_id = $1' : 'uploaded_date::date = $1::date'} ORDER BY batch_id`,
    [batchId || date]
  )).rows;
  if (!batches.length) throw httpError(404, batchId ? 'That batch was not found or is already deleted.' : 'No upload batches on that date (or they are already deleted).');
  const ids = batches.map((b) => b.batch_id);
  const groups = (await db.query(
    `SELECT d.group_id, d.batch_id, s.sd_code, d.title,
            (SELECT COUNT(*)::int FROM sd_document_master v WHERE v.group_id = d.group_id AND v.batch_id IS DISTINCT FROM d.batch_id) AS later_versions
     FROM sd_document_master d JOIN sd_master s ON s.sd_id = d.sd_id
     WHERE d.batch_id = ANY($1::int[]) AND d.version_no = 1 AND d.status = 'Active'
     ORDER BY d.group_id`, [ids]
  )).rows;
  return {
    batches,
    deletable: groups.filter((g) => !g.later_versions),
    skipped: groups.filter((g) => g.later_versions).map((g) => ({ ...g, reason: `${g.sd_code} "${g.title}" has ${g.later_versions} later version(s) uploaded outside the batch; delete it in SD Master > Documents.` })),
  };
}

async function previewDelete(criteria) {
  const p = await deletePlan(criteria);
  return {
    batches: p.batches.map((b) => ({ batch_id: b.batch_id, batch_no: b.batch_no, uploaded_by: b.uploaded_by, uploaded_date: b.uploaded_date, template_name: b.template_name })),
    documents: p.deletable.length, skipped: p.skipped,
  };
}

async function bulkDelete({ batchId, date, reason, by }) {
  const why = text(reason).slice(0, 400);
  if (!why) throw httpError(400, 'Enter the reason for the bulk delete.');
  return withTransaction(async (db) => {
    const p = await deletePlan({ batchId, date }, db);
    const out = [];
    for (const b of p.batches) {
      const groups = p.deletable.filter((g) => g.batch_id === b.batch_id).map((g) => g.group_id);
      const note = `Bulk delete of ${b.batch_no}: ${why}`;
      if (groups.length) {
        await db.query(
          `UPDATE sd_document_master SET status = 'Deleted', deleted_by = $2, deleted_date = NOW(), delete_reason = $3
           WHERE group_id = ANY($1::int[]) AND status = 'Active'`, [groups, by, note]
        );
        await db.query(
          `UPDATE sd_document_batch_rows r SET status = 'Deleted', message = $2
           FROM sd_document_master d WHERE d.document_id = r.document_id AND r.batch_id = $1 AND d.group_id = ANY($3::int[])`,
          [b.batch_id, note.slice(0, 500), groups]
        );
      }
      const skipped = p.skipped.filter((g) => g.batch_id === b.batch_id).length;
      if (!skipped) {
        await db.query(
          `UPDATE sd_document_batches SET status = 'Deleted', deleted_by = $2, deleted_date = NOW(), delete_reason = $3 WHERE batch_id = $1`,
          [b.batch_id, by, why]
        );
      }
      await logAudit({ tableName: 'sd_document_batches', recordId: b.batch_id, action: 'DOC_BULK_DELETE', actionBy: by,
        details: `${b.batch_no}: ${groups.length} document(s) deleted${skipped ? `, ${skipped} skipped (later versions)` : ''} - ${why}` }, db);
      out.push({ batch_no: b.batch_no, deleted: groups.length, skipped });
    }
    return { batches: out, deleted: p.deletable.length, skipped: p.skipped };
  });
}

module.exports = { HEADERS, template, createBatch, processRow, complete, list, getBatch, previewDelete, bulkDelete, importRoots, fileNameOf };
