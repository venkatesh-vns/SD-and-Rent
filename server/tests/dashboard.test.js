// SD Dashboard: KPIs, upcoming dates, summaries, filters and export
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { setup, createMasters, sdBody } = require('./helpers');

// DD/MM/YYYY for today + n days
function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

describe('SD Dashboard', () => {
  let ctx;
  let sd1;
  let sd2;
  const dash = async (qs = '') => {
    const res = await ctx.api('GET', `/dashboard?${qs}`);
    assert.equal(res.status, 200);
    return res.body.data;
  };

  before(async () => {
    ctx = await setup();
    const a = await createMasters(ctx, 'A');
    const b = await createMasters(ctx, 'B');
    sd1 = (await ctx.api('POST', '/sd-master', sdBody(a, {
      landlordName: 'Alpha', agreementValue: '1000000',
      leaseCommencementDate: inDays(5), rentCommencementDate: inDays(10), leaseEndDate: inDays(400),
    }))).body.data;
    const sd2Body = sdBody(b, {
      landlordName: 'Beta', agreementValue: '500000', leaseCommencementDate: '01/04/2024', leaseEndDate: inDays(12),
    });
    sd2 = (await ctx.api('POST', '/sd-master', sd2Body)).body.data;
    const txn = (sd, o) => ctx.api('POST', '/sd-transactions', { sdId: sd.sd_id, agreementStatus: 'LOI', ...o });
    assert.equal((await txn(sd1, { sdType: 'Landlord SD', fy: '2024-2025', txnDate: '01/05/2024', paidAmount: '600000' })).status, 201);
    assert.equal((await txn(sd1, { sdType: 'Landlord SD', fy: '2024-2025', txnDate: '01/06/2024', refundAmount: '100000' })).status, 201);
    assert.equal((await txn(sd2, { sdType: 'CAM SD', fy: '2025-2026', txnDate: '10/05/2025', paidAmount: '200000' })).status, 201);
    await ctx.api('PUT', `/sd-master/${sd2.sd_id}`, { ...sd2Body, landlordStatus: 'Passive' });
  });
  after(async () => { await ctx.close(); });

  it('totals the KPIs', async () => {
    const { kpi } = await dash();
    assert.equal(Number(kpi.agreement_value), 1500000);
    assert.equal(Number(kpi.paid), 800000);
    assert.equal(Number(kpi.balance), 700000);
    assert.equal(Number(kpi.repayable), 700000);
    assert.deepEqual([kpi.sd_count, kpi.active_count, kpi.passive_count, kpi.landlord_count, kpi.cost_center_count], [2, 1, 1, 2, 2]);
  });

  it('lists upcoming lease dates within the chosen number of days', async () => {
    const { alerts } = await dash();
    assert.deepEqual(alerts.leaseCommencement.map((a) => [a.sd_code, a.days_left]), [[sd1.sd_code, 5]]);
    assert.deepEqual(alerts.rentCommencement.map((a) => a.days_left), [10]);
    assert.deepEqual(alerts.leaseEnd.map((a) => [a.sd_code, a.days_left]), [[sd2.sd_code, 12]]);
    const week = await dash('alertDays=7');
    assert.equal(week.alerts.leaseCommencement.length, 1);
    assert.equal(week.alerts.rentCommencement.length + week.alerts.leaseEnd.length, 0);
  });

  it('summarises by SD type, cost center, landlord, status and recoveries', async () => {
    const d = await dash();
    assert.deepEqual(d.sdTypes.map((r) => [r.sd_type, Number(r.paid)]), [['Landlord SD', 600000], ['CAM SD', 200000]]);
    assert.equal(d.costCenters.length, 2);
    assert.deepEqual(d.landlords.map((r) => [r.landlord_name, r.sd_count]), [['Alpha', 1], ['Beta', 1]]);
    assert.deepEqual(d.pending.map((r) => [r.sd_code, Number(r.repayable)]), [[sd1.sd_code, 500000], [sd2.sd_code, 200000]]);
    assert.deepEqual(d.status, { landlord_active: 1, landlord_passive: 1, building_active: 2, building_passive: 0 });
    assert.equal(d.recent.length, 3);
    assert.equal(d.locations.length, 2);
    const fy = Object.fromEntries(d.financialYears.map((r) => [r.fy, r]));
    assert.equal(fy['2024-2025'].paid, 600000);
    assert.equal(fy['2024-2025'].refund, 100000);
    assert.equal(fy['2024-2025'].agreement_value, 500000, 'SD2 commenced in April 2024');
    assert.equal(fy['2025-2026'].paid, 200000);
    const last = d.financialYears[d.financialYears.length - 1];
    assert.equal(last.balance, Number(d.kpi.balance), 'closing balance of the last FY = total SD Balance');
  });

  it('applies SD and transaction filters (multi-select and dates)', async () => {
    const cam = await dash('sdType=CAM%20SD');
    assert.equal(cam.kpi.sd_count, 1);
    assert.equal(Number(cam.kpi.paid), 200000);
    assert.equal(Number(cam.kpi.agreement_value), 500000);
    const both = await dash('sdType=CAM%20SD,Landlord%20SD');
    assert.equal(both.kpi.sd_count, 2);
    assert.equal(Number((await dash('landlordName=Alpha')).kpi.agreement_value), 1000000);
    assert.equal(Number((await dash('landlordStatus=Passive')).kpi.sd_count), 1);
    const dated = await dash('dateFrom=01/01/2025&dateTo=31/12/2025');
    assert.equal(Number(dated.kpi.paid), 200000);
    assert.deepEqual((await dash('fy=2025-2026')).financialYears.map((r) => r.fy), ['2025-2026']);
    assert.equal((await dash(`sdId=${sd1.sd_id}`)).kpi.sd_count, 1);
  });

  it('lists filter options and exports every section to Excel', async () => {
    const opts = (await ctx.api('GET', '/dashboard/options')).body.data;
    assert.deepEqual(opts.landlords, ['Alpha', 'Beta']);
    assert.equal(opts.sdCodes.length, 2);
    const file = await ctx.download('/dashboard/export');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    assert.ok(['Summary', 'Lease Commencement Due', 'SD Type', 'Cost Center', 'Landlord', 'Pending Recovery', 'Financial Year']
      .every((n) => wb.getWorksheet(n)));
    assert.equal(wb.getWorksheet('Summary').getCell('B2').value, 1500000);
  });
});
