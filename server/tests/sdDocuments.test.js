// SD Master documents: PDF / Word only (checked by content), versions, view link,
// download, delete with reason, audit trail and rights
const fs = require('fs');
const os = require('os');
const path = require('path');

const docDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-docs-test-'));
process.env.DOCUMENT_DIR = docDir;
process.env.DOCUMENT_MAX_MB = '1';
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-docs-backup-'));
process.env.BACKUP_DIR = backupDir;

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createMasters, sdBody } = require('./helpers');

const PDF = (n) => Buffer.from(`%PDF-1.4\n% test document ${n}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....[Content_Types].xml....word/document.xml....')]);
const DOC = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from('legacy word')]);

describe('SD Master documents', () => {
  let ctx;
  let sd;
  let first;
  const send = (url, file, name, fields = {}, token) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    if (file) form.append('file', new Blob([file]), name);
    return ctx.api('POST', url, form, token);
  };
  const audits = async () => (await ctx.pool.query(`SELECT action, details FROM audit_log WHERE table_name = 'sd_document_master' ORDER BY audit_id`)).rows;

  before(async () => {
    ctx = await setup();
    const m = await createMasters(ctx);
    sd = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'DOC-1' }))).body.data;
  });
  after(async () => {
    await ctx.close();
    fs.rmSync(docDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it('uploads PDF and Word documents against an SD Code', async () => {
    const pdf = await send('/sd-documents', PDF(1), 'Lease Agreement.pdf', { sdId: sd.sd_id, documentType: 'Agreement', title: 'Lease agreement', remarks: 'Signed copy' });
    assert.equal(pdf.status, 201, pdf.body.message);
    first = pdf.body.data;
    assert.equal(first.version_no, 1);
    assert.equal(first.file_ext, 'pdf');
    assert.equal(first.uploaded_by, 'admin');
    assert.equal((await send('/sd-documents', DOCX, 'Addendum.docx', { sdId: sd.sd_id, documentType: 'Addendum Agreement' })).status, 201);
    assert.equal((await send('/sd-documents', DOC, 'Old letter.doc', { sdId: sd.sd_id, documentType: 'Correspondence' })).status, 201);

    const list = (await ctx.api('GET', `/sd-documents?sdId=${sd.sd_id}`)).body.data;
    assert.equal(list.length, 3);
    assert.equal(list.find((d) => d.file_ext === 'docx').title, 'Addendum', 'title defaults to the file name');
    const row = (await ctx.api('GET', '/sd-master?search=DOC-1')).body.data[0];
    assert.equal(row.doc_count, 3);
    // stored on disk, outside the database, under the SD Code
    assert.ok(fs.readdirSync(path.join(docDir, sd.sd_code)).length === 3);
  });

  it('refuses other file types, renamed files, oversize files and duplicates', async () => {
    const bad = async (file, name, re, status = 400) => {
      const r = await send('/sd-documents', file, name, { sdId: sd.sd_id, documentType: 'Other' });
      assert.equal(r.status, status, name);
      assert.match(r.body.message, re);
    };
    await bad(Buffer.from('a,b'), 'data.csv', /Only PDF/);
    await bad(Buffer.from('MZ fake'), 'virus.exe', /Only PDF/);
    await bad(Buffer.from('MZ not a pdf'), 'renamed.pdf', /not a valid PDF/);
    await bad(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml')]), 'sheet.docx', /not a valid DOCX/);
    await bad(Buffer.concat([PDF(9), Buffer.alloc(1100 * 1024)]), 'big.pdf', /too large\. The limit is 1 MB/);
    await bad(PDF(1), 'same again.pdf', /already attached to this SD Code as "Lease agreement" \(version 1\)/, 409);
    assert.equal((await send('/sd-documents', PDF(2), 'x.pdf', { sdId: sd.sd_id, documentType: 'Unknown' })).status, 400);
    assert.equal((await send('/sd-documents', null, null, { sdId: sd.sd_id, documentType: 'Other' })).status, 400);
  });

  it('keeps every version and shows the latest', async () => {
    const v2 = await send(`/sd-documents/${first.document_id}/versions`, PDF(2), 'Lease Agreement final.pdf', { remarks: 'Registered copy' });
    assert.equal(v2.status, 201, v2.body.message);
    assert.equal(v2.body.data.version_no, 2);
    assert.equal(v2.body.data.title, 'Lease agreement');
    const v3 = await send(`/sd-documents/${first.document_id}/versions`, PDF(3), 'Lease v3.pdf');
    assert.equal(v3.body.data.version_no, 3);

    const list = (await ctx.api('GET', `/sd-documents?sdId=${sd.sd_id}`)).body.data;
    assert.equal(list.length, 3, 'still three documents');
    const lease = list.find((d) => d.title === 'Lease agreement');
    assert.equal(lease.version_no, 3);
    assert.equal(lease.versions, 3);
    const history = (await ctx.api('GET', `/sd-documents/${lease.document_id}/versions`)).body.data;
    assert.deepEqual(history.map((h) => [h.version_no, h.is_latest]), [[3, true], [2, false], [1, false]]);
    assert.equal(history[1].remarks, 'Registered copy');
  });

  it('downloads any version and opens a PDF in a new tab through a short-lived link', async () => {
    const dl = await ctx.download(`/sd-documents/${first.document_id}/download`);
    assert.equal(dl.status, 200);
    assert.deepEqual(dl.buffer, PDF(1), 'version 1 is unchanged');
    assert.match(dl.headers.get('content-disposition'), /^attachment; filename="Lease Agreement.pdf"/);

    const link = (await ctx.api('POST', `/sd-documents/${first.document_id}/view-link`)).body.data.url;
    const view = await fetch(ctx.base.replace(/\/api$/, '') + link); // no login header, like a new tab
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'application/pdf');
    assert.match(view.headers.get('content-disposition'), /^inline/);
    assert.equal(view.headers.get('content-security-policy'), null);

    const tampered = link.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.equal((await fetch(ctx.base.replace(/\/api$/, '') + tampered)).status, 403);
  });

  it('follows SD Master rights and records everything in the audit trail', async () => {
    await ctx.api('POST', '/users', { userName: 'viewer', userEmail: 'viewer@example.test', password: 'Viewerpass123' });
    const viewer = (await ctx.pool.query(`SELECT user_id FROM users WHERE user_name = 'viewer'`)).rows[0].user_id;
    await ctx.api('PUT', `/user-rights/${viewer}`, { rights: [{ screenCode: 'SD_MASTER', canView: true }] });
    const token = await ctx.login('viewer', 'Viewerpass123');
    assert.equal((await ctx.api('GET', `/sd-documents?sdId=${sd.sd_id}`, undefined, token)).status, 200);
    assert.equal((await ctx.download(`/sd-documents/${first.document_id}/download`, token)).status, 200);
    assert.equal((await send('/sd-documents', PDF(7), 'x.pdf', { sdId: sd.sd_id, documentType: 'Other' }, token)).status, 403);
    assert.equal((await ctx.api('DELETE', `/sd-documents/${first.document_id}`, { reason: 'x' }, token)).status, 403);

    const actions = (await audits()).map((a) => a.action);
    for (const a of ['DOC_UPLOAD', 'DOC_VERSION', 'DOC_DOWNLOAD', 'DOC_VIEW']) assert.ok(actions.includes(a), a);
  });

  it('deletes with a reason, keeping versions and files, and protects the SD Code meanwhile', async () => {
    const blocked = await ctx.api('DELETE', `/sd-master/${sd.sd_id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /has 3 attached documents/);

    assert.equal((await ctx.api('DELETE', `/sd-documents/${first.document_id}`, {})).status, 400, 'reason required');
    const del = await ctx.api('DELETE', `/sd-documents/${first.document_id}`, { reason: 'Uploaded to the wrong SD Code' });
    assert.equal(del.status, 200, del.body.message);
    assert.equal((await ctx.api('GET', `/sd-documents?sdId=${sd.sd_id}`)).body.data.length, 2);
    const rows = (await ctx.pool.query(`SELECT status, deleted_by, delete_reason FROM sd_document_master WHERE group_id = $1`, [first.group_id])).rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.status === 'Deleted' && r.deleted_by === 'admin' && r.delete_reason === 'Uploaded to the wrong SD Code'));
    assert.equal((await ctx.download(`/sd-documents/${first.document_id}/download`)).status, 410);
    assert.equal(fs.readdirSync(path.join(docDir, sd.sd_code)).length, 5, 'files kept for the audit trail');
    assert.ok((await audits()).some((a) => a.action === 'DOC_DELETE' && /wrong SD Code/.test(a.details)));
  });

  it('copies new document files into the backup folder', () => {
    const { mirrorDocuments } = require('../services/backupService');
    assert.equal(mirrorDocuments(), 5);
    assert.equal(mirrorDocuments(), 0, 'already copied');
    assert.equal(fs.readdirSync(path.join(backupDir, 'documents', sd.sd_code)).length, 5);
  });
});
