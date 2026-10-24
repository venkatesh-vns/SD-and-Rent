import React, { useCallback, useEffect, useState } from 'react';
import Navbar from '../../components/Navbar';
import DataTable from '../../components/DataTable';
import MultiSelect from '../../components/MultiSelect';
import SearchSelect from '../../components/SearchSelect';
import useCascadeOptions from '../../hooks/useCascadeOptions';
import Modal from '../../components/Modal';
import ExcelUpload from '../../components/ExcelUpload';
import Pager from '../../components/Pager';
import Toast from '../../components/Toast';
import api, { downloadFile, errorMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { SCREENS } from '../../config/screens';
import useDebounce from '../../hooks/useDebounce';
import { formatDate } from '../../utils/format';
import { useRentLookups, DateInput, FormErrors, LeaseDates, money, agreementTotal } from './rentShared';

const PAGE_SIZE = 50;
const EMPTY_FILTERS = { search: '', costCenterId: [], landlordName: [], floor: [], llStatus: [] };
const EMPTY_FORM = { sdId: '', landlordName: '', llStatus: 'Active', inactiveEndDate: '' };

const columns = [
  { key: 'rentCode', label: 'Rent Code' },
  { key: 'sdCode', label: 'SD Code' },
  { key: 'costCenter', label: 'Cost Center' },
  { key: 'floor', label: 'Floor' },
  { key: 'lcd', label: 'LCD' },
  { key: 'rcd', label: 'RCD' },
  { key: 'led', label: 'LED' },
  { key: 'landlordName', label: 'Landlord Name' },
  { key: 'llStatus', label: 'LL Status', badge: true },
  { key: 'inactiveEnd', label: 'Inactive End Date' },
];

const toRow = (r) => ({
  id: r.rent_id,
  rentCode: r.rent_code,
  sdCode: r.sd_code,
  costCenter: r.cost_center_name,
  floor: r.floor,
  lcd: formatDate(r.lcd) || '—',
  rcd: formatDate(r.rcd) || '—',
  led: formatDate(r.led) || '—',
  landlordName: r.landlord_name,
  llStatus: r.ll_status,
  inactiveEnd: formatDate(r.inactive_end_date) || '—',
  cellClass: { rentCode: 'code-cell' },
  raw: r,
});

export default function RentMaster() {
  const { can } = useAuth();
  const lookups = useRentLookups();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [costCenters, setCostCenters] = useState([]);
  const [modal, setModal] = useState(null); // null | { editing: record | null }
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const search = useDebounce(filters.search);
  const query = { ...filters, search };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/rent/master', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data.map(toRow));
      setTotal(res.data.total);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load Rent Master.'));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(query), page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { api.get('/lookups/cost-centers').then((res) => setCostCenters(res.data.data)).catch(() => {}); }, []);

  // Landlord choices follow Cost Center; Floor choices follow Cost Center and Landlord
  const cascade = useCascadeOptions('rent', filters, setFilters);
  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const openModal = async (row = null) => {
    setFormErrors([]);
    if (!row) {
      setForm(EMPTY_FORM);
      setModal({ editing: null });
      return;
    }
    try {
      const res = await api.get(`/rent/master/${row.id}`);
      const r = res.data.data;
      setForm({ sdId: String(r.sd_id), landlordName: r.landlord_name, llStatus: r.ll_status, inactiveEndDate: formatDate(r.inactive_end_date) });
      setModal({ editing: r });
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the Rent Code.'));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormErrors([]);
    try {
      const res = modal.editing ? await api.put(`/rent/master/${modal.editing.rent_id}`, form) : await api.post('/rent/master', form);
      setNotice(res.data.message);
      setModal(null);
      fetchRows();
      lookups.reload();
    } catch (err) {
      const list = err.response?.data?.errors;
      setFormErrors(list?.length ? list : [{ field: '', error: errorMessage(err, 'Failed to save.') }]);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete ${row.rentCode}? This cannot be undone.`)) return;
    try {
      const res = await api.delete(`/rent/master/${row.id}`);
      setNotice(res.data.message);
      fetchRows();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete.'));
    }
  };

  const editing = modal?.editing;
  const canEdit = !editing || can(SCREENS.RENT_MASTER, 'edit');
  const sd = lookups.sds.find((s) => String(s.id) === String(form.sdId));
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  // Choosing an SD Code suggests its landlord from SD Master
  const chooseSd = (id) => {
    const next = lookups.sds.find((s) => String(s.id) === id);
    setForm({ ...form, sdId: id, landlordName: form.landlordName || next?.landlord_name || '' });
  };

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <div>
            <h1>Rent Master</h1>
            <p className="hint">Links a landlord to an SD Code and creates the Rent Code used on every Rent Transaction screen.</p>
          </div>
          {can(SCREENS.RENT_MASTER, 'add') && <button className="btn btn-primary" onClick={() => openModal()}>+ Add Rent Code</button>}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} />

        {can(SCREENS.RENT_MASTER, 'upload') && (
          <>
            <ExcelUpload endpoint="/rent/master" templateName="Rent_Master_Template.xlsx" onUploaded={() => { fetchRows(); lookups.reload(); }} />
            <p className="hint upload-note">
              Leave Rent Code blank to add a Rent Code; fill it to update that Rent Code (blank cells keep their value).
              Cost Center, Floor, LCD, RCD and LED come from SD Master. Dates as DD/MM/YYYY.
            </p>
          </>
        )}

        <div className="filter-bar">
          <input type="search" placeholder="Search Rent Code, SD Code, Landlord, Floor, Cost Center" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <MultiSelect allLabel="All cost centers" noun="cost centers" options={costCenters.map((c) => ({ value: c.id, label: c.name }))} value={filters.costCenterId} onChange={(v) => setFilter({ costCenterId: v })} />
          <MultiSelect allLabel="All landlords" noun="landlords" options={cascade.landlords} value={filters.landlordName} onChange={(v) => setFilter({ landlordName: v })} />
          <MultiSelect allLabel="All floors" noun="floors" options={cascade.floors} value={filters.floor} onChange={(v) => setFilter({ floor: v })} />
          <MultiSelect allLabel="LL Status: all" noun="statuses" options={['Active', 'Inactive']} value={filters.llStatus} onChange={(v) => setFilter({ llStatus: v })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadFile('/rent/master/export', query, 'Rent_Master.xlsx').catch(() => setError('Export failed.'))}>Export to Excel</button>
        </div>

        {loading ? <p>Loading...</p> : (
          <>
            <DataTable
              columns={columns} rows={rows} freeze
              onEdit={openModal} editLabel={can(SCREENS.RENT_MASTER, 'edit') ? 'Edit' : 'View'}
              onDelete={can(SCREENS.RENT_MASTER, 'delete') ? handleDelete : null}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}

        {modal && (
          <Modal wide title={editing ? `Rent Code ${editing.rent_code}` : 'Add Rent Code'} onClose={() => setModal(null)}>
            <form onSubmit={handleSave}>
              <FormErrors errors={formErrors} />
              <fieldset disabled={!canEdit}>
                <div className="form-grid">
                  <div>
                    <label>Rent Code</label>
                    <input type="text" value={editing ? editing.rent_code : 'Auto-generated on save'} disabled />
                  </div>
                  <div>
                    <label htmlFor="sdId">SD Code <span className="req" aria-hidden="true">*</span></label>
                    <SearchSelect id="sdId" required placeholder="Select or type to search SD Code" value={form.sdId} onChange={chooseSd}
                      options={lookups.sds.map((s) => ({ value: s.id, label: [s.sd_code, s.cost_center_name, s.floor, s.landlord_name].filter(Boolean).join(' · ') }))} />
                  </div>
                </div>
                <h4 className="form-section">From SD Master <small>not editable</small></h4>
                {sd ? <LeaseDates rec={sd} /> : <p className="hint">Select an SD Code to see its Cost Center, Floor, LCD, RCD and LED.</p>}

                <h4 className="form-section">Landlord</h4>
                <div className="form-grid">
                  <div>
                    <label htmlFor="landlordName">Landlord Name <span className="req" aria-hidden="true">*</span></label>
                    <input id="landlordName" list="landlord-names" maxLength={200} required value={form.landlordName} onChange={set('landlordName')} />
                    <datalist id="landlord-names">
                      {[...new Set([sd?.landlord_name, ...lookups.landlords].filter(Boolean))].map((n) => <option key={n} value={n} />)}
                    </datalist>
                  </div>
                  <div>
                    <label htmlFor="llStatus">LL Status <span className="req" aria-hidden="true">*</span></label>
                    <select id="llStatus" value={form.llStatus} onChange={set('llStatus')}>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                  {form.llStatus === 'Inactive' && (
                    <DateInput id="inactiveEndDate" label="Inactive End Date" required value={form.inactiveEndDate} onChange={(v) => setForm({ ...form, inactiveEndDate: v })} />
                  )}
                </div>
                {form.llStatus === 'Inactive' && (
                  <p className="hint">Rent is generated up to the Inactive End Date (pro-rated in that month) and stops from the next day.</p>
                )}
              </fieldset>

              {editing && (
                <div className="history">
                  <h4>Rent Agreements</h4>
                  {editing.agreements.length === 0 ? <p className="hint">No Rent Agreement yet.</p> : (
                    <table className="data-table compact">
                      <thead><tr><th>ID</th><th>Agreement Status</th><th>Status</th><th>Components</th><th className="num">Monthly Base</th></tr></thead>
                      <tbody>
                        {editing.agreements.map((a) => (
                          <tr key={a.agreement_id}>
                            <td>{a.agreement_id}</td><td>{a.agreement_status}</td>
                            <td><span className={`badge badge-${a.status.toLowerCase()}`}>{a.status}</span></td>
                            <td>{a.components.length}</td><td className="num">{money(agreementTotal(a.components))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="hint">Business Key: {editing.business_key}</p>
                </div>
              )}

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
