// SD Master and SD Transactions: validation, calculations, uploads
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, readXlsx, createMasters, sdBody } = require('./helpers');

const SD_HEADERS = ['SD Code', 'Lease ID', 'Agreement No.', 'Cost Center', 'Location Level 1', 'Location Level 2', 'Location Level 3',
  'Landlord Name', 'Landlord Status', 'Building Status', 'Floor', 'Agreement Value',
  'Lease Commencement Date', 'Rent Commencement Date', 'Lease End Date'];
const TXN_HEADERS = ['Transaction No.', 'SD Code', 'SD Type', 'FY', 'SD Transaction Date', 'Agreement Status',
  'SD Paid Amount', 'SD Transfer Amount', 'SD Adjustment Amount', 'SD Refund Amount', 'Remarks'];

describe('SD Master and transactions', () => {
  let ctx;
  let m;
  let sd;

  before(async () => {
    ctx = await setup();
    m = await createMasters(ctx);
  });
  after(async () => { await ctx.close(); });

  // Full form body for the main record (a form save replaces every field)
  const sdFull = (o = {}) => sdBody(m, {
    leaseId: 'L-1', agreementNo: 'AG-1', agreementValue: '1000000',
    leaseCommencementDate: '01/04/2024', leaseEndDate: '31/03/2029', ...o,
  });

  const txn = (o) => ctx.api('POST', '/sd-transactions', {
    sdId: sd.sd_id, sdType: 'Landlord SD', fy: '2024-2025', agreementStatus: 'Registered Agreement', ...o,
  });

  describe('SD Master', () => {
    it('creates with an SD Code and stores dates and amounts exactly', async () => {
      const res = await ctx.api('POST', '/sd-master', sdBody(m, {
        leaseId: 'L-1', agreementNo: 'AG-1', agreementValue: '10,00,000', leaseCommencementDate: '01/04/2024', leaseEndDate: '31/03/2029',
      }));
      assert.equal(res.status, 201);
      sd = res.body.data;
      assert.match(sd.sd_code, /^SD\d{6}$/);
      assert.equal(sd.lease_commencement_date, '2024-04-01');
      assert.equal(Number(sd.agreement_value), 1000000);
    });

    it('rejects the same Cost Center, Location, Floor, Landlord, Lease ID and Agreement No.', async () => {
      const first = (await ctx.api('GET', `/sd-master/${sd.sd_id}`)).body.data;
      const same = { leaseId: 'l-1', agreementNo: 'ag-1', floor: first.floor, landlordName: first.landlord_name || '' };
      const dup = await ctx.api('POST', '/sd-master', sdBody(m, same));
      assert.equal(dup.status, 400);
      assert.match(dup.body.message, /same Lease ID and Agreement No already exist for the selected Cost Center, Floor, Location, and Landlord Name/);
      // Allowed when the Floor or the Landlord Name differs; saved as entered
      for (const change of [{ floor: 'Other floor' }, { landlordName: 'Another Landlord' }]) {
        const ok = await ctx.api('POST', '/sd-master', sdBody(m, { ...same, ...change }));
        assert.equal(ok.status, 201, JSON.stringify(change));
        assert.equal(ok.body.data.lease_id, 'l-1');
        assert.equal(ok.body.data.agreement_no, 'ag-1');
        // Editing a record into a duplicate is refused too
        if (change.floor) {
          const edit = await ctx.api('PUT', `/sd-master/${ok.body.data.sd_id}`, sdBody(m, same));
          assert.equal(edit.status, 400);
        }
        await ctx.api('DELETE', `/sd-master/${ok.body.data.sd_id}`);
      }
      assert.equal((await ctx.api('POST', '/sd-master', sdBody(m))).status, 201, 'blank Lease ID and Agreement No.');
    });

    it('reports every invalid field at once', async () => {
      const res = await ctx.api('POST', '/sd-master', sdBody(m, {
        leaseId: 'L-2', agreementValue: 'abc', leaseCommencementDate: '31/02/2024', floor: '', landlordStatus: 'Gone', l3Id: 999999,
      }));
      assert.equal(res.status, 400);
      const fields = res.body.errors.map((e) => e.field);
      ['Floor', 'Landlord Status', 'Agreement Value', 'Lease Commencement Date', 'Location Level 3'].forEach((f) => assert.ok(fields.includes(f), f));
      const order = await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'L-3', leaseCommencementDate: '01/04/2024', leaseEndDate: '01/01/2020' }));
      assert.match(order.body.message, /cannot be before/);
    });

    it('records Landlord / Building status history', async () => {
      await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdFull({ buildingStatus: 'Passive' }));
      const one = (await ctx.api('GET', `/sd-master/${sd.sd_id}`)).body.data;
      assert.equal(one.statusHistory.length, 1);
      assert.equal(one.statusHistory[0].status_type, 'Building');
      await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdFull());
    });

    it('protects cost centers and locations that SD records use', async () => {
      assert.equal((await ctx.api('DELETE', `/cost-centers/${m.cc.cost_center_id}`)).status, 409);
      assert.equal((await ctx.api('DELETE', `/locations/3/${m.l3.l3_id}`)).status, 409);
    });

    it('uploads new rows and bulk-updates by SD Code (blank cells keep values)', async () => {
      const res = await ctx.upload('/sd-master/bulk-upload', [
        SD_HEADERS,
        ['', 'U-1', 'AG-U1', m.cc.cost_center_code, 'Region', 'City', 'Site', 'Owner', 'active', 'Active', 'G', '250000', new Date(Date.UTC(2025, 0, 15)), '', ''],
        ['', 'U-1', 'AG-U1', 'Test CC', 'Region', 'City', 'Site', '', 'Active', 'Active', 'G', '1000', '', '', ''],
        ['', 'U-4', '', 'CC9999', 'Region', 'City', 'Nowhere', '', 'Active', 'ABC', '2', '-5', '32/01/2025', '', ''],
        [sd.sd_code, '', '', '', '', '', '', '', '', '', '', '1200000', '', '', ''],
        ['SD999999', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ]);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.passed, 3, 'the repeated Lease ID + Agreement No. is allowed');
      assert.equal(res.body.data.failed, 2);
      assert.equal((await ctx.api('GET', '/sd-master?search=AG-U1')).body.total, 2);
      const u1 = (await ctx.api('GET', '/sd-master?search=U-1')).body.data.find((r) => Number(r.agreement_value) === 250000);
      assert.equal(u1.lease_commencement_date, '2025-01-15', 'real Excel date cell');
      const updated = (await ctx.api('GET', `/sd-master/${sd.sd_id}`)).body.data;
      assert.equal(Number(updated.agreement_value), 1200000);
      assert.equal(updated.lease_id, 'L-1');
      await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdFull());
    });

    it('exports in the template layout with DD/MM/YYYY dates', async () => {
      const exp = await ctx.download('/sd-master/export?search=L-1');
      const rows = await readXlsx(exp.buffer);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]['Lease Commencement Date'], '01/04/2024');
      assert.equal(rows[0]['Cost Center'], 'Test CC', 'cost center shown by name');
    });
  });

  describe('SD Transactions', () => {
    it('calculates SD Balance and Repayable, running by date', async () => {
      assert.equal((await txn({ txnDate: '01/04/2024', paidAmount: '6,00,000' })).status, 201);
      assert.equal((await txn({ txnDate: '01/06/2024', paidAmount: '300000' })).status, 201);
      assert.equal((await txn({ txnDate: '01/01/2025', refundAmount: '100000' })).status, 201);
      const adj = await txn({ txnDate: '01/02/2025', adjustmentAmount: '50000', sdType: 'cam sd' });
      assert.equal(adj.body.data.sd_type, 'CAM SD');
      const b = (await ctx.api('GET', `/sd-transactions/summary/${sd.sd_id}`)).body.data.balance;
      assert.equal(Number(b.sd_balance), 100000);
      assert.equal(Number(b.sd_balance_repayable), 750000);
      const rows = (await ctx.api('GET', `/sd-transactions?sdId=${sd.sd_id}`)).body.data;
      assert.deepEqual(rows.map((r) => [r.txn_date, Number(r.running_sd_balance), Number(r.running_repayable)]), [
        ['2024-04-01', 400000, 600000], ['2024-06-01', 100000, 900000],
        ['2025-01-01', 100000, 800000], ['2025-02-01', 100000, 750000],
      ]);
    });

    it('stops SD Paid above the Agreement Value (running total)', async () => {
      const over = await txn({ txnDate: '01/03/2025', paidAmount: '100000.01' });
      assert.equal(over.status, 400);
      assert.match(over.body.message, /exceed Agreement Value/);
      assert.equal((await txn({ txnDate: '01/03/2025', paidAmount: '100000' })).status, 201);
      const lower = await ctx.api('PUT', `/sd-master/${sd.sd_id}`, sdFull({ agreementValue: '999999' }));
      assert.match(lower.body.message, /cannot be less than the total SD Paid/);
    });

    it('never lets Repayable go below zero, including on edit and delete', async () => {
      assert.match((await txn({ txnDate: '15/03/2024', refundAmount: '1' })).body.message, /Repayable would be -1.00/);
      const small = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'S-1', agreementValue: '1000' }))).body.data;
      const pay = (await txn({ sdId: small.sd_id, txnDate: '01/04/2024', paidAmount: '500' })).body.data;
      await txn({ sdId: small.sd_id, txnDate: '02/04/2024', refundAmount: '500' });
      assert.equal((await ctx.api('DELETE', `/sd-transactions/${pay.txn_id}`)).status, 400);
      const moved = await ctx.api('PUT', `/sd-transactions/${pay.txn_id}`, { sdType: 'Landlord SD', fy: '2024-2025', agreementStatus: 'LOI', txnDate: '03/04/2024', paidAmount: '500' });
      assert.equal(moved.status, 400);
    });

    it('validates fields and blocks Passive SD Codes', async () => {
      const bad = await txn({ txnDate: '31/02/2025', fy: '2024-2026', sdType: 'X', agreementStatus: '', paidAmount: 'abc' });
      assert.equal(bad.body.errors.length, 5);
      assert.match((await txn({ txnDate: '01/03/2025' })).body.message, /at least one/);
      const passive = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'P-1', landlordStatus: 'Passive' }))).body.data;
      assert.match((await txn({ sdId: passive.sd_id, txnDate: '01/04/2024', paidAmount: '1' })).body.message, /Passive/);
      assert.equal((await ctx.api('DELETE', `/sd-master/${sd.sd_id}`)).status, 409, 'SD with transactions');
    });

    it('uploads transactions, checking each SD ledger row by row', async () => {
      const other = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'T-2', agreementValue: '200000' }))).body.data;
      const existing = (await ctx.api('GET', `/sd-transactions?sdId=${sd.sd_id}`)).body.data[0];
      const res = await ctx.upload('/sd-transactions/bulk-upload', [
        TXN_HEADERS,
        ['', other.sd_code, 'Landlord SD', '2024-2025', '01/05/2024', 'LOI', '150000', '', '', '', ''],
        ['', other.sd_code, 'Electricity SD', '2024-2025', '10/05/2024', 'agreement', '50000', '', '', '', ''],
        ['', other.sd_code, 'Landlord SD', '2024-2025', '20/05/2024', 'LOI', '1', '', '', '', 'over by one'],
        ['', other.sd_code, 'Landlord SD', '2024-2025', '21/05/2024', 'LOI', '', '20000', '', '', 'Transferred to SD000099'],
        [existing.txn_no, '', '', '', '', '', '', '', '', '', 'bulk remark'],
        [existing.txn_no, other.sd_code, '', '', '', '', '', '', '', '', ''],
        ['TXN9999999', '', '', '', '', '', '', '', '', '', ''],
      ]);
      assert.equal(res.body.data.passed, 4);
      assert.equal(res.body.data.failed, 3);
      const overRow = res.body.data.report.find((r) => r.row === 4);
      assert.match(overRow.error, /includes 2 earlier row/);
      const b = (await ctx.api('GET', `/sd-transactions/summary/${other.sd_id}`)).body.data.balance;
      assert.equal(Number(b.sd_balance_repayable), 180000);
      const kept = (await ctx.api('GET', `/sd-transactions/${existing.txn_id}`)).body.data;
      assert.equal(kept.remarks, 'bulk remark');
      assert.equal(Number(kept.paid_amount), Number(existing.paid_amount));
    });

    it('filters by date range and exports with running balances', async () => {
      assert.equal((await ctx.api('GET', '/sd-transactions?dateFrom=01/05/2024&dateTo=31/05/2024')).body.total, 3);
      const rows = await readXlsx((await ctx.download(`/sd-transactions/export?sdId=${sd.sd_id}`)).buffer);
      assert.equal(rows.length, 5);
      assert.equal(rows[0]['SD Transaction Date'], '01/04/2024');
      assert.equal(rows[0]['SD Balance Repayable (running)'], 600000);
    });

    it('multi-select filters match any of the chosen values', async () => {
      const count = async (qs) => (await ctx.api('GET', `/sd-transactions?${qs}`)).body.total;
      const landlord = await count('sdType=Landlord%20SD');
      const cam = await count('sdType=CAM%20SD');
      assert.ok(landlord > 0 && cam > 0);
      assert.equal(await count('sdType=Landlord%20SD,CAM%20SD'), landlord + cam, 'comma-separated');
      assert.equal(await count('sdType=Landlord%20SD&sdType=CAM%20SD'), landlord + cam, 'repeated parameter');
      assert.equal(await count('fy=2024-2025,2099-2100'), await count('fy=2024-2025'));

      const sdTotal = async (qs) => (await ctx.api('GET', `/sd-master?${qs}`)).body.total;
      const all = await sdTotal('');
      assert.equal(await sdTotal('landlordStatus=Active,Passive'), all);
      assert.equal(await sdTotal(`costCenterId=${m.cc.cost_center_id},999999`), await sdTotal(`costCenterId=${m.cc.cost_center_id}`));
      assert.equal(await sdTotal('costCenterId=abc'), all, 'non-numeric ids are ignored');
      const report = (await ctx.api('GET', '/reports/sd-balance?buildingStatus=Active,Passive')).body.totals.count;
      assert.equal(report, all);
    });
  });
});
