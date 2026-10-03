// Runs the SD Maintenance API (and the web screens) inside the desktop app,
// for "This PC holds the data" mode. Other PCs open http://<this-pc>:<port>.
const fs = require('fs');
const os = require('os');
const path = require('path');

// This PC's IPv4 addresses on the office network (for the address other PCs use)
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/**
 * Starts the API on 0.0.0.0:httpPort against the local database.
 * backendDir = folder with server/, client/build and database/migrations.
 * firstAdmin = { email, password } creates the admin user on an empty database.
 * Returns { close() }.
 */
async function startBackend({ backendDir, uploadDir, httpPort, pgPort, dbUser, dbName, dbPassword, jwtSecret, settingsSecret, firstAdmin, log }) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const lan = lanAddresses()[0];
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PORT: String(httpPort),
    DB_HOST: '127.0.0.1',
    DB_PORT: String(pgPort),
    DB_USER: dbUser,
    DB_PASSWORD: dbPassword,
    DB_NAME: dbName,
    JWT_SECRET: jwtSecret,
    SETTINGS_SECRET: settingsSecret,
    CLIENT_URL: `http://${lan || 'localhost'}:${httpPort}`, // links in password-reset emails
    CLIENT_BUILD_DIR: path.join(backendDir, 'client', 'build'),
    MIGRATIONS_DIR: path.join(backendDir, 'database', 'migrations'),
    UPLOAD_DIR: uploadDir,
    NOTIFY_ENABLED: 'true',
    EMAIL_DRY_RUN: 'false',
  });

  const server = (p) => require(path.join(backendDir, 'server', p));
  const { pool } = server('config/db');
  const { runMigrations } = server('scripts/migrate');
  const applied = await runMigrations(pool, { log });
  if (applied.length) log(`Migrations applied: ${applied.join(', ')}`);

  // First start on an empty database: create the administrator chosen in setup
  const users = (await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
  if (users === 0) {
    if (!firstAdmin) throw new Error('No users exist and no administrator details were given.');
    const bcrypt = server('node_modules/bcryptjs');
    await pool.query(
      `INSERT INTO users (user_name, user_email, password_hash, status, is_admin, created_by)
       VALUES ('admin', $1, $2, 'Active', TRUE, 'desktop-setup')`,
      [firstAdmin.email, await bcrypt.hash(firstAdmin.password, 10)]
    );
    log('Administrator user "admin" created');
  }

  const app = server('app');
  const { startReminderScheduler } = server('services/notificationService');
  const httpServer = await new Promise((resolve, reject) => {
    const s = app.listen(httpPort, '0.0.0.0', () => resolve(s));
    s.once('error', reject);
  });
  startReminderScheduler();
  log(`SD Maintenance server listening on port ${httpPort}`);

  return {
    close: async () => {
      const closed = new Promise((resolve) => httpServer.close(() => resolve()));
      httpServer.closeAllConnections(); // keep-alive browser connections would hold close() open
      await closed;
      await pool.end().catch(() => {});
    },
  };
}

module.exports = { startBackend, lanAddresses };
