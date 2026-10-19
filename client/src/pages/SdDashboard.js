import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import MultiSelect from '../components/MultiSelect';
import useCascadeOptions from '../hooks/useCascadeOptions';
import DateRangeFilter from '../components/DateRangeFilter';
import { DonutChart, BarChart, compactAmount } from '../components/Charts';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import { formatAmount, formatDate } from '../utils/format';

const SD_TYPES = ['Landlord SD', 'Electricity SD', 'CAM SD', 'Solar SD', 'Additional Parking SD', 'Fitout SD', 'Other SD'];
const AGREEMENT_STATUSES = ['LOI', 'Agreement', 'Registered Agreement', 'Addendum Agreement', 'Mail Approval'];
const STATUSES = ['Active', 'Passive'];
const TYPE_COLORS = {
  'Landlord SD': '#15803d', 'Electricity SD': '#f59e0b', 'CAM SD': '#2563eb', 'Solar SD': '#0891b2',
  'Additional Parking SD': '#7c3aed', 'Fitout SD': '#db2777', 'Other SD': '#64748b',
};
const C = { agreement: '#334155', paid: '#15803d', balance: '#1d4ed8', repayable: '#6d28d9', refund: '#b45309', transfer: '#ea580c', adjustment: '#ca8a04' };

// Multi-select filters hold arrays (empty = all); dates are DD/MM/YYYY
const EMPTY_FILTERS = {
  sdId: [], costCenterId: [], l1Id: [], l2Id: [], l3Id: [], landlordName: [], floor: [], sdType: [], fy: [],
  landlordStatus: [], buildingStatus: [], agreementStatus: [], dateFrom: '', dateTo: '',
};

const ALERT_TABS = [
  ['leaseCommencement', 'Lease Commencement', 'Lease Commencement Date'],
  ['rentCommencement', 'Rent Commencement', 'Rent Commencement Date'],
  ['leaseEnd', 'Lease Expiry', 'Lease End Date'],
];

// Red = within 7 days, orange = within 15 days, green = more than 15 days
const urgency = (days) => (days <= 7 ? 'red' : days <= 15 ? 'orange' : 'green');
const money = (v) => `₹${formatAmount(v)}`;

// Loads a lookup list whenever its key (e.g. the chosen parents) changes
function useLookup(url, params, enabled = true) {
  const [list, setList] = useState([]);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    api.get(url, { params }).then((res) => setList(res.data.data)).catch(() => setList([]));
  }, [url, key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

function Kpi({ label, value, hint, tone, icon }) {
  return (
    <div className={`kpi-card${tone ? ` tone-${tone}` : ''}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && <span className="kpi-icon" aria-hidden="true">{icon}</span>}
      </div>
      <strong className="kpi-value" title={typeof value === 'string' ? value : undefined}>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Section({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`dash-card ${className}`.trim()}>
      <header className="dash-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="hint">{subtitle}</p>}
        </div>
        {actions && <div className="dash-card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

// Plain table: columns = [{ key, label, money?, render? }]
function MiniTable({ columns, rows, empty = 'No records.', footer }) {
  if (!rows.length) return <p className="empty-state">{empty}</p>;
  return (
    <div className="table-wrap dash-table">
      <table className="data-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.money || c.num ? 'num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={[c.money || c.num ? 'num' : '', c.tone ? `tone-${c.tone}` : '', c.money && !Number(r[c.key]) ? 'amount-zero' : ''].filter(Boolean).join(' ') || undefined}>
                  {c.render ? c.render(r) : c.money ? formatAmount(r[c.key]) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot><tr>{footer}</tr></tfoot>}
      </table>
    </div>
  );
}

export default function SdDashboard() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [alertDays, setAlertDays] = useState(15);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [alertTab, setAlertTab] = useState('leaseCommencement');
  const [typeMetric, setTypeMetric] = useState('paid');
  const [drill, setDrill] = useState([]); // [] | [l1] | [l1, l2] - location drill-down path
  const [exporting, setExporting] = useState(false);

  const options = useLookup('/dashboard/options', {});
  const costCenters = useLookup('/lookups/cost-centers', {});
  const l1List = useLookup('/lookups/locations/1', {});
  const l2List = useLookup('/lookups/locations/2', { parentId: filters.l1Id.join(',') }, filters.l1Id.length > 0);
  const l3List = useLookup('/lookups/locations/3', { parentId: filters.l2Id.join(',') }, filters.l2Id.length > 0);
  const fyList = useLookup('/lookups/fys', {});

  const query = { ...filters, alertDays };
  const queryKey = JSON.stringify(query);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/dashboard', { params: query });
      setData(res.data.data);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the dashboard.'));
    } finally {
      setLoading(false);
    }
  }, [queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Drop child location picks that no longer belong to the chosen parents
  useEffect(() => {
    const valid = new Set(l2List.map((l) => String(l.id)));
    setFilters((f) => (f.l2Id.every((id) => valid.has(String(id))) ? f : { ...f, l2Id: f.l2Id.filter((id) => valid.has(String(id))) }));
  }, [l2List]);
  useEffect(() => {
    const valid = new Set(l3List.map((l) => String(l.id)));
    setFilters((f) => (f.l3Id.every((id) => valid.has(String(id))) ? f : { ...f, l3Id: f.l3Id.filter((id) => valid.has(String(id))) }));
  }, [l3List]);

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));
  // Landlord choices follow Cost Center; Floor choices follow Cost Center and Landlord
  const cascade = useCascadeOptions('sd', filters, setFilters);
  const activeCount = Object.entries(filters).filter(([, v]) => (Array.isArray(v) ? v.length : v)).length;

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/dashboard/export', query, 'SD_Dashboard.xlsx');
    } catch {
      setError('Export failed.');
    } finally {
      setExporting(false);
    }
  };

  // Location summary at the current drill-down level
  const locationRows = useMemo(() => {
    if (!data) return [];
    const [l1, l2] = drill;
    const level = drill.length + 1;
    const rows = data.locations.filter((r) => (!l1 || r.l1_id === l1.id) && (!l2 || r.l2_id === l2.id));
    const groups = new Map();
    rows.forEach((r) => {
      const id = r[`l${level}_id`];
      const g = groups.get(id) || { key: id, id, label: r[`l${level}_name`], agreement_value: 0, paid: 0, balance: 0, repayable: 0, sd_count: 0 };
      g.agreement_value += Number(r.agreement_value);
      g.paid += Number(r.paid);
      g.balance += Number(r.balance);
      g.repayable += Number(r.repayable);
      g.sd_count += r.sd_count;
      groups.set(id, g);
    });
    return [...groups.values()].map((g) => ({ ...g, sub: `${g.sd_count} SD` })).sort((a, b) => b.agreement_value - a.agreement_value);
  }, [data, drill]);

  const k = data?.kpi;
  const canSdAdd = can(SCREENS.SD_MASTER, 'add');
  const canSdUpload = can(SCREENS.SD_MASTER, 'upload');
  const canTxnAdd = can(SCREENS.SD_TRANSACTION, 'add');
  const canTxnUpload = can(SCREENS.SD_TRANSACTION, 'upload');
  const sdLink = (r) => (can(SCREENS.SD_TRANSACTION, 'view')
    ? <Link to={`/sd-transactions?sd=${r.sd_id}&from=sd-dashboard`}><strong>{r.sd_code}</strong></Link>
    : <strong>{r.sd_code}</strong>);
  const daysChip = (r) => (
    <span className={`days-chip ${urgency(r.days_left)}`}>{r.days_left === 0 ? 'Today' : `${r.days_left} day${r.days_left === 1 ? '' : 's'}`}</span>
  );
  const alertCounts = (list) => ({
    red: list.filter((a) => urgency(a.days_left) === 'red').length,
    orange: list.filter((a) => urgency(a.days_left) === 'orange').length,
    green: list.filter((a) => urgency(a.days_left) === 'green').length,
  });

  const alertColumns = (dateLabel, withAgreement, withCc) => [
    { key: 'sd_code', label: 'SD Code', render: sdLink },
    { key: 'lease_id', label: 'Lease ID' },
    ...(withAgreement ? [{ key: 'agreement_no', label: 'Agreement No.' }] : []),
    { key: 'landlord_name', label: 'Landlord Name' },
    ...(withCc ? [{ key: 'cost_center_name', label: 'Cost Center' }] : []),
    { key: 'due_date', label: dateLabel, render: (r) => formatDate(r.due_date) },
    { key: 'days_left', label: 'Days Remaining', render: daysChip },
  ];

  const typeRows = data ? SD_TYPES.map((t) => {
    const r = data.sdTypes.find((x) => x.sd_type === t);
    return { label: t, value: r ? Number(r[typeMetric]) : 0, color: TYPE_COLORS[t] };
  }) : [];

  return (
    <div>
      <Navbar />
      <div className="page-container wide sd-dashboard">
        <div className="page-header dash-header">
          <div>
            <h1>SD Dashboard</h1>
            <p className="hint">
              Security Deposit exposure, upcoming lease actions and recoverable deposits
              {' · '}as on {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div className="dash-actions">
            {canSdAdd && <button type="button" className="btn btn-secondary" onClick={() => navigate('/sd-master?action=add')}>+ Add SD Master</button>}
            {canSdUpload && <button type="button" className="btn btn-secondary" onClick={() => navigate('/sd-master?action=upload')}>Upload SD Master</button>}
            {canTxnAdd && <button type="button" className="btn btn-secondary" onClick={() => navigate('/sd-transactions?action=add')}>+ Add SD Transaction</button>}
            {canTxnUpload && <button type="button" className="btn btn-secondary" onClick={() => navigate('/sd-transactions?action=upload')}>Upload SD Transaction</button>}
            <button type="button" className="btn btn-outline" onClick={handleExport} disabled={exporting || !data}>{exporting ? 'Exporting...' : 'Export to Excel'}</button>
            <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!data}>Export to PDF</button>
          </div>
        </div>

        {/* ---------------- Filters ---------------- */}
        <section className="dash-filters">
          <div className="dash-filters-head">
            <button type="button" className="dash-filters-toggle" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" /></svg>
              Filters {activeCount > 0 && <span className="multi-select-count">{activeCount}</span>}
              <span className="chev" aria-hidden="true">{showFilters ? '▴' : '▾'}</span>
            </button>
            {activeCount > 0 && <button type="button" className="link-button" onClick={() => setFilters(EMPTY_FILTERS)}>Clear all filters</button>}
          </div>
          {showFilters && (
            <div className="dash-filter-grid">
              <MultiSelect allLabel="All SD Codes" noun="SD Codes" options={options.sdCodes?.map((o) => ({ value: o.id, label: o.name })) || []} value={filters.sdId} onChange={(v) => setFilter({ sdId: v })} />
              <MultiSelect allLabel="All cost centers" noun="cost centers" options={costCenters.map((c) => ({ value: c.id, label: c.name }))} value={filters.costCenterId} onChange={(v) => setFilter({ costCenterId: v })} />
              <MultiSelect allLabel="All Level 1" noun="Level 1" options={l1List.map((l) => ({ value: l.id, label: l.name }))} value={filters.l1Id} onChange={(v) => setFilter({ l1Id: v })} />
              <MultiSelect allLabel={filters.l1Id.length ? 'All Level 2' : 'Level 2'} noun="Level 2" disabled={!filters.l1Id.length} options={l2List.map((l) => ({ value: l.id, label: l.name }))} value={filters.l2Id} onChange={(v) => setFilter({ l2Id: v })} />
              <MultiSelect allLabel={filters.l2Id.length ? 'All Level 3' : 'Level 3'} noun="Level 3" disabled={!filters.l2Id.length} options={l3List.map((l) => ({ value: l.id, label: l.name }))} value={filters.l3Id} onChange={(v) => setFilter({ l3Id: v })} />
              <MultiSelect allLabel="All landlords" noun="landlords" options={cascade.landlords} value={filters.landlordName} onChange={(v) => setFilter({ landlordName: v })} />
              <MultiSelect allLabel="All floors" noun="floors" options={cascade.floors} value={filters.floor} onChange={(v) => setFilter({ floor: v })} />
              <MultiSelect allLabel="All SD Types" noun="SD Types" options={SD_TYPES} value={filters.sdType} onChange={(v) => setFilter({ sdType: v })} />
              <MultiSelect allLabel="All FY" noun="FYs" options={fyList} value={filters.fy} onChange={(v) => setFilter({ fy: v })} />
              <MultiSelect allLabel="LL Status: all" noun="statuses" options={STATUSES.map((s) => ({ value: s, label: `Landlord: ${s}` }))} value={filters.landlordStatus} onChange={(v) => setFilter({ landlordStatus: v })} />
              <MultiSelect allLabel="Building: all" noun="statuses" options={STATUSES.map((s) => ({ value: s, label: `Building: ${s}` }))} value={filters.buildingStatus} onChange={(v) => setFilter({ buildingStatus: v })} />
              <MultiSelect allLabel="All Agreement Status" noun="statuses" options={AGREEMENT_STATUSES} value={filters.agreementStatus} onChange={(v) => setFilter({ agreementStatus: v })} />
              <DateRangeFilter label="Txn Date" from={filters.dateFrom} to={filters.dateTo} onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })} />
            </div>
          )}
          {showFilters && (
            <p className="hint dash-filter-note">
              SD Type, FY, Agreement Status and Txn Date filter the transactions that are added up; the SD records shown are those with a matching transaction.
            </p>
          )}
        </section>

        {error && <div className="alert alert-error">{error}</div>}
        {!data && loading && <p className="dash-loading">Loading dashboard...</p>}

        {data && (
          <div className={`dash-body${loading ? ' is-loading' : ''}`}>
            {/* ---------------- KPIs ---------------- */}
            <div className="kpi-grid money">
              <Kpi label="Total Agreement Value" tone="agreement" value={money(k.agreement_value)} hint={`${k.sd_count} SD record${k.sd_count === 1 ? '' : 's'}`} />
              <Kpi label="Total SD Paid" tone="paid" value={money(k.paid)} hint={Number(k.reversal_count) > 0 ? `Net of ${money(k.reversal_amount)} reversals (${k.reversal_count})` : 'Deposit paid to landlords'} />
              <Kpi label="Total SD Balance" tone="balance" value={money(k.balance)} hint="Agreement Value − SD Paid" />
              <Kpi label="Total SD Balance Repayable" tone="repayable" value={money(k.repayable)} hint="Paid − Transfer − Adjustment − Refund" />
            </div>
            <div className="kpi-grid counts">
              <Kpi label="Active SD Records" tone="ok" value={k.active_count} hint="Landlord and Building Active" />
              <Kpi label="Passive SD Records" tone="danger" value={k.passive_count} hint="Landlord or Building Passive" />
              <Kpi label="Landlords" value={k.landlord_count} />
              <Kpi label="Cost Centers" value={k.cost_center_count} />
            </div>

            {/* ---------------- Upcoming alerts ---------------- */}
            <div className="alert-cards">
              {ALERT_TABS.map(([key, name]) => {
                const list = data.alerts[key];
                const n = alertCounts(list);
                return (
                  <button type="button" key={key} className={`alert-card${alertTab === key ? ' active' : ''}`} onClick={() => setAlertTab(key)}>
                    <span className="alert-card-label">{name} Due</span>
                    <strong>{list.length}</strong>
                    <span className="alert-card-split">
                      <span className="days-chip red">{n.red} ≤7d</span>
                      <span className="days-chip orange">{n.orange} 8–15d</span>
                      {alertDays > 15 && <span className="days-chip green">{n.green} &gt;15d</span>}
                    </span>
                  </button>
                );
              })}
              <Link to="/email-log" className="alert-card notif">
                <span className="alert-card-label">Notifications (last 7 days)</span>
                <strong>{data.notifications.sent + data.notifications.failed + data.notifications.dry_run}</strong>
                <span className="alert-card-split">
                  <span className="days-chip green">{data.notifications.sent} sent</span>
                  <span className="days-chip red">{data.notifications.failed} failed</span>
                  {data.notifications.dry_run > 0 && <span className="days-chip grey">{data.notifications.dry_run} dry run</span>}
                </span>
              </Link>
            </div>

            <Section
              title={`${ALERT_TABS.find(([key]) => key === alertTab)[1]} Due`}
              subtitle={`Next ${alertDays} days · red = within 7 days, orange = within 15 days, green = more than 15 days`}
              actions={(
                <label className="inline-select">
                  Look ahead
                  <select value={alertDays} onChange={(e) => setAlertDays(Number(e.target.value))}>
                    {[15, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </label>
              )}
            >
              {ALERT_TABS.filter(([key]) => key === alertTab).map(([key, , dateLabel]) => (
                <MiniTable
                  key={key}
                  rows={data.alerts[key].map((r) => ({ ...r, id: r.sd_id }))}
                  columns={alertColumns(dateLabel, key !== 'rentCommencement', key === 'leaseCommencement')}
                  empty={`Nothing due in the next ${alertDays} days.`}
                />
              ))}
            </Section>

            {/* ---------------- SD Type + Status ---------------- */}
            <div className="dash-row two">
              <Section
                title="SD Type Analysis"
                subtitle={typeMetric === 'paid' ? 'SD Paid by SD Type' : 'SD Balance Repayable by SD Type'}
                actions={(
                  <div className="seg-toggle" role="group" aria-label="Amount shown">
                    <button type="button" className={typeMetric === 'paid' ? 'on' : undefined} onClick={() => setTypeMetric('paid')}>SD Paid</button>
                    <button type="button" className={typeMetric === 'repayable' ? 'on' : undefined} onClick={() => setTypeMetric('repayable')}>Repayable</button>
                  </div>
                )}
              >
                <DonutChart
                  data={typeRows} size={200} valueFormat={compactAmount}
                  center={{ label: typeMetric === 'paid' ? 'SD Paid' : 'Repayable', value: compactAmount(typeRows.reduce((s, r) => s + Math.max(r.value, 0), 0)) }}
                />
              </Section>
              <Section title="Status Monitoring" subtitle="Landlord and Building status of the SD records">
                <div className="status-donuts">
                  {[['Landlord Status', 'landlord'], ['Building Status', 'building']].map(([title, key]) => (
                    <div key={key}>
                      <h3>{title}</h3>
                      <DonutChart
                        size={150} thickness={24}
                        data={[
                          { label: 'Active', value: data.status[`${key}_active`], color: '#16a34a' },
                          { label: 'Passive', value: data.status[`${key}_passive`], color: '#dc2626' },
                        ]}
                        center={{ label: 'SD records', value: data.status[`${key}_active`] + data.status[`${key}_passive`] }}
                      />
                    </div>
                  ))}
                </div>
              </Section>
            </div>

            {/* ---------------- Location ---------------- */}
            <Section
              title="Location Wise SD Summary"
              subtitle={(
                <span className="crumbs">
                  <button type="button" className="link-button" disabled={!drill.length} onClick={() => setDrill([])}>All Level 1</button>
                  {drill.map((d, i) => (
                    <React.Fragment key={d.id}>
                      <span aria-hidden="true">›</span>
                      <button type="button" className="link-button" disabled={i === drill.length - 1} onClick={() => setDrill(drill.slice(0, i + 1))}>{d.label}</button>
                    </React.Fragment>
                  ))}
                </span>
              )}
              actions={drill.length > 0 && <button type="button" className="btn btn-secondary btn-small" onClick={() => setDrill(drill.slice(0, -1))}>← Back</button>}
            >
              <BarChart
                rows={locationRows}
                series={[
                  { key: 'agreement_value', label: 'Agreement Value', color: C.agreement },
                  { key: 'paid', label: 'SD Paid', color: C.paid },
                  { key: 'balance', label: 'SD Balance', color: C.balance },
                ]}
                onSelect={drill.length < 2 ? (r) => setDrill([...drill, { id: r.id, label: r.label }]) : undefined}
                selectHint={`Click a ${drill.length === 0 ? 'Level 1' : 'Level 2'} to see its ${drill.length === 0 ? 'Level 2' : 'Level 3'} locations.`}
              />
            </Section>

            {/* ---------------- Cost center + Landlord ---------------- */}
            <div className="dash-row two">
              <Section title="Cost Center Wise Summary" subtitle={`${data.costCenters.length} cost center(s)`}>
                <MiniTable
                  rows={data.costCenters.map((r) => ({ ...r, id: r.cost_center_id }))}
                  columns={[
                    { key: 'cost_center_name', label: 'Cost Center', render: (r) => <strong>{r.cost_center_name}</strong> },
                    { key: 'agreement_value', label: 'Agreement Value', money: true, tone: 'agreement' },
                    { key: 'paid', label: 'SD Paid', money: true, tone: 'paid' },
                    { key: 'balance', label: 'SD Balance', money: true, tone: 'balance' },
                    { key: 'repayable', label: 'Repayable', money: true, tone: 'repayable' },
                  ]}
                />
              </Section>
              <Section title="Landlord Wise Summary" subtitle={`${data.landlords.length} landlord(s)`}>
                <MiniTable
                  rows={data.landlords.map((r) => ({ ...r, id: r.landlord_name }))}
                  columns={[
                    { key: 'landlord_name', label: 'Landlord Name', render: (r) => <strong>{r.landlord_name}</strong> },
                    { key: 'sd_count', label: 'SD Records', num: true },
                    { key: 'agreement_value', label: 'Agreement Value', money: true, tone: 'agreement' },
                    { key: 'paid', label: 'SD Paid', money: true, tone: 'paid' },
                    { key: 'repayable', label: 'Repayable', money: true, tone: 'repayable' },
                  ]}
                />
              </Section>
            </div>

            {/* ---------------- Financial year ---------------- */}
            <Section
              title="Financial Year Analysis"
              subtitle="FY = April–March. SD Paid, Refund, Transfer and Adjustment: transactions dated in the FY. Agreement Value: SD records whose Lease Commencement falls in the FY. SD Balance: closing balance at the FY end (Agreement Value − SD Paid, cumulative)."
            >
              <BarChart
                rows={data.financialYears.map((r) => ({ ...r, key: r.fy, label: r.fy }))}
                series={[
                  { key: 'agreement_value', label: 'Agreement Value', color: C.agreement },
                  { key: 'paid', label: 'SD Paid', color: C.paid },
                  { key: 'balance', label: 'SD Balance', color: C.balance },
                  { key: 'refund', label: 'SD Refund', color: C.refund },
                  { key: 'transfer', label: 'SD Transfer', color: C.transfer },
                  { key: 'adjustment', label: 'SD Adjustment', color: C.adjustment },
                ]}
              />
              <MiniTable
                rows={data.financialYears.map((r) => ({ ...r, id: r.fy }))}
                columns={[
                  { key: 'fy', label: 'FY', render: (r) => <strong>{r.fy}</strong> },
                  { key: 'agreement_value', label: 'Agreement Value', money: true, tone: 'agreement' },
                  { key: 'paid', label: 'SD Paid', money: true, tone: 'paid' },
                  { key: 'balance', label: 'SD Balance (closing)', money: true, tone: 'balance' },
                  { key: 'refund', label: 'SD Refund', money: true, tone: 'out' },
                  { key: 'transfer', label: 'SD Transfer', money: true, tone: 'out' },
                  { key: 'adjustment', label: 'SD Adjustment', money: true, tone: 'out' },
                ]}
              />
            </Section>

            {/* ---------------- Recovery + recent ---------------- */}
            <Section
              title="Pending Recovery / Refund Tracker"
              subtitle={`${data.pending.length} SD record(s) with SD Balance Repayable > 0 · total ₹${formatAmount(data.pending.reduce((s, r) => s + Number(r.repayable), 0))}`}
            >
              <MiniTable
                rows={data.pending.map((r) => ({ ...r, id: r.sd_id }))}
                empty="No deposits pending recovery."
                columns={[
                  { key: 'sd_code', label: 'SD Code', render: sdLink },
                  { key: 'lease_id', label: 'Lease ID' },
                  { key: 'landlord_name', label: 'Landlord Name' },
                  { key: 'cost_center_name', label: 'Cost Center' },
                  { key: 'agreement_value', label: 'Agreement Value', money: true, tone: 'agreement' },
                  { key: 'repayable', label: 'SD Balance Repayable', money: true, tone: 'repayable' },
                ]}
              />
            </Section>

            <Section title="Recent Transactions" subtitle="Last 10 transactions matching the filters">
              <MiniTable
                rows={data.recent.map((r) => ({ ...r, id: r.txn_id }))}
                empty="No transactions."
                columns={[
                  { key: 'sd_code', label: 'SD Code', render: sdLink },
                  { key: 'txn_date', label: 'Transaction Date', render: (r) => formatDate(r.txn_date) },
                  { key: 'sd_type', label: 'SD Type', render: (r) => <span className="type-chip" style={{ '--tc': TYPE_COLORS[r.sd_type] }}>{r.sd_type}</span> },
                  { key: 'paid_amount', label: 'SD Paid', money: true, tone: 'paid', render: (r) => (Number(r.paid_amount) < 0 ? <span className="amount-negative-text">{formatAmount(r.paid_amount)} <span className="reversal-tag">Reversal</span></span> : formatAmount(r.paid_amount)) },
                  { key: 'transfer_amount', label: 'SD Transfer', money: true, tone: 'out' },
                  { key: 'adjustment_amount', label: 'SD Adjustment', money: true, tone: 'out' },
                  { key: 'refund_amount', label: 'SD Refund', money: true, tone: 'out' },
                  { key: 'remarks', label: 'Remarks', render: (r) => <span className="cell-clip" title={r.remarks || ''}>{r.remarks || '—'}</span> },
                  { key: 'created_by', label: 'Created By' },
                ]}
              />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
