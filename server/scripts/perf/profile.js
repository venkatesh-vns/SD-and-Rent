/**
 * SQL profile of API requests: starts the app in-process against a performance
 * database, runs the requests, and lists the statements by total time.
 *
 *   node scripts/perf/profile.js --db=sd_rent_perf_3x "GET /api/dashboard" "GET /api/reports/sd-rent/options" "UPLOAD /api/sd-transactions/bulk-upload 1000"
 *
 * UPLOAD builds an SD transaction file with that many rows (adjustment of 1 on the
 * first 200 SD Codes).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const arg = (name, fallback) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=').slice(1).join('=') : fallback;
};
process.env.DB_NAME = arg('db', 'sd_rent_perf_3x');
if (!/^sd_rent_perf_/.test(process.env.DB_NAME)) throw new Error('Profile only performance databases (sd_rent_perf_*).');
process.env.EMAIL_DRY_RUN = 'true';
process.env.AUTH_RATE_LIMIT = '100000';

const { Client } = require('pg');
const stats = new Map();
let tracing = false;
const origQuery = Client.prototype.query;
Client.prototype.query = function traced(config, values, cb) {
  if (!tracing || !config || (typeof config !== 'string' && !config.text)) return origQuery.call(this, config, values, cb);
  const sql = String(typeof config === 'string' ? config : config.text).replace(/\s+/g, ' ').trim();
  const key = sql.slice(0, 110);
  const t = process.hrtime.bigint();
  const done = () => {
    const s = stats.get(key) || { n: 0, ms: 0 };
    s.n += 1;
    s.ms += Number(process.hrtime.bigint() - t) / 1e6;
    stats.set(key, s);
  };
  // pg's Pool calls query(config, values, callback); others await the promise
  const callback = typeof values === 'function' ? values : cb;
  if (typeof callback === 'function') {
    const wrapped = (err, res) => { done(); callback(err, res); };
    return typeof values === 'function' ? origQuery.call(this, config, wrapped) : origQuery.call(this, config, values, wrapped);
  }
  const p = origQuery.call(this, config, values);
  p.then(done, done);
  return p;
};

const app = require('../../app');
const ExcelJS = require('exceljs');
const requests = process.argv.slice(2).filter((a) => !a.startsWith('--'));

(async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const login = await (await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: 'perf59', password: 'Perf@12345' }),
  })).json();
  const auth = { Authorization: `Bearer ${login.token}` };

  for (const r of requests) {
    const [method, url, rows] = r.split(' ');
    let init = { method, headers: auth };
    if (method === 'UPLOAD') {
      const codes = (await (await fetch(`${base}/api/sd-master?page=1&pageSize=200`, { headers: auth })).json()).data.map((s) => s.sd_code);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('SD Transactions');
      ws.addRow(['Transaction No.', 'SD Code', 'SD Type', 'FY', 'SD Transaction Date', 'Agreement Status', 'SD Paid Amount', 'SD Transfer Amount', 'SD Adjustment Amount', 'SD Refund Amount', 'Remarks']);
      for (let i = 0; i < Number(rows || 1000); i++) ws.addRow(['', codes[i % codes.length], 'Landlord SD', '2025-2026', '20/10/2025', 'Agreement', '', '', '1', '', `profile ${i}`]);
      const form = new FormData();
      form.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'profile.xlsx');
      init = { method: 'POST', headers: auth, body: form };
    }
    stats.clear();
    tracing = true;
    const t = Date.now();
    const res = await fetch(base + url, init);
    const body = await res.arrayBuffer();
    tracing = false;
    const total = Date.now() - t;
    const sqlMs = [...stats.values()].reduce((a, s) => a + s.ms, 0);
    console.log(`\n${r} -> ${res.status}, ${total} ms total, ${Math.round(sqlMs)} ms in ${[...stats.values()].reduce((a, s) => a + s.n, 0)} SQL statements, ${(body.byteLength / 1024).toFixed(0)} KB`);
    [...stats.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 6)
      .forEach(([k, s]) => console.log(`  ${Math.round(s.ms).toString().padStart(6)} ms ${String(s.n).padStart(5)}x  ${k}`));
  }
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: auth }); // one session per User ID
  server.close();
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
