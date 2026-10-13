import React, { useCallback, useEffect, useState } from 'react';
import Navbar from '../../components/Navbar';
import DataTable from '../../components/DataTable';
import MultiSelect from '../../components/MultiSelect';
import DateRangeFilter from '../../components/DateRangeFilter';
import Modal from '../../components/Modal';
import ExcelUpload from '../../components/ExcelUpload';
import Pager from '../../components/Pager';
import Toast from '../../components/Toast';
import api, { downloadFile, errorMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { SCREENS } from '../../config/screens';
import useDebounce from '../../hooks/useDebounce';
import { formatDate } from '../../utils/format';
import { COMPONENTS, COMPONENT_LABEL, useRentLookups, rentLabel, DateInput, FormErrors, LeaseDates } from './rentShared';

const PAGE_SIZE = 50;
const EMPTY_FILTERS = { search: '', rentId: [], waiverStatus: [], dateFrom: '', dateTo: '' };
const EMPTY_FORM = { rentId: '', fromDate: '', toDate: '', waiverStatus: 'Yes', componentCode: '', remark: '' };

const columns = [
  { key: 'id', label: 'Waiver ID' },
  { key: 'rentCode', label: 'Rent Code' },
  { key: 'landlord', label: 'Landlord Name' },
  { key: 'from', label: 'From Date' },
  { key: 'to', label: 'To Date' },
  { key: 'waiverStatus', label: 'Waiver Status', badge: true },
  { key: 'component', label: 'Applies to' },
  { key: 'remark', label: 'Remark' },
];

const toRow = (w) => ({
  id: w.waiver_id,
  rentCode: w.rent_code,
  landlord: w.landlord_name,
  from: formatDate(w.from_date),
  to: formatDate(w.to_date),
  waiverStatus: w.waiver_status,
  component: w.component_code ? COMPONENT_LABEL[w.component_code] : 'All components',
  remark: w.remark || '—',
  cellClass: { rentCode: 'code-cell' },
  raw: w,
});

export default function RentWaivers() {
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
      const res = await api.get('/rent/waivers', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data.map(toRow));
      setTotal(res.data.total);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load waivers.'));
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
    const w = row.raw;
    setForm({ rentId: String(w.rent_id), fromDate: formatDate(w.from_date), toDate: formatDate(w.to_date), waiverStatus: w.waiver_status, componentCode: w.component_code || '', remark: w.remark || '' });
    setModal({ editing: w });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormErrors([]);
    try {
      const res = modal.editing ? await api.put(`/rent/waivers/${modal.editing.waiver_id}`, form) : await api.post('/rent/waivers', form);
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
    if (!window.confirm(`Delete waiver ${row.id} (${row.from} – ${row.to}) of ${row.rentCode}? Setting Waiver Status to No keeps it for reference instead.`)) return;
    try {
      const res = await api.delete(`/rent/waivers/${row.id}`);
      setNotice(res.data.message);
      fetchRows();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete.'));
    }
  };

  const editing = modal?.editing;
  const canEdit = !editing || can(SCREENS.RENT_WAIVER, 'edit');
  const rent = lookups.rents.find((r) => String(r.id) === String(form.rentId));
  const sd = rent && lookups.sds.find((s) => s.sd_code === rent.sd_code);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <div>
            <h1>Waiver Master</h1>
            <p className="hint">A waiver with Status Yes sets rent to ₹0 for its days and overrides every Rule Master calculation. Status No switches a wrong waiver off without deleting it.</p>
          </div>
          {can(SCREENS.RENT_WAIVER, 'add') && <button className="btn btn-primary" onClick={() => openModal()}>+ Add Waiver</button>}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} />

        {can(SCREENS.RENT_WAIVER, 'upload') && (
          <>
            <ExcelUpload endpoint="/rent/waivers" templateName="Waiver_Master_Template.xlsx" onUploaded={fetchRows} />
            <p className="hint upload-note">A row with the same Rent Code, From Date and To Date as a saved waiver updates it (for example to Status No); otherwise a waiver is added. Dates as DD/MM/YYYY.</p>
          </>
        )}

        <div className="filter-bar">
          <input type="search" placeholder="Search Rent Code, SD Code, Landlord, Remark" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <MultiSelect allLabel="All Rent Codes" noun="Rent Codes" options={lookups.rents.map((r) => ({ value: r.id, label: rentLabel(r) }))} value={filters.rentId} onChange={(v) => setFilter({ rentId: v })} />
          <MultiSelect allLabel="Waiver Status: all" noun="statuses" options={['Yes', 'No']} value={filters.waiverStatus} onChange={(v) => setFilter({ waiverStatus: v })} />
          <DateRangeFilter label="Waiver period" from={filters.dateFrom} to={filters.dateTo} onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadFile('/rent/waivers/export', query, 'Waiver_Master.xlsx').catch(() => setError('Export failed.'))}>Export to Excel</button>
        </div>

        {loading ? <p>Loading...</p> : (
          <>
            <DataTable
              columns={columns} rows={rows} freeze
              onEdit={openModal} editLabel={can(SCREENS.RENT_WAIVER, 'edit') ? 'Edit' : 'View'}
              onDelete={can(SCREENS.RENT_WAIVER, 'delete') ? handleDelete : null}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}

        {modal && (
          <Modal wide title={editing ? `Waiver ${editing.waiver_id} · ${editing.rent_code}` : 'Add Waiver'} onClose={() => setModal(null)}>
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
                  <DateInput id="fromDate" label="From Date" required value={form.fromDate} onChange={(v) => setForm({ ...form, fromDate: v })} />
                  <DateInput id="toDate" label="To Date" required value={form.toDate} onChange={(v) => setForm({ ...form, toDate: v })} />
                  <div>
                    <label htmlFor="waiverStatus">Waiver Status <span className="req" aria-hidden="true">*</span></label>
                    <select id="waiverStatus" value={form.waiverStatus} onChange={set('waiverStatus')}>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="componentCode">Applies to</label>
                    <select id="componentCode" value={form.componentCode} onChange={set('componentCode')}>
                      <option value="">All components</option>
                      {COMPONENTS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="span-2">
                    <label htmlFor="remark">Remark</label>
                    <input id="remark" maxLength={500} value={form.remark} onChange={set('remark')} />
                  </div>
                </div>
                <p className="hint">From Date must be on or after the LCD and To Date on or before the LED. Partly waived months are charged for the remaining days.</p>
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
