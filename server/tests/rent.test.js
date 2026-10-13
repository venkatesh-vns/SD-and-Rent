// Rent Transaction module: Rent Master, Agreements, Rules, Waivers, Schedule, uploads
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { setup, createMasters, sdBody } = require('./helpers');

const HEADERS = {
  master: ['Rent Code', 'SD Code', 'Cost Center', 'Floor', 'LCD', 'RCD', 'LED', 'Landlord Name', 'LL Status', 'Inactive End Date'],
  waiver: ['Waiver ID', 'Rent Code', 'From Date', 'To Date', 'Waiver Status', 'Component', 'Remark'],
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

    it('regenerates future months automatically when a waiver changes', async () => {
      const w = (await ctx.api('GET', `/rent/waivers?rentId=${rent.rent_id}`)).body.data[0];
      const off = await ctx.api('PUT', `/rent/waivers/${w.waiver_id}`, { rentId: rent.rent_id, fromDate: '01/10/2026', toDate: '30/10/2026', waiverStatus: 'No' });
      assert.equal(off.status, 200);
      const { data } = await lines(`rentId=${rent.rent_id}&fromDate=01/10/2026&toDate=31/10/2026`);
      assert.equal(Number(data[0].final_amount), 1150, 'waiver set to No -> normal rent');
      const runs = (await ctx.api('GET', '/rent/schedule/runs')).body.data;
      assert.match(runs[0].trigger, /^Auto: Waiver Master change/);
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

    it('uploads waivers and rejects overlaps within the file', async () => {
      const res = await ctx.upload('/rent/waivers/bulk-upload', [
        HEADERS.waiver,
        ['', rent.rent_code, '01/06/2026', '30/06/2026', 'Yes', '', ''],
        ['', rent.rent_code, '15/06/2026', '15/07/2026', 'Yes', '', ''],
        ['', rent.rent_code, '01/08/2026', '31/08/2026', 'Maybe', '', ''],
      ]);
      assert.equal(res.body.data.passed, 1);
      assert.equal(res.body.data.failed, 2);
    });
  });
});
