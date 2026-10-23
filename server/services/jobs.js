/**
 * Scheduled jobs, run by the one web worker that also sends the reminders
 * (RUN_REMINDERS=true):
 *  - nightly database backup at BACKUP_TIME (default 01:30) unless BACKUP_ENABLED=false
 *  - daily housekeeping at 02:30: ended login sessions older than SESSION_KEEP_DAYS
 *    (365), used / expired password-reset links older than 30 days, monitoring log
 *    files older than 12 months. Business data and the audit log are never deleted.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const backup = require('./backupService');
const { logDir } = require('../utils/metrics');

// Runs fn every day at 'HH:MM' (local time)
function daily(time, fn) {
  const [h, m] = String(time).split(':').map(Number);
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, m || 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(async () => {
      try { await fn(); } catch (err) { console.error(`Scheduled job failed: ${err.message}`); }
      schedule();
    }, next - now).unref();
  };
  schedule();
}

async function housekeeping() {
  const keepDays = Number(process.env.SESSION_KEEP_DAYS) || 365;
  const sessions = await pool.query(`DELETE FROM user_sessions WHERE ended_at < NOW() - make_interval(days => $1)`, [keepDays]);
  const tokens = await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW() - interval '30 days'`);
  let logs = 0;
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    const limit = cutoff.toISOString().slice(0, 7);
    fs.readdirSync(logDir()).filter((f) => /-(\d{4}-\d{2})\.log$/.test(f) && f.match(/-(\d{4}-\d{2})\.log$/)[1] < limit)
      .forEach((f) => { fs.rmSync(path.join(logDir(), f), { force: true }); logs += 1; });
  } catch { /* no log folder yet */ }
  return { sessions: sessions.rowCount, resetLinks: tokens.rowCount, logFiles: logs };
}

function startJobs() {
  if (process.env.BACKUP_ENABLED !== 'false') {
    const time = process.env.BACKUP_TIME || '01:30';
    daily(time, async () => {
      const r = await backup.runBackup({ reason: 'Nightly', by: 'system' });
      console.log(`Nightly backup: ${r.ok ? `OK, ${r.file_path}` : `FAILED - ${r.message}`}`);
    });
    console.log(`Nightly database backup at ${time} to ${backup.backupDir()}`);
  }
  daily('02:30', async () => console.log('Housekeeping:', JSON.stringify(await housekeeping())));
}

module.exports = { startJobs, housekeeping };
