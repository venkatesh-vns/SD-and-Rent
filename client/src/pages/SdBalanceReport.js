import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Pager from '../components/Pager';
import MultiSelect from '../components/MultiSelect';
import DateRangeFilter from '../components/DateRangeFilter';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import { formatAmount, formatDate } from '../utils/format';
import AmountTiles from '../components/AmountTiles';
import { AMOUNTS, amountClass } from '../config/amounts';

const PAGE_SIZE = 50;
// Multi-select filters hold arrays of values (empty = all)
const EMPTY_FILTERS = {
  search: '', costCenterId: [], l1Id: [], l2Id: [], landlordStatus: [], buildingStatus: [],
  leaseEndFrom: '', leaseEndTo: '', balanceDue: '', repayableDue: '',
};

// Report column -> kind of amount (colour and meaning in config/amounts.js)
const MONEY = [
  ['agreement_value', 'agreement'],
  ['total_paid', 'paid'],
  ['total_transfer', 'transfer'],
  ['total_adjustment', 'adjustment'],
  ['total_refund', 'refund'],
  ['sd_balance', 'balance'],
  ['sd_balance_repayable', 'repayable'],
];

// Tile values from the report totals
const tileValues = (t) => Object.fromEntries(MONEY.map(([col, kind]) => [kind, t[col]]));

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
  const [l2List, setL2List] = useState([]);
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

  // Level 2 choices follow the chosen Level 1s; picks outside them are dropped
  const l1Key = filters.l1Id.join(',');
  useEffect(() => {
    if (!l1Key) { setL2List([]); return; }
    api.get('/lookups/locations/2', { params: { parentId: l1Key } }).then((res) => setL2List(res.data.data)).catch(() => setL2List([]));
  }, [l1Key]);
  useEffect(() => {
    setFilters((f) => {
      const valid = new Set(l2List.map((l) => String(l.id)));
      const kept = f.l2Id.filter((id) => valid.has(String(id)));
      return kept.length === f.l2Id.length ? f : { ...f, l2Id: kept };
    });
  }, [l2List]);

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
          <MultiSelect
            allLabel="All cost centers" noun="cost centers"
            options={costCenters.map((c) => ({ value: c.id, label: c.name }))}
            value={filters.costCenterId} onChange={(v) => setFilter({ costCenterId: v })}
          />
          <MultiSelect
            allLabel="All Level 1" noun="Level 1"
            options={l1List.map((l) => ({ value: l.id, label: l.name }))}
            value={filters.l1Id} onChange={(v) => setFilter({ l1Id: v })}
          />
          <MultiSelect
            allLabel={filters.l1Id.length ? 'All Level 2' : 'Level 2'} noun="Level 2" disabled={!filters.l1Id.length}
            options={l2List.map((l) => ({ value: l.id, label: l.name }))}
            value={filters.l2Id} onChange={(v) => setFilter({ l2Id: v })}
          />
          <MultiSelect
            allLabel="Landlord: all" noun="statuses"
            options={['Active', 'Passive'].map((s) => ({ value: s, label: `Landlord: ${s}` }))}
            value={filters.landlordStatus} onChange={(v) => setFilter({ landlordStatus: v })}
          />
          <MultiSelect
            allLabel="Building: all" noun="statuses"
            options={['Active', 'Passive'].map((s) => ({ value: s, label: `Building: ${s}` }))}
            value={filters.buildingStatus} onChange={(v) => setFilter({ buildingStatus: v })}
          />
        </div>
        <div className="filter-bar">
          <DateRangeFilter label="Lease End" from={filters.leaseEndFrom} to={filters.leaseEndTo} onChange={({ from, to }) => setFilter({ leaseEndFrom: from, leaseEndTo: to })} />
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
          <div className="report-totals">
            <AmountTiles values={tileValues(totals)} lead={{ label: 'SD Codes', value: totals.count, hint: 'Matching the filters' }} />
          </div>
        )}

        {loading ? <p>Loading...</p> : rows.length === 0 ? <p className="empty-state">No records found.</p> : (
          <>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr className="group-row">
                    <th colSpan={7}>SD details</th>
                    <th className="tone-agreement">Agreed</th>
                    <th colSpan={4}>Payments and movements</th>
                    <th colSpan={2} className="tone-fill-head">Balances</th>
                    <th />
                  </tr>
                  <tr>
                    <th>SD Code</th><th>Lease / Agreement</th><th>Cost Center</th><th>Location</th><th>Landlord</th>
                    <th>Status</th><th>Lease End</th>
                    {MONEY.map(([col, kind]) => (
                      <th key={col} className={`num tone-head tone-${AMOUNTS[kind].tone}`} title={AMOUNTS[kind].hint}>{AMOUNTS[kind].label}</th>
                    ))}
                    <th className="num">Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sd_id}>
                      <td>{canTxn ? <Link to={`/sd-transactions?sd=${r.sd_id}`}>{r.sd_code}</Link> : r.sd_code}</td>
                      <td>{[r.lease_id, r.agreement_no].filter(Boolean).join(' / ') || '—'}</td>
                      <td>{r.cost_center_name}</td>
                      <td>
                        <strong>{r.l3_name}</strong>
                        <div className="hint">{r.l1_name} › {r.l2_name} · Floor {r.floor}</div>
                      </td>
                      <td>{r.landlord_name || '—'}</td>
                      <td>
                        {r.landlord_status === 'Active' && r.building_status === 'Active'
                          ? <span className="badge badge-active">Active</span>
                          : <span className="badge badge-passive">Passive</span>}
                      </td>
                      <td>{formatDate(r.lease_end_date) || '—'}</td>
                      {MONEY.map(([col, kind]) => <td key={col} className={amountClass(kind, r[col])}>{formatAmount(r[col])}</td>)}
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
