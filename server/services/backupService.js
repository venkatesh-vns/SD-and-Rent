/**
 * Database backups with pg_dump (custom format, compressed).
 *  - nightly at BACKUP_TIME (default 01:30) in the one worker that runs the
 *    scheduled jobs, plus "Back up now" from System Health
 *  - each file is read back with pg_restore --list (verified) before it counts
 *  - kept: the last BACKUP_KEEP_DAILY files (default 14) plus the newest file of
 *    each of the last BACKUP_KEEP_MONTHLY months (default 12); older ones are deleted
 *  - files go to BACKUP_DIR (default server/backups); PG_BIN = folder with pg_dump
 *    (default: found in PATH or C:\Program Files\PostgreSQL\<version>\bin)
 *  - only one backup at a time (PostgreSQL advisory lock); every run is recorded
 *    in backup_runs and a failure in the Audit Log
 * Restore: scripts/restore.js (see docs).
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/audit');

const backupDir = () => process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const PREFIX = () => `${process.env.DB_NAME}_`;

function pgTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    try {
      const versions = fs.readdirSync(base).filter((v) => fs.existsSync(path.join(base, v, 'bin', exe)))
        .sort((a, b) => Number(b) - Number(a));
      if (versions.length) return path.join(base, versions[0], 'bin', exe);
    } catch { /* not installed there */ }
  }
  return exe; // from PATH
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' },
    }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().slice(0, 900))) : resolve(stdout)));
  });
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Deletes backups beyond the daily / monthly retention; returns the deleted file names
function prune() {
  const keepDaily = Number(process.env.BACKUP_KEEP_DAILY) || 14;
  const keepMonthly = Number(process.env.BACKUP_KEEP_MONTHLY) || 12;
  const files = fs.readdirSync(backupDir()).filter((f) => f.startsWith(PREFIX()) && f.endsWith('.dump')).sort().reverse(); // newest first
  const keep = new Set(files.slice(0, keepDaily));
  const months = new Map();
  files.forEach((f) => { const m = f.slice(PREFIX().length, PREFIX().length + 6); if (!months.has(m)) months.set(m, f); });
  [...months.values()].slice(0, keepMonthly).forEach((f) => keep.add(f));
  const removed = files.filter((f) => !keep.has(f));
  removed.forEach((f) => fs.rmSync(path.join(backupDir(), f), { force: true }));
  return removed;
}

/**
 * Runs one backup. Returns the backup_runs row. Throws only for "already running".
 */
async function runBackup({ reason = 'Manual', by = 'system' } = {}) {
  const lockClient = await pool.connect();
  try {
    const got = (await lockClient.query('SELECT pg_try_advisory_lock(7301) AS ok')).rows[0].ok;
    if (!got) {
      const err = new Error('A backup is already running.');
      err.status = 409;
      throw err;
    }
    const row = (await pool.query('INSERT INTO backup_runs (reason, started_by) VALUES ($1, $2) RETURNING *', [reason, by])).rows[0];
    const file = path.join(backupDir(), `${PREFIX()}${stamp()}.dump`);
    let result;
    try {
      fs.mkdirSync(backupDir(), { recursive: true });
      await run(pgTool('pg_dump'), [
        '-h', process.env.DB_HOST || 'localhost', '-p', String(process.env.DB_PORT || 5432), '-U', process.env.DB_USER,
        '-F', 'c', '-Z', '6', '-f', file, process.env.DB_NAME,
      ]);
      const list = await run(pgTool('pg_restore'), ['--list', file]);
      const tables = (list.match(/ TABLE DATA /g) || []).length;
      if (!tables) throw new Error('The backup file could not be read back (no table data found).');
      const size = fs.statSync(file).size;
      const removed = prune();
      result = (await pool.query(
        `UPDATE backup_runs SET finished_at = NOW(), file_path = $2, size_bytes = $3, verified = TRUE, ok = TRUE, message = $4
         WHERE backup_id = $1 RETURNING *`,
        [row.backup_id, file, size, `${tables} tables verified${removed.length ? `; ${removed.length} old backup(s) removed` : ''}`]
      )).rows[0];
    } catch (err) {
      fs.rmSync(file, { force: true });
      result = (await pool.query('UPDATE backup_runs SET finished_at = NOW(), ok = FALSE, message = $2 WHERE backup_id = $1 RETURNING *',
        [row.backup_id, err.message.slice(0, 1000)])).rows[0];
      await logAudit({ tableName: 'backup_runs', recordId: row.backup_id, action: 'BACKUP_FAILED', actionBy: by, details: err.message.slice(0, 500) }).catch(() => {});
    }
    return result;
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(7301)').catch(() => {});
    lockClient.release();
  }
}

// For System Health: last runs, last good backup, files on disk and free space
async function status() {
  const runs = (await pool.query('SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 10')).rows;
  const lastGood = (await pool.query('SELECT * FROM backup_runs WHERE ok ORDER BY started_at DESC LIMIT 1')).rows[0] || null;
  let files = [];
  let freeBytes = null;
  try {
    files = fs.readdirSync(backupDir()).filter((f) => f.startsWith(PREFIX()) && f.endsWith('.dump'));
    const st = fs.statfsSync(backupDir());
    freeBytes = st.bavail * st.bsize;
  } catch { /* folder not created yet */ }
  return {
    dir: backupDir(), time: process.env.BACKUP_TIME || '01:30', enabled: process.env.BACKUP_ENABLED !== 'false',
    keepDaily: Number(process.env.BACKUP_KEEP_DAILY) || 14, keepMonthly: Number(process.env.BACKUP_KEEP_MONTHLY) || 12,
    files: files.length, freeBytes, lastGood, runs,
  };
}

module.exports = { runBackup, status, prune, pgTool, backupDir };
