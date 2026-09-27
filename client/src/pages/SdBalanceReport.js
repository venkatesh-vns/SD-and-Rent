import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Pager from '../components/Pager';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import { formatAmount, formatDate } from '../utils/format';

const PAGE_SIZE = 50;
const EMPTY_FILTERS = {
  search: '', costCenterId: '', l1Id: '', landlordStatus: '', buildingStatus: '',
  leaseEndFrom: '', leaseEndTo: '', balanceDue: '', repayableDue: '',
};

const MONEY = [
  ['agreement_value', 'Agreement Value'],
  ['total_paid', 'Paid'],
  ['total_transfer', 'Transfer'],
  ['total_adjustment', 'Adjustment'],
  ['total_refund', 'Refund'],
  ['sd_balance', 'SD Balance'],
  ['sd_balance_repayable', 'Repayable'],
];

export default function SdBalanceReport() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [costCenters, setCostCenters] = useState([]);
  const [l1List, setL1List] = useState([]);
  const search = useDebounce(filters.search);
  const query = { ...filters, search };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/sd-balance', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data);
      setTotal(res.data.total);
      setTotals(res.data.totals);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the report.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), page]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => {
    api.get('/lookups/cost-centers').then((res) => setCostCenters(res.data.data)).catch(() => {});
    api.get('/lookups/locations/1').then((res) => setL1List(res.data.data)).catch(() => {});
  }, []);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const canTxn = can(SCREENS.SD_TRANSACTION, 'view');

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <h1>SD Balance Report</h1>
          <button type="button" className="btn btn-secondary"
            onClick={() => downloadFile('/reports/sd-balance/export', query, 'SD_Balance_Report.xlsx').catch(() => setError('Export failed.'))}>
            Export to Excel
          </button>
        </div>
        <p className="hint">One row per SD Code. SD Balance = Agreement Value − Paid; Repayable = Paid − Transfer − Refund − Adjustment.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="filter-bar">
          <input type="search" placeholder="Search SD Code, Lease ID, Agreement No., Landlord, Floor" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <select value={filters.costCenterId} onChange={(e) => setFilter({ costCenterId: e.target.value })}>
            <option value="">All cost centers</option>
            {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
          </select>
          <select value={filters.l1Id} onChange={(e) => setFilter({ l1Id: e.target.value })}>
            <option value="">All Level 1</option>
            {l1List.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={filters.landlordStatus} onChange={(e) => setFilter({ landlordStatus: e.target.value })}>
            <option value="">Landlord: all</option>
            <option value="Active">Landlord: Active</option>
            <option value="Passive">Landlord: Passive</option>
          </select>
          <select value={filters.buildingStatus} onChange={(e) => setFilter({ buildingStatus: e.target.value })}>
            <option value="">Building: all</option>
            <option value="Active">Building: Active</option>
            <option value="Passive">Building: Passive</option>
          </select>
        </div>
        <div className="filter-bar">
          <input className="short" type="text" placeholder="Lease end from DD/MM/YYYY" value={filters.leaseEndFrom} onChange={(e) => setFilter({ leaseEndFrom: e.target.value })} />
          <input className="short" type="text" placeholder="Lease end to DD/MM/YYYY" value={filters.leaseEndTo} onChange={(e) => setFilter({ leaseEndTo: e.target.value })} />
          <label className="inline-check">
            <input type="checkbox" checked={filters.balanceDue === 'true'} onChange={(e) => setFilter({ balanceDue: e.target.checked ? 'true' : '' })} />
            SD Balance &gt; 0
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={filters.repayableDue === 'true'} onChange={(e) => setFilter({ repayableDue: e.target.checked ? 'true' : '' })} />
            Repayable &gt; 0
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
        </div>

        {totals && (
          <div className="sd-tiles report-totals">
            <div><span>SD Codes</span><strong>{totals.count}</strong></div>
            {MONEY.map(([key, label]) => (
              <div key={key} className={key.startsWith('sd_') ? 'key' : undefined}><span>{label}</span><strong>{formatAmount(totals[key])}</strong></div>
            ))}
          </div>
        )}

        {loading ? <p>Loading...</p> : rows.length === 0 ? <p className="empty-state">No records found.</p> : (
          <>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>SD Code</th><th>Lease / Agreement</th><th>Cost Center</th><th>Location</th><th>Landlord</th>
                    <th>Status</th><th>Lease End</th>
                    {MONEY.map(([key, label]) => <th key={key} className="num">{label}</th>)}
                    <th className="num">Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sd_id}>
                      <td>{canTxn ? <Link to={`/sd-transactions?sd=${r.sd_id}`}>{r.sd_code}</Link> : r.sd_code}</td>
                      <td>{[r.lease_id, r.agreement_no].filter(Boolean).join(' / ') || '—'}</td>
                      <td>{r.cost_center_code}</td>
                      <td>{r.l1_name} › {r.l2_name} › {r.l3_name} · Fl {r.floor}</td>
                      <td>{r.landlord_name || '—'}</td>
                      <td>
                        {r.landlord_status === 'Active' && r.building_status === 'Active'
                          ? <span className="badge badge-active">Active</span>
                          : <span className="badge badge-passive">Passive</span>}
                      </td>
                      <td>{formatDate(r.lease_end_date) || '—'}</td>
                      {MONEY.map(([key]) => <td key={key} className="num">{formatAmount(r[key])}</td>)}
                      <td className="num">{r.txn_count}</td>
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
