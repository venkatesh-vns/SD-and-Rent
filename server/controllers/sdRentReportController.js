const model = require('../models/sdRentReportModel');
const { parseDMY, formatDMY } = require('../utils/dates');
const { streamWorkbook, dateStamp } = require('../utils/excel');
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
    const summaries = [
      ['By Cost Center', 'Cost Center', await model.getSummary(f, 'costCenter')],
      ['By Landlord', 'Landlord Name', await model.getSummary(f, 'landlord')],
      ['By Expense Head', 'Rent Expense Head', await model.getSummary(f, 'expenseHead')],
    ];

    // Streamed a row at a time (large date ranges have hundreds of thousands of lines)
    await streamWorkbook(res, `SD_Rent_Transaction_Summary_${dateStamp()}.xlsx`, async (wb) => {
      const ws = wb.addWorksheet('SD & Rent Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });
      const widths = { 7: 34, 10: 16, 13: 48 };
      ws.columns = HEADERS.map((h, i) => ({ width: widths[i] || Math.max(12, h.length + 3), style: i === 10 ? { numFmt: MONEY } : {} }));
      const head = ws.addRow(HEADERS);
      head.font = { bold: true };
      head.commit();
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        ws.addRow([
          r.source, r.cost_center_name, r.sd_code, r.landlord_name, r.floor, r.rent_code || '', r.agreement_no || '', r.expense_head,
          r.expense_category, formatDMY(r.effective_date), num(r.amount), r.status, r.reference, r.details,
        ]).commit();
        rows[i] = null; // release as written
        if (i % 500 === 499) await new Promise((resolve) => setImmediate(resolve)); // let other requests run
      }
      ws.addRow([]).commit();
      [['Total Security Deposit (net)', totals.sd_amount], ['Total Rent', totals.rent_amount], ['Total Maintenance', totals.maintenance_amount], ['Grand Total', totals.total_amount]]
        .forEach(([label, v]) => { const row = ws.addRow(['', '', '', '', '', '', '', '', label, '', num(v)]); row.font = { bold: true }; row.commit(); });
      ws.commit();

      summaries.forEach(([name, label, groups]) => {
        const s = wb.addWorksheet(name);
        s.columns = [0, 1, 2, 3, 4, 5].map((i) => ({ width: i === 0 ? 34 : 20, style: i >= 2 ? { numFmt: MONEY } : {} }));
        const h = s.addRow([label, 'Lines', 'Security Deposit (net)', 'Rent', 'Maintenance', 'Total']);
        h.font = { bold: true };
        h.commit();
        groups.forEach((g) => s.addRow([g.group_key, g.lines, num(g.sd_amount), num(g.rent_amount), num(g.maintenance_amount), num(g.total_amount)]).commit());
        s.commit();
      });
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLines, getSummary, getOptions, exportReport, parseDMY };
