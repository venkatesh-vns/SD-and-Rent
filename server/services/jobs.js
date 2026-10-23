/**
 * Scheduled jobs, run by the one web worker that also sends the reminders
 * (RUN_REMINDERS=true):
 *  - nightly database backup at BACKUP_TIME (default 01:30) unless BACKUP_ENABLED=false
 *  - nightly log retention at LOG_RETENTION_TIME (default 02:30): log entries older
 *    than LOG_RETENTION_MONTHS (5) are archived and removed (services/logRetention.js).
 *    Business data is never touched.
 */
const backup = require('./backupService');
const retention = require('./logRetention');

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

function startJobs() {
  if (process.env.BACKUP_ENABLED !== 'false') {
    const time = process.env.BACKUP_TIME || '01:30';
    daily(time, async () => {
      const r = await backup.runBackup({ reason: 'Nightly', by: 'system' });
      console.log(`Nightly backup: ${r.ok ? `OK, ${r.file_path}` : `FAILED - ${r.message}`}`);
    });
    console.log(`Nightly database backup at ${time} to ${backup.backupDir()}`);
  }
  if (process.env.LOG_RETENTION_ENABLED !== 'false') {
    const time = process.env.LOG_RETENTION_TIME || '02:30';
    daily(time, async () => {
      const r = await retention.runRetention({ by: 'system' });
      const removed = r.details.tables.reduce((s, t) => s + t.deleted, 0);
      console.log(`Log retention: ${r.ok ? 'OK' : 'with errors'}, ${removed} old log entries archived and removed`);
    });
    console.log(`Log retention at ${time}: entries older than ${Number(process.env.LOG_RETENTION_MONTHS) || 5} months archived to ${retention.archiveDir()}`);
  }
}

module.exports = { startJobs };
