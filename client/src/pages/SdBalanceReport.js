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
import useReturnState from '../hooks/useReturnState';
import useCascadeOptions from '../hooks/useCascadeOptions';
import { formatAmount, formatDate } from '../utils/format';
import AmountTiles from '../components/AmountTiles';
import { AMOUNTS, amountClass } from '../config/amounts';

const PAGE_SIZE = 50;
// Multi-select filters hold arrays of values (empty = all)
const EMPTY_FILTERS = {
  search: '', costCenterId: [], l1Id: [], l2Id: [], landlordStatus: [], buildingStatus: [],
  leaseEndFrom: '', leaseEndTo: '', balanceDue: '', repayableDue: '', agreementStatus: [], floor: [], landlordName: [],
};

// Report column -> kind of amount (colour and meaning in config/amounts.js), optional label.
// SD Paid shows payments, reversals (negative SD Paid entries) and the net that the
// balances use; the tiles take the net (last 'paid' column).
const MONEY = [
  ['agreement_value', 'agreement'],
  ['total_payments', 'paid', 'SD Paid (payments)', 'Positive SD Paid entries'],
  ['total_reversal', 'paid', 'Reversals', 'Negative SD Paid (reversal) entries'],
  ['total_paid', 'paid', 'Net SD Paid', 'Payments less reversals - used for SD Balance and Repayable'],
  ['total_transfer', 'transfer'],
  ['total_adjustment', 'adjustment'],
  ['total_refund', 'refund'],
  ['sd_balance', 'balance'],
  ['sd_balance_repayable', 'repayable'],
];

// Tile values from the report totals
const AGREEMENT_STATUSES = ['LOI', 'Agreement', 'Registered Agreement', 'Addendum Agreement', 'Mail Approval'];
// Amounts shown per Agreement Status line (Agreement Value and SD Balance are per SD Code)
const LINE_MONEY = MONEY.filter(([col]) => !['agreement_value', 'sd_balance', 'sd_balance_repayable'].includes(col));
const NO_LINES = [{ agreement_status: '—', total_payments: 0, total_reversal: 0, total_paid: 0, total_transfer: 0, total_adjustment: 0, total_refund: 0, sd_balance_repayable: 0 }];
const moneyCell = (kind, value, key, extra = '') => (
  <td key={key} className={`${amountClass(kind, value)}${Number(value) < 0 ? ' amount-negative' : ''}${extra}`}>{formatAmount(value)}</td>
);

const tileValues = (t) => Object.fromEntries(MONEY.map(([col, kind]) => [kind, t[col]]));

export default function SdBalanceReport() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  // Filters, page and scroll come back as they were via "Back to SD Balance Report"
  const back = useReturnState('sd-balance', !loading);
  const [page, setPage] = useState(() => back.saved?.page || 1);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(() => back.saved?.filters || EMPTY_FILTERS);
  useEffect(() => { back.save({ filters, page }); }, [filters, page, back]);
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
    const keepValid = (list) => setFilters((f) => {
      const valid = new Set(list.map((l) => String(l.id)));
      const kept = f.l2Id.filter((id) => valid.has(String(id)));
      return kept.length === f.l2Id.length ? f : { ...f, l2Id: kept };
    });
    if (!l1Key) { setL2List([]); keepValid([]); return; }
    api.get('/lookups/locations/2', { params: { parentId: l1Key } })
      .then((res) => { setL2List(res.data.data); keepValid(res.data.data); })
      .catch(() => setL2List([]));
  }, [l1Key]);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  // Landlord choices follow Cost Center; Floor choices follow Cost Center and Landlord
  const options = useCascadeOptions('sd', filters, setFilters);

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
        <p className="hint">One block per SD Code with a line per Agreement Status. Agreement Value and SD Balance appear once per SD Code and are counted once in the Grand Total at the bottom. SD Balance = Agreement Value − Net SD Paid; Repayable = Net SD Paid − Transfer − Refund − Adjustment.</p>

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
          <MultiSelect allLabel="All floors" noun="floors" options={options.floors} value={filters.floor} onChange={(v) => setFilter({ floor: v })} />
          <MultiSelect allLabel="All landlords" noun="landlords" options={options.landlords} value={filters.landlordName} onChange={(v) => setFilter({ landlordName: v })} />
          <MultiSelect
            allLabel="All Agreement Status" noun="statuses" options={AGREEMENT_STATUSES}
            value={filters.agreementStatus} onChange={(v) => setFilter({ agreementStatus: v })}
          />
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
            {Number(totals.reversal_count) > 0 && (
              <p className="hint reversal-note">
                Paid is net of <strong>₹{formatAmount(-Number(totals.total_reversal))}</strong> in {totals.reversal_count} reversal
                {totals.reversal_count === 1 ? ' entry' : ' entries'} (negative SD Paid) on payments of ₹{formatAmount(totals.total_payments)}.
              </p>
            )}
          </div>
        )}

        {loading ? <p>Loading...</p> : rows.length === 0 ? <p className="empty-state">No records found.</p> : (
          <>
            <div className="table-wrap freeze-head">
              <table className="data-table compact sd-balance-grouped">
                <thead>
                  <tr className="group-row">
                    <th colSpan={7}>SD details</th>
                    <th className="tone-agreement">Agreed</th>
                    <th />
                    <th colSpan={6}>Payments and movements</th>
                    <th colSpan={2} className="tone-fill-head">Balances</th>
                  </tr>
                  <tr>
                    <th>SD Code</th><th>Lease / Agreement</th><th>Cost Center</th><th>Floor</th><th>Landlord</th>
                    <th>Status</th><th>Lease End</th>
                    <th className={`num tone-head tone-${AMOUNTS.agreement.tone}`}>{AMOUNTS.agreement.label}</th>
                    <th>Agreement Status</th>
                    {LINE_MONEY.map(([col, kind, label, hint]) => (
                      <th key={col} className={`num tone-head tone-${AMOUNTS[kind].tone}`} title={hint || AMOUNTS[kind].hint}>{label || AMOUNTS[kind].label}</th>
                    ))}
                    <th className={`num tone-head tone-${AMOUNTS.balance.tone}`} title={AMOUNTS.balance.hint}>{AMOUNTS.balance.label}</th>
                    <th className={`num tone-head tone-${AMOUNTS.repayable.tone}`} title={AMOUNTS.repayable.hint}>{AMOUNTS.repayable.label}</th>
                  </tr>
                </thead>
                {rows.map((r) => {
                  const lines = r.lines.length ? r.lines : NO_LINES;
                  const span = lines.length;
                  return (
                    <tbody key={r.sd_id} className="sd-group">
                      {lines.map((l, i) => (
                        <tr key={l.agreement_status}>
                          {i === 0 && (
                            <>
                              <td rowSpan={span}>{canTxn ? <Link to={`/sd-transactions?sd=${r.sd_id}&from=sd-balance`} onClick={back.leave}>{r.sd_code}</Link> : r.sd_code}</td>
                              <td rowSpan={span}>{[r.lease_id, r.agreement_no].filter(Boolean).join(' / ') || '—'}</td>
                              <td rowSpan={span}>{r.cost_center_name}</td>
                              <td rowSpan={span}>{r.floor}</td>
                              <td rowSpan={span}>{r.landlord_name || '—'}</td>
                              <td rowSpan={span}>
                                {r.landlord_status === 'Active' && r.building_status === 'Active'
                                  ? <span className="badge badge-active">Active</span>
                                  : <span className="badge badge-passive">Passive</span>}
                              </td>
                              <td rowSpan={span}>{formatDate(r.lease_end_date) || '—'}</td>
                              <td rowSpan={span} className={`${amountClass('agreement', r.agreement_value)} once-per-sd`}>{formatAmount(r.agreement_value)}</td>
                            </>
                          )}
                          <td><span className="status-chip">{l.agreement_status}</span></td>
                          {LINE_MONEY.map(([col, kind]) => moneyCell(kind, l[col], col))}
                          {i === 0 && <td rowSpan={span} className={`${amountClass('balance', r.sd_balance)} once-per-sd`}>{formatAmount(r.sd_balance)}</td>}
                          {moneyCell('repayable', l.sd_balance_repayable, 'rep')}
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
                {totals && (
                  <tfoot>
                    <tr className="grand-total">
                      <th colSpan={7}>Grand Total ({totals.count} SD Code{totals.count === 1 ? '' : 's'}{total > PAGE_SIZE ? ', all pages' : ''})</th>
                      {moneyCell('agreement', totals.agreement_value, 'av')}
                      <td />
                      {LINE_MONEY.map(([col, kind]) => moneyCell(kind, totals[col], col))}
                      {moneyCell('balance', totals.sd_balance, 'bal')}
                      {moneyCell('repayable', totals.sd_balance_repayable, 'rep')}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
