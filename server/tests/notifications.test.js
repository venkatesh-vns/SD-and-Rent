// Email notifications (dry run), reminders, report and logs
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, readXlsx, createMasters, sdBody } = require('./helpers');

describe('notifications, report and logs', () => {
  let ctx;
  let m;
  let a;
  let b;
  let c;

  before(async () => {
    ctx = await setup();
    m = await createMasters(ctx);
    a = (await ctx.api('POST', '/sd-master', sdBody(m, {
      leaseId: 'N-1', agreementValue: '500000', leaseCommencementDate: '17/01/2030', rentCommencementDate: '16/01/2030', leaseEndDate: '11/01/2031',
    }))).body.data;
    b = (await ctx.api('POST', '/sd-master', sdBody(m, {
      leaseId: 'N-2', agreementValue: '500000', leaseCommencementDate: '01/01/2020', leaseEndDate: '11/01/2030',
    }))).body.data;
    c = (await ctx.api('POST', '/sd-master', sdBody(m, {
      leaseId: 'N-3', agreementValue: '500000', leaseEndDate: '05/01/2030', buildingStatus: 'Passive',
    }))).body.data;
  });
  after(async () => { await ctx.close(); });

  const emails = async (q = '') => (await ctx.api('GET', `/logs/email?pageSize=200${q}`)).body;

  it('sends date reminders 15 days ahead, once each, skipping Passive records', async () => {
    const run = (asOf) => ctx.api('POST', '/notifications/run-reminders', { asOf });
    assert.equal((await run('01/01/2030')).body.data.sent, 2); // rent 16/01 (15 days), lease end 11/01 (10 days)
    assert.equal((await run('02/01/2030')).body.data.sent, 1); // lease commencement 17/01 now 15 days away
    assert.equal((await run('03/01/2030')).body.data.sent, 0); // everything already sent
    const log = await emails();
    const got = log.data.map((e) => `${e.sd_code}:${e.notification_type}`).sort();
    assert.deepEqual(got, [
      `${a.sd_code}:LEASE_COMMENCEMENT_REMINDER`, `${a.sd_code}:RENT_COMMENCEMENT_REMINDER`, `${b.sd_code}:LEASE_END_REMINDER`,
    ].sort());
    assert.ok(log.data.every((e) => e.status === 'DryRun' && e.recipient === 'qa-team@example.test'));
    assert.ok(!log.data.some((e) => e.sd_code === c.sd_code));
  });

  it('emails Active -> Passive status changes (form and upload), not the reverse', async () => {
    const body = sdBody(m, { leaseId: 'N-2', agreementValue: '500000', leaseCommencementDate: '01/01/2020', leaseEndDate: '11/01/2030' });
    await ctx.api('PUT', `/sd-master/${b.sd_id}`, { ...body, landlordStatus: 'Passive' });
    await ctx.api('PUT', `/sd-master/${b.sd_id}`, body);
    const headers = ['SD Code', 'Cost Center', 'Location Level 1', 'Location Level 2', 'Location Level 3', 'Landlord Status', 'Building Status', 'Floor', 'Agreement Value'];
    const up = await ctx.upload('/sd-master/bulk-upload', [headers, [a.sd_code, '', '', '', '', '', 'Passive', '', '']]);
    assert.equal(up.body.data.passed, 1);
    const landlord = await emails('&notificationType=LANDLORD_STATUS_PASSIVE');
    assert.equal(landlord.total, 1);
    assert.equal(landlord.data[0].sd_code, b.sd_code);
    const building = await emails('&notificationType=BUILDING_STATUS_PASSIVE');
    assert.equal(building.total, 1);
    assert.equal(building.data[0].sd_code, a.sd_code);
  });

  it('builds the SD Balance report with totals and filters', async () => {
    const aBody = sdBody(m, { leaseId: 'N-1', agreementValue: '500000', leaseCommencementDate: '17/01/2030', rentCommencementDate: '16/01/2030', leaseEndDate: '11/01/2031' });
    await ctx.api('PUT', `/sd-master/${a.sd_id}`, aBody);
    const txn = (sdId, o) => ctx.api('POST', '/sd-transactions', { sdId, sdType: 'Landlord SD', fy: '2024-2025', agreementStatus: 'LOI', txnDate: '01/05/2024', ...o });
    await txn(b.sd_id, { paidAmount: '500000' });
    await txn(b.sd_id, { txnDate: '02/05/2024', refundAmount: '500000' });
    await txn(a.sd_id, { paidAmount: '200000' });
    const r = (await ctx.api('GET', '/reports/sd-balance?search=N-')).body;
    assert.equal(r.total, 3);
    assert.equal(Number(r.totals.agreement_value), 1500000);
    assert.equal(Number(r.totals.sd_balance), 800000);
    assert.equal(Number(r.totals.sd_balance_repayable), 200000);
    assert.equal((await ctx.api('GET', '/reports/sd-balance?repayableDue=true')).body.total, 1);
    assert.equal((await ctx.api('GET', '/reports/sd-balance?balanceDue=true')).body.total, 2);
    assert.equal((await ctx.api('GET', '/reports/sd-balance?leaseEndFrom=01/01/2030&leaseEndTo=31/01/2030')).body.total, 2);
    const rows = await readXlsx((await ctx.download('/reports/sd-balance/export')).buffer);
    assert.equal(rows.length, 4);
    assert.equal(rows[3]['SD Code'], 'TOTAL (3)');
    assert.equal(rows[3]['SD Balance Repayable'], 200000);
  });

  it('shows the audit log with filters', async () => {
    const changes = (await ctx.api('GET', '/logs/audit?tableName=sd_master&action=STATUS_CHANGE')).body;
    assert.equal(changes.total, 3); // N-2 to Passive, N-2 back to Active, N-1 back to Active (the upload is logged as UPLOAD)
    assert.ok((await ctx.api('GET', `/logs/audit?tableName=sd_master&search=${b.sd_id}`)).body.total >= 3);
    const txnAudit = (await ctx.api('GET', '/logs/audit?tableName=sd_transactions')).body;
    assert.equal(txnAudit.total, 3);
  });

  it('keeps logs, report and reminder runs behind rights', async () => {
    await ctx.api('POST', '/users', { userName: 'viewer', userEmail: 'viewer@example.test', password: 'Viewpass123' });
    const viewer = (await ctx.api('GET', '/users?search=viewer')).body.data[0];
    await ctx.api('PUT', `/user-rights/${viewer.user_id}`, { rights: [{ screenCode: 'SD_REPORT', canView: true }] });
    const token = await ctx.login('viewer', 'Viewpass123');
    assert.equal((await ctx.api('GET', '/reports/sd-balance', undefined, token)).status, 200);
    assert.equal((await ctx.api('GET', '/logs/email', undefined, token)).status, 403);
    assert.equal((await ctx.api('GET', '/logs/audit', undefined, token)).status, 403);
    assert.equal((await ctx.api('POST', '/notifications/run-reminders', {}, token)).status, 403);
    assert.equal((await ctx.api('POST', '/notifications/run-reminders', { asOf: '31/02/2030' })).status, 400);
  });
});
