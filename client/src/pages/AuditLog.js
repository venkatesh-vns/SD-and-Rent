import React, { useEffect, useState, useCallback, Fragment } from 'react';
import Navbar from '../components/Navbar';
import Pager from '../components/Pager';
import MultiSelect from '../components/MultiSelect';
import DateRangeFilter from '../components/DateRangeFilter';
import api, { downloadFile, errorMessage } from '../services/api';
import useDebounce from '../hooks/useDebounce';
import { formatDateTime } from '../utils/format';

const PAGE_SIZE = 50;
const TABLES = [
  ['users', 'Users'], ['user_rights', 'User Rights'], ['cost_centers', 'Cost Centers'],
  ['location_l1', 'Location Level 1'], ['location_l2', 'Location Level 2'], ['location_l3', 'Location Level 3'],
  ['sd_master', 'SD Master'], ['sd_transactions', 'SD Transactions'],
];
const ACTIONS = ['INSERT', 'UPDATE', 'DELETE', 'UPLOAD', 'STATUS_CHANGE', 'RIGHTS_CHANGE', 'LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET'];
// Multi-select filters hold arrays of values (empty = all)
const EMPTY_FILTERS = { search: '', tableName: [], action: [], dateFrom: '', dateTo: '' };
const TABLE_LABEL = Object.fromEntries(TABLES);
const HIDDEN = new Set(['created_date', 'modified_date', 'created_by', 'modified_by', 'uploaded_by', 'uploaded_date']);

// Fields whose value differs between the old and new record
function changedFields(oldValues, newValues) {
  if (!oldValues || !newValues) return [];
  return Object.keys(newValues)
    .filter((k) => !HIDDEN.has(k) && JSON.stringify(oldValues[k]) !== JSON.stringify(newValues[k]))
    .map((k) => ({ field: k, from: oldValues[k], to: newValues[k] }));
}

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [open, setOpen] = useState(null); // audit_id shown in full
  const search = useDebounce(filters.search);
  const query = { ...filters, search };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/logs/audit', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data);
      setTotal(res.data.total);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the audit log.'));
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

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <h1>Audit Log</h1>
          <button type="button" className="btn btn-secondary"
            onClick={() => downloadFile('/logs/audit/export', query, 'Audit_Log.xlsx').catch(() => setError('Export failed.'))}>
            Export to Excel
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="filter-bar">
          <input type="search" placeholder="Search user, details, values or record ID" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <MultiSelect
            allLabel="All records" noun="record types"
            options={TABLES.map(([v, l]) => ({ value: v, label: l }))}
            value={filters.tableName} onChange={(v) => setFilter({ tableName: v })}
          />
          <MultiSelect allLabel="All actions" noun="actions" options={ACTIONS} value={filters.action} onChange={(v) => setFilter({ action: v })} />
          <DateRangeFilter label="Date" from={filters.dateFrom} to={filters.dateTo} onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
        </div>

        {loading ? <p>Loading...</p> : rows.length === 0 ? <p className="empty-state">No audit entries.</p> : (
          <>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr><th>Date/Time</th><th>Record</th><th>ID</th><th>Action</th><th>By</th><th>Details / changes</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const changes = changedFields(r.old_values, r.new_values);
                    return (
                      <Fragment key={r.audit_id}>
                        <tr>
                          <td>{formatDateTime(r.action_date)}</td>
                          <td>{TABLE_LABEL[r.table_name] || r.table_name}</td>
                          <td>{r.record_id}</td>
                          <td>{r.action}</td>
                          <td>{r.action_by}</td>
                          <td>
                            {r.details && <div>{r.details}</div>}
                            {changes.slice(0, 3).map((c) => (
                              <div key={c.field} className="hint">{c.field}: {String(c.from ?? '—')} → {String(c.to ?? '—')}</div>
                            ))}
                            {changes.length > 3 && <div className="hint">+{changes.length - 3} more</div>}
                          </td>
                          <td>
                            {(r.old_values || r.new_values) && (
                              <button type="button" className="btn btn-small btn-secondary" onClick={() => setOpen(open === r.audit_id ? null : r.audit_id)}>
                                {open === r.audit_id ? 'Hide' : 'Values'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {open === r.audit_id && (
                          <tr className="audit-values">
                            <td colSpan={7}>
                              <div className="audit-json">
                                {r.old_values && <div><strong>Before</strong><pre>{JSON.stringify(r.old_values, null, 2)}</pre></div>}
                                {r.new_values && <div><strong>After</strong><pre>{JSON.stringify(r.new_values, null, 2)}</pre></div>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
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
