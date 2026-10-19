const reportModel = require('../models/reportModel');
const logModel = require('../models/logModel');
const { runDateReminders } = require('../services/notificationService');
const { parseDMY, formatDMY } = require('../utils/dates');
const { httpError } = require('../utils/httpError');
const ExcelJS = require('exceljs');
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
// One row per SD Code and Agreement Status. SD details, Agreement Value and SD
// Balance appear once per SD Code (its first row); an SD Subtotal row follows an
// SD Code with several statuses, and the Grand Total counts each Agreement Value
// once. "Row Type" lets users filter Lines / SD Subtotal / Grand Total in Excel.
async function sdBalanceExport(req, res, next) {
  try {
    const { rows, totals } = await reportModel.sdBalance(withDates(req.query, ['leaseEndFrom', 'leaseEndTo']), { pageSize: 0 });
    const headers = [
      'Row Type', 'SD Code', 'Lease ID', 'Agreement No.', 'Cost Center', 'Location Level 1', 'Location Level 2', 'Location Level 3', 'Floor',
      'Landlord Name', 'Landlord Status', 'Building Status',
      'Lease Commencement Date', 'Rent Commencement Date', 'Lease End Date',
      'Agreement Value', 'Agreement Status', 'SD Paid (payments)', 'SD Paid Reversals', 'Net SD Paid',
      'Total SD Transfer', 'Total SD Adjustment', 'Total SD Refund', 'SD Balance', 'SD Balance Repayable', 'Last Transaction Date',
    ];
    const amounts = (x) => [num(x.total_payments), num(x.total_reversal), num(x.total_paid), num(x.total_transfer), num(x.total_adjustment), num(x.total_refund)];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('SD Balance', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(headers).font = { bold: true };
    const shade = (row, argb) => row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; });

    rows.forEach((r) => {
      const lines = r.lines.length ? r.lines : [{ agreement_status: '—', total_payments: 0, total_reversal: 0, total_paid: 0, total_transfer: 0, total_adjustment: 0, total_refund: 0, sd_balance_repayable: 0 }];
      lines.forEach((l, i) => {
        const first = i === 0;
        ws.addRow([
          'Line', r.sd_code,
          ...(first ? [r.lease_id, r.agreement_no, r.cost_center_name, r.l1_name, r.l2_name, r.l3_name, r.floor, r.landlord_name,
            r.landlord_status, r.building_status, formatDMY(r.lease_commencement_date), formatDMY(r.rent_commencement_date),
            formatDMY(r.lease_end_date), num(r.agreement_value)] : Array(14).fill(null)),
          l.agreement_status, ...amounts(l),
          first ? num(r.sd_balance) : null, num(l.sd_balance_repayable), first ? formatDMY(r.last_txn_date) : null,
        ]);
      });
      if (lines.length > 1) {
        const sub = ws.addRow(['SD Subtotal', r.sd_code, ...Array(14).fill(null), 'All statuses', ...amounts(r), null, num(r.sd_balance_repayable), null]);
        sub.font = { bold: true };
        shade(sub, 'FFF1F5F3');
      }
    });
    const grand = ws.addRow([
      'Grand Total', `GRAND TOTAL (${totals.count} SD Codes)`, ...Array(13).fill(null), num(totals.agreement_value), 'All statuses',
      ...amounts(totals), num(totals.sd_balance), num(totals.sd_balance_repayable), null,
    ]);
    grand.font = { bold: true };
    shade(grand, 'FFDCFCE7');
    ws.columns.forEach((col, i) => {
      col.width = Math.max(12, headers[i].length + 3);
      if (i >= 15 && i <= 24 && i !== 16) col.numFmt = '#,##,##0.00';
    });
    await sendWorkbook(res, `SD_Balance_Report_${dateStamp()}.xlsx`, Buffer.from(await wb.xlsx.writeBuffer()));
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
