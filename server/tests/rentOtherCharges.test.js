// "Rent Other Charges" component: Rate / Month x %, from the RCD (like Solar),
// with rules, waivers, the Rent Schedule and Excel templates
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { setup, createMasters, sdBody } = require('./helpers');

describe('Rent Other Charges component', () => {
  let ctx;
  let rent;
  const headersOf = async (url) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await ctx.download(url)).buffer);
    return wb.worksheets[0].getRow(1).values.slice(1);
  };

  before(async () => {
    ctx = await setup();
    const m = await createMasters(ctx);
    // LCD 01/01/2026, RCD 01/04/2026, LED 01/12/2026
    const sd = (await ctx.api('POST', '/sd-master', sdBody(m, {
      leaseId: 'OC-1', floor: '5', landlordName: 'Owner', leaseCommencementDate: '01/01/2026', rentCommencementDate: '01/04/2026', leaseEndDate: '01/12/2026',
    }))).body.data;
    rent = (await ctx.api('POST', '/rent/master', { sdId: sd.sd_id, landlordName: 'Owner', llStatus: 'Active' })).body.data;
  });
  after(async () => { await ctx.close(); });

  it('is saved on a Rent Agreement with Rate and %, like Solar (no quantity)', async () => {
    const missingPct = await ctx.api('POST', '/rent/agreements', { rentId: rent.rent_id, agreementStatus: 'Individual', components: { OTHER_CHARGES: { rate: '2000' } } });
    assert.equal(missingPct.status, 400);
    assert.match(missingPct.body.message, /Rent Other Charges: % is required/);

    const res = await ctx.api('POST', '/rent/agreements', {
      rentId: rent.rent_id, agreementStatus: 'Individual',
      components: { OFFICE: { quantity: '1000', rate: '10', percentage: '100' }, OTHER_CHARGES: { rate: '2000', percentage: '50' } },
    });
    assert.equal(res.status, 201, res.body.message);
    const other = res.body.data.components.find((c) => c.component_code === 'OTHER_CHARGES');
    assert.equal(other.quantity, null);
    assert.equal(Number(other.rate), 2000);
    assert.equal(Number(other.percentage), 50);
  });

  it('can be chosen in Rule Master and Waiver Master', async () => {
    const rule = await ctx.api('POST', '/rent/rules', { rentId: rent.rent_id, ruleType: 'RCD', escalationMonths: '2', percentage: '10', componentCodes: ['Other Charges'] });
    assert.equal(rule.status, 201, rule.body.message);
    assert.deepEqual(rule.body.data.component_codes, ['OTHER_CHARGES']);
    assert.equal(rule.body.data.effective_date, '2026-06-01');
    const waiver = await ctx.api('POST', '/rent/waivers', { rentId: rent.rent_id, fromDate: '01/09/2026', toDate: '30/09/2026', waiverStatus: 'Yes', componentCodes: ['OTHER_CHARGES'] });
    assert.equal(waiver.status, 201, waiver.body.message);
  });

  it('is generated in the Rent Schedule from the RCD, with escalation and waiver', async () => {
    assert.equal((await ctx.api('POST', '/rent/schedule/generate', { fromDate: '01/01/2026', toDate: '31/12/2026', filters: {} })).status, 200);
    const { data } = (await ctx.api('GET', `/rent/schedule?pageSize=500&rentId=${rent.rent_id}&componentCode=OTHER_CHARGES`)).body;
    const byMonth = Object.fromEntries(data.map((l) => [l.rent_month.slice(0, 7), Number(l.final_amount)]));
    assert.deepEqual(byMonth, {
      '2026-04': 1000, '2026-05': 1000,                                   // 2000 x 50% from the RCD (not the LCD)
      '2026-06': 1100, '2026-07': 1100, '2026-08': 1100,                  // +10% from June
      '2026-09': 0,                                                       // waived
      '2026-10': 1100, '2026-11': 1100, '2026-12': 35.48,                 // 1 day of December (to the LED)
    });
    const office = (await ctx.api('GET', `/rent/schedule?pageSize=500&rentId=${rent.rent_id}&componentCode=OFFICE&fromDate=01/06/2026&toDate=30/09/2026`)).body.data;
    assert.ok(office.every((l) => Number(l.final_amount) === 10000), 'the rule and waiver apply to Other Charges only');

    const sum = (await ctx.api('GET', `/rent/schedule/summary?groupBy=component&rentId=${rent.rent_id}`)).body.data;
    assert.ok(sum.some((s) => s.group_label === 'Rent Other Charges'));
    const report = (await ctx.api('GET', `/reports/sd-rent?pageSize=500&expenseHead=Rent Other Charges`)).body;
    assert.ok(report.data.length > 0 && report.data.every((r) => r.expense_category === 'Rent'));
  });

  it('has its columns in the Excel templates', async () => {
    const agreement = await headersOf('/rent/agreements/template');
    assert.ok(agreement.includes('Other Charges Rate / Month') && agreement.includes('Other Charges %'), agreement.join(', '));
    assert.ok((await headersOf('/rent/rules/template')).includes('Applies to: Other Charges'));
    assert.ok((await headersOf('/rent/waivers/template')).includes('Applies to: Other Charges'));
  });
});
