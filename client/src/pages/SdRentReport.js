import React, { useCallback, useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import MultiSelect from '../components/MultiSelect';
import DateRangeFilter from '../components/DateRangeFilter';
import Pager from '../components/Pager';
import api, { downloadFile, errorMessage } from '../services/api';
import { formatAmount, formatDate } from '../utils/format';
import { presetRange } from '../utils/dateRanges';

const PAGE_SIZE = 100;
const fy = presetRange('thisFy');
const EMPTY_FILTERS = {
  costCenterId: [], landlordName: [], floor: [], sdId: [], expenseHead: [], category: [], status: [],
  dateFrom: fy.from, dateTo: fy.to,
};
const VIEWS = [
  ['lines', 'All transactions'],
  ['costCenter', 'By Cost Center'],
  ['landlord', 'By Landlord'],
  ['expenseHead', 'By Expense Head'],
  ['floor', 'By Floor'],
  ['month', 'By Month'],
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORY_TONE = { 'Security Deposit': 'balance', Rent: 'paid', Maintenance: 'out' };
const money = (v) => `₹${formatAmount(v)}`;

export default function SdRentReport() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState('lines');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [totals, setTotals] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [options, setOptions] = useState({ landlords: [], floors: [], sdCodes: [], expenseHeads: [], categories: [] });
  const [costCenters, setCostCenters] = useState([]);
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const lines = await api.get('/reports/sd-rent', { params: { ...filters, page: view === 'lines' ? page : 1, pageSize: view === 'lines' ? PAGE_SIZE : 1 } });
      setTotals(lines.data.totals);
      if (view === 'lines') {
        setRows(lines.data.data);
        setTotal(lines.data.total);
      } else {
        setSummary((await api.get('/reports/sd-rent/summary', { params: { ...filters, groupBy: view } })).data.data);
      }
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the report.'));
    } finally {
      setLoading(false);
    }
  }, [key, page, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/reports/sd-rent/options').then((res) => setOptions(res.data.data)).catch(() => {});
    api.get('/lookups/cost-centers').then((res) => setCostCenters(res.data.data)).catch(() => {});
  }, []);

  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const groupLabel = (k) => (view === 'month' && k ? `${MONTHS[+k.slice(5, 7) - 1]}-${k.slice(0, 4)}` : k);

  return (
    <div>
      <Navbar />
      <div className="page-container wide sd-rent-report">
        <div className="page-header">
          <div>
            <h1>SD &amp; Rent Transaction Summary Report</h1>
            <p className="hint">
              Security Deposit transactions and Rent Schedule months in one list. SD amount = Paid − Transfer − Adjustment − Refund;
              Rent / Maintenance amount = final monthly rent from the generated Rent Schedule.
            </p>
          </div>
          <div className="dash-actions">
            <button type="button" className="btn btn-outline" onClick={() => downloadFile('/reports/sd-rent/export', filters, 'SD_Rent_Transaction_Summary.xlsx').catch(() => setError('Export failed.'))}>Export to Excel</button>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>Export to PDF</button>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="filter-bar">
          <DateRangeFilter label="Effective Date" from={filters.dateFrom} to={filters.dateTo} onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })} />
          <MultiSelect allLabel="All cost centers" noun="cost centers" options={costCenters.map((c) => ({ value: c.id, label: c.name }))} value={filters.costCenterId} onChange={(v) => setFilter({ costCenterId: v })} />
          <MultiSelect allLabel="All landlords" noun="landlords" options={options.landlords} value={filters.landlordName} onChange={(v) => setFilter({ landlordName: v })} />
          <MultiSelect allLabel="All floors" noun="floors" options={options.floors} value={filters.floor} onChange={(v) => setFilter({ floor: v })} />
          <MultiSelect allLabel="All SD Codes" noun="SD Codes" options={options.sdCodes.map((s) => ({ value: s.id, label: s.name }))} value={filters.sdId} onChange={(v) => setFilter({ sdId: v })} />
          <MultiSelect allLabel="All Expense Heads" noun="heads" options={options.expenseHeads} value={filters.expenseHead} onChange={(v) => setFilter({ expenseHead: v })} />
          <MultiSelect allLabel="All categories" noun="categories" options={options.categories} value={filters.category} onChange={(v) => setFilter({ category: v })} />
          <MultiSelect allLabel="Status: all" noun="statuses" options={['Active', 'Inactive']} value={filters.status} onChange={(v) => setFilter({ status: v })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
        </div>

        {totals && (
          <div className="sd-tiles rent-tiles">
            <div className="tile"><span>Transactions</span><strong>{totals.lines}</strong></div>
            <div className="tile tone-balance"><span>Security Deposit (net)</span><strong>{money(totals.sd_amount)}</strong></div>
            <div className="tile tone-paid"><span>Rent</span><strong>{money(totals.rent_amount)}</strong></div>
            <div className="tile tone-out"><span>Maintenance</span><strong>{money(totals.maintenance_amount)}</strong></div>
            <div className="tile tone-agreement"><span>Total</span><strong>{money(totals.total_amount)}</strong></div>
          </div>
        )}

        <div className="seg-toggle rent-view" role="group" aria-label="View">
          {VIEWS.map(([k, label]) => (
            <button key={k} type="button" className={view === k ? 'on' : undefined} onClick={() => { setView(k); setPage(1); }}>{label}</button>
          ))}
        </div>

        {loading ? <p>Loading...</p> : view === 'lines' ? (
          rows.length === 0 ? <p className="empty-state">No SD or Rent transactions for these filters.</p> : (
            <>
              <div className="table-wrap freeze">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Cost Center</th><th>SD Code</th><th>Landlord Name</th><th>Floor</th><th>Rent Code</th><th>Agreement No.</th>
                      <th>Rent Expense Head</th><th>Expense Category</th><th>Effective Date</th>
                      <th className="num">Monthly Rent / SD Amount</th><th>Status</th><th>Reference</th><th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row_key}>
                        <td>{r.cost_center_name}</td>
                        <td className="code-cell">{r.sd_code}</td>
                        <td>{r.landlord_name}</td>
                        <td>{r.floor}</td>
                        <td>{r.rent_code || '—'}</td>
                        <td>{r.agreement_no || '—'}</td>
                        <td>{r.expense_head}</td>
                        <td><span className={`category-chip tone-${CATEGORY_TONE[r.expense_category]}`}>{r.expense_category}</span></td>
                        <td>{formatDate(r.effective_date)}</td>
                        <td className={`num tone-${CATEGORY_TONE[r.expense_category]}${Number(r.amount) < 0 ? ' amount-negative' : ''}`}><strong>{formatAmount(r.amount)}</strong></td>
                        <td><span className={`badge badge-${r.status.toLowerCase()}`}>{r.status}</span></td>
                        <td>{r.reference}</td>
                        <td className="hint">{r.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
            </>
          )
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{VIEWS.find(([k]) => k === view)[1].replace('By ', '')}</th><th className="num">Transactions</th>
                  <th className="num tone-head tone-balance">Security Deposit (net)</th><th className="num tone-head tone-paid">Rent</th>
                  <th className="num tone-head tone-out">Maintenance</th><th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 && <tr><td colSpan={6} className="empty-state">No SD or Rent transactions for these filters.</td></tr>}
                {summary.map((s) => (
                  <tr key={s.group_key}>
                    <td><strong>{groupLabel(s.group_key)}</strong></td>
                    <td className="num">{s.lines}</td>
                    <td className="num tone-balance">{formatAmount(s.sd_amount)}</td>
                    <td className="num tone-paid">{formatAmount(s.rent_amount)}</td>
                    <td className="num tone-out">{formatAmount(s.maintenance_amount)}</td>
                    <td className="num"><strong>{formatAmount(s.total_amount)}</strong></td>
                  </tr>
                ))}
              </tbody>
              {summary.length > 0 && totals && (
                <tfoot>
                  <tr>
                    <th>Total</th><td className="num">{totals.lines}</td><td className="num">{formatAmount(totals.sd_amount)}</td>
                    <td className="num">{formatAmount(totals.rent_amount)}</td><td className="num">{formatAmount(totals.maintenance_amount)}</td>
                    <td className="num"><strong>{formatAmount(totals.total_amount)}</strong></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="hint report-note">Rent rows appear once the Rent Schedule has been generated for the period (Rent Transaction &gt; Rent Schedule).</p>
      </div>
    </div>
  );
}
