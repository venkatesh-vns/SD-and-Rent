import React, { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../services/api';

const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const ago = (seconds) => (seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min ago`);

// Administrators: who is logged in now, and End session (one session per User ID)
export default function ActiveSessions({ onNotice }) {
  const [rows, setRows] = useState([]);
  const [info, setInfo] = useState({ idleMinutes: 30, liveMinutes: 3 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/users/sessions');
      setRows(res.data.data);
      setInfo({ idleMinutes: res.data.idleMinutes, liveMinutes: res.data.liveMinutes });
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load the active sessions.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const end = async (s) => {
    if (!window.confirm(`End ${s.user_name}'s session on ${s.client_label} (${s.ip_address})? They will be logged out and can log in again.`)) return;
    setBusy(s.session_id);
    try {
      const res = await api.post(`/users/sessions/${s.session_id}/end`);
      onNotice?.(res.data.message);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not end the session.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="active-sessions" aria-labelledby="active-sessions-title">
      <div className="active-sessions-head">
        <h2 id="active-sessions-title">Active sessions <span className="multi-select-count">{rows.length}</span></h2>
        <button type="button" className="btn btn-small btn-secondary" onClick={load}>Refresh</button>
      </div>
      <p className="hint">
        Each User ID can be logged in on one browser or PC at a time. Sessions end at logout, after {info.idleMinutes} minutes
        without activity, or here. A session shown as "Not responding" belongs to a closed browser and frees the login within {info.liveMinutes} minutes.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {rows.length === 0 ? <p className="empty-state">No one is logged in.</p> : (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr><th>User</th><th>Browser / device</th><th>IP address</th><th>Logged in</th><th>Last activity</th><th>Status</th><th className="actions-head">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.session_id}>
                  <td><strong>{s.user_name}</strong>{s.is_admin && <span className="hint"> (admin)</span>}</td>
                  <td>{s.client_label}</td>
                  <td>{s.ip_address}</td>
                  <td>{fmt(s.started_at)}</td>
                  <td>{ago(s.idle_seconds)}</td>
                  <td>
                    {s.responding
                      ? <span className="badge badge-active">Active</span>
                      : <span className="badge badge-passive" title="No heartbeat: the browser was probably closed">Not responding</span>}
                  </td>
                  <td className="actions-cell">
                    {s.is_current ? <span className="hint">This session</span> : (
                      <button type="button" className="btn btn-small btn-danger" disabled={busy === s.session_id} onClick={() => end(s)}>
                        {busy === s.session_id ? 'Ending...' : 'End session'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
