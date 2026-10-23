/**
 * Restores a backup made by the application (pg_dump custom format) into a NEW
 * database, then prints its record counts. The live database is never touched:
 * after checking the restored copy, the DBA switches DB_NAME (or renames databases).
 *
 *   node scripts/restore.js --file=backups\sd_rent_uat_20261023_013000.dump --db=sd_restore_check
 *
 * Needs PostgreSQL's pg_restore (PG_BIN, PATH or C:\Program Files\PostgreSQL\<version>\bin).
 */
require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');
const { execFile } = require('child_process');
const { pgTool } = require('../services/backupService');

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const file = arg('file');
const db = arg('db');

async function main() {
  if (!file || !fs.existsSync(file)) throw new Error('--file=<backup .dump> is required and must exist.');
  if (!/^[a-z0-9_]+$/.test(db || '')) throw new Error('--db=<new database name> is required (lower case letters, digits, _).');
  if (db === process.env.DB_NAME) throw new Error(`Refusing to restore over the database in use (${db}). Choose a new name.`);
  const conn = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT, 10) || 5432 };
  const admin = new Client({ ...conn, database: 'postgres' });
  await admin.connect();
  const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])).rows.length;
  if (exists) { await admin.end(); throw new Error(`Database ${db} already exists. Choose a new name.`); }
  await admin.query(`CREATE DATABASE "${db}"`);
  await admin.end();

  const t0 = Date.now();
  await new Promise((resolve, reject) => execFile(pgTool('pg_restore'), [
    '-h', conn.host || 'localhost', '-p', String(conn.port), '-U', conn.user, '-d', db, '--no-owner', '--exit-on-error', file,
  ], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PGPASSWORD: conn.password || '' } },
  (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())));
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const check = new Client({ ...conn, database: db });
  await check.connect();
  const counts = (await check.query(`SELECT
    (SELECT COUNT(*) FROM sd_master)::int AS sd_records, (SELECT COUNT(*) FROM sd_transactions)::int AS sd_transactions,
    (SELECT COUNT(*) FROM rent_master)::int AS rent_codes, (SELECT COUNT(*) FROM rent_schedule_lines)::int AS schedule_lines,
    (SELECT COUNT(*) FROM users)::int AS users, (SELECT COUNT(*) FROM schema_migrations)::int AS migrations`)).rows[0];
  await check.end();
  console.log(JSON.stringify({ restoredInto: db, seconds: Number(seconds), ...counts }, null, 2));
}

main().catch((err) => { console.error('Restore failed:', err.message); process.exit(1); });
