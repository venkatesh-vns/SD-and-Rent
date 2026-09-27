const reportModel = require('../models/reportModel');
const logModel = require('../models/logModel');
const { runDateReminders } = require('../services/notificationService');
const { parseDMY, formatDMY } = require('../utils/dates');
const { httpError } = require('../utils/httpError');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');

function paging(query) {
  return {
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    pageSize: Math.min(Math.max(parseInt(query.pageSize, 10) || 50, 1), 200),
  };
}

// DD/MM/YYYY query dates -> 'YYYY-MM-DD'
function withDates(query, keys) {
  const out = { ...query };
  keys.forEach((k) => { out[k] = parseDMY(query[k]) || null; });
  return out;
}

const num = (v) => Number(v);

// GET /api/reports/sd-balance
async function sdBalance(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total, totals } = await reportModel.sdBalance(withDates(req.query, ['leaseEndFrom', 'leaseEndTo']), p);
    res.json({ success: true, data: rows, total, totals, ...p });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/sd-balance/export
async function sdBalanceExport(req, res, next) {
  try {
    const { rows, totals } = await reportModel.sdBalance(withDates(req.query, ['leaseEndFrom', 'leaseEndTo']), { pageSize: 0 });
    const data = rows.map((r) => [
      r.sd_code, r.lease_id, r.agreement_no, r.cost_center_code, r.l1_name, r.l2_name, r.l3_name, r.floor,
      r.landlord_name, r.landlord_status, r.building_status,
      formatDMY(r.lease_commencement_date), formatDMY(r.rent_commencement_date), formatDMY(r.lease_end_date),
      num(r.agreement_value), num(r.total_paid), num(r.total_transfer), num(r.total_adjustment), num(r.total_refund),
      num(r.sd_balance), num(r.sd_balance_repayable), r.txn_count, formatDMY(r.last_txn_date),
    ]);
    data.push([
      `TOTAL (${totals.count})`, '', '', '', '', '', '', '', '', '', '', '', '', '',
      num(totals.agreement_value), num(totals.total_paid), num(totals.total_transfer), num(totals.total_adjustment),
      num(totals.total_refund), num(totals.sd_balance), num(totals.sd_balance_repayable), '', '',
    ]);
    const buffer = buildWorkbook('SD Balance', [
      'SD Code', 'Lease ID', 'Agreement No.', 'Cost Center', 'Location Level 1', 'Location Level 2', 'Location Level 3', 'Floor',
      'Landlord Name', 'Landlord Status', 'Building Status',
      'Lease Commencement Date', 'Rent Commencement Date', 'Lease End Date',
      'Agreement Value', 'Total SD Paid', 'Total SD Transfer', 'Total SD Adjustment', 'Total SD Refund',
      'SD Balance', 'SD Balance Repayable', 'Transactions', 'Last Transaction Date',
    ], data);
    await sendWorkbook(res, `SD_Balance_Report_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// GET /api/logs/email
async function emailLog(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total } = await logModel.getEmailLog(withDates(req.query, ['dateFrom', 'dateTo']), p);
    res.json({ success: true, data: rows, total, ...p });
  } catch (err) {
    next(err);
  }
}

// GET /api/logs/email/export
async function emailLogExport(req, res, next) {
  try {
    const { rows } = await logModel.getEmailLog(withDates(req.query, ['dateFrom', 'dateTo']), { pageSize: 0 });
    const buffer = buildWorkbook(
      'Email Log',
      ['Date/Time Sent', 'SD Code', 'Notification Type', 'Recipient', 'Email Subject', 'Trigger Event', 'Status', 'Error'],
      rows.map((r) => [r.sent_at, r.sd_code, r.notification_type, r.recipient, r.subject, r.trigger_event, r.status, r.error_message])
    );
    await sendWorkbook(res, `Email_Log_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// GET /api/logs/audit
async function auditLog(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total } = await logModel.getAuditLog(withDates(req.query, ['dateFrom', 'dateTo']), p);
    res.json({ success: true, data: rows, total, ...p });
  } catch (err) {
    next(err);
  }
}

// GET /api/logs/audit/export
async function auditLogExport(req, res, next) {
  try {
    const { rows } = await logModel.getAuditLog(withDates(req.query, ['dateFrom', 'dateTo']), { pageSize: 0 });
    const json = (v) => (v ? JSON.stringify(v) : '');
    const buffer = buildWorkbook(
      'Audit Log',
      ['Date/Time', 'Table', 'Record ID', 'Action', 'By', 'Details', 'Old Values', 'New Values'],
      rows.map((r) => [r.action_date, r.table_name, r.record_id, r.action, r.action_by, r.details, json(r.old_values), json(r.new_values)])
    );
    await sendWorkbook(res, `Audit_Log_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// POST /api/notifications/run-reminders  { asOf?: 'DD/MM/YYYY' }  - administrators only
// Runs the daily reminder job now (e.g. for UAT with a chosen "today").
async function runReminders(req, res, next) {
  try {
    let asOf = null;
    if (req.body?.asOf) {
      asOf = parseDMY(req.body.asOf);
      if (!asOf) throw httpError(400, 'asOf must be a date in DD/MM/YYYY format.');
    }
    const result = await runDateReminders(asOf);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { sdBalance, sdBalanceExport, emailLog, emailLogExport, auditLog, auditLogExport, runReminders };
