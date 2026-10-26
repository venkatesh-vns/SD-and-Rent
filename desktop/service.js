// Background service: runs "This PC holds the data" (PostgreSQL + the application
// server) without the desktop window, so other PCs keep working while this PC's
// screen is locked, its user is signed out, or no one has logged in after a restart.
//
// Started by the Windows scheduled task that lib/backgroundService.js registers
// ("At system start-up", as this PC's user, whether the user is logged on or not),
// through the app's own executable running as Node:
//   set ELECTRON_RUN_AS_NODE=1
//   "<app>.exe" "<resources>\app.asar.unpacked\service.js" --res "<resources>" --data "<data folder>"
// Stops cleanly when <data folder>\service.stop appears (the app's "Stop" setting),
// or on Ctrl+C / termination.
const fs = require('fs');
const path = require('path');
const configStore = require('./lib/config');
const channel = require('./lib/channel');
const { startServer } = require('./lib/server');
const { keepAwake } = require('./lib/keepAwake');
const { rotateLog } = require('./lib/logs');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const RES = arg('res');
const DATA = arg('data');
if (!RES || !DATA) {
  console.error('Usage: service.js --res <resources folder> --data <data folder>');
  process.exit(2);
}
const LOG_DIR = path.join(DATA, 'logs');
const STOP_FILE = path.join(DATA, 'service.stop');
const STATUS_FILE = path.join(DATA, 'service-status.json');
fs.mkdirSync(LOG_DIR, { recursive: true });
rotateLog(path.join(LOG_DIR, 'service.log'));
const logStream = fs.createWriteStream(path.join(LOG_DIR, 'service.log'), { flags: 'a' });
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  logStream.write(`${line}\n`);
  if (process.stdout.isTTY) process.stdout.write(`${line}\n`);
}
for (const level of ['log', 'info', 'warn', 'error']) console[level] = (...a) => log(...a);

const version = require('./package.json').version;
let running = null;
let stopAwake = () => {};
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  log('Background service stopping');
  stopAwake();
  if (running) await running.stop();
  fs.rmSync(STATUS_FILE, { force: true });
  fs.rmSync(STOP_FILE, { force: true });
  log('Background service stopped');
  logStream.end(() => process.exit(code));
}

async function main() {
  fs.rmSync(STOP_FILE, { force: true });
  const config = configStore.load(path.join(DATA, 'config.json'));
  if (config.mode !== 'server' || !config.server) throw new Error(`This PC is not set up to hold the ${channel.APP_NAME} data (open the app and choose "This PC holds the data" first).`);
  log(`${channel.APP_NAME} ${version} background service starting (data: ${DATA})`);
  running = await startServer({
    resDir: RES, userDir: DATA, logDir: LOG_DIR, settings: config.server, appVersion: version, emailDryRun: channel.EMAIL_DRY_RUN, log,
  });
  stopAwake = keepAwake(log);
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ pid: process.pid, version, httpPort: config.server.httpPort, startedAt: new Date().toISOString() }));
  log(`Serving on port ${config.server.httpPort}`);

  // Stop when asked; restart PostgreSQL if it stops on its own
  setInterval(() => { if (fs.existsSync(STOP_FILE)) stop(0); }, 2000);
  setInterval(async () => {
    if (stopping) return;
    try {
      if (!(await running.database.isRunning())) {
        log('PostgreSQL is not running; starting it again');
        await running.database.start();
      }
    } catch (err) {
      log('PostgreSQL restart failed', err);
    }
  }, 60000);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
main().catch((err) => {
  log('Background service could not start', err);
  // A non-zero exit lets the scheduled task try again (restart on failure)
  stop(1);
});
