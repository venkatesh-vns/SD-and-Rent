/**
 * Response cache for read-heavy screens (dashboard, lookups, report options).
 *
 * Correctness first: an entry is dropped as soon as a table it depends on
 * changes. PostgreSQL announces every committed change on the 'app_data_changed'
 * channel (triggers from migration 021); each web worker LISTENs on its own
 * connection. A worker also clears its whole cache after any change request it
 * handles itself (so the user who saved sees the result at once). Entries expire
 * after CACHE_TTL_SECONDS (default 300) as a safety net, and caching switches off
 * while the change listener is not connected.
 *
 * Disabled when CACHE_ENABLED=false (the automated tests run without it unless a
 * test turns it on).
 */
const { Client } = require('pg');

const MAX_ENTRIES = 500;
const entries = new Map(); // key -> { body, at, tables }
const stats = { hits: 0, misses: 0, invalidations: 0, listening: false };
let listener = null;
let starting = null;

const enabled = () => process.env.CACHE_ENABLED !== 'false' && !(process.env.NODE_ENV === 'test' && process.env.CACHE_ENABLED !== 'true');
const ttlMs = () => (Number(process.env.CACHE_TTL_SECONDS) || 300) * 1000;

function invalidate(table) {
  stats.invalidations += 1;
  for (const [key, e] of entries) if (!table || e.tables.includes(table)) entries.delete(key);
}

async function connectListener() {
  const client = new Client({
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST,
    database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10) || 5432,
  });
  client.on('notification', (msg) => invalidate(msg.payload));
  client.on('error', () => {}); // handled by 'end'
  client.on('end', () => {
    stats.listening = false;
    listener = null;
    entries.clear(); // changes may be missed while disconnected
    if (enabled() && !stop.called) setTimeout(() => { start().catch(() => {}); }, 5000).unref();
  });
  await client.connect();
  await client.query('LISTEN app_data_changed');
  if (client.connection?.stream?.unref) client.connection.stream.unref(); // do not keep the process alive
  listener = client;
  stats.listening = true;
}

function start() {
  if (!enabled() || listener) return Promise.resolve();
  if (!starting) starting = connectListener().catch(() => { stats.listening = false; }).finally(() => { starting = null; });
  return starting;
}

async function stop() {
  stop.called = true;
  entries.clear();
  if (listener) await listener.end().catch(() => {});
}

/**
 * Express middleware for GET routes: caches the JSON body per URL (path + query).
 * tables = the tables the response is built from.
 */
function cacheResponse(tables) {
  return (req, res, next) => {
    if (!enabled() || req.method !== 'GET') return next();
    start().catch(() => {});
    if (!stats.listening) { res.set('X-Cache', 'BYPASS'); return next(); }
    const key = req.originalUrl;
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs()) {
      stats.hits += 1;
      entries.delete(key); entries.set(key, hit); // most recently used last
      res.set('X-Cache', 'HIT');
      return res.json(hit.body);
    }
    stats.misses += 1;
    res.set('X-Cache', 'MISS');
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200 && body && body.success !== false) {
        entries.set(key, { body, at: Date.now(), tables });
        while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
      }
      return json(body);
    };
    return next();
  };
}

// After a change request handled by this worker, drop this worker's cache at once
function clearAfterWrites(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && !req.originalUrl.startsWith('/api/auth/heartbeat')) {
    res.on('finish', () => { if (res.statusCode < 400) entries.clear(); });
  }
  next();
}

const snapshot = () => ({ ...stats, entries: entries.size, enabled: enabled(), ttlSeconds: ttlMs() / 1000 });

module.exports = { cacheResponse, clearAfterWrites, start, stop, invalidate, snapshot };
