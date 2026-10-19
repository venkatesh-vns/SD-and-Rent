import React, { useEffect, useState, useCallback } from 'react';
import Toast from '../components/Toast';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DataTable from '../components/DataTable';
import MultiSelect from '../components/MultiSelect';
import DateRangeFilter from '../components/DateRangeFilter';
import Modal from '../components/Modal';
import ExcelUpload from '../components/ExcelUpload';
import Pager from '../components/Pager';
import SdPicker from '../components/SdPicker';
import api, { downloadFile, errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SCREENS } from '../config/screens';
import useDebounce from '../hooks/useDebounce';
import { RETURN_SCREENS } from '../hooks/useReturnState';
import useCascadeOptions from '../hooks/useCascadeOptions';
import { formatAmount, formatDate } from '../utils/format';
import AmountTiles from '../components/AmountTiles';
import { amountClass } from '../config/amounts';

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
  paidAmount: '', transferAmount: '', adjustmentAmount: '', refundAmount: '', remarks: '', reversesTxnNo: '',
};

// Multi-select filters hold arrays of values (empty = all)
const EMPTY_FILTERS = {
  search: '', costCenterId: [], landlordName: [], floor: [], sdType: [], fy: [], agreementStatus: [], entryType: [], dateFrom: '', dateTo: '',
};

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
  // Opened from SD Master / SD Balance Report / SD Dashboard: offer a way back
  const fromKey = params.get('from') || '';
  const from = RETURN_SCREENS[fromKey];
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null); // { sd, balance }
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [fyList, setFyList] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [modal, setModal] = useState(null); // null | { editing: txn | null, sd }
  const [form, setForm] = useState(EMPTY_FORM);
  const [payments, setPayments] = useState([]); // this SD Code's payments, for a reversal's link
  const [formErrors, setFormErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const search = useDebounce(filters.search);
  // Landlord choices follow Cost Center; Floor choices follow Cost Center and Landlord
  const cascade = useCascadeOptions('sd', filters, setFilters);

  // One SD Code selected: its own filters (Cost Center / Landlord / Floor) do not apply
  const query = sdId ? { ...filters, costCenterId: [], landlordName: [], floor: [], search, sdId } : { ...filters, search, sdId };

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
        // Negative SD Paid = reversal entry, tagged; a payment shows how much of it was reversed
        txnNo: Number(t.paid_amount) < 0 ? (
          <span className="txn-cell">{t.txn_no}<span className="reversal-tag" title="Negative SD Paid entry (reversal / credit note)">Reversal{t.reverses_txn_no ? ` of ${t.reverses_txn_no}` : ''}</span></span>
        ) : Number(t.reversed_amount) > 0 ? (
          <span className="txn-cell">{t.txn_no}<small className="reversed-note">₹{formatAmount(t.reversed_amount)} reversed</small></span>
        ) : t.txn_no,
        txnNoText: t.txn_no,
        rowClass: Number(t.paid_amount) < 0 ? 'row-reversal' : undefined,
        sdCode: t.sd_code,
        floor: t.floor,
        landlord: t.landlord_name || '—',
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
        cellClass: {
          paid: `${amountClass('paid', t.paid_amount)}${Number(t.paid_amount) < 0 ? ' amount-negative' : ''}`,
          transfer: amountClass('transfer', t.transfer_amount),
          adjustment: amountClass('adjustment', t.adjustment_amount),
          refund: amountClass('refund', t.refund_amount),
          balance: amountClass('balance', t.running_sd_balance),
          repayable: amountClass('repayable', t.running_repayable),
        },
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
  useEffect(() => {
    api.get('/lookups/cost-centers').then((res) => setCostCenters(res.data.data)).catch(() => {});
  }, []);
  // Financial years in use (refreshed with the list, so a new FY appears after a save)
  useEffect(() => {
    api.get('/lookups/fys').then((res) => setFyList(res.data.data)).catch(() => setFyList([]));
  }, [rows]);

  const refresh = () => {
    fetchRows();
    fetchSummary();
  };

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const selectSd = (sd) => {
    setParams({ ...(sd ? { sd: String(sd.sd_id) } : {}), ...(from ? { from: fromKey } : {}) });
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
        reversesTxnNo: t.reverses_txn_no || '',
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
    if (!window.confirm(`Delete ${row.txnNoText} (${row.sdCode}, ${row.txnDate})?`)) return;
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
    ...(sdId ? [] : [{ key: 'sdCode', label: 'SD Code' }, { key: 'floor', label: 'Floor' }, { key: 'landlord', label: 'Landlord Name' }]),
    { key: 'txnDate', label: 'Date' },
    { key: 'fy', label: 'FY' },
    { key: 'sdType', label: 'SD Type' },
    { key: 'agreementStatus', label: 'Agreement Status' },
    { key: 'paid', label: 'Paid', align: 'right', tone: 'paid' },
    { key: 'transfer', label: 'Transfer', align: 'right', tone: 'out' },
    { key: 'adjustment', label: 'Adjustment', align: 'right', tone: 'out' },
    { key: 'refund', label: 'Refund', align: 'right', tone: 'out' },
    { key: 'balance', label: 'SD Balance', align: 'right', tone: 'balance' },
    { key: 'repayable', label: 'Repayable', align: 'right', tone: 'repayable' },
    { key: 'remarks', label: 'Remarks' },
  ];

  // Negative SD Paid (reversal) entries: allowed with the "SD Negative Entry" right
  const canNegative = can(SCREENS.SD_NEGATIVE_ENTRY, 'add');
  const negativePaid = String(form.paidAmount).trim().startsWith('-');
  const modalSdId = modal?.sd?.sd_id;
  useEffect(() => {
    if (!modalSdId || !negativePaid) return;
    api.get('/sd-transactions', { params: { sdId: modalSdId, entryType: 'Payment', pageSize: 200 } })
      .then((res) => setPayments(res.data.data.filter((t) => Number(t.paid_amount) > 0)))
      .catch(() => setPayments([]));
  }, [modalSdId, negativePaid]);

  const editing = modal?.editing;
  const canEdit = can(SCREENS.SD_TRANSACTION, 'edit');
  const b = summary?.balance;

  // Quick actions from the SD Dashboard: ?action=add opens the Add form,
  // ?action=upload brings the Excel upload panel into view
  useEffect(() => {
    const action = params.get('action');
    if (!action) return;
    if (action === 'add' && can(SCREENS.SD_TRANSACTION, 'add')) openModal();
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
        {from && (
          <button type="button" className="back-link" onClick={() => navigate(from.path, { state: { restore: true } })}>
            <span aria-hidden="true">←</span> Back to {from.label}
          </button>
        )}
        <div className="page-header">
          <h1>SD Transactions</h1>
          {can(SCREENS.SD_TRANSACTION, 'add') && !sd && (
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
        <Toast message={notice} onClose={() => setNotice('')} />

        <div className="sd-select-row">
          <SdPicker onSelect={selectSd} placeholder={sd ? 'Switch to another SD Code' : undefined} />
          {sd && <button type="button" className="btn btn-secondary" onClick={() => selectSd(null)}>Show all SD Codes</button>}
        </div>

        {sd && b && (
          // Key SD details stay pinned under the menu bar while the transactions scroll
          <section className="sd-sticky" aria-label={`Selected SD record ${sd.sd_code}`}>
            <div className="sd-sticky-id">
              <span>SD Code</span>
              <strong>{sd.sd_code}</strong>
              <small>{[sd.lease_id, sd.agreement_no].filter(Boolean).join(' · ') || 'No Lease ID / Agreement No.'}</small>
            </div>
            <dl className="sd-sticky-fields">
              <div><dt>Cost Center</dt><dd>{sd.cost_center_name}</dd></div>
              <div><dt>Floor</dt><dd>{sd.floor}</dd></div>
              <div><dt>Landlord Name</dt><dd>{sd.landlord_name || '—'}</dd></div>
              <div>
                <dt>Status</dt>
                <dd className="sd-sticky-badges">
                  <span className={`badge badge-${sd.landlord_status.toLowerCase()}`}>Landlord {sd.landlord_status}</span>
                  <span className={`badge badge-${sd.building_status.toLowerCase()}`}>Building {sd.building_status}</span>
                </dd>
              </div>
              <div className="tone-balance"><dt>SD Balance</dt><dd className="sd-sticky-amount">{formatAmount(b.sd_balance)}</dd></div>
              <div className="tone-repayable"><dt>Repayable</dt><dd className="sd-sticky-amount">{formatAmount(b.sd_balance_repayable)}</dd></div>
            </dl>
            <div className="sd-sticky-actions">
              {can(SCREENS.SD_TRANSACTION, 'add') && (
                <button className="btn btn-primary btn-small" disabled={passive} onClick={() => openModal()}
                  title={passive ? 'This SD Code is Passive and cannot take new transactions.' : undefined}>
                  + Add Transaction
                </button>
              )}
              {can(SCREENS.SD_MASTER, 'view') && (
                <Link className="btn btn-secondary btn-small" to={`/sd-master?search=${sd.sd_code}`}>Open in SD Master</Link>
              )}
            </div>
          </section>
        )}

        {sd && b && (
          <div className="sd-summary card">
            <dl className="sd-facts">
              <div><dt>Lease Commencement</dt><dd>{formatDate(sd.lease_commencement_date) || '—'}</dd></div>
              <div><dt>Rent Commencement</dt><dd>{formatDate(sd.rent_commencement_date) || '—'}</dd></div>
              <div><dt>Lease End</dt><dd>{formatDate(sd.lease_end_date) || '—'}</dd></div>
              <div><dt>Agreement Value</dt><dd>{formatAmount(b.agreement_value)}</dd></div>
              <div><dt>Transactions</dt><dd>{b.txn_count}</dd></div>
            </dl>
            <AmountTiles values={{
              agreement: b.agreement_value, paid: b.total_paid, transfer: b.total_transfer,
              adjustment: b.total_adjustment, refund: b.total_refund,
              balance: b.sd_balance, repayable: b.sd_balance_repayable,
            }} />
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
          {!sdId && (
            <>
              <MultiSelect allLabel="All cost centers" noun="cost centers" options={costCenters.map((c) => ({ value: c.id, label: c.name }))} value={filters.costCenterId} onChange={(v) => setFilter({ costCenterId: v })} />
              <MultiSelect allLabel="All landlords" noun="landlords" options={cascade.landlords} value={filters.landlordName} onChange={(v) => setFilter({ landlordName: v })} />
              <MultiSelect allLabel="All floors" noun="floors" options={cascade.floors} value={filters.floor} onChange={(v) => setFilter({ floor: v })} />
            </>
          )}
          <MultiSelect allLabel="All SD Types" noun="SD Types" options={SD_TYPES} value={filters.sdType} onChange={(v) => setFilter({ sdType: v })} />
          <MultiSelect allLabel="All FY" noun="FYs" options={fyList} value={filters.fy} onChange={(v) => setFilter({ fy: v })} />
          <MultiSelect allLabel="All Agreement Status" noun="statuses" options={AGREEMENT_STATUSES} value={filters.agreementStatus} onChange={(v) => setFilter({ agreementStatus: v })} />
          <MultiSelect allLabel="Entry type: all" noun="types" options={[{ value: 'Payment', label: 'Payments' }, { value: 'Reversal', label: 'Reversals (negative SD Paid)' }]} value={filters.entryType} onChange={(v) => setFilter({ entryType: v })} />
          <DateRangeFilter label="Txn Date" from={filters.dateFrom} to={filters.dateTo} onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })} />
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
              freeze
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

              <label>SD Code <span className="req" aria-hidden="true">*</span></label>
              {modal.sd ? (
                <div className="picked-sd">
                  <strong>{modal.sd.sd_code}</strong>
                  {!editing && !sd && <button type="button" className="btn btn-small btn-secondary" onClick={() => setModal({ ...modal, sd: null })}>Change</button>}
                </div>
              ) : (
                <SdPicker autoFocus onSelect={(picked) => setModal({ ...modal, sd: picked })} />
              )}

              <h4 className="form-section">Transaction details</h4>
              <div className="form-grid">
                <div>
                  <label htmlFor="txnDate">SD Transaction Date <span className="req" aria-hidden="true">*</span></label>
                  <input id="txnDate" type="text" required placeholder="DD/MM/YYYY" maxLength={10} value={form.txnDate} onChange={setDate} />
                </div>
                <div>
                  <label htmlFor="fy">FY <span className="req" aria-hidden="true">*</span></label>
                  <input id="fy" type="text" required placeholder="e.g. 2024-2025" maxLength={9} value={form.fy} onChange={set('fy')} />
                </div>
                <div>
                  <label htmlFor="sdType">SD Type <span className="req" aria-hidden="true">*</span></label>
                  <select id="sdType" required value={form.sdType} onChange={set('sdType')}>
                    <option value="">Select SD Type</option>
                    {SD_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="agreementStatus">Agreement Status <span className="req" aria-hidden="true">*</span></label>
                  <select id="agreementStatus" required value={form.agreementStatus} onChange={set('agreementStatus')}>
                    <option value="">Select Agreement Status</option>
                    {AGREEMENT_STATUSES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <h4 className="form-section">Amounts <small>enter at least one</small></h4>
              <div className="form-grid">
                {AMOUNTS.map(([key, , label]) => (
                  <div key={key} className={`money-field tone-${key === 'paidAmount' ? 'paid' : 'out'}`}>
                    <label htmlFor={key}>{label}</label>
                    <div className="money-input">
                      <span aria-hidden="true">₹</span>
                      <input id={key} type="text" inputMode={key === 'paidAmount' && canNegative ? 'text' : 'decimal'} placeholder="Amount in ₹" value={form[key]} onChange={set(key)} />
                    </div>
                    {key === 'paidAmount' && canNegative && <small className="hint">Enter a negative amount (e.g. -2000) to reverse a wrong payment.</small>}
                  </div>
                ))}
              </div>
              {negativePaid && (
                <div className="reversal-box">
                  <strong>Reversal entry</strong> — this negative SD Paid reverses an earlier payment (like a credit note); the original stays in the history.
                  <div className="form-grid">
                    <div>
                      <label htmlFor="reversesTxnNo">Reverses Transaction No.</label>
                      <input id="reversesTxnNo" list="sd-payments" placeholder="e.g. TXN0000012 (optional)" value={form.reversesTxnNo} onChange={set('reversesTxnNo')} />
                      <datalist id="sd-payments">
                        {payments.map((p) => <option key={p.txn_id} value={p.txn_no}>{`${formatDate(p.txn_date)} · Paid ₹${formatAmount(p.paid_amount)}`}</option>)}
                      </datalist>
                    </div>
                  </div>
                  {!canNegative && <p className="hint">You need the "SD Negative Entry" right to save a negative amount.</p>}
                </div>
              )}

              <div className="form-grid">
                <div className="span-2">
                  <label htmlFor="remarks">Remarks</label>
                  <textarea id="remarks" rows={3} maxLength={1000} value={form.remarks} onChange={set('remarks')}
                    placeholder="e.g. transferred to SD000123" />
                </div>
              </div>
              <p className="hint">SD Balance and Repayable are calculated automatically from the amounts.</p>

              <button type="submit" className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
