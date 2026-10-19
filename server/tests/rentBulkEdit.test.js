// Bulk Edit of Rule Master and Waiver Master, and its dependency on the Rent Schedule
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { setup, createMasters, sdBody } = require('./helpers');

describe('Rule / Waiver Bulk Edit', () => {
  let ctx;
  let rent;
  let rule;
  let waiver;
  const lines = async (qs = '') => (await ctx.api('GET', `/rent/schedule?pageSize=500&rentId=${rent.rent_id}&${qs}`)).body;
  const byMonth = async (qs) => Object.fromEntries((await lines(qs)).data.map((l) => [l.rent_month.slice(0, 7), Number(l.final_amount)]));
  const generate = (fromDate, toDate) => ctx.api('POST', '/rent/schedule/generate', { fromDate, toDate, filters: {} });
  const remove = (fromDate, toDate) => ctx.api('POST', '/rent/schedule/delete', { fromDate, toDate, filters: { rentId: [rent.rent_id] } });

  // Downloads the Bulk Edit file as rows (header first), so a test can change cells and upload it
  async function download(path) {
    const file = await ctx.download(`/rent/${path}/bulk-edit?rentId=${rent.rent_id}`);
    assert.equal(file.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    assert.ok(wb.getWorksheet('How to use'), 'instructions sheet');
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow((row) => rows.push(row.values.slice(1).map((v) => (v === undefined || v === null ? '' : v))));
    return rows;
  }
  const set = (rows, i, header, value) => { rows[i][rows[0].indexOf(header)] = value; };
  const failed = (res) => res.body.data.report.filter((r) => r.status === 'Failed');

  before(async () => {
    ctx = await setup();
    const m = await createMasters(ctx);
    // LCD 01/01/2026, RCD 01/04/2026, LED 01/12/2026
    const sd = (await ctx.api('POST', '/sd-master', sdBody(m, {
      leaseId: 'BE-1', floor: '4', landlordName: 'Owner', leaseCommencementDate: '01/01/2026', rentCommencementDate: '01/04/2026', leaseEndDate: '01/12/2026',
    }))).body.data;
    rent = (await ctx.api('POST', '/rent/master', { sdId: sd.sd_id, landlordName: 'Owner', llStatus: 'Active' })).body.data;
    await ctx.api('POST', '/rent/agreements', { rentId: rent.rent_id, agreementStatus: 'Individual', components: { OFFICE: { quantity: '1000', rate: '10', percentage: '10' } } });
    rule = (await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'RCD', escalationMonths: '1', percentage: '15' })).body.data;
    waiver = (await ctx.api('POST', '/rent/waivers', { rentId: rent.rent_id, fromDate: '01/10/2026', toDate: '31/10/2026', waiverStatus: 'Yes' })).body.data;
  });
  after(async () => { await ctx.close(); });

  it('downloads rules in the upload layout with the Rule ID and reference columns', async () => {
    const rows = await download('rules');
    assert.equal(rows[0][0], 'Rule ID');
    assert.ok(rows[0].includes('Escalation Date (reference)'));
    assert.ok(rows[0].includes('Rent Schedule Generated Up To (reference)'));
    assert.equal(rows[1][0], rule.rule_id);
    assert.equal(rows[1][rows[0].indexOf('Rent Schedule Generated Up To (reference)')], 'Not generated');
  });

  it('edits rules before the Rent Schedule is generated; unchanged rows are skipped', async () => {
    const rows = await download('rules');
    rows.push([...rows[1]]);
    set(rows, 1, 'Percentage', 20);
    set(rows, 2, 'Rule ID', '');                       // a new row is not allowed in Bulk Edit
    const res = await ctx.upload('/rent/rules/bulk-edit', rows);
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.passed, 1);
    assert.match(failed(res)[0].error, /Rule ID is required in Bulk Edit/);
    assert.equal(Number((await ctx.api('GET', `/rent/rules/${rule.rule_id}`)).body.data.percentage), 20);

    const again = await ctx.upload('/rent/rules/bulk-edit', (await download('rules')));
    assert.equal(again.body.data.unchanged, 1);
    assert.equal(again.body.data.passed, 0);
    assert.match(again.body.message, /0 saved, 1 unchanged, 0 rejected/);
  });

  it('refuses a rule edit while the Rent Schedule exists in the months it affects', async () => {
    assert.equal((await generate('01/01/2026', '31/12/2026')).status, 200);
    assert.equal((await byMonth())['2026-05'], 1200, '20% from May');
    const rows = await download('rules');
    assert.equal(rows[1][rows[0].indexOf('Rent Schedule Generated Up To (reference)')], 'Dec-2026');
    set(rows, 1, 'Percentage', 25);
    const res = await ctx.upload('/rent/rules/bulk-edit', rows);
    assert.equal(res.body.data.passed, 0);
    assert.match(failed(res)[0].error, /Rent Schedule is already generated for RENT\d+ in the months this change affects \(May-2026 onward/);
    assert.match(failed(res)[0].error, /Delete those Rent Schedule lines first/);
    assert.equal(Number((await ctx.api('GET', `/rent/rules/${rule.rule_id}`)).body.data.percentage), 20, 'not saved');
  });

  it('deletes schedule lines for a period, then the edit saves and the schedule is regenerated', async () => {
    const bad = await ctx.api('POST', '/rent/schedule/delete', { fromDate: '', toDate: '31/12/2026', filters: {} });
    assert.equal(bad.status, 400);

    const del = await remove('01/05/2026', '31/12/2026');
    assert.equal(del.status, 200, del.body.message);
    assert.match(del.body.message, /Deleted 8 Rent Schedule line\(s\) of 1 Rent Code\(s\), May-2026 to Dec-2026/);
    assert.deepEqual(Object.keys(await byMonth()), ['2026-04'], 'April kept');
    const runs = (await ctx.api('GET', '/rent/schedule/runs')).body.data;
    assert.equal(runs[0].trigger, 'Delete');

    const rows = await download('rules');
    assert.equal(rows[1][rows[0].indexOf('Rent Schedule Generated Up To (reference)')], 'Apr-2026');
    set(rows, 1, 'Percentage', 25);
    const res = await ctx.upload('/rent/rules/bulk-edit', rows);
    assert.equal(res.body.data.passed, 1, JSON.stringify(failed(res)));
    assert.deepEqual(Object.keys(await byMonth()), ['2026-04'], 'Bulk Edit does not regenerate by itself');

    assert.equal((await generate('01/05/2026', '31/12/2026')).status, 200);
    const after = await byMonth();
    assert.equal(after['2026-05'], 1250, '25% from May');
    assert.equal(after['2026-04'], 1000);
  });

  it('refuses a waiver edit while its old or new period is generated; other months do not matter', async () => {
    const rows = await download('waivers');
    assert.equal(rows[0][0], 'Waiver ID');
    assert.equal(rows[1][0], waiver.waiver_id);
    set(rows, 1, 'To Date', '15/10/2026');
    const blocked = await ctx.upload('/rent/waivers/bulk-edit', rows);
    assert.match(failed(blocked)[0].error, /Rent Schedule is already generated for RENT\d+ in the months this change affects \(Oct-2026 to Oct-2026/);

    await remove('01/10/2026', '31/10/2026');                      // November and December stay generated
    const ok = await ctx.upload('/rent/waivers/bulk-edit', rows);
    assert.equal(ok.body.data.passed, 1, JSON.stringify(failed(ok)));
    assert.equal((await ctx.api('GET', `/rent/waivers/${waiver.waiver_id}`)).body.data.to_date, '2026-10-15');
    await generate('01/10/2026', '31/10/2026');
    const oct = (await lines('fromDate=01/10/2026&toDate=31/10/2026')).data[0];
    assert.ok(Number(oct.waiver_amount) > 0 && Number(oct.final_amount) > 0, 'half of October waived');
  });

  it('needs the Waiver ID column', async () => {
    const res = await ctx.upload('/rent/waivers/bulk-edit', [['Rent Code', 'From Date', 'To Date', 'Waiver Status'], [rent.rent_code, '01/10/2026', '15/10/2026', 'No']]);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /missing required column\(s\): Waiver ID/);
  });
});
