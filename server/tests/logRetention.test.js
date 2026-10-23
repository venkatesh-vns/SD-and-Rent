// Log retention: entries older than 5 months are archived (gzip JSON lines,
// checked) and removed; recent entries, reminders for coming lease dates and
// all business data stay
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-archive-test-'));
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-logs-test-'));
process.env.LOG_ARCHIVE_DIR = archiveDir;
process.env.LOG_DIR = logDir;

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, createMasters, sdBody } = require('./helpers');

const readArchive = (file) => zlib.gunzipSync(fs.readFileSync(path.join(archiveDir, file))).toString().trim().split('\n').map((l) => JSON.parse(l));

describe('log retention', () => {
  let ctx;
  const count = async (sql, params) => Number((await ctx.pool.query(sql, params)).rows[0].n);
  const business = () => ctx.pool.query(`SELECT (SELECT COUNT(*) FROM sd_master)::int AS sd, (SELECT COUNT(*) FROM sd_transactions)::int AS txn,
    (SELECT COUNT(*) FROM cost_centers)::int AS cc, (SELECT COUNT(*) FROM sd_status_history)::int AS hist, (SELECT COUNT(*) FROM users)::int AS users`).then((r) => r.rows[0]);

  before(async () => {
    ctx = await setup();
    const m = await createMasters(ctx);
    const sd = (await ctx.api('POST', '/sd-master', sdBody(m, { leaseId: 'RET-1' }))).body.data;
    await ctx.api('POST', '/sd-transactions', { sdId: sd.sd_id, sdType: 'Landlord SD', fy: '2025-2026', txnDate: '01/06/2025', agreementStatus: 'Agreement', paidAmount: '1000' });
    const old = "NOW() - interval '7 months'";
    const q = (sql) => ctx.pool.query(sql);
    await q(`INSERT INTO audit_log (table_name, record_id, action, action_by, action_date, details)
             SELECT 'sd_master', g, 'UPDATE', 'old', ${old}, 'old ' || g FROM generate_series(1, 3) g`);
    // email: an old reminder for a past date (goes), an old reminder for a date still to come (stays),
    // an old failed email (goes), a recent one (stays)
    await q(`INSERT INTO email_log (sd_code, notification_type, recipient, subject, trigger_event, status, sent_at) VALUES
      ('SD000001', 'LEASE_END', 'a@x.test', 'old past', 'Lease End ' || to_char(NOW() - interval '6 months', 'DD/MM/YYYY'), 'Sent', ${old}),
      ('SD000001', 'LEASE_END', 'a@x.test', 'old future', 'Lease End ' || to_char(NOW() + interval '2 months', 'DD/MM/YYYY'), 'Sent', ${old}),
      ('SD000001', 'LEASE_END', 'a@x.test', 'old failed', 'Lease End ' || to_char(NOW() + interval '2 months', 'DD/MM/YYYY'), 'Failed', ${old}),
      ('SD000001', 'LEASE_END', 'a@x.test', 'recent', 'Lease End ' || to_char(NOW() + interval '1 month', 'DD/MM/YYYY'), 'Sent', NOW())`);
    await q(`INSERT INTO upload_batches (screen_code, file_name, total_rows, passed_rows, failed_rows, report, uploaded_by, uploaded_date)
             VALUES ('SD_MASTER', 'old.xlsx', 1, 1, 0, '[]', 'old', ${old}), ('SD_MASTER', 'new.xlsx', 1, 1, 0, '[]', 'new', NOW())`);
    await q(`INSERT INTO user_sessions (session_id, user_id, started_at, last_seen_at, last_activity_at, ended_at, end_reason)
             SELECT gen_random_uuid(), user_id, ${old}, ${old}, ${old}, ${old}, 'Logged out' FROM users WHERE user_name = 'admin'`);
    await q(`INSERT INTO backup_runs (reason, started_at, ok) VALUES ('Nightly', ${old}, TRUE)`);
    await q(`INSERT INTO password_reset_tokens (user_id, token, expires_at, created_date) SELECT user_id, 'oldtoken', ${old}, ${old} FROM users WHERE user_name = 'admin'`);
    fs.writeFileSync(path.join(logDir, 'slow-requests-2025-01.log'), '{"old":true}\n');
    fs.writeFileSync(path.join(logDir, `slow-requests-${new Date().toISOString().slice(0, 7)}.log`), '{"current":true}\n');
  });
  after(async () => {
    await ctx.close();
    fs.rmSync(archiveDir, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('archives and removes log entries older than 5 months, keeping everything else', async () => {
    const before = await business();
    const recentAudit = await count(`SELECT COUNT(*) AS n FROM audit_log WHERE action_date > NOW() - interval '5 months'`);

    const res = await ctx.api('POST', '/system/log-retention');
    assert.equal(res.status, 200, res.body.message);
    const run = res.body.data;
    assert.equal(run.ok, true);
    const by = Object.fromEntries(run.details.tables.map((t) => [t.table, t]));
    assert.equal(by.audit_log.deleted, 3);
    assert.equal(by.email_log.deleted, 2, 'old past-date reminder and old failed email');
    assert.equal(by.upload_batches.deleted, 1);
    assert.equal(by.user_sessions.deleted, 1);
    assert.equal(by.backup_runs.deleted, 1);
    assert.equal(run.details.resetLinks, 1);
    assert.equal(run.details.logFiles, 1);
    assert.match(res.body.message, /8 log entries older than 5 months archived and removed/);

    // Kept: recent entries and the reminder for a lease date still to come
    assert.equal(await count(`SELECT COUNT(*) AS n FROM audit_log WHERE details LIKE 'old %'`), 0);
    assert.ok(await count(`SELECT COUNT(*) AS n FROM audit_log`) >= recentAudit);
    assert.deepEqual((await ctx.pool.query('SELECT subject FROM email_log ORDER BY subject')).rows.map((r) => r.subject), ['old future', 'recent']);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM upload_batches WHERE file_name = 'new.xlsx'`), 1);
    assert.ok(await count(`SELECT COUNT(*) AS n FROM user_sessions WHERE ended_at IS NULL`) >= 1, 'live sessions untouched');

    // Business data unchanged
    assert.deepEqual(await business(), before);

    // Archives hold exactly the removed rows
    const auditFile = by.audit_log.file;
    assert.ok(auditFile && fs.existsSync(path.join(archiveDir, auditFile)));
    assert.deepEqual(readArchive(auditFile).map((r) => r.details).sort(), ['old 1', 'old 2', 'old 3']);
    assert.deepEqual(readArchive(by.email_log.file).map((r) => r.subject).sort(), ['old failed', 'old past']);
    assert.ok(fs.existsSync(path.join(archiveDir, 'monitoring-logs', 'slow-requests-2025-01.log')), 'old monitoring log moved');
    assert.ok(fs.readdirSync(logDir).some((f) => f.startsWith('slow-requests-20') && !f.includes('2025-01')), 'current monitoring log stays');
  });

  it('finds nothing the second time, and shows the policy in System Health', async () => {
    const again = await ctx.api('POST', '/system/log-retention');
    assert.equal(again.status, 200);
    assert.match(again.body.message, /No log entries older than 5 months/);
    const h = (await ctx.api('GET', '/system/health')).body.data.logRetention;
    assert.equal(h.months, 5);
    assert.ok(h.files >= 5);
    assert.equal(h.runs.length, 2);
  });

  it('is for administrators only', async () => {
    assert.equal((await ctx.api('POST', '/users', { userName: 'clerk', userEmail: 'clerk@example.test', password: 'Clerkpass123' })).status, 201);
    const token = await ctx.login('clerk', 'Clerkpass123');
    assert.equal((await ctx.api('POST', '/system/log-retention', undefined, token)).status, 403);
  });
});
