import React, { useCallback, useEffect, useState } from 'react';
import Navbar from '../../components/Navbar';
import DataTable from '../../components/DataTable';
import MultiSelect from '../../components/MultiSelect';
import Modal from '../../components/Modal';
import ExcelUpload from '../../components/ExcelUpload';
import Pager from '../../components/Pager';
import Toast from '../../components/Toast';
import api, { downloadFile, errorMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { SCREENS } from '../../config/screens';
import useDebounce from '../../hooks/useDebounce';
import { formatAmount, formatDate } from '../../utils/format';
import {
  COMPONENTS, triggerName, monthlyAmount, agreementTotal, useRentLookups, rentLabel, DateInput, FormErrors, LeaseDates, money,
} from './rentShared';

const PAGE_SIZE = 50;
const EMPTY_FILTERS = { search: '', rentId: [], agreementStatus: [], status: [] };
const EMPTY_FORM = { rentId: '', agreementStatus: 'Individual', status: 'Active', transferFromRentId: '', transferEffectiveDate: '', remark: '', components: {} };

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'rentCode', label: 'Rent Code' },
  { key: 'sdCode', label: 'SD Code' },
  { key: 'landlord', label: 'Landlord Name' },
  { key: 'agreementStatus', label: 'Agreement Status', badge: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'transfer', label: 'Transfer From / Effective' },
  { key: 'components', label: 'Components' },
  { key: 'monthly', label: 'Monthly Base (₹)', align: 'right' },
];

const toRow = (a) => ({
  id: a.agreement_id,
  rentCode: a.rent_code,
  sdCode: a.sd_code,
  landlord: a.landlord_name,
  agreementStatus: a.agreement_status,
  status: a.status,
  transfer: a.agreement_status === 'Transfer' ? `${a.transfer_from_rent_code} from ${formatDate(a.transfer_effective_date)}` : '—',
  components: a.components.map((c) => COMPONENTS.find((x) => x.code === c.component_code)?.label.replace('Rent to Landlord - ', '')).join(', '),
  monthly: formatAmount(agreementTotal(a.components)),
  cellClass: { rentCode: 'code-cell' },
  raw: a,
});

// Stored components -> form shape { CODE: { quantity, rate, percentage } }
const toFormComponents = (list = []) => Object.fromEntries(list.map((c) => [c.component_code, {
  quantity: c.quantity === null ? '' : String(Number(c.quantity)),
  rate: String(Number(c.rate)),
  percentage: String(Number(c.percentage)),
}]));

export default function RentAgreements() {
  const { can } = useAuth();
  const lookups = useRentLookups();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [modal, setModal] = useState(null); // null | { editing, locked }
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const search = useDebounce(filters.search);
  const query = { ...filters, search };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/rent/agreements', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data.map(toRow));
      setTotal(res.data.total);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load Rent Agreements.'));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(query), page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchRows(); }, [fetchRows]);
  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const openModal = async (row = null) => {
    setFormErrors([]);
    if (!row) {
      setForm(EMPTY_FORM);
      setModal({ editing: null, locked: false });
      return;
    }
    try {
      const { data } = (await api.get(`/rent/agreements/${row.id}`)).data;
      setForm({
        rentId: String(data.rent_id), agreementStatus: data.agreement_status, status: data.status,
        transferFromRentId: data.transfer_from_rent_id ? String(data.transfer_from_rent_id) : '',
        transferEffectiveDate: formatDate(data.transfer_effective_date), remark: data.remark || '',
        components: toFormComponents(data.components),
      });
      setModal({ editing: data, locked: Boolean(data.usage.rules || data.usage.schedule_lines), usage: data.usage });
    } catch (err) {
      setError(errorMessage(err, 'Failed to load the agreement.'));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormErrors([]);
    try {
      const res = modal.editing ? await api.put(`/rent/agreements/${modal.editing.agreement_id}`, form) : await api.post('/rent/agreements', form);
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
    if (!window.confirm(`Delete agreement ${row.id} of ${row.rentCode}?`)) return;
    try {
      const res = await api.delete(`/rent/agreements/${row.id}`);
      setNotice(res.data.message);
      fetchRows();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete.'));
    }
  };

  const editing = modal?.editing;
  const canEdit = !editing || can(SCREENS.RENT_AGREEMENT, 'edit');
  const locked = Boolean(modal?.locked);
  const rent = lookups.rents.find((r) => String(r.id) === String(form.rentId));
  const sdOf = (r) => lookups.sds.find((s) => s.sd_code === r?.sd_code);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setComp = (code, key, value) => setForm({ ...form, components: { ...form.components, [code]: { ...(form.components[code] || {}), [key]: value } } });
  const filled = COMPONENTS.map((c) => ({ ...(form.components[c.code] || {}), def: c }))
    .filter((v) => (v.def.unit === 'month' ? v.rate : v.quantity));
  const totalMonthly = filled.reduce((s, v) => s + monthlyAmount(v.def.unit === 'month' ? { rate: v.rate, percentage: v.percentage } : v), 0);
  const transferSources = lookups.rents.filter((r) => rent && r.sd_code === rent.sd_code && r.id !== rent.id);

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <div>
            <h1>Rent Agreement Master</h1>
            <p className="hint">Each component's monthly amount is Quantity × Rate × Percentage. Maintenance Charges start from the LCD, rent from the RCD; all end on the LED.</p>
          </div>
          {can(SCREENS.RENT_AGREEMENT, 'add') && <button className="btn btn-primary" onClick={() => openModal()}>+ Add Agreement</button>}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <Toast message={notice} onClose={() => setNotice('')} />

        {can(SCREENS.RENT_AGREEMENT, 'upload') && (
          <>
            <ExcelUpload endpoint="/rent/agreements" templateName="Rent_Agreement_Template.xlsx" onUploaded={fetchRows} />
            <p className="hint upload-note">
              Rent Code + Agreement Status identify the agreement: an active one is updated (blank cells keep their value), otherwise a new one is added.
              Fill a component's Sq.Ft / No. / Rate per Month, then its Rate and %.
            </p>
          </>
        )}

        <div className="filter-bar">
          <input type="search" placeholder="Search Rent Code, SD Code, Landlord, Remark" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <MultiSelect allLabel="All Rent Codes" noun="Rent Codes" options={lookups.rents.map((r) => ({ value: r.id, label: rentLabel(r) }))} value={filters.rentId} onChange={(v) => setFilter({ rentId: v })} />
          <MultiSelect allLabel="All Agreement Status" noun="statuses" options={['Individual', 'Transfer']} value={filters.agreementStatus} onChange={(v) => setFilter({ agreementStatus: v })} />
          <MultiSelect allLabel="Status: all" noun="statuses" options={['Active', 'Inactive']} value={filters.status} onChange={(v) => setFilter({ status: v })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
          <button type="button" className="btn btn-secondary" onClick={() => downloadFile('/rent/agreements/export', query, 'Rent_Agreements.xlsx').catch(() => setError('Export failed.'))}>Export to Excel</button>
        </div>

        {loading ? <p>Loading...</p> : (
          <>
            <DataTable
              columns={columns} rows={rows} freeze
              onEdit={openModal} editLabel={can(SCREENS.RENT_AGREEMENT, 'edit') ? 'Edit' : 'View'}
              onDelete={can(SCREENS.RENT_AGREEMENT, 'delete') ? handleDelete : null}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}

        {modal && (
          <Modal wide title={editing ? `Agreement ${editing.agreement_id} · ${editing.rent_code}` : 'Add Rent Agreement'} onClose={() => setModal(null)}>
            <form onSubmit={handleSave}>
              <FormErrors errors={formErrors} />
              {locked && (
                <div className="alert alert-info">
                  This agreement is already used in {modal.usage.rules ? 'Rule Master' : 'Rent Schedule'}, so only Status and Remark can change.
                  To change the amounts, make it Inactive and add a new agreement.
                </div>
              )}
              <fieldset disabled={!canEdit}>
                <div className="form-grid">
                  <div className="span-2">
                    <label htmlFor="rentId">Rent Code <span className="req" aria-hidden="true">*</span></label>
                    <select id="rentId" required disabled={locked} value={form.rentId} onChange={(e) => setForm({ ...form, rentId: e.target.value, transferFromRentId: '' })}>
                      <option value="">Select Rent Code</option>
                      {lookups.rents.map((r) => <option key={r.id} value={r.id}>{rentLabel(r)}</option>)}
                    </select>
                  </div>
                </div>
                {rent && <LeaseDates rec={{ ...rent, ...sdOf(rent) }} />}

                <div className="form-grid three">
                  <div>
                    <label htmlFor="agreementStatus">Agreement Status <span className="req" aria-hidden="true">*</span></label>
                    <select id="agreementStatus" disabled={locked} value={form.agreementStatus} onChange={set('agreementStatus')}>
                      <option value="Individual">Individual</option>
                      <option value="Transfer">Transfer</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="status">Status <span className="req" aria-hidden="true">*</span></label>
                    <select id="status" value={form.status} onChange={set('status')}>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="remark">Remark</label>
                    <input id="remark" maxLength={500} value={form.remark} onChange={set('remark')} />
                  </div>
                </div>

                {form.agreementStatus === 'Transfer' && (
                  <>
                    <h4 className="form-section">Transfer <small>configuration taken over from another landlord on the same SD Code</small></h4>
                    <div className="form-grid">
                      <div>
                        <label htmlFor="transferFrom">Transfer From Rent Code <span className="req" aria-hidden="true">*</span></label>
                        <select id="transferFrom" disabled={locked || !rent} value={form.transferFromRentId} onChange={set('transferFromRentId')}>
                          <option value="">{rent ? (transferSources.length ? 'Select the current landlord\'s Rent Code' : 'No other Rent Code on this SD Code') : 'Select the Rent Code first'}</option>
                          {transferSources.map((r) => <option key={r.id} value={r.id}>{rentLabel(r)}</option>)}
                        </select>
                      </div>
                      <DateInput id="transferEffective" label="Transfer Effective Date" required disabled={locked} value={form.transferEffectiveDate} onChange={(v) => setForm({ ...form, transferEffectiveDate: v })} />
                    </div>
                    <p className="hint">The old Rent Code's rent stops the day before this date. Leave the components blank to copy them; its rules and later waivers are copied too.</p>
                  </>
                )}

                <h4 className="form-section">Rent and charge components <small>fill the first field to use a component</small></h4>
                <div className="table-wrap">
                  <table className="data-table compact component-grid">
                    <thead>
                      <tr><th>Component</th><th>Starts from</th><th>Sq.Ft / No. / Rate per Month</th><th>Rate</th><th>%</th><th className="num">Monthly Amount</th></tr>
                    </thead>
                    <tbody>
                      {COMPONENTS.map((c) => {
                        const v = form.components[c.code] || {};
                        const monthly = c.unit === 'month' ? monthlyAmount({ rate: v.rate, percentage: v.percentage }) : monthlyAmount(v);
                        const used = c.unit === 'month' ? v.rate : v.quantity;
                        return (
                          <tr key={c.code} className={used ? 'is-used' : undefined}>
                            <th scope="row">{c.label}</th>
                            <td>{c.code === 'MAINTENANCE' ? 'LCD' : 'RCD'}</td>
                            <td>
                              <input
                                aria-label={`${c.label} ${triggerName(c)}`} placeholder={triggerName(c)} inputMode="decimal" disabled={locked}
                                value={c.unit === 'month' ? v.rate || '' : v.quantity || ''}
                                onChange={(e) => setComp(c.code, c.unit === 'month' ? 'rate' : 'quantity', e.target.value)}
                              />
                            </td>
                            <td>
                              {c.unit === 'month' ? <span className="hint">—</span> : (
                                <input aria-label={`${c.label} Rate`} placeholder="Rate" inputMode="decimal" disabled={locked || !used} value={v.rate || ''} onChange={(e) => setComp(c.code, 'rate', e.target.value)} />
                              )}
                            </td>
                            <td>
                              <input aria-label={`${c.label} %`} placeholder="%" inputMode="decimal" disabled={locked || !used} value={v.percentage || ''} onChange={(e) => setComp(c.code, 'percentage', e.target.value)} />
                            </td>
                            <td className="num">{used && monthly ? money(monthly) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr><th colSpan={5}>Total monthly base amount</th><td className="num"><strong>{money(totalMonthly)}</strong></td></tr>
                    </tfoot>
                  </table>
                </div>
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
