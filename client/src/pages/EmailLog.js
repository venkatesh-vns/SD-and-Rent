import React, { useEffect, useState, useCallback } from 'react';
import Toast from '../components/Toast';
import Navbar from '../components/Navbar';
import Pager from '../components/Pager';
import MultiSelect from '../components/MultiSelect';
import DateRangeFilter from '../components/DateRangeFilter';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import useDebounce from '../hooks/useDebounce';
import { formatDateTime } from '../utils/format';

const PAGE_SIZE = 50;
const TYPES = [
  'LANDLORD_STATUS_PASSIVE', 'BUILDING_STATUS_PASSIVE', 'LEASE_COMMENCEMENT_REMINDER',
  'RENT_COMMENCEMENT_REMINDER', 'LEASE_END_REMINDER', 'PASSWORD_RESET',
];
// Multi-select filters hold arrays of values (empty = all)
const EMPTY_FILTERS = { search: '', notificationType: [], status: [], dateFrom: '', dateTo: '' };
const STATUSES = [{ value: 'Sent', label: 'Sent' }, { value: 'Failed', label: 'Failed' }, { value: 'DryRun', label: 'Dry run (not sent)' }];
const label = (t) => t.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function EmailLog() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [asOf, setAsOf] = useState('');
  const [running, setRunning] = useState(false);
  const search = useDebounce(filters.search);
  const query = { ...filters, search };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/logs/email', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data);
      setTotal(res.data.total);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the email log.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), page]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const runReminders = async () => {
    setRunning(true);
    setError('');
    setNotice('');
    try {
      const res = await api.post('/notifications/run-reminders', asOf ? { asOf } : {});
      const r = res.data.data;
      setNotice(r.skipped
        ? r.reason
        : `Reminders for ${r.asOf.split('-').reverse().join('/')}: ${r.sent} sent, ${r.failed} failed.`);
      fetchRows();
    } catch (err) {
      setError(errorMessage(err, 'Reminder run failed.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <div>
            <h1>Email Log</h1>
            <p className="hint">The last 5 months (plus reminders for lease dates still to come). Older entries are archived automatically every night.</p>
          </div>
          <button type="button" className="btn btn-secondary"
            onClick={() => downloadFile('/logs/email/export', query, 'Email_Log.xlsx').catch(() => setError('Export failed.'))}>
            Export to Excel
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} />

        {user?.isAdmin && (
          <div className="upload-panel run-panel">
            <strong>Run date reminders now</strong>
            <span className="hint">Normally runs daily. Leave the date blank for today, or enter a date to test as if it were that day.</span>
            <input className="short" type="text" placeholder="DD/MM/YYYY (optional)" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={running} onClick={runReminders}>
              {running ? 'Running...' : 'Run reminders'}
            </button>
          </div>
        )}

        <div className="filter-bar">
          <input type="search" placeholder="Search SD Code, recipient or subject" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <MultiSelect
            allLabel="All notification types" noun="types"
            options={TYPES.map((t) => ({ value: t, label: label(t) }))}
            value={filters.notificationType} onChange={(v) => setFilter({ notificationType: v })}
          />
          <MultiSelect allLabel="All statuses" noun="statuses" options={STATUSES} value={filters.status} onChange={(v) => setFilter({ status: v })} />
          <DateRangeFilter label="Sent" from={filters.dateFrom} to={filters.dateTo} onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
        </div>

        {loading ? <p>Loading...</p> : rows.length === 0 ? <p className="empty-state">No emails logged.</p> : (
          <>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr><th>Date/Time Sent</th><th>SD Code</th><th>Notification Type</th><th>Recipient</th><th>Subject</th><th>Trigger Event</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.email_log_id}>
                      <td>{formatDateTime(r.sent_at)}</td>
                      <td>{r.sd_code || '—'}</td>
                      <td>{label(r.notification_type)}</td>
                      <td>{r.recipient}</td>
                      <td>{r.subject}</td>
                      <td>{r.trigger_event}</td>
                      <td title={r.error_message || undefined}>
                        <span className={`badge badge-${r.status === 'Sent' ? 'active' : r.status === 'Failed' ? 'inactive' : 'passive'}`}>
                          {r.status === 'DryRun' ? 'Dry run' : r.status}
                        </span>
                        {r.error_message && <div className="hint">{r.error_message}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
