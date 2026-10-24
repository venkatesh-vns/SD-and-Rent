// SD Balance report, Transaction date filter: movements of the period, balances as at its end
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, readXlsx, createMasters, sdBody } = require('./helpers');

describe('SD Balance report by transaction date', () => {
  let ctx;
  let a;
  const report = async (q) => (await ctx.api('GET', `/reports/sd-balance?search=PER-${q}`)).body;

  before(async () => {
    ctx = await setup();
    const m = await createMasters(ctx);
    a = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'PER-1', agreementValue: '1000000' }))).body.data;
    const b = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'PER-2', agreementValue: '500000' }))).body.data;
    const txn = async (sd, o) => {
      const r = await ctx.api('POST', '/sd-transactions', { sdId: sd.sd_id, sdType: 'Landlord SD', fy: '2025-2026', agreementStatus: 'Agreement', ...o });
      assert.equal(r.status, 201, r.body.message);
    };
    await txn(a, { txnDate: '10/04/2025', paidAmount: '400000' });
    await txn(a, { txnDate: '15/06/2025', paidAmount: '300000' });
    await txn(a, { txnDate: '20/07/2025', refundAmount: '50000' });
    await txn(a, { txnDate: '10/09/2025', paidAmount: '100000' });
    await txn(b, { txnDate: '05/05/2025', paidAmount: '200000' });
  });
  after(async () => { await ctx.close(); });

  it('without dates, shows everything to date', async () => {
    const r = await report('');
    assert.equal(r.total, 2);
    assert.equal(Number(r.totals.total_paid), 1000000);
  });

  it('adds up the period and gives balances as at the To date', async () => {
    const r = await report('&txnDateFrom=01/06/2025&txnDateTo=31/07/2025');
    assert.equal(r.total, 1, 'PER-2 has no transaction in the period');
    const row = r.data[0];
    assert.equal(row.sd_code, a.sd_code);
    assert.equal(Number(row.total_paid), 300000);
    assert.equal(Number(row.total_refund), 50000);
    assert.equal(Number(row.sd_balance), 300000, '10,00,000 - (4,00,000 + 3,00,000) paid up to 31/07');
    assert.equal(Number(row.sd_balance_repayable), 650000, '7,00,000 paid - 50,000 refunded up to 31/07');
    assert.equal(Number(r.totals.total_paid), 300000);
  });

  it('works with only a From or only a To date', async () => {
    const from = await report('&txnDateFrom=01/08/2025');
    assert.equal(from.total, 1);
    assert.equal(Number(from.totals.total_paid), 100000);
    assert.equal(Number(from.totals.sd_balance), 200000);
    const to = await report('&txnDateTo=31/05/2025');
    assert.equal(to.total, 2);
    assert.equal(Number(to.totals.total_paid), 600000);
    assert.equal(Number(to.totals.sd_balance), 900000);
  });

  it('exports the period with a note', async () => {
    const rows = await readXlsx((await ctx.download('/reports/sd-balance/export?search=PER-&txnDateFrom=01/06/2025&txnDateTo=31/07/2025')).buffer);
    const text = JSON.stringify(rows);
    assert.match(text, /Transaction date 01\/06\/2025 to 31\/07\/2025/);
    assert.ok(text.includes(a.sd_code));
  });
});
