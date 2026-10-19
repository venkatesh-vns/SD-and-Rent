import React, { useEffect, useState, useCallback } from 'react';
import Toast from '../components/Toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DataTable from '../components/DataTable';
import MultiSelect from '../components/MultiSelect';
import DateRangeFilter from '../components/DateRangeFilter';
import Modal from '../components/Modal';
import ExcelUpload from '../components/ExcelUpload';
import Pager from '../components/Pager';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import useReturnState from '../hooks/useReturnState';
import useCascadeOptions from '../hooks/useCascadeOptions';
import { formatAmount, formatDate, formatDateTime, daysUntil } from '../utils/format';
import { AMOUNTS, amountClass } from '../config/amounts';

const PAGE_SIZE = 50;

const columns = [
  { key: 'sdCode', label: 'SD Code' },
  { key: 'leaseId', label: 'Lease ID' },
  { key: 'agreementNo', label: 'Agreement No.' },
  { key: 'costCenter', label: 'Cost Center' },
  { key: 'floor', label: 'Floor' },
  { key: 'landlordName', label: 'Landlord Name' },
  { key: 'landlordStatus', label: 'Landlord Status', badge: true },
  { key: 'buildingStatus', label: 'Building Status', badge: true },
  { key: 'agreementValue', label: 'Agreement Value', align: 'right', tone: 'agreement' },
  { key: 'sdBalance', label: AMOUNTS.balance.label, align: 'right', tone: 'balance' },
  { key: 'repayable', label: AMOUNTS.repayable.label, align: 'right', tone: 'repayable' },
  { key: 'leaseEnd', label: 'Lease End' },
];

// Lease End with a warning when it has passed or is within 90 days
function leaseEndCell(iso) {
  if (!iso) return '—';
  const days = daysUntil(iso);
  if (days < 0) return <span className="date-flag expired">{formatDate(iso)}<small>Expired</small></span>;
  if (days <= 90) return <span className="date-flag soon">{formatDate(iso)}<small>{days === 0 ? 'Today' : `in ${days} days`}</small></span>;
  return formatDate(iso);
}

const EMPTY_FORM = {
  leaseId: '', agreementNo: '', costCenterId: '', l1Id: '', l2Id: '', l3Id: '',
  landlordName: '', landlordStatus: 'Active', buildingStatus: 'Active', floor: '', agreementValue: '',
  leaseCommencementDate: '', rentCommencementDate: '', leaseEndDate: '',
};

// Multi-select filters hold arrays of values (empty = all)
const EMPTY_FILTERS = {
  search: '', costCenterId: [], landlordName: [], floor: [], landlordStatus: [], buildingStatus: [], leaseEndFrom: '', leaseEndTo: '',
};
const SD_STATUSES = ['Active', 'Passive'];

function toRow(r) {
  return {
    id: r.sd_id,
    sdCode: r.sd_code,
    leaseId: r.lease_id || '—',
    agreementNo: r.agreement_no || '—',
    costCenter: r.cost_center_name,
    floor: r.floor,
    landlordName: r.landlord_name || '—',
    landlordStatus: r.landlord_status,
    buildingStatus: r.building_status,
    agreementValue: formatAmount(r.agreement_value),
    sdBalance: formatAmount(r.sd_balance),
    repayable: formatAmount(r.sd_balance_repayable),
    leaseEnd: leaseEndCell(r.lease_end_date),
    cellClass: {
      sdCode: 'code-cell',
      agreementValue: `${amountClass('agreement', r.agreement_value)} amount-plain`,
      sdBalance: amountClass('balance', r.sd_balance),
      repayable: amountClass('repayable', r.sd_balance_repayable),
    },
    raw: r,
  };
}

function toForm(r) {
  return {
    leaseId: r.lease_id || '',
    agreementNo: r.agreement_no || '',
    costCenterId: r.cost_center_id,
    l1Id: r.l1_id,
    l2Id: r.l2_id,
    l3Id: r.l3_id,
    landlordName: r.landlord_name || '',
    landlordStatus: r.landlord_status,
    buildingStatus: r.building_status,
    floor: r.floor,
    agreementValue: Number(r.agreement_value).toFixed(2),
    leaseCommencementDate: formatDate(r.lease_commencement_date),
    rentCommencementDate: formatDate(r.rent_commencement_date),
    leaseEndDate: formatDate(r.lease_end_date),
  };
}

// Active options, plus the record's current value even if since made Inactive
const selectable = (list, currentId) => list.filter((o) => o.status === 'Active' || String(o.id) === String(currentId));
// Dropdowns show names only (no codes); Inactive values are marked
const optionLabel = (o) => `${o.name}${o.status !== 'Active' ? ' (Inactive)' : ''}`;

// Loads a location level's list whenever its parent changes
function useLocations(level, parentId) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (level > 1 && !parentId) {
      setList([]);
      return;
    }
    api.get(`/lookups/locations/${level}`, { params: { parentId } })
      .then((res) => setList(res.data.data))
      .catch(() => setList([]));
  }, [level, parentId]);
  return list;
}

export default function SdMaster() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Filters, page and scroll come back as they were via "Back to SD Master"
  const back = useReturnState('sd-master', !loading);
  const [page, setPage] = useState(back.saved?.page || 1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(() => back.saved?.filters || { ...EMPTY_FILTERS, search: params.get('search') || '' });
  useEffect(() => { back.save({ filters, page }); }, [filters, page, back]);
  const [costCenters, setCostCenters] = useState([]);
  const [modal, setModal] = useState(null); // null | { editing: record | null, history: [] }
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const search = useDebounce(filters.search);

  const l1List = useLocations(1);
  const formL2 = useLocations(2, form.l1Id);
  // Landlord choices follow Cost Center; Floor choices follow Cost Center and Landlord
  const cascade = useCascadeOptions('sd', filters, setFilters);
  const formL3 = useLocations(3, form.l2Id);

  const query = { ...filters, search };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/sd-master', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data.map(toRow));
      setTotal(res.data.total);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load SD records.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), page]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    api.get('/lookups/cost-centers').then((res) => setCostCenters(res.data.data)).catch(() => {});
  }, []);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const openModal = async (row = null) => {
    setFormErrors([]);
    setError('');
    if (!row) {
      setForm(EMPTY_FORM);
      setModal({ editing: null, history: [] });
      return;
    }
    try {
      const res = await api.get(`/sd-master/${row.id}`);
      setForm(toForm(res.data.data));
      setModal({ editing: res.data.data, history: res.data.data.statusHistory });
    } catch (err) {
      setError(errorMessage(err, 'Failed to load SD record.'));
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormErrors([]);
    try {
      const res = modal.editing
        ? await api.put(`/sd-master/${modal.editing.sd_id}`, form)
        : await api.post('/sd-master', form);
      setNotice(res.data.message);
      setModal(null);
      fetchRows();
    } catch (err) {
      const list = err.response?.data?.errors;
      setFormErrors(list?.length ? list : [{ field: '', error: errorMessage(err, 'Failed to save SD record.') }]);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete ${row.sdCode}? This cannot be undone.`)) return;
    setError('');
    try {
      const res = await api.delete(`/sd-master/${row.id}`);
      setNotice(res.data.message);
      fetchRows();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete SD record.'));
    }
  };

  const handleExport = () => {
    downloadFile('/sd-master/export', query, 'SD_Master.xlsx').catch(() => setError('Export failed.'));
  };

  const editing = modal?.editing;
  const dateField = (key, label) => (
    <div>
      <label htmlFor={key}>{label}</label>
      <input
        id={key} type="text" inputMode="numeric" placeholder="DD/MM/YYYY" maxLength={10}
        pattern="\d{1,2}/\d{1,2}/\d{4}" title="DD/MM/YYYY"
        value={form[key]} onChange={set(key)}
      />
    </div>
  );

  // Quick actions from the SD Dashboard: ?action=add opens the Add form,
  // ?action=upload brings the Excel upload panel into view
  useEffect(() => {
    const action = params.get('action');
    if (!action) return;
    if (action === 'add' && can(SCREENS.SD_MASTER, 'add')) openModal();
    if (action === 'upload') {
      const panel = document.querySelector('.upload-panel');
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        panel.classList.add('flash');
        setTimeout(() => panel.classList.remove('flash'), 1800);
      }
    }
    setParams((p) => { p.delete('action'); return p; }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <h1>SD Master</h1>
          {can(SCREENS.SD_MASTER, 'add') && (
            <button className="btn btn-primary" onClick={() => openModal()}>+ Add SD Record</button>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} />

        {can(SCREENS.SD_MASTER, 'upload') && (
          <>
            <ExcelUpload endpoint="/sd-master" templateName="SD_Master_Template.xlsx" onUploaded={fetchRows} />
            <p className="hint upload-note">
              Leave SD Code blank to add a record. Fill SD Code to update that record; blank cells keep their current value.
              Dates as DD/MM/YYYY. Cost Center and locations can be given by code or name.
            </p>
          </>
        )}

        <div className="filter-bar">
          <input
            type="search" placeholder="Search SD Code, Lease ID, Agreement No., Landlord, Floor"
            value={filters.search} onChange={(e) => setFilter({ search: e.target.value })}
          />
          <MultiSelect
            allLabel="All cost centers" noun="cost centers"
            options={costCenters.map((c) => ({ value: c.id, label: c.name }))}
            value={filters.costCenterId} onChange={(v) => setFilter({ costCenterId: v })}
          />
          <MultiSelect allLabel="All landlords" noun="landlords" options={cascade.landlords} value={filters.landlordName} onChange={(v) => setFilter({ landlordName: v })} />
          <MultiSelect allLabel="All floors" noun="floors" options={cascade.floors} value={filters.floor} onChange={(v) => setFilter({ floor: v })} />
          <MultiSelect
            allLabel="Landlord: all" noun="statuses"
            options={SD_STATUSES.map((s) => ({ value: s, label: `Landlord: ${s}` }))}
            value={filters.landlordStatus} onChange={(v) => setFilter({ landlordStatus: v })}
          />
          <MultiSelect
            allLabel="Building: all" noun="statuses"
            options={SD_STATUSES.map((s) => ({ value: s, label: `Building: ${s}` }))}
            value={filters.buildingStatus} onChange={(v) => setFilter({ buildingStatus: v })}
          />
          <DateRangeFilter label="Lease End" from={filters.leaseEndFrom} to={filters.leaseEndTo} onChange={({ from, to }) => setFilter({ leaseEndFrom: from, leaseEndTo: to })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
          <button type="button" className="btn btn-secondary" onClick={handleExport}>Export to Excel</button>
        </div>

        {loading ? <p>Loading...</p> : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              onEdit={openModal}
              editLabel={can(SCREENS.SD_MASTER, 'edit') ? 'Edit' : 'View'}
              onDelete={can(SCREENS.SD_MASTER, 'delete') ? handleDelete : null}
              freeze
              extraActions={can(SCREENS.SD_TRANSACTION, 'view') ? (row) => (
                <button className="btn btn-small btn-outline" onClick={() => { back.leave(); navigate(`/sd-transactions?sd=${row.id}&from=sd-master`); }}>Transactions</button>
              ) : null}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}

        {modal && (
          <Modal wide title={editing ? `SD Record ${editing.sd_code}` : 'Add SD Record'} onClose={() => setModal(null)}>
            <form onSubmit={handleSave}>
              {formErrors.length > 0 && (
                <div className="alert alert-error">
                  <strong>Please correct the following:</strong>
                  <ul>{formErrors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.error}</li>)}</ul>
                </div>
              )}

              <fieldset disabled={Boolean(editing) && !can(SCREENS.SD_MASTER, 'edit')}>
                <div className="form-grid">
                  <div>
                    <label>SD Code</label>
                    <input type="text" value={editing ? editing.sd_code : 'Auto-generated on save'} disabled />
                  </div>
                  <div>
                    <label htmlFor="floor">Floor <span className="req" aria-hidden="true">*</span></label>
                    <input id="floor" type="text" maxLength={50} required value={form.floor} onChange={set('floor')} />
                  </div>
                  <div>
                    <label htmlFor="leaseId">Lease ID</label>
                    <input id="leaseId" type="text" maxLength={50} value={form.leaseId} onChange={set('leaseId')} />
                  </div>
                  <div>
                    <label htmlFor="agreementNo">Agreement No.</label>
                    <input id="agreementNo" type="text" maxLength={50} value={form.agreementNo} onChange={set('agreementNo')} />
                  </div>

                  <div className="span-2">
                    <label htmlFor="costCenterId">Cost Center <span className="req" aria-hidden="true">*</span></label>
                    <select id="costCenterId" required value={form.costCenterId} onChange={set('costCenterId')}>
                      <option value="">Select Cost Center</option>
                      {selectable(costCenters, editing?.cost_center_id).map((c) => <option key={c.id} value={c.id}>{optionLabel(c)}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-grid three">
                  <div>
                    <label htmlFor="l1Id">Location Level 1 <span className="req" aria-hidden="true">*</span></label>
                    <select id="l1Id" required value={form.l1Id} onChange={(e) => setForm({ ...form, l1Id: e.target.value, l2Id: '', l3Id: '' })}>
                      <option value="">Select Level 1</option>
                      {selectable(l1List, editing?.l1_id).map((l) => <option key={l.id} value={l.id}>{optionLabel(l)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="l2Id">Location Level 2 <span className="req" aria-hidden="true">*</span></label>
                    <select id="l2Id" required disabled={!form.l1Id} value={form.l2Id} onChange={(e) => setForm({ ...form, l2Id: e.target.value, l3Id: '' })}>
                      <option value="">{form.l1Id ? 'Select Level 2' : 'Select Level 1 first'}</option>
                      {selectable(formL2, editing?.l2_id).map((l) => <option key={l.id} value={l.id}>{optionLabel(l)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="l3Id">Location Level 3 <span className="req" aria-hidden="true">*</span></label>
                    <select id="l3Id" required disabled={!form.l2Id} value={form.l3Id} onChange={set('l3Id')}>
                      <option value="">{form.l2Id ? 'Select Level 3' : 'Select Level 2 first'}</option>
                      {selectable(formL3, editing?.l3_id).map((l) => <option key={l.id} value={l.id}>{optionLabel(l)}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-grid">
                  <div>
                    <label htmlFor="landlordName">Landlord Name</label>
                    <input id="landlordName" type="text" maxLength={200} value={form.landlordName} onChange={set('landlordName')} />
                  </div>
                  <div className="money-field tone-agreement">
                    <label htmlFor="agreementValue">Agreement Value <span className="req" aria-hidden="true">*</span></label>
                    <div className="money-input">
                      <span aria-hidden="true">₹</span>
                      <input
                        id="agreementValue" type="text" inputMode="decimal" required placeholder="Amount in ₹"
                        value={form.agreementValue} onChange={set('agreementValue')}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="landlordStatus">Landlord Status <span className="req" aria-hidden="true">*</span></label>
                    <select id="landlordStatus" value={form.landlordStatus} onChange={set('landlordStatus')}>
                      <option value="Active">Active</option>
                      <option value="Passive">Passive</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="buildingStatus">Building Status <span className="req" aria-hidden="true">*</span></label>
                    <select id="buildingStatus" value={form.buildingStatus} onChange={set('buildingStatus')}>
                      <option value="Active">Active</option>
                      <option value="Passive">Passive</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid three">
                  {dateField('leaseCommencementDate', 'Lease Commencement Date')}
                  {dateField('rentCommencementDate', 'Rent Commencement Date')}
                  {dateField('leaseEndDate', 'Lease End Date')}
                </div>
              </fieldset>

              {editing && modal.history.length > 0 && (
                <div className="history">
                  <h4>Status history</h4>
                  <table className="data-table compact">
                    <thead><tr><th>When</th><th>Status</th><th>Change</th><th>By</th></tr></thead>
                    <tbody>
                      {modal.history.map((h) => (
                        <tr key={h.history_id}>
                          <td>{formatDateTime(h.changed_date)}</td>
                          <td>{h.status_type}</td>
                          <td>{h.old_status} → {h.new_status}</td>
                          <td>{h.changed_by}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(!editing || can(SCREENS.SD_MASTER, 'edit')) && (
                <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
