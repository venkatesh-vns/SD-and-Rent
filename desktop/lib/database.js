// Private PostgreSQL for "This PC holds the data" mode. Data lives in the
// user's AppData folder; the server only listens on 127.0.0.1, so it is
// reachable by this app alone (other PCs talk to the app's web server).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFile, spawn } = require('child_process');

const DB_USER = 'sdadmin';
const DB_NAME = 'sd_maintenance';

function exec(file, args, { log } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (log && (stdout || stderr)) log(`${path.basename(file)}: ${(stdout + stderr).trim()}`);
      if (err) {
        err.message = `${path.basename(file)} failed: ${(stderr || stdout || err.message).trim()}`;
        reject(err);
      } else resolve(stdout);
    });
  });
}

// First free TCP port at or after `start`
function freePort(start, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once('error', () => tryPort(port + 1));
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, host);
    };
    tryPort(start);
  });
}

class Database {
  constructor({ pgHome, dataDir, logDir, log }) {
    this.bin = (name) => path.join(pgHome, 'bin', `${name}.exe`);
    this.dataDir = dataDir;
    this.logFile = path.join(logDir, 'postgres.log');
    this.log = log || console.log;
    fs.mkdirSync(logDir, { recursive: true });
  }

  get initialized() {
    return fs.existsSync(path.join(this.dataDir, 'PG_VERSION'));
  }

  // Creates the data folder (first run) with a password-protected superuser
  async init({ password, port }) {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(this.dataDir), { recursive: true });
    const pwFile = path.join(os.tmpdir(), `sdm-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(pwFile, password, { mode: 0o600 });
    try {
      await exec(this.bin('initdb'), [
        '-D', this.dataDir, '-U', DB_USER, '-A', 'scram-sha-256', `--pwfile=${pwFile}`,
        '-E', 'UTF8', '--locale=C', '--no-instructions',
      ], { log: this.log });
    } finally {
      fs.rmSync(pwFile, { force: true });
    }
    fs.appendFileSync(path.join(this.dataDir, 'postgresql.auto.conf'), [
      '', '# SD Maintenance desktop app',
      `port = ${port}`,
      "listen_addresses = '127.0.0.1'",
      'max_connections = 50',
      "timezone = 'Asia/Kolkata'",
      "log_timezone = 'Asia/Kolkata'",
      '',
    ].join('\n'));
    this.log(`Database folder created at ${this.dataDir}`);
  }

  async isRunning() {
    try {
      await exec(this.bin('pg_ctl'), ['status', '-D', this.dataDir]);
      return true;
    } catch {
      return false;
    }
  }

  async start() {
    if (await this.isRunning()) {
      this.log('PostgreSQL already running');
      return;
    }
    // No pipes here: the postgres process pg_ctl launches inherits them and keeps
    // them open, so waiting for pg_ctl's output would never finish. Its messages
    // go to the log file (-l) instead.
    const code = await new Promise((resolve, reject) => {
      const child = spawn(this.bin('pg_ctl'), ['start', '-D', this.dataDir, '-l', this.logFile, '-w', '-t', '60'], { windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`PostgreSQL did not start (pg_ctl exit code ${code}). See ${this.logFile}`);
    this.log('PostgreSQL started');
  }

  async stop() {
    if (!(await this.isRunning())) return;
    await exec(this.bin('pg_ctl'), ['stop', '-D', this.dataDir, '-m', 'fast', '-w', '-t', '30'], { log: this.log });
  }

  // Creates the application database if it does not exist yet
  async ensureDatabase({ Client, password, port }) {
    const client = new Client({ host: '127.0.0.1', port, user: DB_USER, password, database: 'postgres' });
    await client.connect();
    try {
      const exists = (await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])).rowCount > 0;
      if (!exists) {
        await client.query(`CREATE DATABASE ${DB_NAME} TEMPLATE template0 ENCODING 'UTF8'`);
        this.log(`Database ${DB_NAME} created`);
      }
    } finally {
      await client.end();
    }
  }

  // Full backup (custom format, restorable with pg_restore)
  async backup({ file, password, port }) {
    const prev = process.env.PGPASSWORD;
    process.env.PGPASSWORD = password;
    try {
      await exec(this.bin('pg_dump'), ['-h', '127.0.0.1', '-p', String(port), '-U', DB_USER, '-Fc', '-f', file, DB_NAME]);
    } finally {
      if (prev === undefined) delete process.env.PGPASSWORD; else process.env.PGPASSWORD = prev;
    }
  }
}

module.exports = { Database, freePort, DB_USER, DB_NAME };
