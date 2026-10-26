// SD Document Upload: template, bulk upload with a status per row (files sent by
// the browser or read from an allowed shared folder), and admin bulk delete
const fs = require('fs');
const os = require('os');
const path = require('path');

const docDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-bulkdocs-'));
const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-shared-'));
process.env.DOCUMENT_DIR = docDir;
process.env.DOCUMENT_IMPORT_ROOTS = shared;

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { setup, createMasters, sdBody } = require('./helpers');

const PDF = (n) => Buffer.from(`%PDF-1.4\n% bulk ${n}\n%%EOF\n`);
const HEAD = ['S.No', 'SD Code / SD ID', 'Document Type', 'File Path'];

describe('SD Document Upload (bulk)', () => {
  let ctx;
  let a;
  let b;
  let batch;
  const sendFile = (url, buf, name, token) => {
    const form = new FormData();
    form.append('file', new Blob([buf]), name);
    return ctx.api('POST', url, form, token);
  };
  const row = (bt, sNo) => bt.rows.find((r) => r.s_no === String(sNo));

  before(async () => {
    ctx = await setup();
    const m = await createMasters(ctx);
    a = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'BULK-1' }))).body.data;
    b = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'BULK-2' }))).body.data;
    fs.mkdirSync(path.join(shared, 'SD'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'SD', 'Registered.pdf'), PDF('shared'));
  });
  after(async () => {
    await ctx.close();
    [docDir, shared].forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  });

  it('gives a template with the four columns and a Document Type drop-down', async () => {
    const dl = await ctx.download('/sd-document-batches/template');
    assert.equal(dl.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(dl.buffer);
    assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), HEAD);
    assert.match(JSON.stringify(wb.worksheets[0].dataValidations.model), /Registered Agreement/);
    assert.equal(wb.worksheets[1].name, 'Instructions');
  });

  it('checks every row and reads files from an allowed shared folder at once', async () => {
    const res = await ctx.upload('/sd-document-batches', [
      HEAD,
      [1, a.sd_code, 'Agreement', 'D:\\Docs\\BULK-1\\Lease Agreement.pdf'],
      [2, String(b.sd_id), 'loi', 'D:\\Docs\\BULK-2\\LOI.docx'],
      [3, 'SD999999', 'Agreement', 'D:\\Docs\\x.pdf'],
      [4, a.sd_code, 'Invoice', 'D:\\Docs\\y.pdf'],
      [5, a.sd_code, 'Other', 'D:\\Docs\\photo.jpg'],
      [6, a.sd_code, 'Agreement', 'd:\\docs\\bulk-1\\lease agreement.pdf'],
      [7, b.sd_code, 'Registered Agreement', path.join(shared, 'SD', 'Registered.pdf')],
      [8, b.sd_code, 'Correspondence', 'D:\\Docs\\BULK-2\\Letter.pdf'],
    ], ctx.adminToken, 'docs.xlsx');
    assert.equal(res.status, 201, res.body.message);
    batch = res.body.data;
    assert.match(batch.batch_no, /^DOCB\d{6}$/);
    assert.equal(batch.total_rows, 8);
    assert.equal(row(batch, 1).status, 'Pending');
    assert.equal(row(batch, 2).document_type, 'LOI', 'type matched without case');
    assert.equal(row(batch, 2).sd_code, b.sd_code, 'SD ID accepted');
    assert.match(row(batch, 3).message, /"SD999999" was not found/);
    assert.match(row(batch, 4).message, /Document Type must be one of/);
    assert.match(row(batch, 5).message, /Only PDF/);
    assert.match(row(batch, 6).message, /Same SD Code and File Path as row 2/);
    assert.equal(row(batch, 7).status, 'Success', 'read from the shared folder');
    assert.match(row(batch, 7).message, /Uploaded as "Registered"/);
  });

  it('uploads the files the browser sends, row by row, then completes the batch', async () => {
    const one = await sendFile(`/sd-document-batches/${batch.batch_id}/rows/${row(batch, 1).row_no}/file`, PDF(1), 'Lease Agreement.pdf');
    assert.equal(one.body.data.status, 'Success', one.body.message);
    const two = await sendFile(`/sd-document-batches/${batch.batch_id}/rows/${row(batch, 2).row_no}/file`, Buffer.from('not word'), 'LOI.docx');
    assert.equal(two.body.data.status, 'Failed');
    assert.match(two.body.data.message, /not a valid DOCX/);

    const done = await ctx.api('POST', `/sd-document-batches/${batch.batch_id}/complete`, {
      notFound: [{ rowNo: row(batch, 8).row_no, message: 'Letter.pdf was not among the chosen files.' }],
    });
    batch = done.body.data;
    assert.equal(batch.status, 'Completed');
    assert.equal(batch.success_rows, 2);
    assert.equal(batch.failed_rows, 6);
    assert.match(row(batch, 8).message, /not among the chosen files/);

    const list = (await ctx.api('GET', `/sd-documents?sdId=${a.sd_id}`)).body.data;
    assert.equal(list.length, 1);
    assert.match(list[0].remarks, new RegExp(`Bulk upload ${batch.batch_no}, S.No 1`));
    assert.equal((await sendFile(`/sd-document-batches/${batch.batch_id}/rows/${row(batch, 8).row_no}/file`, PDF(8), 'Letter.pdf')).status, 409, 'batch closed');
    const history = (await ctx.api('GET', '/sd-document-batches')).body;
    assert.equal(history.data[0].batch_no, batch.batch_no);
    assert.equal(history.data[0].active_documents, 2);
  });

  it('follows the screen rights; bulk delete is for administrators only', async () => {
    await ctx.api('POST', '/users', { userName: 'uploader', userEmail: 'up@example.test', password: 'Uploaderpass123' });
    const id = (await ctx.pool.query(`SELECT user_id FROM users WHERE user_name = 'uploader'`)).rows[0].user_id;
    const token = await ctx.login('uploader', 'Uploaderpass123');
    assert.equal((await ctx.api('GET', '/sd-document-batches', undefined, token)).status, 403);
    await ctx.api('PUT', `/user-rights/${id}`, { rights: [{ screenCode: 'SD_DOCUMENT_UPLOAD', canView: true, canUpload: true }] });
    assert.equal((await ctx.api('GET', '/sd-document-batches', undefined, token)).status, 200);
    assert.equal((await ctx.api('POST', '/sd-document-batches/bulk-delete/preview', { batchId: batch.batch_id }, token)).status, 403);
    assert.equal((await ctx.api('POST', '/sd-document-batches/bulk-delete', { batchId: batch.batch_id, reason: 'x' }, token)).status, 403);
  });

  it('bulk deletes a batch, skipping documents with later versions', async () => {
    // a second batch whose document then gets a manual new version
    const second = (await ctx.upload('/sd-document-batches', [HEAD, [1, a.sd_code, 'Payment Proof', 'C:\\x\\Receipt.pdf']], ctx.adminToken, 'second.xlsx')).body.data;
    await sendFile(`/sd-document-batches/${second.batch_id}/rows/${second.rows[0].row_no}/file`, PDF('r1'), 'Receipt.pdf');
    await ctx.api('POST', `/sd-document-batches/${second.batch_id}/complete`, {});
    const receipt = (await ctx.api('GET', `/sd-documents?sdId=${a.sd_id}`)).body.data.find((d) => d.document_type === 'Payment Proof');
    await sendFile(`/sd-documents/${receipt.document_id}/versions`, PDF('r2'), 'Receipt v2.pdf');

    const preview = (await ctx.api('POST', '/sd-document-batches/bulk-delete/preview', { batchId: batch.batch_id })).body.data;
    assert.equal(preview.documents, 2);
    assert.equal((await ctx.api('POST', '/sd-document-batches/bulk-delete', { batchId: batch.batch_id })).status, 400, 'reason required');
    const del = await ctx.api('POST', '/sd-document-batches/bulk-delete', { batchId: batch.batch_id, reason: 'Wrong files' });
    assert.equal(del.status, 200, del.body.message);
    assert.match(del.body.message, /2 documents deleted from DOCB/);
    const after1 = (await ctx.api('GET', `/sd-document-batches/${batch.batch_id}`)).body.data;
    assert.equal(after1.status, 'Deleted');
    assert.equal(row(after1, 1).status, 'Deleted');
    assert.equal((await ctx.api('GET', `/sd-documents?sdId=${b.sd_id}`)).body.data.length, 0);

    // by date: the second batch's document has a later version, so it stays
    const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
    const byDate = await ctx.api('POST', '/sd-document-batches/bulk-delete', { date: today, reason: 'Clean-up' });
    assert.equal(byDate.status, 200, byDate.body.message);
    assert.equal(byDate.body.data.deleted, 0);
    assert.equal(byDate.body.data.skipped.length, 1);
    assert.match(byDate.body.data.skipped[0].reason, /later version/);
    assert.equal((await ctx.api('GET', `/sd-documents?sdId=${a.sd_id}`)).body.data.length, 1);
    const actions = (await ctx.pool.query(`SELECT action FROM audit_log WHERE table_name = 'sd_document_batches'`)).rows.map((r) => r.action);
    assert.ok(actions.includes('DOC_BULK_UPLOAD') && actions.includes('DOC_BULK_DELETE'));
  });
});
