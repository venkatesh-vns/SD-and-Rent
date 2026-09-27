// Rules shared by SD Transaction manual entry and Excel upload.
const { AMOUNT_FIELDS } = require('../models/sdTransactionModel');
const { parseDMY, formatDMY } = require('../utils/dates');
const { blank, text, parseAmount } = require('./sdMasterService');

const SD_TYPES = ['Landlord SD', 'Electricity SD', 'Additional Parking SD', 'Other SD', 'Fitout SD', 'CAM SD', 'Solar SD'];
const AGREEMENT_STATUSES = ['LOI', 'Agreement', 'Registered Agreement', 'Addendum Agreement', 'Mail Approval'];

const LABELS = {
  sd_id: 'SD Code',
  sd_type: 'SD Type',
  fy: 'FY',
  txn_date: 'SD Transaction Date',
  agreement_status: 'Agreement Status',
  paid_amount: 'SD Paid Amount',
  transfer_amount: 'SD Transfer Amount',
  adjustment_amount: 'SD Adjustment Amount',
  refund_amount: 'SD Refund Amount',
  remarks: 'Remarks',
};

// Matches a dropdown value ignoring case and extra spaces; returns the
// canonical spelling, or the input unchanged when nothing matches
function canonical(value, list) {
  const v = String(value ?? '').trim().replace(/\s+/g, ' ');
  return list.find((x) => x.toLowerCase() === v.toLowerCase()) || v;
}

const toCents = (n) => Math.round(Number(n || 0) * 100);
const money = (cents) => (cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Field-level checks for one transaction. `sd` is its SD Master record
 * (null when the SD Code was not found). New transactions need both
 * Landlord and Building Status Active.
 */
function validateFields(rec, raw, { sd, isNew }) {
  const errors = [];
  const fail = (field, error, value = raw[field] ?? rec[field]) =>
    errors.push({ field: LABELS[field], value: value ?? '', error });

  if (!sd) {
    if (!raw.sd_id) fail('sd_id', 'SD Code is required.');
  } else if (isNew && (sd.landlord_status !== 'Active' || sd.building_status !== 'Active')) {
    fail('sd_id', `${sd.sd_code} is Passive (Landlord: ${sd.landlord_status}, Building: ${sd.building_status}) and cannot take new transactions.`, sd.sd_code);
  }

  if (!rec.sd_type) fail('sd_type', 'SD Type is required.');
  else if (!SD_TYPES.includes(rec.sd_type)) fail('sd_type', 'Invalid SD Type.');

  if (!rec.fy) fail('fy', 'FY is required.');
  else {
    const m = rec.fy.match(/^(\d{4})-(\d{4})$/);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) fail('fy', 'FY must look like 2024-2025 (two consecutive years).');
  }

  if (rec.txn_date === null) fail('txn_date', 'SD Transaction Date is required.');
  else if (rec.txn_date === undefined) fail('txn_date', 'Date must be a valid date in DD/MM/YYYY format.');

  if (!rec.agreement_status) fail('agreement_status', 'Agreement Status is required.');
  else if (!AGREEMENT_STATUSES.includes(rec.agreement_status)) fail('agreement_status', 'Invalid Agreement Status.');

  AMOUNT_FIELDS.forEach((f) => {
    if (rec[f] === undefined) fail(f, 'Amount must be a number with up to 2 decimals (0 or more).');
    else if (rec[f] >= 1e13) fail(f, 'Amount is too large.');
  });
  if (AMOUNT_FIELDS.every((f) => rec[f] !== undefined) && AMOUNT_FIELDS.every((f) => !rec[f])) {
    errors.push({ field: 'Amounts', value: '0', error: 'Enter at least one of SD Paid, Transfer, Adjustment or Refund Amount.' });
  }

  if (rec.remarks && rec.remarks.length > 1000) fail('remarks', 'Remarks must be 1000 characters or fewer.');

  return errors;
}

/**
 * Checks an SD Code's ledger after a change:
 *   - Total SD Paid may not exceed Agreement Value
 *   - SD Balance Repayable may not drop below zero at any date
 * ledger: stored transactions; removeIds: txn_ids being replaced or deleted;
 * entries: new/changed transactions ({ txn_id?, txn_date, ...amounts }).
 * Returns [{ field, value, error }].
 */
function checkLedger({ agreementValue, ledger, removeIds = new Set(), entries = [] }) {
  const errors = [];
  const rows = [
    ...ledger.filter((t) => !removeIds.has(t.txn_id)),
    ...entries.map((e, i) => ({ ...e, sortId: e.txn_id ?? Number.MAX_SAFE_INTEGER - entries.length + i })),
  ].map((t) => ({ ...t, sortId: t.sortId ?? t.txn_id }));
  rows.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.sortId - b.sortId));

  let paid = 0;
  let repayable = 0;
  for (const t of rows) {
    paid += toCents(t.paid_amount);
    repayable += toCents(t.paid_amount) - toCents(t.transfer_amount) - toCents(t.refund_amount) - toCents(t.adjustment_amount);
    if (repayable < 0) {
      errors.push({
        field: 'SD Balance Repayable',
        value: formatDMY(t.txn_date),
        error: `On ${formatDMY(t.txn_date)} SD Balance Repayable would be ${money(repayable)}. Transfer, Adjustment and Refund cannot exceed SD Paid up to that date.`,
      });
      break;
    }
  }
  if (paid > toCents(agreementValue)) {
    errors.push({
      field: LABELS.paid_amount,
      value: money(paid),
      error: `Total SD Paid ${money(paid)} would exceed Agreement Value ${money(toCents(agreementValue))}. Increase the Agreement Value in SD Master first.`,
    });
  }
  return errors;
}

// Manual entry body (camelCase, date DD/MM/YYYY) -> { rec, raw }
function fromBody(body) {
  const amount = (v) => (blank(v) ? 0 : parseAmount(v));
  const rec = {
    sd_id: blank(body.sdId) ? null : Number(body.sdId),
    sd_type: blank(body.sdType) ? null : canonical(body.sdType, SD_TYPES),
    fy: text(body.fy),
    txn_date: parseDMY(body.txnDate),
    agreement_status: blank(body.agreementStatus) ? null : canonical(body.agreementStatus, AGREEMENT_STATUSES),
    paid_amount: amount(body.paidAmount),
    transfer_amount: amount(body.transferAmount),
    adjustment_amount: amount(body.adjustmentAmount),
    refund_amount: amount(body.refundAmount),
    remarks: text(body.remarks),
  };
  const raw = {
    txn_date: body.txnDate,
    paid_amount: body.paidAmount,
    transfer_amount: body.transferAmount,
    adjustment_amount: body.adjustmentAmount,
    refund_amount: body.refundAmount,
  };
  return { rec, raw };
}

// Audit detail naming what changed, e.g. "SD Paid 1,00,000.00 -> 1,50,000.00; Remarks updated"
function changeSummary(before, after) {
  const parts = [];
  const names = { paid_amount: 'SD Paid', transfer_amount: 'SD Transfer', adjustment_amount: 'SD Adjustment', refund_amount: 'SD Refund' };
  AMOUNT_FIELDS.forEach((f) => {
    if (toCents(before[f]) !== toCents(after[f])) parts.push(`${names[f]} ${money(toCents(before[f]))} -> ${money(toCents(after[f]))}`);
  });
  ['sd_type', 'fy', 'txn_date', 'agreement_status'].forEach((f) => {
    if (String(before[f]) !== String(after[f])) parts.push(`${LABELS[f]} ${before[f]} -> ${after[f]}`);
  });
  if ((before.remarks || '') !== (after.remarks || '')) parts.push('Remarks updated');
  return parts.join('; ') || null;
}

module.exports = {
  SD_TYPES, AGREEMENT_STATUSES, LABELS, canonical, validateFields, checkLedger, fromBody, changeSummary,
};
