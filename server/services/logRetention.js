/**
 * Log retention: entries older than LOG_RETENTION_MONTHS (default 5) are written
 * to compressed archive files and then removed from the database, so log tables
 * stay small. Runs nightly (services/jobs.js) and from System Health.
 *
 * Covered (log data only):
 *   audit_log        changes, logins, lockouts
 *   email_log        sent / failed emails - EXCEPT entries for a lease date still to
 *                    come: the reminder job checks them so it never sends twice
 *   upload_batches   Excel upload reports
 *   user_sessions    ended login sessions (and abandoned ones)
 *   backup_runs      backup history
 *   maintenance_runs history of this job
 *   password_reset_tokens  used / expired reset links (deleted, not archived)
 *   monitoring log files (LOG_DIR/*-YYYY-MM.log): moved to the archive folder
 * Never touched: SD / Rent business tables, SD status history, Rent Schedule runs
 * (every schedule line refers to its run).
 *
 * Safety: for each table the old rows are written to
 * LOG_ARCHIVE_DIR/<table>_before_<cutoff>_<run>.jsonl.gz, the file is read back and
 * its row count checked, and only then are exactly those rows deleted, in batches
 * of 2,000 (short locks; the application keeps working). Any error before the
 * delete leaves the table as it was. LOG_ARCHIVE=false deletes without archiving.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { pool } = require('../config/db');
const { logDir } = require('../utils/metrics');

const months = () => Number(process.env.LOG_RETENTION_MONTHS) || 5;
const archiveDir = () => process.env.LOG_ARCHIVE_DIR || path.join(__dirname, '..', 'log-archive');
const archiving = () => process.env.LOG_ARCHIVE !== 'false';
const BATCH = 2000;

// Old rows of each log table: { table, id, where } (cutoff = $1)
const TABLES = [
  { table: 'audit_log', id: 'audit_id', where: 'action_date < $1' },
  {
    table: 'email_log',
    id: 'email_log_id',
    // keep reminders whose lease date has not passed yet (they stop duplicate reminders)
    where: `sent_at < $1 AND NOT (
              status IN ('Sent', 'DryRun') AND trigger_event ~ '\\d{2}/\\d{2}/\\d{4}$'
              AND to_date(right(trigger_event, 10), 'DD/MM/YYYY') >= CURRENT_DATE)`,
  },
  { table: 'upload_batches', id: 'batch_id', where: 'uploaded_date < $1' },
  { table: 'user_sessions', id: 'session_id', where: '(ended_at < $1 OR (ended_at IS NULL AND last_seen_at < $1))' },
  { table: 'backup_runs', id: 'backup_id', where: 'started_at < $1' },
  { table: 'maintenance_runs', id: 'run_id', where: 'started_at < $1' },
];

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

async function countLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) if (line) n += 1;
  return n;
}

// Archives then deletes one table's old rows; returns { table, archived, deleted, file }
async function cleanTable({ table, id, where }, cutoff, run) {
  const ids = [];
  let file = null;
  if (archiving()) {
    fs.mkdirSync(archiveDir(), { recursive: true });
    // written as .part and named only once complete and checked, never over an existing archive
    const part = path.join(archiveDir(), `${table}_${run}_${process.pid}_${Date.now()}.part`);
    const gz = zlib.createGzip();
    const out = fs.createWriteStream(part);
    const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); gz.on('error', reject); });
    gz.pipe(out);
    let last = null;
    for (;;) {
      const params = [cutoff, BATCH];
      const after = last === null ? '' : `AND ${id} > $3`;
      if (last !== null) params.push(last);
      const rows = (await pool.query(`SELECT * FROM ${table} WHERE ${where} ${after} ORDER BY ${id} LIMIT $2`, params)).rows;
      if (!rows.length) break;
      rows.forEach((r) => { gz.write(`${JSON.stringify(r)}\n`); ids.push(r[id]); });
      last = rows[rows.length - 1][id];
      if (rows.length < BATCH) break;
    }
    gz.end();
    await done;
    if (!ids.length) { fs.rmSync(part, { force: true }); return { table, archived: 0, deleted: 0, file: null }; }
    const written = await countLines(part);
    if (written !== ids.length) { fs.rmSync(part, { force: true }); throw new Error(`${table}: archive has ${written} rows, expected ${ids.length}; nothing deleted`); }
    const name = `${table}_before_${cutoff.slice(0, 10)}_${run}`;
    file = path.join(archiveDir(), `${name}.jsonl.gz`);
    for (let n = 2; fs.existsSync(file); n += 1) file = path.join(archiveDir(), `${name}-${n}.jsonl.gz`);
    fs.renameSync(part, file);
  } else {
    ids.push(...(await pool.query(`SELECT ${id} AS k FROM ${table} WHERE ${where}`, [cutoff])).rows.map((r) => r.k));
  }

  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    // the WHERE is repeated: a row is only removed if it is still old (and archived)
    deleted += (await pool.query(`DELETE FROM ${table} WHERE ${id} = ANY($2) AND ${where}`, [cutoff, ids.slice(i, i + BATCH)])).rowCount;
  }
  return { table, archived: archiving() ? ids.length : 0, deleted, file: file && path.basename(file) };
}

// Monitoring log files of months before the cutoff: moved into the archive folder
function cleanLogFiles(cutoff) {
  const limit = cutoff.slice(0, 7);
  let moved = 0;
  try {
    for (const f of fs.readdirSync(logDir())) {
      const m = f.match(/-(\d{4}-\d{2})\.log$/);
      if (!m || m[1] >= limit) continue;
      if (archiving()) {
        fs.mkdirSync(path.join(archiveDir(), 'monitoring-logs'), { recursive: true });
        fs.renameSync(path.join(logDir(), f), path.join(archiveDir(), 'monitoring-logs', f));
      } else fs.rmSync(path.join(logDir(), f), { force: true });
      moved += 1;
    }
  } catch { /* no log folder yet */ }
  return moved;
}

/**
 * One clean-up run (only one at a time, across all web workers). Returns the
 * maintenance_runs row.
 */
async function runRetention({ by = 'system' } = {}) {
  const lock = await pool.connect();
  try {
    if (!(await lock.query('SELECT pg_try_advisory_lock(7302) AS ok')).rows[0].ok) {
      const err = new Error('The log clean-up is already running.');
      err.status = 409;
      throw err;
    }
    const cutoff = (await pool.query(`SELECT (NOW() - make_interval(months => $1::int))::timestamp::text AS c`, [months()])).rows[0].c;
    const row = (await pool.query(`INSERT INTO maintenance_runs (job, started_by) VALUES ('Log retention', $1) RETURNING *`, [by])).rows[0];
    const run = stamp();
    const tables = [];
    let ok = true;
    let error = null;
    for (const t of TABLES) {
      try {
        tables.push(await cleanTable(t, cutoff, run));
      } catch (err) {
        ok = false;
        error = err.message;
        tables.push({ table: t.table, archived: 0, deleted: 0, error: err.message });
      }
    }
    const resetLinks = (await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < $1 OR (used AND created_date < $1)`, [cutoff])).rowCount;
    const logFiles = cleanLogFiles(cutoff);
    const details = { cutoff, months: months(), archiveDir: archiving() ? archiveDir() : null, tables, resetLinks, logFiles, error };
    return (await pool.query(`UPDATE maintenance_runs SET finished_at = NOW(), ok = $2, details = $3 WHERE run_id = $1 RETURNING *`,
      [row.run_id, ok, JSON.stringify(details)])).rows[0];
  } finally {
    await lock.query('SELECT pg_advisory_unlock(7302)').catch(() => {});
    lock.release();
  }
}

// For System Health: policy, last runs and the archive folder
async function status() {
  const runs = (await pool.query(`SELECT * FROM maintenance_runs WHERE job = 'Log retention' ORDER BY started_at DESC LIMIT 5`)).rows;
  let files = 0;
  let bytes = 0;
  try {
    for (const f of fs.readdirSync(archiveDir())) {
      const st = fs.statSync(path.join(archiveDir(), f));
      if (st.isFile()) { files += 1; bytes += st.size; }
    }
  } catch { /* none yet */ }
  return { months: months(), archiving: archiving(), archiveDir: archiveDir(), files, bytes, runs, tables: TABLES.map((t) => t.table) };
}

module.exports = { runRetention, status, TABLES, archiveDir };
