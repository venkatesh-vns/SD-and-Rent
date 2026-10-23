/**
 * Load test: N users working at the same time against a running server
 * (use a performance database from seed.js - never UAT or production).
 *
 *   node scripts/perf/loadtest.js --url=http://localhost:5300 --users=20 --duration=120 --think=2000 [--jobs] [--out=result.json]
 *
 * Each user logs in as its own User ID (perf01..perf59; one session per User ID) and keeps opening screens: a "page" is the set of
 * API calls the screen makes when it opens, sent together; the page time is the
 * slowest of them. Between pages the user "thinks" for --think ms (+/- 50%).
 * Some pages export to Excel or save an SD transaction.
 * --jobs also runs, part-way through, a Rent Schedule generation for one financial
 * year (all Rent Codes) and a 1,000-row SD transaction bulk upload, and reports how
 * the screens behaved while they ran.
 */
const path = require('path');
const ExcelJS = require(path.join(__dirname, '..', '..', 'node_modules', 'exceljs'));

const arg = (name, fallback) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`) || a === `--${name}`);
  if (!m) return fallback;
  return m.includes('=') ? m.split('=').slice(1).join('=') : true;
};
const BASE = arg('url', 'http://localhost:5300');
const USERS = Number(arg('users', 20));
const DURATION = Number(arg('duration', 120)) * 1000;
const THINK = Number(arg('think', 2000));
const JOBS = Boolean(arg('jobs', false));
const OUT = arg('out', null);

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (list) => list[rnd(list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FY = { from: '01/04/2025', to: '31/03/2026' };

// ------------------------------------------------------------------ metrics
const samples = {};          // name -> [{ ms, ok, at }]
let rejected = 0;           // business-rule refusals (400 / 409)
const record = (name, ms, ok, at) => { (samples[name] = samples[name] || []).push({ ms, ok, at }); };
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
function summarise(list) {
  const ms = list.map((s) => s.ms).sort((a, b) => a - b);
  return {
    count: list.length, errors: list.filter((s) => !s.ok).length,
    avg: Math.round(ms.reduce((a, b) => a + b, 0) / (ms.length || 1)),
    p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: ms[ms.length - 1] || 0,
  };
}

async function call(token, method, url, body, { binary = false, name } = {}) {
  const t = Date.now();
  let ok = false;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload });
    if (binary) await res.arrayBuffer(); else await res.text();
    // A business-rule refusal (400 / 409, e.g. a Passive SD Code) is a correct answer, not a failure
    if (res.status === 400 || res.status === 409) rejected += 1;
    ok = res.status < 400 || res.status === 400 || res.status === 409;
    if (!ok && process.env.PERF_DEBUG) console.error(method, url, res.status);
  } catch (err) {
    if (process.env.PERF_DEBUG) console.error(method, url, err.message, err.cause?.code || err.cause?.message || '');
  }
  const ms = Date.now() - t;
  record(`api ${name || url.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id')}`, ms, ok, t);
  return { ms, ok };
}

// ------------------------------------------------------------------ pages
let sdIds = [];
const cc = () => (Math.random() < 0.3 && ctxLookups.cc.length ? `&costCenterId=${pick(ctxLookups.cc)}` : '');
const ctxLookups = { cc: [] };

const PAGES = [
  // [name, weight, (token) => [requests]]
  ['SD Dashboard', 15, () => [['GET', `/api/dashboard?x=1${cc()}`], ['GET', '/api/dashboard/options'], ['GET', '/api/lookups/cost-centers'], ['GET', '/api/lookups/fys'], ['GET', '/api/lookups/filter-combos?source=sd']]],
  ['SD Master list', 15, () => [['GET', `/api/sd-master?page=${1 + rnd(20)}&pageSize=50${cc()}${Math.random() < 0.3 ? '&search=Landlord 0' + rnd(10) : ''}`], ['GET', '/api/lookups/cost-centers'], ['GET', '/api/lookups/filter-combos?source=sd']]],
  ['SD Transaction (all)', 10, () => [['GET', `/api/sd-transactions?page=${1 + rnd(20)}&pageSize=50${cc()}`], ['GET', '/api/lookups/fys'], ['GET', '/api/lookups/cost-centers'], ['GET', '/api/lookups/filter-combos?source=sd']]],
  ['SD Transaction (one SD)', 15, () => { const id = pick(sdIds); return [['GET', `/api/sd-transactions/summary/${id}`], ['GET', `/api/sd-transactions?sd=${id}&sdId=${id}&page=1&pageSize=50`], ['GET', '/api/lookups/fys']]; }],
  ['SD Balance Report', 10, () => [['GET', `/api/reports/sd-balance?page=${1 + rnd(10)}&pageSize=50${cc()}${Math.random() < 0.3 ? '&agreementStatus=Agreement' : ''}`], ['GET', '/api/lookups/cost-centers'], ['GET', '/api/lookups/filter-combos?source=sd']]],
  ['Rent Schedule', 10, () => [['GET', `/api/rent/schedule?fromDate=${FY.from}&toDate=${FY.to}&page=${1 + rnd(20)}&pageSize=100${cc()}`], ['GET', `/api/rent/schedule/summary?fromDate=${FY.from}&toDate=${FY.to}&groupBy=${pick(['component', 'costCenter', 'landlord', 'month'])}${cc()}`], ['GET', '/api/rent/lookups'], ['GET', '/api/lookups/filter-combos?source=rent']]],
  ['SD & Rent Report', 8, () => [['GET', `/api/reports/sd-rent?dateFrom=${FY.from}&dateTo=${FY.to}&page=1&pageSize=100${cc()}`], ['GET', `/api/reports/sd-rent/summary?dateFrom=${FY.from}&dateTo=${FY.to}&groupBy=costCenter`], ['GET', '/api/reports/sd-rent/options'], ['GET', '/api/lookups/filter-combos?source=all']]],
  ['Rent Masters (lists)', 7, () => [['GET', `/api/rent/${pick(['master', 'agreements', 'rules', 'waivers'])}?page=${1 + rnd(10)}&pageSize=50`], ['GET', '/api/rent/lookups']]],
  ['Audit Log', 3, () => [['GET', `/api/logs/audit?page=${1 + rnd(50)}&pageSize=50`]]],
  ['Export to Excel', 4, () => [[...pick([
    ['GET', '/api/sd-master/export', null, 'export SD Master'],
    ['GET', '/api/reports/sd-balance/export', null, 'export SD Balance'],
    ['GET', `/api/rent/schedule/export?fromDate=01/04/2025&toDate=30/06/2025${cc()}`, null, 'export Rent Schedule (quarter)'],
    ['GET', `/api/reports/sd-rent/export?dateFrom=01/04/2025&dateTo=30/06/2025`, null, 'export SD & Rent (quarter)'],
    ['GET', '/api/dashboard/export', null, 'export Dashboard'],
  ]), true]]],
  ['Save SD transaction', 3, () => [['POST', '/api/sd-transactions', {
    sdId: pick(sdIds), sdType: 'Landlord SD', fy: '2025-2026', txnDate: '15/10/2025', agreementStatus: 'Agreement', adjustmentAmount: '1', remarks: 'load test',
  }, 'save SD transaction']]],
];
const TOTAL_WEIGHT = PAGES.reduce((s, p) => s + p[1], 0);
function pickPage() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const p of PAGES) { r -= p[1]; if (r < 0) return p; }
  return PAGES[0];
}

async function openPage(token, [name, , build]) {
  const t = Date.now();
  const results = await Promise.all(build().map(([method, url, body, label, binary]) => call(token, method, url, body, { name: label, binary })));
  record(`page ${name}`, Date.now() - t, results.every((r) => r.ok), t);
}

async function login(user) {
  const t = Date.now();
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: user, password: 'Perf@12345' }) });
  const json = await res.json();
  record('api /api/auth/login', Date.now() - t, res.status === 200, t);
  if (!json.token) throw new Error(`login ${user}: ${json.message}`);
  return json.token;
}

async function virtualUser(n, until) {
  const token = await login(`perf${String(n).padStart(2, '0')}`);
  await sleep(rnd(THINK + 1));              // users do not all start together
  while (Date.now() < until) {
    await openPage(token, pickPage());
    await sleep(THINK * (0.5 + Math.random()));
  }
  await logout(token); // frees the User ID for the next run (one session per User ID)
}

const logout = (token) => fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});

// ------------------------------------------------------------------ heavy jobs
const jobs = [];
async function runJobs(token, start) {
  await sleep(Math.min(20000, DURATION * 0.2));
  let t = Date.now();
  const gen = await call(token, 'POST', '/api/rent/schedule/generate', { fromDate: FY.from, toDate: FY.to, filters: {} }, { name: 'job Rent Schedule generate (1 FY, all Rent Codes)' });
  jobs.push({ job: 'Rent Schedule generate (1 FY, all Rent Codes)', start: t - start, ms: gen.ms, ok: gen.ok });

  await sleep(10000);
  const codes = (await (await fetch(`${BASE}/api/sd-master?page=1&pageSize=200`, { headers: { Authorization: `Bearer ${token}` } })).json()).data.map((s) => s.sd_code);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SD Transactions');
  ws.addRow(['Transaction No.', 'SD Code', 'SD Type', 'FY', 'SD Transaction Date', 'Agreement Status', 'SD Paid Amount', 'SD Transfer Amount', 'SD Adjustment Amount', 'SD Refund Amount', 'Remarks']);
  for (let i = 0; i < 1000; i++) ws.addRow(['', codes[i % codes.length], 'Landlord SD', '2025-2026', '20/10/2025', 'Agreement', '', '', '1', '', `bulk ${i}`]);
  const form = new FormData();
  form.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'load.xlsx');
  t = Date.now();
  const up = await call(token, 'POST', '/api/sd-transactions/bulk-upload', form, { name: 'job SD transaction upload (1,000 rows)' });
  jobs.push({ job: 'SD transaction bulk upload (1,000 rows)', start: t - start, ms: up.ms, ok: up.ok });
}

// ------------------------------------------------------------------ run
(async () => {
  const admin = await login('perf60');
  sdIds = (await (await fetch(`${BASE}/api/sd-master?page=1&pageSize=200`, { headers: { Authorization: `Bearer ${admin}` } })).json()).data.map((s) => s.sd_id);
  ctxLookups.cc = (await (await fetch(`${BASE}/api/lookups/cost-centers`, { headers: { Authorization: `Bearer ${admin}` } })).json()).data.map((c) => c.id);
  delete samples['api /api/auth/login'];

  const start = Date.now();
  const until = start + DURATION;
  console.log(`${USERS} users, ${DURATION / 1000}s, think ${THINK}ms${JOBS ? ', with heavy jobs' : ''} -> ${BASE}`);

  // Every minute: server memory per worker, cache, connections (System Health); and
  // --kill-worker-at=SECONDS stops one web worker part-way (failover test)
  const health = [];
  const killAt = Number(arg('kill-worker-at', 0)) * 1000;
  const sampleHealth = async () => {
    try {
      const h = (await (await fetch(`${BASE}/api/system/health`, { headers: { Authorization: `Bearer ${admin}` } })).json()).data;
      health.push({
        second: Math.round((Date.now() - start) / 1000),
        workers: h.app.workers.map((w) => ({ pid: w.pid, rssMB: w.memoryMB.rss, heapMB: w.memoryMB.heapUsed, loopP99: w.eventLoopDelayMs.p99 })),
        restarts: h.app.cluster?.restarts ?? 0,
        cacheHits: h.app.workers.reduce((s, w) => s + w.cache.hits, 0), cacheMisses: h.app.workers.reduce((s, w) => s + w.cache.misses, 0),
        dbConnections: h.database.connections.reduce((s, c) => s + c.n, 0), dbCacheHitPercent: h.database.cacheHitPercent,
      });
      return h;
    } catch { return null; }
  };
  await sampleHealth();
  const healthTimer = setInterval(sampleHealth, 60000);
  let killed = null;
  const killTimer = killAt ? setTimeout(async () => {
    const h = await sampleHealth();
    const victim = h?.app.workers.find((w) => !w.reminders) || h?.app.workers[0];
    if (victim) { try { process.kill(victim.pid); killed = { pid: victim.pid, second: Math.round((Date.now() - start) / 1000) }; console.log(`Stopped web worker ${victim.pid}`); } catch (e) { console.log('kill failed', e.message); } }
  }, killAt) : null;

  await Promise.all([
    ...Array.from({ length: Math.min(USERS, 59) }, (_, i) => virtualUser(i + 1, until)),
    ...(JOBS ? [runJobs(admin, start)] : []),
  ]);
  clearInterval(healthTimer);
  if (killTimer) clearTimeout(killTimer);
  await sampleHealth();
  const seconds = (Date.now() - start) / 1000;
  await logout(admin);

  // Screens per minute (typical / 95%), to see stability over a long run
  const timeline = [];
  const allPages = Object.entries(samples).filter(([k]) => k.startsWith('page')).flatMap(([, l]) => l);
  for (let m = 0; m * 60000 < DURATION; m += 1) {
    const inMinute = allPages.filter((s) => s.at >= start + m * 60000 && s.at < start + (m + 1) * 60000);
    if (inMinute.length) { const s = summarise(inMinute); timeline.push({ minute: m + 1, pages: s.count, errors: s.errors, p50: s.p50, p95: s.p95 }); }
  }

  const rows = Object.entries(samples).filter(([k]) => !k.startsWith('job')).map(([name, list]) => ({ name, ...summarise(list) }))
    .sort((a, b) => (a.name.startsWith('page') === b.name.startsWith('page') ? b.p95 - a.p95 : a.name.startsWith('page') ? -1 : 1));
  const pages = Object.entries(samples).filter(([k]) => k.startsWith('page')).flatMap(([, l]) => l);
  const apis = Object.entries(samples).filter(([k]) => k.startsWith('api')).flatMap(([, l]) => l);
  // Screens while a heavy job ran vs the rest
  const during = (list) => list.filter((s) => jobs.some((j) => s.at >= start + j.start && s.at <= start + j.start + j.ms));
  const result = {
    config: { url: BASE, users: USERS, seconds: Math.round(seconds), thinkMs: THINK, jobs: JOBS },
    totals: { pages: pages.length, apiCalls: apis.length, apiPerSecond: +(apis.length / seconds).toFixed(1), errors: apis.filter((s) => !s.ok).length, validationRefusals: rejected, allPages: summarise(pages) },
    duringJobs: JOBS ? summarise(during(pages)) : undefined,
    jobs,
    killed,
    timeline,
    health,
    rows,
  };
  console.table(rows.map((r) => ({ name: r.name, n: r.count, err: r.errors, avg: r.avg, p50: r.p50, p95: r.p95, p99: r.p99, max: r.max })));
  console.log('Totals', JSON.stringify(result.totals));
  if (JOBS) { console.log('Heavy jobs', JSON.stringify(jobs)); console.log('Pages while jobs ran', JSON.stringify(result.duringJobs)); }
  if (killed) console.log("Worker stopped", JSON.stringify(killed), "restarts seen", health[health.length - 1]?.restarts);
  console.log("Memory per worker (MB, first -> last)", JSON.stringify(health.length ? health[0].workers.map((w) => w.rssMB) : []), "->", JSON.stringify(health.length ? health[health.length - 1].workers.map((w) => w.rssMB) : []));
  if (OUT) require('fs').writeFileSync(OUT, JSON.stringify(result, null, 2));
})().catch((err) => { console.error(err); process.exit(1); });
