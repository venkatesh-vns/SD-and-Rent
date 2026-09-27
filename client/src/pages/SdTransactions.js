import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import ExcelUpload from '../components/ExcelUpload';
import Pager from '../components/Pager';
import SdPicker from '../components/SdPicker';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import { formatAmount, formatDate } from '../utils/format';

const PAGE_SIZE = 50;

// Must match the server's allowed values
const SD_TYPES = ['Landlord SD', 'Electricity SD', 'Additional Parking SD', 'Other SD', 'Fitout SD', 'CAM SD', 'Solar SD'];
const AGREEMENT_STATUSES = ['LOI', 'Agreement', 'Registered Agreement', 'Addendum Agreement', 'Mail Approval'];

const AMOUNTS = [
  ['paidAmount', 'paid_amount', 'SD Paid Amount'],
  ['transferAmount', 'transfer_amount', 'SD Transfer Amount'],
  ['adjustmentAmount', 'adjustment_amount', 'SD Adjustment Amount'],
  ['refundAmount', 'refund_amount', 'SD Refund Amount'],
];

const EMPTY_FORM = {
  sdType: '', fy: '', txnDate: '', agreementStatus: '',
  paidAmount: '', transferAmount: '', adjustmentAmount: '', refundAmount: '', remarks: '',
};

const EMPTY_FILTERS = { search: '', sdType: '', fy: '', agreementStatus: '', dateFrom: '', dateTo: '' };

// Indian financial year (April-March) for a DD/MM/YYYY date, e.g. '2024-2025'
function fyFor(dmy) {
  const m = String(dmy).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const month = Number(m[2]);
  const year = Number(m[3]);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${start + 1}`;
}

const blankZero = (v) => (Number(v) ? formatAmount(v) : '');

export default function SdTransactions() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const sdId = params.get('sd') || '';

  const [summary, setSummary] = useState(null); // { sd, balance }
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [modal, setModal] = useState(null); // null | { editing: txn | null, sd }
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const search = useDebounce(filters.search);

  const query = { ...filters, search, sdId };

  const fetchSummary = useCallback(async () => {
    if (!sdId) {
      setSummary(null);
      return;
    }
    try {
      const res = await api.get(`/sd-transactions/summary/${sdId}`);
      setSummary(res.data.data);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load SD Code.'));
    }
  }, [sdId]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/sd-transactions', { params: { ...query, page, pageSize: PAGE_SIZE } });
      setRows(res.data.data.map((t) => ({
        id: t.txn_id,
        txnNo: t.txn_no,
        sdCode: t.sd_code,
        txnDate: formatDate(t.txn_date),
        fy: t.fy,
        sdType: t.sd_type,
        agreementStatus: t.agreement_status,
        paid: blankZero(t.paid_amount),
        transfer: blankZero(t.transfer_amount),
        adjustment: blankZero(t.adjustment_amount),
        refund: blankZero(t.refund_amount),
        balance: formatAmount(t.running_sd_balance),
        repayable: formatAmount(t.running_repayable),
        remarks: t.remarks,
        raw: t,
      })));
      setTotal(res.data.total);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load transactions.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), page]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const refresh = () => {
    fetchRows();
    fetchSummary();
  };

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const selectSd = (sd) => {
    setParams(sd ? { sd: String(sd.sd_id) } : {});
    setPage(1);
    setNotice('');
    setError('');
  };

  const sd = summary?.sd;
  const passive = sd && (sd.landlord_status !== 'Active' || sd.building_status !== 'Active');

  const openModal = (row = null, forSd = sd) => {
    setFormErrors([]);
    if (row) {
      const t = row.raw;
      setForm({
        sdType: t.sd_type, fy: t.fy, txnDate: formatDate(t.txn_date), agreementStatus: t.agreement_status,
        ...Object.fromEntries(AMOUNTS.map(([key, col]) => [key, Number(t[col]) ? Number(t[col]).toFixed(2) : ''])),
        remarks: t.remarks || '',
      });
      setModal({ editing: t, sd: { sd_id: t.sd_id, sd_code: t.sd_code } });
    } else {
      setForm(EMPTY_FORM);
      setModal({ editing: null, sd: forSd || null });
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  // Fill FY from the date unless the user typed a different FY
  const setDate = (e) => {
    const txnDate = e.target.value;
    const autoFy = !form.fy || form.fy === fyFor(form.txnDate);
    setForm({ ...form, txnDate, fy: autoFy ? fyFor(txnDate) || form.fy : form.fy });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!modal.sd) {
      setFormErrors([{ field: 'SD Code', error: 'Choose an SD Code.' }]);
      return;
    }
    setSaving(true);
    setFormErrors([]);
    try {
      const body = { ...form, sdId: modal.sd.sd_id };
      const res = modal.editing
        ? await api.put(`/sd-transactions/${modal.editing.txn_id}`, body)
        : await api.post('/sd-transactions', body);
      setNotice(res.data.message);
      setModal(null);
      refresh();
    } catch (err) {
      const list = err.response?.data?.errors;
      setFormErrors(list?.length ? list : [{ field: '', error: errorMessage(err, 'Failed to save transaction.') }]);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete ${row.txnNo} (${row.sdCode}, ${row.txnDate})?`)) return;
    setError('');
    try {
      const res = await api.delete(`/sd-transactions/${row.id}`);
      setNotice(res.data.message);
      refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete transaction.'));
    }
  };

  const handleExport = () => {
    downloadFile('/sd-transactions/export', query, 'SD_Transactions.xlsx').catch(() => setError('Export failed.'));
  };

  const columns = [
    { key: 'txnNo', label: 'Txn No.' },
    ...(sdId ? [] : [{ key: 'sdCode', label: 'SD Code' }]),
    { key: 'txnDate', label: 'Date' },
    { key: 'fy', label: 'FY' },
    { key: 'sdType', label: 'SD Type' },
    { key: 'agreementStatus', label: 'Agreement Status' },
    { key: 'paid', label: 'Paid', align: 'right' },
    { key: 'transfer', label: 'Transfer', align: 'right' },
    { key: 'adjustment', label: 'Adjustment', align: 'right' },
    { key: 'refund', label: 'Refund', align: 'right' },
    { key: 'balance', label: 'SD Balance', align: 'right' },
    { key: 'repayable', label: 'Repayable', align: 'right' },
    { key: 'remarks', label: 'Remarks' },
  ];

  const editing = modal?.editing;
  const canEdit = can(SCREENS.SD_TRANSACTION, 'edit');
  const b = summary?.balance;

  return (
    <div>
      <Navbar />
      <div className="page-container wide">
        <div className="page-header">
          <h1>SD Transaction</h1>
          {can(SCREENS.SD_TRANSACTION, 'add') && (
            <button
              className="btn btn-primary"
              disabled={passive}
              title={passive ? 'This SD Code is Passive and cannot take new transactions.' : undefined}
              onClick={() => openModal()}
            >
              + Add Transaction
            </button>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        <div className="sd-select-row">
          <SdPicker onSelect={selectSd} placeholder={sd ? 'Switch to another SD Code' : undefined} />
          {sd && <button type="button" className="btn btn-secondary" onClick={() => selectSd(null)}>Show all SD Codes</button>}
        </div>

        {sd && b && (
          <div className="sd-summary card">
            <div className="sd-summary-head">
              <div>
                <h2>{sd.sd_code}</h2>
                <p className="hint">
                  {[sd.lease_id && `Lease ${sd.lease_id}`, sd.agreement_no && `Agreement ${sd.agreement_no}`, `Floor ${sd.floor}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="sd-summary-status">
                <span className={`badge badge-${sd.landlord_status.toLowerCase()}`}>Landlord {sd.landlord_status}</span>
                <span className={`badge badge-${sd.building_status.toLowerCase()}`}>Building {sd.building_status}</span>
                {can(SCREENS.SD_MASTER, 'view') && <Link to={`/sd-master?search=${sd.sd_code}`}>Open in SD Master</Link>}
              </div>
            </div>
            <dl className="sd-facts">
              <div><dt>Cost Center</dt><dd>{sd.cost_center_code} - {sd.cost_center_name}</dd></div>
              <div><dt>Location</dt><dd>{sd.l1_name} › {sd.l2_name} › {sd.l3_name}</dd></div>
              <div><dt>Landlord</dt><dd>{sd.landlord_name || '—'}</dd></div>
              <div><dt>Lease</dt><dd>{formatDate(sd.lease_commencement_date) || '—'} to {formatDate(sd.lease_end_date) || '—'}</dd></div>
              <div><dt>Rent Commencement</dt><dd>{formatDate(sd.rent_commencement_date) || '—'}</dd></div>
            </dl>
            <div className="sd-tiles">
              <div><span>Agreement Value</span><strong>{formatAmount(b.agreement_value)}</strong></div>
              <div><span>Total Paid</span><strong>{formatAmount(b.total_paid)}</strong></div>
              <div><span>Transfer</span><strong>{formatAmount(b.total_transfer)}</strong></div>
              <div><span>Adjustment</span><strong>{formatAmount(b.total_adjustment)}</strong></div>
              <div><span>Refund</span><strong>{formatAmount(b.total_refund)}</strong></div>
              <div className="key"><span>SD Balance</span><strong>{formatAmount(b.sd_balance)}</strong></div>
              <div className="key"><span>SD Balance Repayable</span><strong>{formatAmount(b.sd_balance_repayable)}</strong></div>
            </div>
            {passive && <p className="hint">This SD Code is Passive: existing transactions stay visible, but no new ones can be added.</p>}
          </div>
        )}

        {can(SCREENS.SD_TRANSACTION, 'upload') && (
          <>
            <ExcelUpload endpoint="/sd-transactions" templateName="SD_Transaction_Template.xlsx" onUploaded={refresh} />
            <p className="hint upload-note">
              Leave Transaction No. blank to add a transaction. Fill it to update that transaction; blank cells keep their current value.
              Dates as DD/MM/YYYY, FY as 2024-2025.
            </p>
          </>
        )}

        <div className="filter-bar">
          <input type="search" placeholder="Search Txn No., SD Code or Remarks" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <select value={filters.sdType} onChange={(e) => setFilter({ sdType: e.target.value })}>
            <option value="">All SD Types</option>
            {SD_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input className="short" type="text" placeholder="FY e.g. 2024-2025" value={filters.fy} onChange={(e) => setFilter({ fy: e.target.value })} />
          <select value={filters.agreementStatus} onChange={(e) => setFilter({ agreementStatus: e.target.value })}>
            <option value="">All Agreement Status</option>
            {AGREEMENT_STATUSES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input className="short" type="text" placeholder="From DD/MM/YYYY" value={filters.dateFrom} onChange={(e) => setFilter({ dateFrom: e.target.value })} />
          <input className="short" type="text" placeholder="To DD/MM/YYYY" value={filters.dateTo} onChange={(e) => setFilter({ dateTo: e.target.value })} />
          <button type="button" className="btn btn-secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
          <button type="button" className="btn btn-secondary" onClick={handleExport}>Export to Excel</button>
        </div>
        <p className="hint">
          {sdId
            ? 'Oldest first. SD Balance and Repayable are running totals up to each transaction date.'
            : 'Newest first, across all SD Codes. SD Balance and Repayable are running totals for each row\'s SD Code.'}
        </p>

        {loading ? <p>Loading...</p> : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              onEdit={canEdit ? (row) => openModal(row) : null}
              onDelete={can(SCREENS.SD_TRANSACTION, 'delete') ? handleDelete : null}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </>
        )}

        {modal && (
          <Modal wide title={editing ? `Edit ${editing.txn_no}` : 'Add SD Transaction'} onClose={() => setModal(null)}>
            <form onSubmit={handleSave}>
              {formErrors.length > 0 && (
                <div className="alert alert-error">
                  <strong>Please correct the following:</strong>
                  <ul>{formErrors.map((er, i) => <li key={i}>{er.field ? `${er.field}: ` : ''}{er.error}</li>)}</ul>
                </div>
              )}

              <label>SD Code *</label>
              {modal.sd ? (
                <div className="picked-sd">
                  <strong>{modal.sd.sd_code}</strong>
                  {!editing && !sd && <button type="button" className="btn btn-small btn-secondary" onClick={() => setModal({ ...modal, sd: null })}>Change</button>}
                </div>
              ) : (
                <SdPicker autoFocus onSelect={(picked) => setModal({ ...modal, sd: picked })} />
              )}

              <div className="form-grid">
                <div>
                  <label htmlFor="txnDate">SD Transaction Date *</label>
                  <input id="txnDate" type="text" required placeholder="DD/MM/YYYY" maxLength={10} value={form.txnDate} onChange={setDate} />
                </div>
                <div>
                  <label htmlFor="fy">FY *</label>
                  <input id="fy" type="text" required placeholder="2024-2025" maxLength={9} value={form.fy} onChange={set('fy')} />
                </div>
                <div>
                  <label htmlFor="sdType">SD Type *</label>
                  <select id="sdType" required value={form.sdType} onChange={set('sdType')}>
                    <option value="">Select SD Type</option>
                    {SD_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="agreementStatus">Agreement Status *</label>
                  <select id="agreementStatus" required value={form.agreementStatus} onChange={set('agreementStatus')}>
                    <option value="">Select Agreement Status</option>
                    {AGREEMENT_STATUSES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                {AMOUNTS.map(([key, , label]) => (
                  <div key={key}>
                    <label htmlFor={key}>{label}</label>
                    <input id={key} type="text" inputMode="decimal" placeholder="0.00" value={form[key]} onChange={set(key)} />
                  </div>
                ))}
                <div className="span-2">
                  <label htmlFor="remarks">Remarks</label>
                  <textarea id="remarks" rows={3} maxLength={1000} value={form.remarks} onChange={set('remarks')}
                    placeholder="e.g. transferred to SD000123" />
                </div>
              </div>
              <p className="hint">Enter at least one amount. SD Balance and Repayable are calculated automatically.</p>

              <button type="submit" className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
