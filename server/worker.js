// One web server process (see cluster.js): serves the API and the screens on
// PORT (HOST, default all addresses). RUN_REMINDERS=true in exactly one worker.
require('dotenv').config();

const app = require('./app');
const { startReminderScheduler } = require('./services/notificationService');

const port = Number(process.env.PORT) || 5000;
const host = process.env.HOST || undefined;
const server = app.listen(port, host);
// Keep idle browser connections open longer than Node's 5 s default, so a
// connection is not closed just as a browser sends its next request on it
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;
if (process.env.RUN_REMINDERS === 'true') startReminderScheduler();

// Started by cluster.js: stop when the primary process goes (no orphaned workers)
if (process.send) process.on('disconnect', () => process.exit(0));
