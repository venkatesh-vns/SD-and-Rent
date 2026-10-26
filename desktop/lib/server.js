// Starts / stops "This PC holds the data": the private PostgreSQL and the
// application server. Used by the desktop window (main.js) and by the background
// service (service.js), so both run exactly the same way.
//
// Upgrades: when the installed version brings database changes (migrations not yet
// applied), the database is first backed up to <data>\backups\pre-upgrade and the
// backup is read back; only then are the changes applied. If the backup cannot be
// made, nothing is changed and the start stops with the reason.
const fs = require('fs');
const path = require('path');
const { Database, DB_USER, DB_NAME } = require('./database');
const { startBackend } = require('./backend');

// Migration files not yet recorded in the database ([] for a new, empty database)
async function pendingMigrations({ Client, migrationsDir, password, port }) {
  const client = new Client({ host: '127.0.0.1', port, user: DB_USER, password, database: DB_NAME });
  await client.connect();
  try {
    const exists = (await client.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0].t;
    if (!exists) return { applied: 0, pending: [] };
    const applied = new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    return { applied: applied.size, pending: files.filter((f) => !applied.has(f)) };
  } finally {
    await client.end();
  }
}

async function startServer({ resDir, userDir, logDir, settings, appVersion, emailDryRun, firstAdmin = null, log }) {
  const backendDir = path.join(resDir, 'backend');
  const database = new Database({ pgHome: path.join(resDir, 'pgsql'), dataDir: path.join(userDir, 'pgdata'), logDir, log });
  if (!database.initialized) await database.init({ password: settings.dbPassword, port: settings.pgPort });
  await database.start();
  const { Client } = require(path.join(backendDir, 'server', 'node_modules', 'pg'));
  await database.ensureDatabase({ Client, password: settings.dbPassword, port: settings.pgPort });

  // Back up before an upgrade changes the database
  const migrationsDir = path.join(backendDir, 'database', 'migrations');
  const { applied, pending } = await pendingMigrations({ Client, migrationsDir, password: settings.dbPassword, port: settings.pgPort });
  if (applied > 0 && pending.length) {
    const dir = path.join(userDir, 'backups', 'pre-upgrade');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
    const file = path.join(dir, `before_${String(appVersion).replace(/[^\w.-]/g, '_')}_${stamp}.dump`);
    log(`Upgrade to ${appVersion}: ${pending.length} database change(s) (${pending[0]} ... ${pending[pending.length - 1]}); backing up first to ${file}`);
    try {
      await database.backup({ file, password: settings.dbPassword, port: settings.pgPort });
      const tables = await database.verifyBackup(file);
      log(`Pre-upgrade backup verified: ${tables} tables, ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
    } catch (err) {
      fs.rmSync(file, { force: true });
      throw new Error(`The database could not be backed up before the upgrade, so it was not changed. ${err.message}`);
    }
  }

  const backend = await startBackend({
    backendDir,
    uploadDir: path.join(userDir, 'uploads'),
    backupDir: path.join(userDir, 'backups'), // nightly database backups
    pgBin: path.join(resDir, 'pgsql', 'bin'),
    logArchiveDir: path.join(userDir, 'log-archive'), // log entries older than 5 months
    documentDir: path.join(userDir, 'documents'), // SD Master documents (PDF / Word)
    logDir: path.join(logDir, 'server'),
    httpPort: settings.httpPort,
    pgPort: settings.pgPort,
    dbUser: DB_USER,
    dbName: DB_NAME,
    dbPassword: settings.dbPassword,
    jwtSecret: settings.jwtSecret,
    settingsSecret: settings.settingsSecret,
    emailDryRun,
    firstAdmin,
    log,
  });
  return {
    database,
    backend,
    async stop() {
      try { await backend.close(); } catch (err) { log('Server stop failed', err); }
      try { await database.stop(); } catch (err) { log('Database stop failed', err); }
    },
  };
}

module.exports = { startServer, pendingMigrations };
