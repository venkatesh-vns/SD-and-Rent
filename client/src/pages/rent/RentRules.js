import React, { useCallback, useEffect, useState } from 'react';
import Navbar from '../../components/Navbar';
import DataTable from '../../components/DataTable';
import MultiSelect from '../../components/MultiSelect';
import Modal from '../../components/Modal';
import ExcelUpload from '../../components/ExcelUpload';
import BulkEdit from '../../components/BulkEdit';
import Pager from '../../components/Pager';
import Toast from '../../components/Toast';
import api, { downloadFile, errorMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { SCREENS } from '../../config/screens';
import useDebounce from '../../hooks/useDebounce';
import { formatDate } from '../../utils/format';
import { COMPONENT_OPTIONS, appliesToLabel, useRentLookups, rentLabel, DateInput, FormErrors, LeaseDates } from './rentShared';

const PAGE_SIZE = 50;
const RULE_TYPES = ['RCD', 'LCD', 'Normal Day'];
const EMPTY_FILTERS = { search: '', rentId: [], ruleType: [], status: [] };
const EMPTY_FORM = { rentId: '', ruleType: 'RCD', escalationMonths: '', fromDate: '', toDate: '', percentage: '', componentCodes: [], status: 'Active' };

const columns = [
  { key: 'id', label: 'Rule ID' },
  { key: 'rentCode', label: 'Rent Code' },
  { key: 'landlord', label: 'Landlord Name' },
  { key: 'ruleType', label: 'Rule Type' },
  { key: 'months', label: 'Escalation Month', align: 'right' },
  { key: 'period', label: 'From / To (Normal Day)' },
  { key: 'percentage', label: 'Percentage', align: 'right' },
  { key: 'component', label: 'Applies to' },
  { key: 'effective', label: 'Escalation Date' },
  { key: 'status', label: 'Status', badge: true },
];

const pct = (v) => `${Number(v) > 0 ? '+' : ''}${Number(v)}%`;

const toRow = (r) => ({
  id: r.rule_id,
  rentCode: r.rent_code,
  landlord: r.landlord_name,
  ruleType: r.rule_type,
  months: r.escalation_months ?? '—',
  period: r.rule_type === 'Normal Day' ? `${formatDate(r.from_date)} – ${formatDate(r.to_date)}` : '—',
  percentage: pct(r.percentage),
  component: appliesToLabel(r.component_codes),
  effective: formatDate(r.effective_date) || '—',
  status: r.status,
  cellClass: { rentCode: 'code-cell', percentage: Number(r.percentage) < 0 ? 'num tone-out' : 'num tone-paid' },
  raw: r,
});

export default function RentRules() {
  const { can } = useAuth();
  const lookups = useRentLookups();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const search = useDebounce(filters.search);
  const query = { ...filters, search };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/rent/rules', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data.map(toRow));
      setTotal(res.data.total);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load rules.'));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(query), page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchRows(); }, [fetchRows]);
  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const openModal = (row = null) => {
    setFormErrors([]);
    if (!row) {
      setForm(EMPTY_FORM);
      setModal({ editing: null });
      return;
    }
    const r = row.raw;
    setForm({
      rentId: String(r.rent_id), ruleType: r.rule_type, escalationMonths: r.escalation_months ?? '',
      fromDate: formatDate(r.from_date), toDate: formatDate(r.to_date), percentage: String(Number(r.percentage)),
      componentCodes: r.component_codes || [], status: r.status,
    });
    setModal({ editing: r });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormErrors([]);
    try {
      const res = modal.editing ? await api.put(`/rent/rules/${modal.editing.rule_id}`, form) : await api.post('/rent/rules', form);
      setNotice(res.data.message);
      setModal(null);
      fetchRows();
    } catch (err) {
      const list = err.response?.data?.errors;
      setFormErrors(list?.length ? list : [{ field: '', error: errorMessage(err, 'Failed to save.') }]);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete rule ${row.id} of ${row.rentCode}? Later escalation dates of this Rent Code move up.`)) return;
    try {
      const res = await api.delete(`/rent/rules/${row.id}`);
      setNotice(res.data.message);
      fetchRows();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete.'));
    }
  };

  const editing = modal?.editing;
  const canEdit = !editing || can(SCREENS.RENT_RULE, 'edit');
  const rent = lookups.rents.find((r) => String(r.id) === String(form.rentId));
  const sd = rent && lookups.sds.find((s) => s.sd_code === rent.sd_code);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const normal = form.ruleType === 'Normal Day';
  const example = Number(form.percentage);
  const sample = Number.isFinite(example) && form.percentage !== '' ? 100000 * (1 + example / 100) : null;

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <div>
            <h1>Rule Master</h1>
            <p className="hint">The first RCD / LCD rule escalates Escalation Month months after the RCD / LCD; each later rule counts from the previous escalation. Revised rent = current rent + current rent × %.</p>
          </div>
          {can(SCREENS.RENT_RULE, 'add') && <button className="btn btn-primary" onClick={() => openModal()}>+ Add Rule</button>}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} />

        {can(SCREENS.RENT_RULE, 'upload') && (
          <>
            <ExcelUpload endpoint="/rent/rules" templateName="Rule_Master_Template.xlsx" onUploaded={fetchRows} />
            <p className="hint upload-note">Leave Rule ID blank to add a rule; fill it to update that rule. Rules of one Rent Code are applied in row order. "Applies to: ..." columns: Yes = selected, No = not selected; leave them all blank for all components. Dates as DD/MM/YYYY. Once the Rent Schedule is generated, adding, editing or deleting a rule or waiver in those months needs the schedule deleted first (Rent Schedule &gt; Delete Schedule); regenerate it afterwards.</p>
          </>
        )}
        {can(SCREENS.RENT_RULE, 'edit') && (
          <BulkEdit endpoint="/rent/rules" query={query} fileName="Rule_Master_Bulk_Edit.xlsx" noun="rules" onUploaded={fetchRows} />
        )}

        <div className="filter-bar">
          <input type="search" placeholder="Search Rent Code, SD Code, Landlord" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <MultiSelect allLabel="All Rent Codes" noun="Rent Codes" options={lookups.rents.map((r) => ({ value: r.id, label: rentLabel(r) }))} value={filters.rentId} onChange={(v) => setFilter({ rentId: v })} />
          <MultiSelect allLabel="All Rule Types" noun="types" options={RULE_TYPES} value={filters.ruleType} onChange={(v) => setFilter({ ruleType: v })} />
          <MultiSelect allLabel="Status: all" noun="statuses" options={['Active', 'Inactive']} value={filters.status} onChange={(v) => setFilter({ status: v })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadFile('/rent/rules/export', query, 'Rule_Master.xlsx').catch(() => setError('Export failed.'))}>Export to Excel</button>
        </div>

        {loading ? <p>Loading...</p> : (
          <>
            <DataTable
              columns={columns} rows={rows} freeze
              onEdit={openModal} editLabel={can(SCREENS.RENT_RULE, 'edit') ? 'Edit' : 'View'}
              onDelete={can(SCREENS.RENT_RULE, 'delete') ? handleDelete : null}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}

        {modal && (
          <Modal wide title={editing ? `Rule ${editing.rule_id} · ${editing.rent_code}` : 'Add Rule'} onClose={() => setModal(null)}>
            <form onSubmit={handleSave}>
              <FormErrors errors={formErrors} />
              <fieldset disabled={!canEdit}>
                <div className="form-grid">
                  <div className="span-2">
                    <label htmlFor="rentId">Rent Code <span className="req" aria-hidden="true">*</span></label>
                    <select id="rentId" required value={form.rentId} onChange={set('rentId')}>
                      <option value="">Select Rent Code</option>
                      {lookups.rents.map((r) => <option key={r.id} value={r.id}>{rentLabel(r)}</option>)}
                    </select>
                  </div>
                </div>
                {sd && <LeaseDates rec={sd} />}
                <div className="form-grid three">
                  <div>
                    <label htmlFor="ruleType">Rule Type <span className="req" aria-hidden="true">*</span></label>
                    <select id="ruleType" value={form.ruleType} onChange={set('ruleType')}>
                      {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {!normal && (
                    <div>
                      <label htmlFor="months">Escalation Month <span className="req" aria-hidden="true">*</span></label>
                      <input id="months" inputMode="numeric" placeholder="e.g. 12, 24, 36" required value={form.escalationMonths} onChange={set('escalationMonths')} />
                    </div>
                  )}
                  {normal && <DateInput id="fromDate" label="From Date" required value={form.fromDate} onChange={(v) => setForm({ ...form, fromDate: v })} />}
                  {normal && <DateInput id="toDate" label="To Date" required value={form.toDate} onChange={(v) => setForm({ ...form, toDate: v })} />}
                  <div>
                    <label htmlFor="percentage">Percentage <span className="req" aria-hidden="true">*</span></label>
                    <input id="percentage" inputMode="decimal" placeholder="e.g. 5, 0, -10" required value={form.percentage} onChange={set('percentage')} />
                  </div>
                  <div>
                    <label htmlFor="status">Status</label>
                    <select id="status" value={form.status} onChange={set('status')}>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                  <div className="span-2 applies-to">
                    <label>Applies to</label>
                    <MultiSelect
                      allLabel="All components" noun="components" options={COMPONENT_OPTIONS}
                      value={form.componentCodes} onChange={(v) => setForm({ ...form, componentCodes: v })}
                    />
                    <span className="hint">Tick one or more components; leave empty for all components.</span>
                  </div>
                </div>
                <p className="hint">
                  {normal
                    ? 'Normal Day: the percentage applies to the current rent only from the From Date to the To Date.'
                    : `${form.ruleType}: escalates ${form.escalationMonths || 'N'} month(s) after the ${editing ? 'previous escalation' : `${form.ruleType} (or the previous ${form.ruleType} rule's escalation)`}. LCD and RCD rules cannot be mixed on one Rent Code.`}
                  {sample !== null && ` Example: ₹1,00,000 becomes ₹${sample.toLocaleString('en-IN', { maximumFractionDigits: 2 })}.`}
                </p>
                {editing?.effective_date && <p className="hint">Current escalation date: <strong>{formatDate(editing.effective_date)}</strong></p>}
              </fieldset>
              {canEdit && (
                <button type="submit" className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              )}
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
