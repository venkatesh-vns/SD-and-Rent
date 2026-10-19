// SD Paid negative (reversal / credit note) entries
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, readXlsx, createMasters, sdBody } = require('./helpers');

const PW = 'Clerk12345';
const TXN_HEADERS = ['Transaction No.', 'SD Code', 'SD Type', 'FY', 'SD Transaction Date', 'Agreement Status',
  'SD Paid Amount', 'SD Transfer Amount', 'SD Adjustment Amount', 'SD Refund Amount', 'Remarks', 'Reverses Transaction No.'];

describe('SD Paid reversal entries', () => {
  let ctx;
  let m;
  let sd;
  let first;
  let wrong;
  let clerkToken;
  let clerkId;
  const txn = (o, token) => ctx.api('POST', '/sd-transactions', {
    sdId: sd.sd_id, sdType: 'Landlord SD', fy: '2026-2027', agreementStatus: 'LOI', ...o,
  }, token);
  const balance = async () => (await ctx.api('GET', `/sd-transactions/summary/${sd.sd_id}`)).body.data.balance;

  before(async () => {
    ctx = await setup();
    m = await createMasters(ctx);
    sd = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'NEG-1', agreementValue: '100000' }))).body.data;
    first = (await txn({ txnDate: '01/05/2026', paidAmount: '10000' })).body.data;
    wrong = (await txn({ txnDate: '02/05/2026', paidAmount: '2000', remarks: 'paid twice by mistake' })).body.data;
    // A clerk with SD Transaction rights but not the SD Negative Entry right
    clerkId = (await ctx.api('POST', '/users', { userName: 'clerk', userEmail: 'clerk@example.test', password: PW })).body.data.user_id;
    await ctx.api('PUT', `/user-rights/${clerkId}`, { rights: [{ screenCode: 'SD_TRANSACTION', canView: true, canAdd: true, canEdit: true, canUpload: true }] });
    clerkToken = await ctx.login('clerk', PW);
  });
  after(async () => { await ctx.close(); });

  it('reverses a wrong payment with a negative SD Paid entry', async () => {
    const res = await txn({ txnDate: '03/05/2026', paidAmount: '-2,000', reversesTxnNo: wrong.txn_no, remarks: 'Reversal of duplicate payment' });
    assert.equal(res.status, 201, res.body.message);
    assert.equal(Number(res.body.data.paid_amount), -2000);
    assert.equal(res.body.data.reverses_txn_no, wrong.txn_no);
    const b = await balance();
    assert.equal(Number(b.total_paid), 10000, 'net SD Paid after the reversal');
    assert.equal(Number(b.sd_balance), 90000);
    assert.equal(Number(b.sd_balance_repayable), 10000);
    const list = (await ctx.api('GET', `/sd-transactions?sdId=${sd.sd_id}`)).body.data;
    assert.deepEqual(list.map((t) => Number(t.paid_amount)), [10000, 2000, -2000], 'history keeps both the payment and its reversal');
    assert.equal(Number(list[1].reversed_amount), 2000, 'the wrong payment shows it was reversed');
  });

  it('cannot reverse more than the payment or than was paid in total', async () => {
    const twice = await txn({ txnDate: '04/05/2026', paidAmount: '-1', reversesTxnNo: wrong.txn_no });
    assert.match(twice.body.message, /already reversed; at most 0.00 can be reversed/);
    const tooMuch = await txn({ txnDate: '04/05/2026', paidAmount: '-10000.01' });
    assert.match(tooMuch.body.message, /A reversal cannot exceed what was paid|Repayable would be/);
    const early = await txn({ txnDate: '30/04/2026', paidAmount: '-100', reversesTxnNo: first.txn_no });
    assert.match(early.body.message, /cannot be before/);
  });

  it('keeps a reversal as an entry of its own', async () => {
    const mixed = await txn({ txnDate: '05/05/2026', paidAmount: '-100', refundAmount: '50' });
    assert.match(mixed.body.message, /leave Transfer, Adjustment and Refund empty/);
    const linkOnPositive = await txn({ txnDate: '05/05/2026', paidAmount: '100', reversesTxnNo: first.txn_no });
    assert.match(linkOnPositive.body.message, /only used with a negative SD Paid/);
    const other = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'NEG-2', agreementValue: '5000' }))).body.data;
    const otherTxn = (await ctx.api('POST', '/sd-transactions', { sdId: other.sd_id, sdType: 'CAM SD', fy: '2026-2027', agreementStatus: 'LOI', txnDate: '01/05/2026', paidAmount: '500' })).body.data;
    const crossSd = await txn({ txnDate: '05/05/2026', paidAmount: '-100', reversesTxnNo: otherTxn.txn_no });
    assert.match(crossSd.body.message, /must be on the same SD Code/);
  });

  it('needs the SD Negative Entry right', async () => {
    const denied = await txn({ txnDate: '06/05/2026', paidAmount: '-100', reversesTxnNo: first.txn_no }, clerkToken);
    assert.equal(denied.status, 403);
    assert.match(denied.body.message, /SD Negative Entry/);
    assert.equal((await txn({ txnDate: '06/05/2026', paidAmount: '100' }, clerkToken)).status, 201, 'positive entries still allowed');

    await ctx.api('PUT', `/user-rights/${clerkId}`, { rights: [
      { screenCode: 'SD_TRANSACTION', canView: true, canAdd: true, canEdit: true, canUpload: true },
      { screenCode: 'SD_NEGATIVE_ENTRY', canAdd: true },
    ] });
    const allowed = await txn({ txnDate: '06/05/2026', paidAmount: '-100', reversesTxnNo: first.txn_no }, clerkToken);
    assert.equal(allowed.status, 201, allowed.body.message);
  });

  it('filters, exports and reports negative entries', async () => {
    const rev = (await ctx.api('GET', `/sd-transactions?sdId=${sd.sd_id}&entryType=Reversal`)).body.data;
    assert.ok(rev.length >= 2 && rev.every((t) => Number(t.paid_amount) < 0));
    const rows = await readXlsx((await ctx.download(`/sd-transactions/export?sdId=${sd.sd_id}`)).buffer);
    const r = rows.find((x) => x['Reverses Transaction No.'] === wrong.txn_no);
    assert.equal(r['SD Paid Amount'], -2000);
    assert.equal(r['Entry Type'], 'Reversal (negative SD Paid)');
    const report = (await ctx.api('GET', `/reports/sd-rent?sdId=${sd.sd_id}&pageSize=100`)).body;
    const neg = report.data.find((x) => Number(x.amount) === -2000);
    assert.match(neg.details, new RegExp(`Reversal \\(SD Paid\\) -2,000.00 of ${wrong.txn_no}`));
  });

  it('accepts negative SD Paid in uploads only with the right', async () => {
    await ctx.api('PUT', `/user-rights/${clerkId}`, { rights: [{ screenCode: 'SD_TRANSACTION', canView: true, canAdd: true, canUpload: true }, { screenCode: 'SD_NEGATIVE_ENTRY', canAdd: false }] });
    const row = ['', sd.sd_code, 'Landlord SD', '2026-2027', '07/05/2026', 'LOI', '-50', '', '', '', 'upload reversal', first.txn_no];
    const denied = await ctx.upload('/sd-transactions/bulk-upload', [TXN_HEADERS, row], clerkToken);
    assert.equal(denied.body.data.failed, 1);
    assert.match(denied.body.data.report[0].error, /SD Negative Entry/);
    const ok = await ctx.upload('/sd-transactions/bulk-upload', [TXN_HEADERS, row]);
    assert.equal(ok.body.data.passed, 1, JSON.stringify(ok.body.data.report));
  });

  // By now NEG-1 has payments 10,000 + 2,000 + 100 and reversals -2,000 - 100 - 50
  it('reflects reversals in the SD Balance Report and SD Dashboard', async () => {
    const report = (await ctx.api('GET', '/reports/sd-balance?search=NEG-1')).body;
    const r = report.data[0];
    assert.deepEqual([r.total_payments, r.total_reversal, r.total_paid].map(Number), [12100, -2150, 9950]);
    assert.equal(Number(r.sd_balance), 100000 - 9950, 'outstanding SD balance uses net SD Paid');
    assert.equal(report.totals.reversal_count, 3);
    assert.equal(Number(report.totals.total_reversal), -2150);

    const dash = (await ctx.api('GET', `/dashboard?sdId=${sd.sd_id}`)).body.data;
    assert.equal(Number(dash.kpi.paid), 9950);
    assert.equal(Number(dash.kpi.balance), 90050);
    assert.equal(Number(dash.kpi.reversal_amount), 2150);
    assert.equal(dash.kpi.reversal_count, 3);
    assert.ok(dash.recent.some((t) => Number(t.paid_amount) < 0), 'recent transactions include reversals');
  });

  it('SD Balance Report: a line per Agreement Status, Agreement Value once, status filter, grand total', async () => {
    const ExcelJS = require('exceljs');
    // NEG-1 so far: all LOI; add an "Agreement" payment
    assert.equal((await txn({ txnDate: '08/05/2026', paidAmount: '1000', agreementStatus: 'Agreement' })).status, 201);

    const all = (await ctx.api('GET', '/reports/sd-balance?search=NEG-1')).body;
    const r = all.data[0];
    assert.deepEqual(r.lines.map((l) => [l.agreement_status, Number(l.total_paid)]), [['Agreement', 1000], ['LOI', 9950]]);
    assert.equal(Number(r.agreement_value), 100000);
    assert.equal(Number(all.totals.agreement_value), 100000, 'Agreement Value counted once in the total');
    assert.equal(Number(r.sd_balance), 100000 - 10950);

    const agreementOnly = (await ctx.api('GET', '/reports/sd-balance?search=NEG-&agreementStatus=Agreement')).body;
    assert.equal(agreementOnly.total, 1, 'only SD Codes with Agreement transactions');
    assert.equal(Number(agreementOnly.data[0].total_paid), 1000);
    assert.deepEqual(agreementOnly.data[0].lines.map((l) => l.agreement_status), ['Agreement']);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await ctx.download('/reports/sd-balance/export?search=NEG-1')).buffer);
    const ws = wb.getWorksheet('SD Balance');
    const head = ws.getRow(1).values;
    const col = (row, name) => row[head.indexOf(name)];
    const data = [];
    ws.eachRow((row, n) => { if (n > 1 && row.getCell(1).value) data.push(row.values); });
    assert.deepEqual(data.map((x) => col(x, 'SD Code')), [sd.sd_code, sd.sd_code, 'GRAND TOTAL (1 SD Codes)'], 'no subtotal rows');
    assert.ok(!head.includes('Row Type'));
    assert.equal(col(data[0], 'Agreement Value'), 100000);
    assert.equal(col(data[1], 'Agreement Value'), undefined, 'not repeated on the second status line');
    assert.equal(col(data[2], 'Net SD Paid'), 10950);
    assert.equal(col(data[2], 'Agreement Value'), 100000, 'grand total counts the Agreement Value once');
    assert.ok(head.includes('Location Level 1') && head.includes('Floor'), 'Location columns kept in the report');
    assert.ok(!head.includes('Transactions') && !head.includes('Reversal Entries'), 'columns removed');
  });

  it('Floor and Landlord Name filters, with Cost Center -> Landlord -> Floor choices', async () => {
    await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdBody(m, { leaseId: 'NEG-1', agreementValue: '100000', floor: '7', landlordName: 'Prestige Estates' }));
    const combos = (await ctx.api('GET', '/lookups/filter-combos?source=sd')).body.data;
    assert.ok(combos.some((c) => c.costCenterId === sd.cost_center_id && c.landlord === 'Prestige Estates' && c.floor === '7'));
    assert.ok(combos.some((c) => c.landlord === '(Not given)'), 'blank landlords grouped');
    for (const path of ['/reports/sd-balance', '/sd-master', '/sd-transactions']) {
      const ll = encodeURIComponent('Prestige Estates,Nobody');
      const hit = (await ctx.api('GET', `${path}?floor=7&landlordName=${ll}&costCenterId=${sd.cost_center_id}`)).body;
      assert.ok(hit.total > 0 && hit.data.every((r) => r.sd_code === sd.sd_code), path);
      assert.equal((await ctx.api('GET', `${path}?floor=7&landlordName=Nobody`)).body.total, 0, path);
    }
  });

  it('exports transactions grouped by SD Code with the Agreement Value once', async () => {
    const ExcelJS = require('exceljs');
    const file = await ctx.download('/sd-transactions/export');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const rows = await readXlsx(file.buffer);
    const codes = rows.map((x) => x['SD Code']);
    assert.deepEqual(codes, [...codes].sort(), 'grouped by SD Code');
    const neg1 = rows.filter((x) => x['SD Code'] === sd.sd_code);
    assert.equal(neg1[0]['Agreement Value'], 100000, 'shown on the first row of the SD Code');
    assert.ok(neg1.slice(1).every((x) => x['Agreement Value'] === undefined || x['Agreement Value'] === null || x['Agreement Value'] === ''), 'not repeated');

    const by = wb.getWorksheet('By SD Code');
    const head = by.getRow(1).values;
    const line = [];
    by.eachRow((row) => { if (row.getCell(1).value === sd.sd_code) line.push(row.values); });
    const col = (name) => line[0][head.indexOf(name)];
    assert.equal(col('Agreement Value'), 100000);
    // includes the 1,000 Agreement-status payment added by the previous test
    assert.deepEqual([col('SD Paid (payments)'), col('Reversals'), col('Net SD Paid')], [13100, -2150, 10950]);
    assert.equal(col('SD Balance (closing)'), 89050);
  });
});
