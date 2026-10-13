import React, { useCallback, useEffect, useState } from 'react';
import Navbar from '../../components/Navbar';
import MultiSelect from '../../components/MultiSelect';
import DateRangeFilter from '../../components/DateRangeFilter';
import Pager from '../../components/Pager';
import Toast from '../../components/Toast';
import api, { downloadFile, errorMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { SCREENS } from '../../config/screens';
import { formatAmount, formatDate, formatDateTime } from '../../utils/format';
import { presetRange } from '../../utils/dateRanges';
import { COMPONENTS, COMPONENT_LABEL, useRentLookups, rentLabel, money } from './rentShared';

const PAGE_SIZE = 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]}-${iso.slice(0, 4)}`;
const fy = presetRange('thisFy');
const EMPTY_FILTERS = {
  costCenterId: [], floor: [], landlordName: [], llStatus: [], rentId: [], agreementStatus: [], componentCode: [],
  fromDate: fy.from, toDate: fy.to,
};
const GROUPS = [
  ['lines', 'Month-wise lines'],
  ['component', 'By Agreement Header'],
  ['costCenter', 'By Cost Center'],
  ['landlord', 'By Landlord'],
  ['rentCode', 'By Rent Code'],
  ['month', 'By Month'],
];

export default function RentSchedule() {
  const { can } = useAuth();
  const lookups = useRentLookups();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState('lines');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [totals, setTotals] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [runs, setRuns] = useState([]);
  const [showRuns, setShowRuns] = useState(false);
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'lines') {
        const res = await api.get('/rent/schedule', { params: { ...filters, page, pageSize: PAGE_SIZE } });
        setRows(res.data.data);
        setTotal(res.data.total);
        setTotals(res.data.totals);
      } else {
        const [res, all] = await Promise.all([
          api.get('/rent/schedule/summary', { params: { ...filters, groupBy: view } }),
          api.get('/rent/schedule', { params: { ...filters, page: 1, pageSize: 1 } }),
        ]);
        setSummary(res.data.data);
        setTotals(all.data.totals);
      }
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the Rent Schedule.'));
    } finally {
      setLoading(false);
    }
  }, [key, page, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/lookups/cost-centers').then((res) => setCostCenters(res.data.data)).catch(() => {}); }, []);
  const loadRuns = () => api.get('/rent/schedule/runs').then((res) => setRuns(res.data.data)).catch(() => {});
  useEffect(() => { if (showRuns) loadRuns(); }, [showRuns]);

  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const generate = async () => {
    if (!filters.fromDate || !filters.toDate) {
      setError('Choose the From and To dates to generate.');
      return;
    }
    const { fromDate, toDate, ...rest } = filters;
    if (!window.confirm(`Generate the Rent Schedule from ${fromDate} to ${toDate} for the selected filters? Months already generated in this range are recalculated.`)) return;
    setGenerating(true);
    setMessages([]);
    try {
      const res = await api.post('/rent/schedule/generate', { fromDate, toDate, filters: rest });
      setNotice(res.data.message);
      setMessages(res.data.data.messages);
      setPage(1);
      load();
      if (showRuns) loadRuns();
    } catch (err) {
      setError(errorMessage(err, 'Generation failed.'));
    } finally {
      setGenerating(false);
    }
  };

  const tiles = totals && [
    ['Lines', totals.lines, null],
    ['Escalated Amount', money(totals.escalated_amount), 'balance'],
    ['Waiver Amount', money(totals.waiver_amount), 'out'],
    ['Final Rent Amount', money(totals.final_amount), 'paid'],
  ];

  return (
    <div>
      <Navbar />
      <div className="page-container wide rent-schedule">
        <div className="page-header">
          <div>
            <h1>Rent Schedule</h1>
            <p className="hint">Rent Agreement Master → Rule Master → Waiver Master, month by month from the RCD (rent) or LCD (maintenance) to the LED or Inactive End Date. Mid-month changes are pro-rated on actual days.</p>
          </div>
          <div className="dash-actions">
            {can(SCREENS.RENT_SCHEDULE, 'add') && (
              <button type="button" className="btn btn-primary" onClick={generate} disabled={generating}>{generating ? 'Generating...' : 'Generate / Regenerate'}</button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => downloadFile('/rent/schedule/export', filters, 'Rent_Schedule.xlsx').catch(() => setError('Export failed.'))}>Export to Excel</button>
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>Export to PDF</button>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} duration={6000} />
        {messages.length > 0 && (
          <div className="alert alert-info">
            <strong>{messages.length} Rent Code message(s) from the last generation:</strong>
            <ul>{messages.map((m, i) => <li key={i}><strong>{m.rentCode}</strong>: {m.message}</li>)}</ul>
          </div>
        )}

        <div className="filter-bar">
          <DateRangeFilter label="Period" from={filters.fromDate} to={filters.toDate} onChange={({ from, to }) => setFilter({ fromDate: from, toDate: to })} />
          <MultiSelect allLabel="All cost centers" noun="cost centers" options={costCenters.map((c) => ({ value: c.id, label: c.name }))} value={filters.costCenterId} onChange={(v) => setFilter({ costCenterId: v })} />
          <MultiSelect allLabel="All floors" noun="floors" options={lookups.floors} value={filters.floor} onChange={(v) => setFilter({ floor: v })} />
          <MultiSelect allLabel="All landlords" noun="landlords" options={lookups.landlords} value={filters.landlordName} onChange={(v) => setFilter({ landlordName: v })} />
          <MultiSelect allLabel="LL Status: all" noun="statuses" options={['Active', 'Inactive']} value={filters.llStatus} onChange={(v) => setFilter({ llStatus: v })} />
          <MultiSelect allLabel="All Rent Codes" noun="Rent Codes" options={lookups.rents.map((r) => ({ value: r.id, label: rentLabel(r) }))} value={filters.rentId} onChange={(v) => setFilter({ rentId: v })} />
          <MultiSelect allLabel="All Agreement Status" noun="statuses" options={['Individual', 'Transfer']} value={filters.agreementStatus} onChange={(v) => setFilter({ agreementStatus: v })} />
          <MultiSelect allLabel="All Agreement Headers" noun="headers" options={COMPONENTS.map((c) => ({ value: c.code, label: c.label }))} value={filters.componentCode} onChange={(v) => setFilter({ componentCode: v })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
        </div>

        {tiles && (
          <div className="sd-tiles rent-tiles">
            {tiles.map(([label, value, tone]) => (
              <div key={label} className={`tile${tone ? ` tone-${tone}` : ''}`}><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>
        )}

        <div className="seg-toggle rent-view" role="group" aria-label="View">
          {GROUPS.map(([k, label]) => (
            <button key={k} type="button" className={view === k ? 'on' : undefined} onClick={() => { setView(k); setPage(1); }}>{label}</button>
          ))}
        </div>

        {loading ? <p>Loading...</p> : view === 'lines' ? (
          rows.length === 0 ? (
            <p className="empty-state">No schedule lines for these filters. {can(SCREENS.RENT_SCHEDULE, 'add') ? 'Choose the period and press Generate.' : ''}</p>
          ) : (
            <>
              <div className="table-wrap freeze">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Rent Code</th><th>Cost Center</th><th>Floor</th><th>Landlord Name</th><th>LL Status</th><th>Agreement Status</th>
                      <th>Agreement Header</th><th>Rent Month</th><th>Schedule Date</th><th className="num">Days</th>
                      <th className="num tone-head tone-agreement">Base Rent Amount</th><th className="num">Rule %</th>
                      <th className="num tone-head tone-balance">Escalated Amount</th><th className="num tone-head tone-out">Waiver Amount</th>
                      <th className="num tone-head tone-paid">Final Rent Amount</th><th>LCD</th><th>RCD</th><th>LED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.line_id}>
                        <td className="code-cell">{l.rent_code}</td><td>{l.cost_center_name}</td><td>{l.floor}</td><td>{l.landlord_name}</td>
                        <td><span className={`badge badge-${l.ll_status.toLowerCase()}`}>{l.ll_status}</span></td>
                        <td>{l.agreement_status}</td><td>{COMPONENT_LABEL[l.component_code]}</td>
                        <td>{monthLabel(l.rent_month)}</td>
                        <td>{formatDate(l.period_from)}{l.period_to !== l.period_from && <small className="hint"> – {formatDate(l.period_to)}</small>}</td>
                        <td className="num">{l.days_charged}</td>
                        <td className="num">{formatAmount(l.base_amount)}</td>
                        <td className="num">{l.rule_percentage === null ? '—' : `${Number(l.rule_percentage)}%`}</td>
                        <td className="num tone-balance">{formatAmount(l.escalated_amount)}</td>
                        <td className={`num tone-out${Number(l.waiver_amount) ? '' : ' amount-zero'}`}>{formatAmount(l.waiver_amount)}</td>
                        <td className="num tone-paid"><strong>{formatAmount(l.final_amount)}</strong></td>
                        <td>{formatDate(l.lcd) || '—'}</td><td>{formatDate(l.rcd) || '—'}</td><td>{formatDate(l.led) || '—'}</td>
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
                  <th>{GROUPS.find(([k]) => k === view)[1].replace('By ', '')}</th><th className="num">Lines</th>
                  <th className="num">Escalated Amount</th><th className="num">Waiver Amount</th><th className="num">Final Rent Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 && <tr><td colSpan={5} className="empty-state">No schedule lines for these filters.</td></tr>}
                {summary.map((s) => (
                  <tr key={s.group_key}>
                    <td><strong>{view === 'month' ? monthLabel(`${s.group_key}-01`) : s.group_label}</strong></td>
                    <td className="num">{s.lines}</td>
                    <td className="num tone-balance">{formatAmount(s.escalated_amount)}</td>
                    <td className="num tone-out">{formatAmount(s.waiver_amount)}</td>
                    <td className="num tone-paid"><strong>{formatAmount(s.final_amount)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <section className="history rent-runs">
          <button type="button" className="link-button" onClick={() => setShowRuns((s) => !s)}>{showRuns ? 'Hide' : 'Show'} generation history (audit trail)</button>
          {showRuns && (
            <table className="data-table compact">
              <thead><tr><th>Run</th><th>When</th><th>By</th><th>Trigger</th><th>Months</th><th className="num">Rent Codes</th><th className="num">Lines</th><th>Messages</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.run_id}>
                    <td>{r.run_id}</td><td>{formatDateTime(r.run_at)}</td><td>{r.run_by}</td><td>{r.trigger}</td>
                    <td>{monthLabel(r.from_month)} – {monthLabel(r.to_month)}</td><td className="num">{r.rent_codes}</td><td className="num">{r.lines}</td>
                    <td>{(r.messages || []).map((m) => `${m.rentCode}: ${m.message}`).join(' ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
