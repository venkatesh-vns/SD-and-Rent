// SD Document Master: PDF / Word documents attached to an SD Code.
//  - Only .pdf, .doc and .docx are accepted, checked by extension AND by the
//    file's content (a renamed .exe or .xlsx is refused), up to DOCUMENT_MAX_MB.
//  - Files are kept on disk under DOCUMENT_DIR/<SD Code>/ with a generated name;
//    the database row holds the details (name, type, size, SHA-256, who / when).
//  - A new version keeps the earlier ones; Delete marks every version Deleted
//    and keeps the files, so the history stays complete.
//  - "View" uses a short-lived signed link, so a PDF opens in a new browser tab
//    (which cannot send the login token) without exposing a permanent URL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const { httpError } = require('../utils/httpError');
const { logAudit } = require('../utils/audit');

const DOCUMENT_TYPES = ['LOI', 'Agreement', 'Registered Agreement', 'Addendum Agreement', 'Mail Approval', 'Payment Proof', 'Correspondence', 'Other'];
const KINDS = {
  pdf: { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // a ZIP package holding a word/ part
    test: (b) => b.readUInt32LE(0) === 0x04034b50 && b.includes('word/'),
  },
  doc: { mime: 'application/msword', test: (b) => b.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) },
};
const VIEW_LINK_SECONDS = 120;

const documentDir = () => process.env.DOCUMENT_DIR || path.join(__dirname, '..', 'documents');
const maxMb = () => Number(process.env.DOCUMENT_MAX_MB) || 20;
const fullPath = (stored) => {
  const root = path.resolve(documentDir());
  const file = path.resolve(root, stored);
  if (!file.startsWith(root + path.sep)) throw httpError(400, 'Invalid document path.');
  return file;
};

// Checks the uploaded file; returns { ext, mime, sha256 }
function checkFile(file) {
  if (!file || !file.buffer || !file.size) throw httpError(400, 'Choose a PDF or Word file to upload.');
  const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
  const kind = KINDS[ext];
  if (!kind) throw httpError(400, 'Only PDF (.pdf) and Word (.doc, .docx) documents can be attached.');
  if (file.size > maxMb() * 1024 * 1024) throw httpError(400, `The file is too large. The limit is ${maxMb()} MB.`);
  if (!kind.test(file.buffer)) throw httpError(400, `${file.originalname} is not a valid ${ext.toUpperCase()} file (its content does not match the extension).`);
  return { ext, mime: kind.mime, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}

const cleanName = (name) => path.basename(String(name || 'document')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').slice(0, 200) || 'document';
const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

const SELECT = `
  SELECT d.document_id, d.sd_id, s.sd_code, d.group_id, d.version_no, d.is_latest, d.document_type, d.title, d.remarks,
         d.file_name, d.file_ext, d.mime_type, d.size_bytes, d.sha256, d.status, d.uploaded_by, d.uploaded_date,
         d.deleted_by, d.deleted_date, d.delete_reason
  FROM sd_document_master d JOIN sd_master s ON s.sd_id = d.sd_id`;

// Latest version of each Active document of an SD Code, with its version count
async function list(sdId) {
  return (await pool.query(
    `${SELECT.replace('d.delete_reason', `d.delete_reason,
       (SELECT COUNT(*)::int FROM sd_document_master v WHERE v.group_id = d.group_id) AS versions,
       (SELECT MIN(v.uploaded_date) FROM sd_document_master v WHERE v.group_id = d.group_id) AS first_uploaded_date`)}
     WHERE d.sd_id = $1 AND d.is_latest AND d.status = 'Active'
     ORDER BY d.uploaded_date DESC, d.document_id DESC`,
    [sdId]
  )).rows;
}

async function findById(documentId, db = pool) {
  return (await db.query(`${SELECT} WHERE d.document_id = $1`, [documentId])).rows[0];
}

async function storedPath(documentId) {
  return (await pool.query('SELECT stored_path FROM sd_document_master WHERE document_id = $1', [documentId])).rows[0]?.stored_path;
}

// Every version of a document, newest first
async function versions(documentId) {
  const doc = await findById(documentId);
  if (!doc) throw httpError(404, 'Document not found.');
  return (await pool.query(`${SELECT} WHERE d.group_id = $1 ORDER BY d.version_no DESC`, [doc.group_id])).rows;
}

// Writes the file and its row in one go; the file is removed again if the row is not saved
async function store(db, { sdId, sdCode, groupId, versionNo, documentType, title, remarks, file, info, by }) {
  const row = (await db.query(
    `INSERT INTO sd_document_master (sd_id, group_id, version_no, document_type, title, remarks, file_name, file_ext,
                                     mime_type, size_bytes, sha256, stored_path, uploaded_by)
     VALUES ($1, COALESCE($2, 0), $3, $4, $5, $6, $7, $8, $9, $10, $11, '', $12) RETURNING document_id`,
    [sdId, groupId, versionNo, documentType, title, remarks, cleanName(file.originalname), info.ext, info.mime, file.size, info.sha256, by]
  )).rows[0];
  const group = groupId || row.document_id;
  const rel = path.join(sdCode, `${group}-v${versionNo}-${crypto.randomBytes(6).toString('hex')}.${info.ext}`);
  const target = fullPath(rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.part`, file.buffer);
  fs.renameSync(`${target}.part`, target);
  await db.query('UPDATE sd_document_master SET group_id = $2, stored_path = $3 WHERE document_id = $1', [row.document_id, group, rel]);
  return { documentId: row.document_id, target };
}

async function saveWithFile(work) {
  let written = null;
  try {
    return await withTransaction(async (db) => {
      const out = await work(db, (t) => { written = t; });
      return out;
    });
  } catch (err) {
    if (written) fs.rmSync(written, { force: true });
    throw err;
  }
}

async function refuseDuplicate(db, sdId, sha256) {
  const dup = (await db.query(
    `SELECT title, version_no FROM sd_document_master WHERE sd_id = $1 AND sha256 = $2 AND status = 'Active' LIMIT 1`, [sdId, sha256]
  )).rows[0];
  if (dup) throw httpError(409, `This file is already attached to this SD Code as "${dup.title}" (version ${dup.version_no}).`);
}

// New document (version 1)
async function upload({ sdId, documentType, title, remarks, file, by }) {
  const info = checkFile(file);
  if (!DOCUMENT_TYPES.includes(documentType)) throw httpError(400, `Document Type must be one of: ${DOCUMENT_TYPES.join(', ')}.`);
  const docTitle = text(title, 200) || cleanName(file.originalname).replace(/\.[^.]+$/, '');
  const id = await saveWithFile(async (db, wrote) => {
    const sd = (await db.query('SELECT sd_id, sd_code FROM sd_master WHERE sd_id = $1 FOR SHARE', [sdId])).rows[0];
    if (!sd) throw httpError(404, 'SD record not found.');
    await refuseDuplicate(db, sd.sd_id, info.sha256);
    const { documentId, target } = await store(db, {
      sdId: sd.sd_id, sdCode: sd.sd_code, groupId: null, versionNo: 1, documentType, title: docTitle, remarks: text(remarks, 500), file, info, by,
    });
    wrote(target);
    await logAudit({ tableName: 'sd_document_master', recordId: documentId, action: 'DOC_UPLOAD', actionBy: by,
      details: `${sd.sd_code}: ${documentType} "${docTitle}" v1 - ${cleanName(file.originalname)} (${file.size} bytes)` }, db);
    return documentId;
  });
  return findById(id);
}

// New version of an existing document; the earlier versions are kept
async function addVersion({ documentId, remarks, file, by }) {
  const info = checkFile(file);
  const id = await saveWithFile(async (db, wrote) => {
    const doc = (await db.query(
      `SELECT d.*, s.sd_code FROM sd_document_master d JOIN sd_master s ON s.sd_id = d.sd_id
       WHERE d.group_id = (SELECT group_id FROM sd_document_master WHERE document_id = $1) AND d.is_latest FOR UPDATE OF d`, [documentId]
    )).rows[0];
    if (!doc) throw httpError(404, 'Document not found.');
    if (doc.status !== 'Active') throw httpError(409, 'This document has been deleted.');
    await refuseDuplicate(db, doc.sd_id, info.sha256);
    await db.query('UPDATE sd_document_master SET is_latest = FALSE WHERE group_id = $1 AND is_latest', [doc.group_id]);
    const { documentId: newId, target } = await store(db, {
      sdId: doc.sd_id, sdCode: doc.sd_code, groupId: doc.group_id, versionNo: doc.version_no + 1,
      documentType: doc.document_type, title: doc.title, remarks: text(remarks, 500), file, info, by,
    });
    wrote(target);
    await logAudit({ tableName: 'sd_document_master', recordId: newId, action: 'DOC_VERSION', actionBy: by,
      details: `${doc.sd_code}: ${doc.document_type} "${doc.title}" v${doc.version_no + 1} (replaces v${doc.version_no}) - ${cleanName(file.originalname)}` }, db);
    return newId;
  });
  return findById(id);
}

// Marks every version of the document Deleted (files kept for the audit trail)
async function remove({ documentId, reason, by }) {
  const why = text(reason, 500);
  if (!why) throw httpError(400, 'Enter the reason for deleting this document.');
  return withTransaction(async (db) => {
    const doc = (await db.query(
      `SELECT d.*, s.sd_code FROM sd_document_master d JOIN sd_master s ON s.sd_id = d.sd_id
       WHERE d.group_id = (SELECT group_id FROM sd_document_master WHERE document_id = $1) AND d.is_latest FOR UPDATE OF d`, [documentId]
    )).rows[0];
    if (!doc) throw httpError(404, 'Document not found.');
    if (doc.status !== 'Active') throw httpError(409, 'This document is already deleted.');
    await db.query(
      `UPDATE sd_document_master SET status = 'Deleted', deleted_by = $2, deleted_date = NOW(), delete_reason = $3 WHERE group_id = $1`,
      [doc.group_id, by, why]
    );
    await logAudit({ tableName: 'sd_document_master', recordId: doc.document_id, action: 'DOC_DELETE', actionBy: by,
      details: `${doc.sd_code}: ${doc.document_type} "${doc.title}" (${doc.version_no} version${doc.version_no === 1 ? '' : 's'}) - ${why}` }, db);
    return doc;
  });
}

// File for viewing / download; records who opened it
async function open({ documentId, by, action }) {
  const doc = await findById(documentId);
  if (!doc) throw httpError(404, 'Document not found.');
  if (doc.status !== 'Active') throw httpError(410, 'This document has been deleted.');
  const file = fullPath(await storedPath(documentId));
  if (!fs.existsSync(file)) throw httpError(404, 'The file of this document is missing from the document store. Contact the administrator.');
  await logAudit({ tableName: 'sd_document_master', recordId: doc.document_id, action, actionBy: by,
    details: `${doc.sd_code}: ${doc.document_type} "${doc.title}" v${doc.version_no}` });
  return { doc, file };
}

const downloadName = (doc) => {
  const base = doc.file_name.replace(/\.[^.]+$/, '');
  return `${base}${doc.version_no > 1 ? ` (v${doc.version_no})` : ''}.${doc.file_ext}`;
};

// Short-lived signed link for opening a document in a new tab
const secret = () => process.env.JWT_SECRET;
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
function viewToken({ documentId, userId, sessionId }) {
  const payload = Buffer.from(JSON.stringify({ d: Number(documentId), u: userId, s: sessionId, e: Math.floor(Date.now() / 1000) + VIEW_LINK_SECONDS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readViewToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.e >= Math.floor(Date.now() / 1000) ? data : null;
}

module.exports = {
  DOCUMENT_TYPES, maxMb, documentDir, list, versions, upload, addVersion, remove, open, downloadName, viewToken, readViewToken,
};
