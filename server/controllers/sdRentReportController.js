const ExcelJS = require('exceljs');
const model = require('../models/sdRentReportModel');
const { parseDMY, formatDMY } = require('../utils/dates');
const { sendWorkbook, dateStamp } = require('../utils/excel');
const { paging, withDates } = require('./rentHelpers');

const num = (v) => Number(v || 0);
const filtersOf = (query) => withDates(query, ['dateFrom', 'dateTo']);

// GET /api/reports/sd-rent
async function getLines(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total, totals } = await model.getLines(filtersOf(req.query), p);
    res.json({ success: true, data: rows, total, totals, ...p });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/sd-rent/summary?groupBy=costCenter|landlord|expenseHead|category|floor|sdCode|month
async function getSummary(req, res, next) {
  try {
    res.json({ success: true, data: await model.getSummary(filtersOf(req.query), req.query.groupBy) });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/sd-rent/options
async function getOptions(req, res, next) {
  try {
    res.json({ success: true, data: await model.getOptions() });
  } catch (err) {
    next(err);
  }
}

const HEADERS = [
  'Source', 'Cost Center', 'SD Code', 'Landlord Name', 'Floor', 'Rent Code', 'Agreement No.', 'Rent Expense Head',
  'Expense Category', 'Effective Date', 'Monthly Rent / SD Amount', 'Status', 'Reference', 'Details',
];
const MONEY = '#,##,##0.00';

// GET /api/reports/sd-rent/export - all lines plus summaries by Cost Center, Landlord and Expense Head
async function exportReport(req, res, next) {
  try {
    const f = filtersOf(req.query);
    const { rows, totals } = await model.getLines(f, { pageSize: 0 });
    const wb = new ExcelJS.Workbook();

    const ws = wb.addWorksheet('SD & Rent Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(HEADERS).font = { bold: true };
    rows.forEach((r) => ws.addRow([
      r.source, r.cost_center_name, r.sd_code, r.landlord_name, r.floor, r.rent_code || '', r.agreement_no || '', r.expense_head,
      r.expense_category, formatDMY(r.effective_date), num(r.amount), r.status, r.reference, r.details,
    ]));
    ws.addRow([]);
    [['Total Security Deposit (net)', totals.sd_amount], ['Total Rent', totals.rent_amount], ['Total Maintenance', totals.maintenance_amount], ['Grand Total', totals.total_amount]]
      .forEach(([label, v]) => { const row = ws.addRow(['', '', '', '', '', '', '', '', label, '', num(v)]); row.font = { bold: true }; });
    ws.columns.forEach((col, i) => { col.width = Math.max(12, HEADERS[i].length + 3); });
    ws.getColumn(8).width = 34;
    ws.getColumn(11).numFmt = MONEY;
    ws.getColumn(14).width = 48;

    const summarySheet = async (name, groupBy, label) => {
      const s = wb.addWorksheet(name);
      s.addRow([label, 'Lines', 'Security Deposit (net)', 'Rent', 'Maintenance', 'Total']).font = { bold: true };
      (await model.getSummary(f, groupBy)).forEach((g) => s.addRow([
        g.group_key, g.lines, num(g.sd_amount), num(g.rent_amount), num(g.maintenance_amount), num(g.total_amount),
      ]));
      s.columns.forEach((col, i) => { col.width = i === 0 ? 34 : 20; if (i >= 2) col.numFmt = MONEY; });
    };
    await summarySheet('By Cost Center', 'costCenter', 'Cost Center');
    await summarySheet('By Landlord', 'landlord', 'Landlord Name');
    await summarySheet('By Expense Head', 'expenseHead', 'Rent Expense Head');

    await sendWorkbook(res, `SD_Rent_Transaction_Summary_${dateStamp()}.xlsx`, Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
}

module.exports = { getLines, getSummary, getOptions, exportReport, parseDMY };
