// Rent Transaction module: Rent Master, Agreements, Rules, Waivers, Schedule, uploads
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { setup, createMasters, sdBody } = require('./helpers');

const HEADERS = {
  master: ['Rent Code', 'SD Code', 'Cost Center', 'Floor', 'LCD', 'RCD', 'LED', 'Landlord Name', 'LL Status', 'Inactive End Date'],
  waiver: ['Waiver ID', 'Rent Code', 'From Date', 'To Date', 'Waiver Status', 'Remark', 'Applies to: Additional Parking', 'Applies to: Fitouts', 'Applies to: Cafe', 'Applies to: Car Park Rent', 'Applies to: Office Rent', 'Applies to: Signage', 'Applies to: Solar', 'Applies to: Terrace', 'Applies to: Maintenance Charges'],
};

describe('Rent Transaction module', () => {
  let ctx;
  let m;
  let sd;      // LCD 01/01/2026, RCD 01/04/2026, LED 01/12/2026 (scope 6.4)
  let rent;    // RENT for landlord Venkat
  let agreement;
  const office = (sqft, rate, pct) => ({ OFFICE: { quantity: sqft, rate, percentage: pct } });
  const lines = async (qs = '') => (await ctx.api('GET', `/rent/schedule?pageSize=500&${qs}`)).body;

  before(async () => {
    ctx = await setup();
    m = await createMasters(ctx);
    sd = (await ctx.api('POST', '/sd-master', sdBody(m, {
      leaseId: 'R-1', floor: '3', landlordName: 'Venkat', leaseCommencementDate: '01/01/2026', rentCommencementDate: '01/04/2026', leaseEndDate: '01/12/2026',
    }))).body.data;
  });
  after(async () => { await ctx.close(); });

  describe('Rent Master', () => {
    it('creates a Rent Code from an SD Code with SD fields read from SD Master', async () => {
      const res = await ctx.api('POST', '/rent/master', { sdId: sd.sd_id, landlordName: 'Venkat', llStatus: 'Active' });
      assert.equal(res.status, 201);
      rent = res.body.data;
      assert.match(rent.rent_code, /^RENT\d{4}$/);
      assert.equal(rent.floor, '3');
      assert.equal(rent.rcd, '2026-04-01');
      assert.equal(rent.business_key, `TEST CC | ${sd.sd_code} | 3 | VENKAT`);
    });

    it('finds the SD record in SD Master by its Rent Code', async () => {
      const found = (await ctx.api('GET', `/sd-master?search=${rent.rent_code.toLowerCase()}`)).body;
      assert.equal(found.total, 1);
      assert.equal(found.data[0].sd_code, sd.sd_code);
      assert.equal((await ctx.api('GET', '/sd-master?search=RENT9999')).body.total, 0);
    });

    it('blocks duplicate Business Keys, missing SD dates and Inactive without an end date', async () => {
      const dup = await ctx.api('POST', '/rent/master', { sdId: sd.sd_id, landlordName: ' venkat ', llStatus: 'Active' });
      assert.equal(dup.status, 400);
      assert.match(dup.body.message, /already exists/);
      const noRcd = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'R-2', floor: '9' }))).body.data;
      assert.match((await ctx.api('POST', '/rent/master', { sdId: noRcd.sd_id, landlordName: 'X', llStatus: 'Active' })).body.message, /no Rent Commencement Date/);
      const inactive = await ctx.api('POST', '/rent/master', { sdId: sd.sd_id, landlordName: 'Other', llStatus: 'Inactive' });
      assert.match(inactive.body.message, /Inactive End Date is required/);
    });
  });

  describe('Rent Agreement Master', () => {
    it('requires Rate and % once a component trigger is entered', async () => {
      const res = await ctx.api('POST', '/rent/agreements', { rentId: rent.rent_id, agreementStatus: 'Individual', components: { OFFICE: { quantity: '1000' } } });
      assert.equal(res.status, 400);
      assert.deepEqual(res.body.errors.map((e) => e.field).sort(), ['Rent to Landlord - Office Rent %', 'Rent to Landlord - Office Rent Rate']);
    });

    it('saves components (Sq.Ft x Rate x %) and allows only one active per Rent Code + status', async () => {
      const res = await ctx.api('POST', '/rent/agreements', { rentId: rent.rent_id, agreementStatus: 'Individual', components: office('1000', '10', '10') });
      assert.equal(res.status, 201);
      agreement = res.body.data;
      assert.equal(agreement.components.length, 1);
      const again = await ctx.api('POST', '/rent/agreements', { rentId: rent.rent_id, agreementStatus: 'Individual', components: office('2000', '10', '10') });
      assert.match(again.body.message, /already has an active Individual agreement/);
    });
  });

  describe('Rule and Waiver Masters', () => {
    it('chains RCD escalations and keeps them within the LED', async () => {
      const res = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'RCD', escalationMonths: '1', percentage: '15' });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.effective_date, '2026-05-01');
      const tooLate = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'RCD', escalationMonths: '12', percentage: '5' });
      assert.match(tooLate.body.message, /not before the LED/);
      const mixed = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'LCD', escalationMonths: '2', percentage: '5' });
      assert.match(mixed.body.message, /cannot be combined/);
      const badNormal = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'Normal Day', fromDate: '10/06/2026', toDate: '01/06/2026', percentage: '5' });
      assert.match(badNormal.body.message, /on or before To Date/);
    });

    it('locks an agreement used in Rule Master (only Status may change)', async () => {
      const edit = await ctx.api('PUT', `/rent/agreements/${agreement.agreement_id}`, { rentId: rent.rent_id, agreementStatus: 'Individual', components: office('1500', '10', '10') });
      assert.match(edit.body.message, /only made Inactive/);
      assert.equal((await ctx.api('DELETE', `/rent/agreements/${agreement.agreement_id}`)).status, 409);
      assert.equal((await ctx.api('DELETE', `/rent/master/${rent.rent_id}`)).status, 409);
    });

    it('validates waiver ranges and overlaps', async () => {
      const ok = await ctx.api('POST', '/rent/waivers', { rentId: rent.rent_id, fromDate: '01/10/2026', toDate: '30/10/2026', waiverStatus: 'Yes' });
      assert.equal(ok.status, 201);
      const overlap = await ctx.api('POST', '/rent/waivers', { rentId: rent.rent_id, fromDate: '15/10/2026', toDate: '20/11/2026', waiverStatus: 'Yes' });
      assert.match(overlap.body.message, /Overlaps/);
      const pastLed = await ctx.api('POST', '/rent/waivers', { rentId: rent.rent_id, fromDate: '01/11/2026', toDate: '31/12/2026', waiverStatus: 'Yes' });
      assert.match(pastLed.body.message, /after the LED/);
    });
  });

  describe('Rent Schedule', () => {
    it('generates the worked scenario (scope 6.4)', async () => {
      const gen = await ctx.api('POST', '/rent/schedule/generate', { fromDate: '01/01/2026', toDate: '31/12/2026', filters: {} });
      assert.equal(gen.status, 200, gen.body.message);
      const { data } = await lines(`rentId=${rent.rent_id}`);
      const byMonth = Object.fromEntries(data.map((l) => [l.rent_month.slice(0, 7), Number(l.final_amount)]));
      assert.deepEqual(byMonth, {
        '2026-04': 1000, '2026-05': 1150, '2026-06': 1150, '2026-07': 1150, '2026-08': 1150, '2026-09': 1150,
        '2026-10': 37.1, '2026-11': 1150, '2026-12': 37.1,
      });
      const oct = data.find((l) => l.rent_month === '2026-10-01');
      assert.equal(Number(oct.waiver_amount), 1112.9);
      assert.equal(Number(oct.rule_percentage), 15);
    });

    it('refuses a waiver change while its months are generated: delete, change, regenerate', async () => {
      const w = (await ctx.api('GET', `/rent/waivers?rentId=${rent.rent_id}`)).body.data[0];
      const body = { rentId: rent.rent_id, fromDate: '01/10/2026', toDate: '30/10/2026', waiverStatus: 'No' };
      const blocked = await ctx.api('PUT', `/rent/waivers/${w.waiver_id}`, body);
      assert.equal(blocked.status, 400);
      assert.match(blocked.body.message, /Rent Schedule is already generated for RENT\d+ in the months this change affects \(Oct-2026 to Oct-2026/);
      assert.equal((await ctx.api('DELETE', `/rent/waivers/${w.waiver_id}`)).status, 400, 'deleting is refused too');
      assert.equal((await ctx.api('PUT', `/rent/waivers/${w.waiver_id}`, { ...body, waiverStatus: 'Yes' })).status, 200, 'an unchanged save is fine');

      await ctx.api('POST', '/rent/schedule/delete', { fromDate: '01/10/2026', toDate: '31/10/2026', filters: { rentId: [rent.rent_id] } });
      assert.equal((await ctx.api('PUT', `/rent/waivers/${w.waiver_id}`, body)).status, 200);
      assert.equal((await lines(`rentId=${rent.rent_id}&fromDate=01/10/2026&toDate=31/10/2026`)).data.length, 0, 'not regenerated by itself');
      await ctx.api('POST', '/rent/schedule/generate', { fromDate: '01/10/2026', toDate: '31/10/2026', filters: {} });
      const { data } = await lines(`rentId=${rent.rent_id}&fromDate=01/10/2026&toDate=31/10/2026`);
      assert.equal(Number(data[0].final_amount), 1150, 'waiver set to No -> normal rent');
    });

    it('refuses adding or deleting a rule in generated months', async () => {
      const add = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'Normal Day', fromDate: '01/07/2026', toDate: '31/07/2026', percentage: '0' });
      assert.equal(add.status, 400);
      assert.match(add.body.message, /Jul-2026 to Jul-2026/);
      const rule = (await ctx.api('GET', `/rent/rules?rentId=${rent.rent_id}`)).body.data[0];
      const del = await ctx.api('DELETE', `/rent/rules/${rule.rule_id}`);
      assert.equal(del.status, 400);
      assert.match(del.body.message, /May-2026 onward/);
    });

    it('stops at the Inactive End Date, pro-rated', async () => {
      await ctx.api('PUT', `/rent/master/${rent.rent_id}`, { sdId: sd.sd_id, landlordName: 'Venkat', llStatus: 'Inactive', inactiveEndDate: '15/11/2026' });
      const { data } = await lines(`rentId=${rent.rent_id}&fromDate=01/11/2026&toDate=31/12/2026`);
      assert.deepEqual(data.map((l) => [l.rent_month, Number(l.final_amount)]), [['2026-11-01', 575]]);
      await ctx.api('PUT', `/rent/master/${rent.rent_id}`, { sdId: sd.sd_id, landlordName: 'Venkat', llStatus: 'Active' });
      assert.equal((await lines(`rentId=${rent.rent_id}&fromDate=01/12/2026&toDate=31/12/2026`)).data.length, 1, 'back to Active resumes');
    });

    it('filters, summarises and exports', async () => {
      const sum = (await ctx.api('GET', `/rent/schedule/summary?groupBy=component&rentId=${rent.rent_id}`)).body.data;
      assert.equal(sum[0].group_label, 'Rent to Landlord - Office Rent');
      const file = await ctx.download(`/rent/schedule/export?rentId=${rent.rent_id}`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer);
      const ws = wb.getWorksheet('Rent Schedule');
      assert.equal(ws.getCell('A1').value, 'Rent Code');
      assert.equal(ws.getCell('H2').value, 'Rent to Landlord - Office Rent');
    });

    it('transfers the configuration to another landlord from a date', async () => {
      const b = (await ctx.api('POST', '/rent/master', { sdId: sd.sd_id, landlordName: 'New Owner', llStatus: 'Active' })).body.data;
      const t = await ctx.api('POST', '/rent/agreements', {
        rentId: b.rent_id, agreementStatus: 'Transfer', transferFromRentId: rent.rent_id, transferEffectiveDate: '01/11/2026', components: {},
      });
      assert.equal(t.status, 201, t.body.message);
      assert.equal(t.body.data.components.length, 1, 'components copied from the source');
      assert.match(t.body.message, /rule\(s\) copied/);
      await ctx.api('POST', '/rent/schedule/generate', { fromDate: '01/01/2026', toDate: '31/12/2026', filters: {} });
      const src = (await lines(`rentId=${rent.rent_id}`)).data.map((l) => l.rent_month.slice(0, 7));
      const dst = (await lines(`rentId=${b.rent_id}`)).data.map((l) => [l.rent_month.slice(0, 7), Number(l.final_amount)]);
      assert.equal(src[src.length - 1], '2026-10', 'source ends the day before the transfer');
      assert.deepEqual(dst, [['2026-11', 1150], ['2026-12', 37.1]], 'escalated rent continues for the new landlord');
    });
  });

  describe('Bulk upload', () => {
    it('uploads Rent Master rows and reports Success / Rejected with a Remark', async () => {
      const sd2 = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'R-3', floor: '5', rentCommencementDate: '01/01/2027', leaseEndDate: '31/12/2029' }))).body.data;
      const res = await ctx.upload('/rent/master/bulk-upload', [
        HEADERS.master,
        ['', sd2.sd_code, '', '', '', '', '', 'Landlord A', 'Active', ''],
        ['', sd2.sd_code, '', '9', '', '', '', 'Landlord B', 'Active', ''],
        ['', sd2.sd_code, '', '', '', '', '', 'Landlord A', 'Active', ''],
        ['', 'SD999999', '', '', '', '', '', 'Landlord C', 'Inactive', ''],
      ]);
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.data.passed, 1);
      assert.equal(res.body.data.failed, 3);
      const file = await ctx.download(`/uploads/${res.body.data.batchId}/report`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer);
      const ws = wb.worksheets[0];
      assert.deepEqual([2, 3, 4, 5].map((r) => ws.getCell(`C${r}`).value), ['Success', 'Rejected', 'Rejected', 'Rejected']);
      assert.match(String(ws.getCell('F3').value), /Floor does not match/);
      assert.match(String(ws.getCell('F4').value), /Same Cost Center \+ SD Code \+ Floor \+ Landlord Name as row 2/);
    });

    it('uploads waivers with Yes / No Applies to columns and rejects overlaps', async () => {
      // Upload follows the same rule: delete generated months first, regenerate afterwards
      const blocked = await ctx.upload('/rent/waivers/bulk-upload', [HEADERS.waiver, ['', rent.rent_code, '01/06/2026', '30/06/2026', 'Yes', '', ...Array(9).fill('')]]);
      assert.match(blocked.body.data.report[0].error, /Rent Schedule is already generated/);
      await ctx.api('POST', '/rent/schedule/delete', { fromDate: '01/06/2026', toDate: '31/12/2026', filters: {} });
      //            AddlPark Fitouts Cafe CarPark Office Signage Solar Terrace Maint
      const only = (i) => Array.from({ length: 9 }, (_, k) => (k === i ? 'Yes' : ''));
      const res = await ctx.upload('/rent/waivers/bulk-upload', [
        HEADERS.waiver,
        ['', rent.rent_code, '01/06/2026', '30/06/2026', 'Yes', '', ...only(4)],              // Office Rent only
        ['', rent.rent_code, '15/06/2026', '15/07/2026', 'Yes', '', ...only(8)],              // Maintenance only: no clash
        ['', rent.rent_code, '20/06/2026', '25/06/2026', 'Yes', '', ...Array(9).fill('')],    // all components: clashes row 2
        ['', rent.rent_code, '01/08/2026', '31/08/2026', 'Maybe', '', ...Array(9).fill('')],
        ['', rent.rent_code, '01/09/2026', '30/09/2026', 'Yes', '', ...only(4).map((v) => (v ? 'Perhaps' : ''))],
        ['', rent.rent_code, '01/11/2026', '20/11/2026', 'Yes', '', ...Array(9).fill('No')],
      ]);
      assert.equal(res.body.data.passed, 2, JSON.stringify(res.body.data.report.filter((x) => x.status === 'Failed')));
      assert.equal(res.body.data.failed, 4);
      const errors = res.body.data.report.filter((x) => x.status === 'Failed').map((x) => x.error).join(' ');
      assert.match(errors, /must be Yes or No/);
      assert.match(errors, /Select at least one component/);
      const saved = (await ctx.api('GET', `/rent/waivers?rentId=${rent.rent_id}&dateFrom=01/06/2026&dateTo=30/06/2026`)).body.data;
      assert.deepEqual(saved.map((w) => w.component_codes).sort(), [['MAINTENANCE'], ['OFFICE']]);
    });

    it('saves several components on a rule from the screen', async () => {
      const res = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'Normal Day', fromDate: '01/06/2026', toDate: '30/06/2026', percentage: '0', componentCodes: ['OFFICE', 'Cafe'] });
      assert.equal(res.status, 201, res.body.message);
      assert.deepEqual(res.body.data.component_codes, ['CAFE', 'OFFICE']);
      const bad = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'Normal Day', fromDate: '01/06/2026', toDate: '30/06/2026', percentage: '0', componentCodes: ['Gym'] });
      assert.match(bad.body.message, /Component not recognised/);
      await ctx.api('DELETE', `/rent/rules/${res.body.data.rule_id}`);
      await ctx.api('POST', '/rent/schedule/generate', { fromDate: '01/06/2026', toDate: '31/12/2026', filters: {} });
    });
  });

  describe('SD & Rent Transaction Summary Report', () => {
    it('lists SD transactions and Rent Schedule lines together, with filters, totals and summaries', async () => {
      const txn = await ctx.api('POST', '/sd-transactions', {
        sdId: sd.sd_id, sdType: 'Landlord SD', fy: '2026-2027', txnDate: '05/05/2026', agreementStatus: 'LOI', paidAmount: '50000', refundAmount: '',
      });
      assert.equal(txn.status, 201, txn.body.message);
      const report = async (qs) => (await ctx.api('GET', `/reports/sd-rent?pageSize=500&${qs}`)).body;

      const all = await report(`sdId=${sd.sd_id}&dateFrom=01/05/2026&dateTo=31/05/2026`);
      const sdRow = all.data.find((r) => r.source === 'SD');
      assert.equal(sdRow.expense_category, 'Security Deposit');
      assert.equal(sdRow.expense_head, 'Landlord SD');
      assert.equal(Number(sdRow.amount), 50000);
      const rentRow = all.data.find((r) => r.source === 'Rent');
      assert.equal(rentRow.expense_head, 'Rent to Landlord - Office Rent');
      assert.equal(rentRow.expense_category, 'Rent');
      assert.equal(rentRow.rent_code, rent.rent_code);
      assert.equal(Number(all.totals.sd_amount), 50000);
      assert.equal(Number(all.totals.rent_amount), Number(rentRow.amount));

      const onlyRent = await report(`sdId=${sd.sd_id}&expenseHead=Rent to Landlord - Office Rent&dateFrom=01/05/2026&dateTo=31/05/2026`);
      assert.ok(onlyRent.data.length > 0 && onlyRent.data.every((r) => r.source === 'Rent'));
      const byLandlord = await report(`landlordName=New Owner`);
      assert.ok(byLandlord.data.every((r) => r.landlord_name === 'New Owner'));

      const sum = (await ctx.api('GET', `/reports/sd-rent/summary?groupBy=costCenter&sdId=${sd.sd_id}`)).body.data;
      assert.equal(sum[0].group_key, 'Test CC');
      assert.equal(Number(sum[0].sd_amount), 50000);
      const opts = (await ctx.api('GET', '/reports/sd-rent/options')).body.data;
      assert.ok(opts.expenseHeads.includes('Landlord SD') && opts.expenseHeads.includes('Maintenance Charges - Landlord'));

      const file = await ctx.download(`/reports/sd-rent/export?sdId=${sd.sd_id}`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer);
      assert.ok(['SD & Rent Transactions', 'By Cost Center', 'By Landlord', 'By Expense Head'].every((n) => wb.getWorksheet(n)));
    });
  });
});
