// One web server process (see cluster.js): serves the API and the screens on
// PORT (HOST, default all addresses). RUN_REMINDERS=true in exactly one worker,
// which also runs the scheduled jobs (nightly backup, log retention).
// HTTPS: set HTTPS_PFX_FILE (+ HTTPS_PFX_PASSPHRASE) or HTTPS_CERT_FILE + HTTPS_KEY_FILE.
require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');
const app = require('./app');
const { startReminderScheduler } = require('./services/notificationService');
const { startJobs } = require('./services/jobs');

function tlsOptions() {
  const { HTTPS_PFX_FILE, HTTPS_PFX_PASSPHRASE, HTTPS_CERT_FILE, HTTPS_KEY_FILE } = process.env;
  if (HTTPS_PFX_FILE) return { pfx: fs.readFileSync(HTTPS_PFX_FILE), passphrase: HTTPS_PFX_PASSPHRASE };
  if (HTTPS_CERT_FILE && HTTPS_KEY_FILE) return { cert: fs.readFileSync(HTTPS_CERT_FILE), key: fs.readFileSync(HTTPS_KEY_FILE) };
  return null;
}

const port = Number(process.env.PORT) || 5000;
const host = process.env.HOST || undefined;
const tls = tlsOptions();
const server = (tls ? https.createServer(tls, app) : http.createServer(app)).listen(port, host);
// Keep idle browser connections open longer than Node's 5 s default, so a
// connection is not closed just as a browser sends its next request on it
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;
if (process.env.RUN_REMINDERS === 'true') {
  startReminderScheduler();
  startJobs();
}

// Started by cluster.js: stop when the primary process goes (no orphaned workers)
if (process.send) process.on('disconnect', () => process.exit(0));
