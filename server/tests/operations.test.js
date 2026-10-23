// Operations: response cache with change notifications, account lockout,
// System Health, database backup and backup retention
process.env.CACHE_ENABLED = 'true'; // the other test files run without the cache
const fs = require('fs');
const os = require('os');
const path = require('path');

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-backup-test-'));
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-log-test-'));
process.env.BACKUP_DIR = backupDir;
process.env.LOG_DIR = logDir;

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createMasters, sdBody } = require('./helpers');

describe('operations', () => {
  let ctx;
  let sd;
  const get = async (url) => {
    const res = await fetch(ctx.base + url, { headers: { Authorization: `Bearer ${ctx.adminToken}` } });
    return { cache: res.headers.get('x-cache'), body: await res.json() };
  };
  const waitFor = async (check, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 50)); }
    return false;
  };

  before(async () => {
    ctx = await setup();
    const m = await createMasters(ctx);
    sd = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'OPS-1', agreementValue: '100000' }))).body.data;
  });
  after(async () => {
    await require('../utils/cache').stop();
    await ctx.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('caches the dashboard and drops it as soon as the data changes (also from elsewhere)', async () => {
    await get('/lookups/cost-centers'); // starts the change listener
    assert.ok(await waitFor(async () => (await get('/dashboard')).cache !== 'BYPASS'), 'listener connected');
    const first = await get('/dashboard');
    const second = await get('/dashboard');
    assert.equal(second.cache, 'HIT');
    assert.deepEqual(second.body.data.kpi, first.body.data.kpi);

    // A change made outside this server (e.g. another web worker): the database notifies
    await ctx.pool.query(
      `INSERT INTO sd_transactions (sd_id, sd_type, fy, txn_date, agreement_status, paid_amount) VALUES ($1, 'Landlord SD', '2025-2026', '2025-06-01', 'Agreement', 5000)`,
      [sd.sd_id]
    );
    assert.ok(await waitFor(async () => {
      const r = await get('/dashboard');
      return r.cache === 'MISS' && Number(r.body.data.kpi.paid) === 5000;
    }), 'fresh figures after the change');

    // A change through this server clears its cache at once
    assert.equal((await get('/dashboard')).cache, 'HIT');
    const txn = await ctx.api('POST', '/sd-transactions', { sdId: sd.sd_id, sdType: 'Landlord SD', fy: '2025-2026', txnDate: '02/06/2025', agreementStatus: 'Agreement', paidAmount: '1000' });
    assert.equal(txn.status, 201, txn.body.message);
    const after = await get('/dashboard');
    assert.equal(after.cache, 'MISS');
    assert.equal(Number(after.body.data.kpi.paid), 6000);
  });

  it('locks an account after 5 wrong passwords; an administrator reset unlocks it', async () => {
    const created = await ctx.api('POST', '/users', { userName: 'locky', userEmail: 'locky@example.test', password: 'Lockpass123' });
    const id = created.body.data.user_id;
    const login = (password) => ctx.api('POST', '/auth/login', { userName: 'locky', password }, null);
    for (let i = 1; i <= 4; i += 1) assert.equal((await login('wrong')).status, 401, `attempt ${i}`);
    const fifth = await login('wrong');
    assert.equal(fifth.status, 423);
    assert.match(fifth.body.message, /locked for 15 minutes/);
    const right = await login('Lockpass123');
    assert.equal(right.status, 423, 'even the right password waits');
    assert.match(right.body.message, /Try again in 15 minute/);
    assert.equal((await ctx.pool.query("SELECT 1 FROM audit_log WHERE action = 'LOGIN_LOCKED'")).rows.length, 1);
    const list = (await ctx.api('GET', '/users')).body.data.find((u) => u.user_id === id);
    assert.ok(list.locked_until, 'User Master shows the lock');

    assert.equal((await ctx.api('PUT', `/users/${id}/password`, { newPassword: 'Newpass1234' })).status, 200);
    assert.equal((await login('Newpass1234')).status, 200);
  });

  it('shows System Health to administrators only', async () => {
    const res = await ctx.api('GET', '/system/health');
    assert.equal(res.status, 200);
    const h = res.body.data;
    assert.ok(h.app.workers[0].routes.some((r) => r.route === 'GET /api/dashboard'));
    assert.ok(h.app.workers[0].cache.hits >= 1);
    assert.ok(h.database.pingMs >= 0 && h.database.cacheHitPercent > 0);
    assert.equal(h.database.business.sd_records, 1);
    assert.ok(h.database.tables.length > 0);
    assert.ok(h.sessions.open >= 1);
    const clerk = await ctx.api('POST', '/users', { userName: 'viewer', userEmail: 'viewer@example.test', password: 'Viewpass123' });
    assert.equal(clerk.status, 201);
    const token = await ctx.login('viewer', 'Viewpass123');
    assert.equal((await ctx.api('GET', '/system/health', undefined, token)).status, 403);
    assert.equal((await ctx.api('POST', '/system/backup', undefined, token)).status, 403);
  });

  it('backs up the database, verifies the file and keeps the retention', async () => {
    const res = await ctx.api('POST', '/system/backup');
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.verified, true);
    assert.ok(fs.existsSync(res.body.data.file_path));
    assert.ok(res.body.data.size_bytes > 10000);
    const status = (await ctx.api('GET', '/system/health')).body.data.backups;
    assert.equal(status.lastGood.backup_id, res.body.data.backup_id);

    // Retention: 14 daily + newest per month for 12 months
    const { prune } = require('../services/backupService');
    const prefix = `${process.env.DB_NAME}_`;
    for (let d = 1; d <= 20; d += 1) fs.writeFileSync(path.join(backupDir, `${prefix}202609${String(d).padStart(2, '0')}_013000.dump`), 'x');
    fs.writeFileSync(path.join(backupDir, `${prefix}20250115_013000.dump`), 'x');
    prune();
    const left = fs.readdirSync(backupDir).filter((f) => f.endsWith('.dump'));
    assert.ok(left.includes(`${prefix}20250115_013000.dump`), 'monthly copy kept');
    assert.ok(!left.includes(`${prefix}20260901_013000.dump`), 'old daily copy removed');
    assert.equal(left.length, 14 + 1);
  });
});
