/**
 * Load balancing over CPU cores: the primary process starts WEB_WORKERS copies of
 * the web server (worker.js) that share one port; connections are handed out in
 * turn (round robin), so a heavy request (an Excel export, a bulk upload, a Rent
 * Schedule calculation) keeps one worker busy while the others go on serving.
 * Workers are stateless (JWT sessions, data in PostgreSQL), so any of them can
 * serve any request. A worker that stops is replaced. The daily reminder job runs
 * in exactly one worker.
 *
 * Used by server.js and by the desktop app (lib/backend.js).
 */
const cluster = require('node:cluster');
const os = require('os');
const path = require('path');

// WEB_WORKERS from the environment, else one per core up to 4 (leaving a core for PostgreSQL)
function workerCount() {
  const given = parseInt(process.env.WEB_WORKERS, 10);
  if (given > 0) return given;
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cores - 1));
}

/**
 * Starts the workers. env: extra environment for them (e.g. ELECTRON_RUN_AS_NODE).
 * Resolves with { workers, stop() } once every worker is listening.
 */
function startCluster({ count = workerCount(), env = {}, log = console.log } = {}) {
  cluster.schedulingPolicy = cluster.SCHED_RR; // even spread, also on Windows
  cluster.setupPrimary({ exec: path.join(__dirname, 'worker.js'), silent: false });
  let stopping = false;
  let reminderWorker = null;
  // Monitoring: latest snapshot per worker (utils/metrics.js) and restarts
  const snapshots = new Map();
  const info = { workers: count, restarts: 0, lastRestart: null, startedAt: new Date().toISOString() };

  const fork = (first) => {
    const runReminders = first || !reminderWorker || reminderWorker.isDead();
    const w = cluster.fork({ ...env, RUN_REMINDERS: runReminders ? 'true' : 'false' });
    if (runReminders) reminderWorker = w;
    w.on('message', (msg) => {
      if (msg?.type === 'metrics') snapshots.set(msg.data.pid, msg.data);
      if (msg?.type === 'metrics:get' && !w.isDead()) w.send({ type: 'metrics:all', id: msg.id, data: [...snapshots.values()], cluster: info });
    });
    return w;
  };

  cluster.on('exit', (w, code, signal) => {
    snapshots.delete(w.process.pid);
    if (stopping) return;
    info.restarts += 1;
    info.lastRestart = { at: new Date().toISOString(), pid: w.process.pid, reason: String(signal || code) };
    log(`Web worker ${w.process.pid} stopped (${signal || code}); starting a new one`);
    fork(false);
  });

  const workers = Array.from({ length: count }, (_, i) => fork(i === 0));
  const ready = Promise.all(workers.map((w) => new Promise((resolve, reject) => {
    w.once('listening', resolve);
    w.once('exit', (code) => reject(new Error(`web worker exited during start-up (code ${code})`)));
  })));

  return ready.then(() => {
    log(`${count} web worker(s) serving (load balanced)`);
    return {
      workers: count,
      stop: () => new Promise((resolve) => {
        stopping = true;
        const alive = Object.values(cluster.workers || {});
        if (!alive.length) { resolve(); return; }
        let left = alive.length;
        alive.forEach((w) => {
          w.once('exit', () => { left -= 1; if (!left) resolve(); });
          w.kill();
        });
      }),
    };
  });
}

module.exports = { startCluster, workerCount };
