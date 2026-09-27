// Cost Center, User and Location Masters, including Excel upload
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, readXlsx } = require('./helpers');

describe('masters', () => {
  let ctx;
  before(async () => { ctx = await setup(); });
  after(async () => { await ctx.close(); });

  describe('cost centers', () => {
    it('generates codes and rejects duplicate names ignoring case', async () => {
      const a = await ctx.api('POST', '/cost-centers', { name: 'Admin Office' });
      assert.equal(a.status, 201);
      assert.match(a.body.data.cost_center_code, /^CC\d{4}$/);
      assert.equal((await ctx.api('POST', '/cost-centers', { name: 'admin office' })).status, 409);
    });

    it('uploads with a row-level report and keeps failed rows out', async () => {
      const res = await ctx.upload('/cost-centers/bulk-upload', [
        ['Cost Center Name', 'Status'],
        ['Upload A', 'Active'],
        ['Upload A', 'Active'],
        ['', 'Active'],
        ['Upload B', 'Maybe'],
        ['Admin Office', ''],
        ['Upload C', ''],
      ]);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.passed, 2);
      assert.equal(res.body.data.failed, 4); // in-file duplicate, blank name, bad status, existing name
      const errors = res.body.data.report.filter((r) => r.status === 'Failed').map((r) => `${r.row}:${r.error}`);
      assert.ok(errors.includes('3:Duplicate of row 2 in this file.'));
      assert.ok(errors.includes('5:Status must be Active or Inactive.'));
      assert.ok(errors.includes('6:Cost Center Name already exists.'));
      const report = await ctx.download(`/uploads/${res.body.data.batchId}/report`);
      assert.equal(report.status, 200);
      assert.ok((await readXlsx(report.buffer)).length >= 5);
    });

    it('rejects files without the required columns, and non-xlsx files', async () => {
      const bad = await ctx.upload('/cost-centers/bulk-upload', [['Name'], ['x']]);
      assert.equal(bad.status, 400);
      assert.match(bad.body.message, /missing required column/);
      const xls = await ctx.upload('/cost-centers/bulk-upload', [['Cost Center Name'], ['x']], ctx.adminToken, 'old.xls');
      assert.equal(xls.status, 400);
    });

    it('searches, filters and exports', async () => {
      assert.equal((await ctx.api('GET', '/cost-centers?search=upload')).body.data.length, 2);
      const exp = await ctx.download('/cost-centers/export?status=Active');
      assert.equal(exp.status, 200);
      assert.equal((await readXlsx(exp.buffer)).length, 3);
      const tpl = await ctx.download('/cost-centers/template');
      assert.match(tpl.headers.get('content-disposition'), /CostCenter_Template/);
    });
  });

  describe('locations', () => {
    let south;
    let north;
    let chennai;
    let site;

    it('keeps names unique within their parent', async () => {
      south = (await ctx.api('POST', '/locations/1', { name: 'South' })).body.data;
      north = (await ctx.api('POST', '/locations/1', { name: 'North' })).body.data;
      assert.match(south.l1_code, /^L1-\d{4}$/);
      assert.equal((await ctx.api('POST', '/locations/1', { name: 'south' })).status, 409);
      chennai = (await ctx.api('POST', '/locations/2', { name: 'Chennai', l1Id: south.l1_id })).body.data;
      assert.equal((await ctx.api('POST', '/locations/2', { name: 'Chennai', l1Id: north.l1_id })).status, 201);
      assert.equal((await ctx.api('POST', '/locations/2', { name: 'CHENNAI', l1Id: south.l1_id })).status, 409);
    });

    it('checks the hierarchy and Active parents', async () => {
      const mismatch = await ctx.api('POST', '/locations/3', { name: 'Guindy', l1Id: north.l1_id, l2Id: chennai.l2_id });
      assert.equal(mismatch.status, 400);
      site = (await ctx.api('POST', '/locations/3', { name: 'Guindy', l1Id: south.l1_id, l2Id: chennai.l2_id })).body.data;
      assert.ok(site.l3_id);
      await ctx.api('PUT', `/locations/1/${north.l1_id}`, { name: 'North', status: 'Inactive' });
      assert.equal((await ctx.api('POST', '/locations/2', { name: 'Delhi', l1Id: north.l1_id })).status, 400);
      await ctx.api('PUT', `/locations/1/${north.l1_id}`, { name: 'North', status: 'Active' });
    });

    it('blocks deleting a parent with children', async () => {
      const del = await ctx.api('DELETE', `/locations/1/${south.l1_id}`);
      assert.equal(del.status, 409);
    });

    it('moves Level 3 records along when their Level 2 moves', async () => {
      assert.equal((await ctx.api('PUT', `/locations/2/${chennai.l2_id}`, { name: 'Chennai Metro', l1Id: north.l1_id, status: 'Active' })).status, 200);
      const l3 = (await ctx.api('GET', `/locations/3?l1Id=${north.l1_id}`)).body.data;
      assert.equal(l3.length, 1);
      assert.equal(l3[0].l3_id, site.l3_id);
    });

    it('uploads Level 2 with parents matched by name', async () => {
      const res = await ctx.upload('/locations/2/bulk-upload', [
        ['Level 1 Name', 'Level 2 Name', 'Status'],
        ['North', 'Pune', ''],
        ['Nowhere', 'X', ''],
        ['North', 'Pune', ''],
        ['South', '', 'Active'],
      ]);
      assert.equal(res.body.data.passed, 1);
      assert.equal(res.body.data.failed, 3);
    });
  });

  describe('users', () => {
    it('deletes users without activity, keeps users with activity', async () => {
      const idle = (await ctx.api('POST', '/users', { userName: 'idle', userEmail: 'idle@example.test', password: 'Idlepass123' })).body.data;
      assert.equal((await ctx.api('DELETE', `/users/${idle.user_id}`)).status, 200);

      const worker = (await ctx.api('POST', '/users', { userName: 'worker', userEmail: 'worker@example.test', password: 'Workpass123' })).body.data;
      await ctx.api('PUT', `/user-rights/${worker.user_id}`, { rights: [{ screenCode: 'LOCATION', canAdd: true }] });
      const token = await ctx.login('worker', 'Workpass123');
      assert.equal((await ctx.api('POST', '/locations/1', { name: 'West' }, token)).status, 201);
      const del = await ctx.api('DELETE', `/users/${worker.user_id}`);
      assert.equal(del.status, 409);
      assert.match(del.body.message, /Mark the user Inactive/);
    });

    it('uploads users with duplicate and format checks', async () => {
      const res = await ctx.upload('/users/bulk-upload', [
        ['User Name', 'User Email ID', 'Password', 'Status'],
        ['u1', 'u1@example.test', '', ''],
        ['u2', 'not-an-email', '', ''],
        ['u1', 'other@example.test', '', ''],
        ['u3', 'u3@example.test', 'weak', ''],
      ]);
      assert.equal(res.body.data.passed, 1);
      assert.equal(res.body.data.failed, 3);
    });
  });
});
