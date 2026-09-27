import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import ExcelUpload from '../components/ExcelUpload';
import Pager from '../components/Pager';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import { formatAmount, formatDate, formatDateTime } from '../utils/format';

const PAGE_SIZE = 50;

const columns = [
  { key: 'sdCode', label: 'SD Code' },
  { key: 'leaseAgreement', label: 'Lease ID / Agreement No.' },
  { key: 'costCenter', label: 'Cost Center' },
  { key: 'location', label: 'Location' },
  { key: 'floor', label: 'Floor' },
  { key: 'landlordName', label: 'Landlord' },
  { key: 'landlordStatus', label: 'Landlord Status', badge: true },
  { key: 'buildingStatus', label: 'Building Status', badge: true },
  { key: 'agreementValue', label: 'Agreement Value', align: 'right' },
  { key: 'leaseEnd', label: 'Lease End' },
];

const EMPTY_FORM = {
  leaseId: '', agreementNo: '', costCenterId: '', l1Id: '', l2Id: '', l3Id: '',
  landlordName: '', landlordStatus: 'Active', buildingStatus: 'Active', floor: '', agreementValue: '',
  leaseCommencementDate: '', rentCommencementDate: '', leaseEndDate: '',
};

const EMPTY_FILTERS = { search: '', costCenterId: '', l1Id: '', l2Id: '', landlordStatus: '', buildingStatus: '' };

function toRow(r) {
  return {
    id: r.sd_id,
    sdCode: r.sd_code,
    leaseAgreement: [r.lease_id, r.agreement_no].filter(Boolean).join(' / ') || '—',
    costCenter: r.cost_center_code,
    location: `${r.l1_name} › ${r.l2_name} › ${r.l3_name}`,
    floor: r.floor,
    landlordName: r.landlord_name || '—',
    landlordStatus: r.landlord_status,
    buildingStatus: r.building_status,
    agreementValue: formatAmount(r.agreement_value),
    leaseEnd: formatDate(r.lease_end_date) || '—',
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
const optionLabel = (o) => `${o.code} - ${o.name}${o.status !== 'Active' ? ' (Inactive)' : ''}`;

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
  const [params] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, search: params.get('search') || '' }));
  const [costCenters, setCostCenters] = useState([]);
  const [modal, setModal] = useState(null); // null | { editing: record | null, history: [] }
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const search = useDebounce(filters.search);

  const l1List = useLocations(1);
  const filterL2 = useLocations(2, filters.l1Id);
  const formL2 = useLocations(2, form.l1Id);
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
        {notice && <div className="alert alert-success">{notice}</div>}

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
          <select value={filters.costCenterId} onChange={(e) => setFilter({ costCenterId: e.target.value })}>
            <option value="">All cost centers</option>
            {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
          </select>
          <select value={filters.l1Id} onChange={(e) => setFilter({ l1Id: e.target.value, l2Id: '' })}>
            <option value="">All Level 1</option>
            {l1List.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={filters.l2Id} disabled={!filters.l1Id} onChange={(e) => setFilter({ l2Id: e.target.value })}>
            <option value="">{filters.l1Id ? 'All Level 2' : 'Level 2'}</option>
            {filterL2.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
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
              extraActions={can(SCREENS.SD_TRANSACTION, 'view') ? (row) => (
                <button className="btn btn-small btn-secondary" onClick={() => navigate(`/sd-transactions?sd=${row.id}`)}>Transactions</button>
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
                    <label htmlFor="floor">Floor *</label>
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
                    <label htmlFor="costCenterId">Cost Center *</label>
                    <select id="costCenterId" required value={form.costCenterId} onChange={set('costCenterId')}>
                      <option value="">Select Cost Center</option>
                      {selectable(costCenters, editing?.cost_center_id).map((c) => <option key={c.id} value={c.id}>{optionLabel(c)}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-grid three">
                  <div>
                    <label htmlFor="l1Id">Location Level 1 *</label>
                    <select id="l1Id" required value={form.l1Id} onChange={(e) => setForm({ ...form, l1Id: e.target.value, l2Id: '', l3Id: '' })}>
                      <option value="">Select Level 1</option>
                      {selectable(l1List, editing?.l1_id).map((l) => <option key={l.id} value={l.id}>{optionLabel(l)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="l2Id">Location Level 2 *</label>
                    <select id="l2Id" required disabled={!form.l1Id} value={form.l2Id} onChange={(e) => setForm({ ...form, l2Id: e.target.value, l3Id: '' })}>
                      <option value="">{form.l1Id ? 'Select Level 2' : 'Select Level 1 first'}</option>
                      {selectable(formL2, editing?.l2_id).map((l) => <option key={l.id} value={l.id}>{optionLabel(l)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="l3Id">Location Level 3 *</label>
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
                  <div>
                    <label htmlFor="agreementValue">Agreement Value *</label>
                    <input
                      id="agreementValue" type="text" inputMode="decimal" required placeholder="0.00"
                      value={form.agreementValue} onChange={set('agreementValue')}
                    />
                  </div>
                  <div>
                    <label htmlFor="landlordStatus">Landlord Status *</label>
                    <select id="landlordStatus" value={form.landlordStatus} onChange={set('landlordStatus')}>
                      <option value="Active">Active</option>
                      <option value="Passive">Passive</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="buildingStatus">Building Status *</label>
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
