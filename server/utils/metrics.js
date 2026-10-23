/**
 * Request monitoring for the System Health page.
 *  - per route: count, server errors, average / 95th percentile / max time (last 500)
 *  - slow requests (over SLOW_REQUEST_MS, default 2000) and server errors are appended
 *    to LOG_DIR/slow-requests-YYYY-MM.log and errors-YYYY-MM.log (JSON lines)
 *  - each web worker reports a snapshot to the primary process every 10 seconds;
 *    allWorkers() asks the primary for every worker's latest snapshot
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const cache = require('./cache');

const startedAt = new Date();
const routes = new Map(); // 'GET /api/dashboard' -> { count, errors, totalMs, recent: [] }
const totals = { requests: 0, errors: 0, slow: 0 };
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

const logDir = () => process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const slowMs = () => Number(process.env.SLOW_REQUEST_MS) || 2000;
const month = () => new Date().toISOString().slice(0, 7);

function appendLog(kind, entry) {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    fs.appendFile(path.join(logDir(), `${kind}-${month()}.log`), `${JSON.stringify(entry)}\n`, () => {});
  } catch { /* logging must never break a request */ }
}

// Route pattern, e.g. 'GET /api/rent/rules/:id'
const routeKey = (req) => `${req.method} ${req.route ? `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` : req.baseUrl || req.path}`;

function requestMetrics(req, res, next) {
  if (!req.originalUrl.startsWith('/api/')) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const key = routeKey(req);
    const r = routes.get(key) || { count: 0, errors: 0, totalMs: 0, recent: [] };
    r.count += 1;
    r.totalMs += ms;
    r.recent.push(ms);
    if (r.recent.length > 500) r.recent.shift();
    if (res.statusCode >= 500) r.errors += 1;
    routes.set(key, r);
    totals.requests += 1;
    if (res.statusCode >= 500) {
      totals.errors += 1;
      appendLog('errors', { at: new Date().toISOString(), pid: process.pid, user: req.user?.userName, method: req.method, url: req.originalUrl.slice(0, 300), status: res.statusCode, ms: Math.round(ms) });
    }
    if (ms > slowMs() && !/\/export|bulk-upload|bulk-edit|schedule\/generate|system\/backup/.test(req.originalUrl)) {
      totals.slow += 1;
      appendLog('slow-requests', { at: new Date().toISOString(), pid: process.pid, user: req.user?.userName, method: req.method, url: req.originalUrl.slice(0, 300), status: res.statusCode, ms: Math.round(ms) });
    }
  });
  next();
}

const pct = (list, p) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

function snapshot() {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memoryMB: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
    eventLoopDelayMs: { p50: +(loopDelay.percentile(50) / 1e6).toFixed(1), p99: +(loopDelay.percentile(99) / 1e6).toFixed(1), max: +(loopDelay.max / 1e6).toFixed(1) },
    totals: { ...totals },
    cache: cache.snapshot(),
    reminders: process.env.RUN_REMINDERS === 'true',
    routes: [...routes.entries()].map(([route, r]) => ({
      route, count: r.count, errors: r.errors, avgMs: Math.round(r.totalMs / r.count), p95Ms: Math.round(pct(r.recent, 95)), maxMs: Math.round(Math.max(...r.recent)),
    })),
  };
}

// Workers report to the primary (cluster.js) every 10 seconds
if (process.send) {
  const report = () => { try { process.send({ type: 'metrics', data: snapshot() }); } catch { /* primary gone */ } };
  setTimeout(report, 2000).unref(); // first report soon after start
  setInterval(report, 10000).unref();
}

// Every worker's latest snapshot (this one's is always current) and the cluster's
// restart count: { workers: [...], cluster }
function allWorkers() {
  if (!process.send) return Promise.resolve({ workers: [snapshot()], cluster: { workers: 1, restarts: 0 } });
  return new Promise((resolve) => {
    const id = `${process.pid}-${Date.now()}-${Math.random()}`;
    const onMessage = (msg) => {
      if (msg?.type !== 'metrics:all' || msg.id !== id) return;
      process.off('message', onMessage);
      clearTimeout(timer);
      resolve({ workers: [snapshot(), ...msg.data.filter((w) => w.pid !== process.pid)], cluster: msg.cluster });
    };
    const timer = setTimeout(() => { process.off('message', onMessage); resolve({ workers: [snapshot()], cluster: null }); }, 2000);
    process.on('message', onMessage);
    process.send({ type: 'metrics:get', id });
  });
}

const host = () => ({
  hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model,
  totalMemoryGB: +(os.totalmem() / 1073741824).toFixed(1), freeMemoryGB: +(os.freemem() / 1073741824).toFixed(1), node: process.version,
});

module.exports = { requestMetrics, snapshot, allWorkers, host, appendLog, logDir };
