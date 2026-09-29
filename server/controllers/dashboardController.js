const ExcelJS = require('exceljs');
const dashboardModel = require('../models/dashboardModel');
const { parseDMY, formatDMY } = require('../utils/dates');
const { sendWorkbook, dateStamp } = require('../utils/excel');

// Query -> model filters: DD/MM/YYYY dates to 'YYYY-MM-DD' (invalid = ignored)
function filtersOf(query) {
  return { ...query, dateFrom: parseDMY(query.dateFrom) || null, dateTo: parseDMY(query.dateTo) || null };
}

function alertDaysOf(query) {
  const n = parseInt(query.alertDays, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), 365) : 15;
}

// GET /api/dashboard
async function getDashboard(req, res, next) {
  try {
    res.json({ success: true, data: await dashboardModel.getDashboard(filtersOf(req.query), { alertDays: alertDaysOf(req.query) }) });
  } catch (err) {
    next(err);
  }
}

// GET /api/dashboard/options
async function getOptions(req, res, next) {
  try {
    res.json({ success: true, data: await dashboardModel.getOptions() });
  } catch (err) {
    next(err);
  }
}

const num = (v) => Number(v || 0);
const MONEY_FMT = '#,##,##0.00';

// One sheet per dashboard section; amount columns formatted as money
function addSheet(workbook, name, headers, rows, moneyCols = []) {
  const sheet = workbook.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(headers).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r.map((v) => (v === null || v === undefined ? '' : v))));
  sheet.columns.forEach((col, i) => {
    col.width = Math.max(14, String(headers[i] || '').length + 4);
    if (moneyCols.includes(i)) col.numFmt = MONEY_FMT;
  });
  return sheet;
}

// GET /api/dashboard/export - the whole dashboard as a workbook
async function exportDashboard(req, res, next) {
  try {
    const d = await dashboardModel.getDashboard(filtersOf(req.query), { alertDays: alertDaysOf(req.query) });
    const wb = new ExcelJS.Workbook();
    const k = d.kpi;

    const summary = addSheet(wb, 'Summary', ['Measure', 'Value'], [
      ['Total Agreement Value', num(k.agreement_value)],
      ['Total SD Paid', num(k.paid)],
      ['Total SD Balance (Agreement Value - SD Paid)', num(k.balance)],
      ['Total SD Balance Repayable (Paid - Transfer - Adjustment - Refund)', num(k.repayable)],
      ['Total SD Transfer', num(k.transfer)],
      ['Total SD Adjustment', num(k.adjustment)],
      ['Total SD Refund', num(k.refund)],
      ['SD Records', k.sd_count],
      ['Active SD Records', k.active_count],
      ['Passive SD Records', k.passive_count],
      ['Landlords', k.landlord_count],
      ['Cost Centers', k.cost_center_count],
      ['Landlord Status Active / Passive', `${d.status.landlord_active} / ${d.status.landlord_passive}`],
      ['Building Status Active / Passive', `${d.status.building_active} / ${d.status.building_passive}`],
    ]);
    summary.getColumn(1).width = 62;
    summary.getColumn(2).width = 22;
    for (let r = 2; r <= 8; r += 1) summary.getCell(r, 2).numFmt = MONEY_FMT;

    const alertRows = (list) => list.map((a) => [a.sd_code, a.lease_id, a.agreement_no, a.landlord_name, a.cost_center_name, formatDMY(a.due_date), a.days_left]);
    const alertHead = (label) => ['SD Code', 'Lease ID', 'Agreement No.', 'Landlord Name', 'Cost Center', label, 'Days Remaining'];
    addSheet(wb, 'Lease Commencement Due', alertHead('Lease Commencement Date'), alertRows(d.alerts.leaseCommencement));
    addSheet(wb, 'Rent Commencement Due', alertHead('Rent Commencement Date'), alertRows(d.alerts.rentCommencement));
    addSheet(wb, 'Lease Expiry Due', alertHead('Lease End Date'), alertRows(d.alerts.leaseEnd));

    addSheet(wb, 'SD Type', ['SD Type', 'SD Paid', 'SD Transfer', 'SD Adjustment', 'SD Refund', 'SD Balance Repayable', 'Transactions'],
      d.sdTypes.map((r) => [r.sd_type, num(r.paid), num(r.transfer), num(r.adjustment), num(r.refund), num(r.repayable), r.txn_count]), [1, 2, 3, 4, 5]);

    addSheet(wb, 'Location', ['Location Level 1', 'Location Level 2', 'Location Level 3', 'SD Records', 'Agreement Value', 'SD Paid', 'SD Balance', 'SD Balance Repayable'],
      d.locations.map((r) => [r.l1_name, r.l2_name, r.l3_name, r.sd_count, num(r.agreement_value), num(r.paid), num(r.balance), num(r.repayable)]), [4, 5, 6, 7]);

    addSheet(wb, 'Cost Center', ['Cost Center', 'SD Records', 'Agreement Value', 'SD Paid', 'SD Balance', 'SD Balance Repayable'],
      d.costCenters.map((r) => [r.cost_center_name, r.sd_count, num(r.agreement_value), num(r.paid), num(r.balance), num(r.repayable)]), [2, 3, 4, 5]);

    addSheet(wb, 'Landlord', ['Landlord Name', 'No. of SD Records', 'Agreement Value', 'SD Paid', 'SD Balance Repayable'],
      d.landlords.map((r) => [r.landlord_name, r.sd_count, num(r.agreement_value), num(r.paid), num(r.repayable)]), [2, 3, 4]);

    addSheet(wb, 'Recent Transactions', ['Transaction No.', 'SD Code', 'Transaction Date', 'SD Type', 'SD Paid', 'SD Transfer', 'SD Adjustment', 'SD Refund', 'Remarks', 'Created By'],
      d.recent.map((r) => [r.txn_no, r.sd_code, formatDMY(r.txn_date), r.sd_type, num(r.paid_amount), num(r.transfer_amount),
        num(r.adjustment_amount), num(r.refund_amount), r.remarks, r.created_by]), [4, 5, 6, 7]);

    addSheet(wb, 'Pending Recovery', ['SD Code', 'Lease ID', 'Landlord Name', 'Cost Center', 'Agreement Value', 'SD Balance Repayable'],
      d.pending.map((r) => [r.sd_code, r.lease_id, r.landlord_name, r.cost_center_name, num(r.agreement_value), num(r.repayable)]), [4, 5]);

    addSheet(wb, 'Financial Year', ['FY', 'Agreement Value', 'SD Paid', 'SD Balance', 'SD Refund', 'SD Transfer', 'SD Adjustment'],
      d.financialYears.map((r) => [r.fy, r.agreement_value, r.paid, r.balance, r.refund, r.transfer, r.adjustment]), [1, 2, 3, 4, 5, 6]);

    await sendWorkbook(res, `SD_Dashboard_${dateStamp()}.xlsx`, Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard, getOptions, exportDashboard };
