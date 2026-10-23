import React, { useCallback, useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Toast from '../components/Toast';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';

const mb = (bytes) => (bytes == null ? '—' : bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${(bytes / 1048576).toFixed(1)} MB`);
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
const dur = (s) => (s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const tone = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : 'bad');
const BUSINESS_LABELS = {
  cost_centers: 'Cost centers (buildings)', landlords: 'Landlords', sd_records: 'SD records', sd_transactions: 'SD transactions',
  rent_codes: 'Rent Codes', agreements: 'Rent agreements', schedule_lines: 'Rent Schedule lines', audit_entries: 'Audit Log entries',
};

// Requests per route across all workers: totals, weighted average, worst 95th percentile and max
function mergeRoutes(workers) {
  const by = new Map();
  workers.forEach((w) => w.routes.forEach((r) => {
    const m = by.get(r.route) || { route: r.route, count: 0, errors: 0, total: 0, p95Ms: 0, maxMs: 0 };
    m.count += r.count; m.errors += r.errors; m.total += r.avgMs * r.count;
    m.p95Ms = Math.max(m.p95Ms, r.p95Ms); m.maxMs = Math.max(m.maxMs, r.maxMs);
    by.set(r.route, m);
  }));
  return [...by.values()].map((m) => ({ ...m, avgMs: m.count ? Math.round(m.total / m.count) : 0 })).sort((a, b) => b.p95Ms - a.p95Ms);
}

function Tile({ label, value, sub, state }) {
  return (
    <div className={`health-tile health-${state || 'ok'}`}>
      <span className="health-tile-label">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// Administrators: how the application, database and backups are doing
export default function SystemHealth() {
  const { user } = useAuth();
  const [h, setH] = useState(null);
  const [logs, setLogs] = useState({ kind: 'slow-requests', rows: [] });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/system/health');
      setH(res.data.data);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load System Health.'));
    }
  }, []);
  const loadLogs = useCallback(async (kind) => {
    try {
      const res = await api.get('/system/logs', { params: { kind } });
      setLogs({ kind, rows: res.data.data });
    } catch { /* shown as empty */ }
  }, []);
  useEffect(() => { load(); loadLogs('slow-requests'); }, [load, loadLogs]);

  const backupNow = async () => {
    setBusy(true);
    try {
      const res = await api.post('/system/backup');
      setNotice(res.data.message);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Backup failed.'));
    } finally {
      setBusy(false);
    }
  };

  if (!user?.isAdmin) {
    return (<div><Navbar /><div className="page-container"><h1>Access denied</h1><p>System Health is for administrators.</p></div></div>);
  }

  const workers = h?.app.workers || [];
  const routes = h ? mergeRoutes(workers) : [];
  const totals = workers.reduce((t, w) => ({ requests: t.requests + w.totals.requests, errors: t.errors + w.totals.errors, slow: t.slow + w.totals.slow, hits: t.hits + w.cache.hits, misses: t.misses + w.cache.misses }), { requests: 0, errors: 0, slow: 0, hits: 0, misses: 0 });
  const db = h?.database;
  const bk = h?.backups;
  const backupAgeHours = bk?.lastGood ? (Date.now() - new Date(bk.lastGood.started_at).getTime()) / 3600000 : null;
  const connections = db ? db.connections.reduce((s, c) => s + c.n, 0) : 0;
  const maxConn = db ? Number(String(db.settings.max_connections).split(' ')[0]) : 100;

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <div>
            <h1>System Health</h1>
            <p className="hint">Application workers, database, backups and logs{h ? ` · ${h.host.hostname}, ${h.host.cpus} cores, ${h.host.totalMemoryGB} GB RAM · checked ${when(h.at)}` : ''}</p>
          </div>
          <div className="dash-actions">
            <button type="button" className="btn btn-secondary" onClick={() => { load(); loadLogs(logs.kind); }}>Refresh</button>
            <button type="button" className="btn btn-primary" onClick={backupNow} disabled={busy}>{busy ? 'Backing up...' : 'Back up now'}</button>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} duration={6000} />

        {!h ? <p>Loading...</p> : (
          <>
            <div className="health-tiles">
              <Tile label="Application" value={`${workers.length} of ${h.configuredWorkers} workers`}
                sub={h.app.cluster ? `${h.app.cluster.restarts} restart(s)${h.app.cluster.lastRestart ? `, last ${when(h.app.cluster.lastRestart.at)}` : ''}` : 'single process'}
                state={tone(workers.length >= h.configuredWorkers, workers.length > 0)} />
              <Tile label="Requests" value={num(totals.requests)} sub={`${num(totals.errors)} errors · ${num(totals.slow)} slow (> ${ms(h.slowRequestMs)})`}
                state={tone(!totals.errors && totals.slow <= totals.requests * 0.01, totals.errors <= 5)} />
              <Tile label="Response cache" value={totals.hits + totals.misses ? `${Math.round((totals.hits / (totals.hits + totals.misses)) * 100)}% hits` : '—'}
                sub={workers.every((w) => w.cache.listening) ? 'listening for changes' : 'not listening - bypassed'} state={tone(workers.every((w) => w.cache.listening), true)} />
              <Tile label="Database" value={mb(db.size_bytes)} sub={`${db.pingMs} ms ping · ${db.cacheHitPercent}% from memory`} state={tone(db.pingMs < 50 && db.cacheHitPercent >= 95, db.pingMs < 500)} />
              <Tile label="Connections" value={`${connections} of ${maxConn}`} sub={db.connections.map((c) => `${c.n} ${c.state}`).join(' · ')} state={tone(connections < maxConn * 0.7, connections < maxConn * 0.9)} />
              <Tile label="Logged in" value={num(h.sessions.open)} sub={`${h.sessions.responding} active now`} />
              <Tile label="Last backup" value={bk.lastGood ? when(bk.lastGood.started_at) : bk.enabled ? 'None yet' : 'Switched off'}
                sub={bk.lastGood ? `${mb(bk.lastGood.size_bytes)}${bk.lastGood.verified ? ' · verified' : ''} · ${bk.files} kept` : `Nightly at ${bk.time}`}
                state={bk.enabled ? tone(backupAgeHours !== null && backupAgeHours < 26, backupAgeHours !== null && backupAgeHours < 50) : 'warn'} />
              <Tile label="Backup disk free" value={mb(bk.freeBytes)} sub={bk.dir} state={tone(bk.freeBytes == null || bk.freeBytes > 10 * 1073741824, bk.freeBytes > 2 * 1073741824)} />
            </div>

            <h2 className="health-h2">Business data</h2>
            <div className="health-chips">
              {Object.entries(db.business).map(([k, v]) => <span key={k} className="chip">{BUSINESS_LABELS[k] || k}: <strong>{num(v)}</strong></span>)}
            </div>

            <h2 className="health-h2">Web workers</h2>
            <div className="table-wrap"><table className="data-table compact">
              <thead><tr><th>Process</th><th>Up for</th><th className="num">Memory</th><th className="num">Wait time p99</th><th className="num">Requests</th><th className="num">Errors</th><th className="num">Cache hits / misses</th><th>Jobs</th></tr></thead>
              <tbody>{workers.map((w) => (
                <tr key={w.pid}><td>{w.pid}</td><td>{dur(w.uptimeSeconds)}</td><td className="num">{w.memoryMB.rss} MB</td><td className="num">{ms(w.eventLoopDelayMs.p99)}</td>
                  <td className="num">{num(w.totals.requests)}</td><td className="num">{num(w.totals.errors)}</td><td className="num">{num(w.cache.hits)} / {num(w.cache.misses)}</td><td>{w.reminders ? 'Reminders, backup' : ''}</td></tr>
              ))}</tbody>
            </table></div>

            <h2 className="health-h2">Slowest requests <small className="hint">since the workers started; 95% of requests were at or under p95</small></h2>
            <div className="table-wrap"><table className="data-table compact">
              <thead><tr><th>Request</th><th className="num">Count</th><th className="num">Average</th><th className="num">p95</th><th className="num">Slowest</th><th className="num">Errors</th></tr></thead>
              <tbody>{routes.slice(0, 15).map((r) => (
                <tr key={r.route}><td><code>{r.route}</code></td><td className="num">{num(r.count)}</td><td className="num">{ms(r.avgMs)}</td><td className="num">{ms(r.p95Ms)}</td><td className="num">{ms(r.maxMs)}</td><td className="num">{r.errors || ''}</td></tr>
              ))}</tbody>
            </table></div>

            <h2 className="health-h2">Largest tables</h2>
            <div className="table-wrap"><table className="data-table compact">
              <thead><tr><th>Table</th><th className="num">Rows</th><th className="num">Size</th><th>Last vacuum</th><th>Last analyse</th></tr></thead>
              <tbody>{db.tables.map((t) => (
                <tr key={t.table_name}><td>{t.table_name}</td><td className="num">{num(t.rows)}</td><td className="num">{mb(t.size_bytes)}</td><td>{when(t.last_vacuum)}</td><td>{when(t.last_analyze)}</td></tr>
              ))}</tbody>
            </table></div>
            {db.longRunning.length > 0 && (
              <>
                <h2 className="health-h2">Queries running over 5 seconds</h2>
                <div className="table-wrap"><table className="data-table compact">
                  <thead><tr><th>PID</th><th>State</th><th className="num">Seconds</th><th>Query</th></tr></thead>
                  <tbody>{db.longRunning.map((q) => <tr key={q.pid}><td>{q.pid}</td><td>{q.state}</td><td className="num">{q.seconds}</td><td><code>{q.query}</code></td></tr>)}</tbody>
                </table></div>
              </>
            )}
            <p className="hint">{db.version} · up {dur(db.uptime_seconds)} · {Object.entries(db.settings).map(([k, v]) => `${k} ${v}`).join(' · ')} · {num(db.deadlocks)} deadlocks</p>

            <h2 className="health-h2">Backups <small className="hint">nightly at {bk.time}; keeps {bk.keepDaily} daily and {bk.keepMonthly} monthly copies in {bk.dir}</small></h2>
            <div className="table-wrap"><table className="data-table compact">
              <thead><tr><th>Started</th><th>Type</th><th>By</th><th>Result</th><th className="num">Size</th><th>Details</th></tr></thead>
              <tbody>{bk.runs.length === 0 ? <tr><td colSpan={6} className="hint">No backups yet.</td></tr> : bk.runs.map((r) => (
                <tr key={r.backup_id}><td>{when(r.started_at)}</td><td>{r.reason}</td><td>{r.started_by}</td>
                  <td>{r.ok === null ? 'Running' : <span className={`badge badge-${r.ok ? 'active' : 'inactive'}`}>{r.ok ? 'OK' : 'Failed'}</span>}</td>
                  <td className="num">{mb(r.size_bytes)}</td><td>{r.message}</td></tr>
              ))}</tbody>
            </table></div>

            <h2 className="health-h2">Logs <small className="hint">{h.logDir}</small></h2>
            <div className="seg-toggle">
              {[['slow-requests', 'Slow requests'], ['errors', 'Server errors']].map(([k, label]) => (
                <button key={k} type="button" className={logs.kind === k ? 'active' : ''} onClick={() => loadLogs(k)}>{label}</button>
              ))}
            </div>
            <div className="table-wrap"><table className="data-table compact">
              <thead><tr><th>When</th><th>User</th><th>Request</th><th className="num">Status</th><th className="num">Time</th></tr></thead>
              <tbody>{logs.rows.length === 0 ? <tr><td colSpan={5} className="hint">Nothing this month.</td></tr> : logs.rows.map((l, i) => (
                <tr key={i}><td>{when(l.at)}</td><td>{l.user || '—'}</td><td><code>{l.method} {l.url}</code></td><td className="num">{l.status}</td><td className="num">{ms(l.ms)}</td></tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </div>
    </div>
  );
}
