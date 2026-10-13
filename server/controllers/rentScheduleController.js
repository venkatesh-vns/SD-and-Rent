const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const scheduleModel = require('../models/rentScheduleModel');
const rentMasterModel = require('../models/rentMasterModel');
const schedule = require('../services/rentScheduleService');
const { COMPONENTS, BY_CODE } = require('../services/rentComponents');
const { monthStart } = require('../services/rentCalc');
const { parseDMY, formatDMY } = require('../utils/dates');
const { sendWorkbook, dateStamp } = require('../utils/excel');
const { paging } = require('./rentHelpers');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]}-${iso.slice(0, 4)}`;
const num = (v) => Number(v || 0);

// Query -> filters with the DD/MM/YYYY range as months
function filtersOf(q) {
  const from = parseDMY(q.fromDate);
  const to = parseDMY(q.toDate);
  return { ...q, fromMonth: from ? monthStart(from) : null, toMonth: to ? monthStart(to) : null };
}

// GET /api/rent/schedule
async function getLines(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total, totals } = await scheduleModel.getLines(filtersOf(req.query), p);
    res.json({ success: true, data: rows, total, totals, ...p });
  } catch (err) {
    next(err);
  }
}

// GET /api/rent/schedule/summary?groupBy=component|costCenter|landlord|rentCode|month
async function getSummary(req, res, next) {
  try {
    const rows = await scheduleModel.getSummary(filtersOf(req.query), req.query.groupBy);
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, group_label: req.query.groupBy === 'component' || !req.query.groupBy ? BY_CODE[r.group_key]?.label || r.group_key : r.group_key })),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/rent/schedule/generate { fromDate, toDate, filters }
async function generate(req, res, next) {
  try {
    const from = parseDMY(req.body.fromDate);
    const to = parseDMY(req.body.toDate);
    const errors = [];
    if (!from) errors.push({ field: 'From Date', error: 'From Date is required as DD/MM/YYYY.' });
    if (!to) errors.push({ field: 'To Date', error: 'To Date is required as DD/MM/YYYY.' });
    if (from && to && from > to) errors.push({ field: 'From Date', error: 'From Date must be on or before To Date.' });
    if (from && to && (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) > 30) errors.push({ field: 'To Date', error: 'Generate at most 30 years at a time.' });
    if (errors.length) return res.status(400).json({ success: false, message: errors.map((e) => e.error).join(' '), errors });

    const { filters = {} } = req.body;
    const result = await schedule.generate({ fromDate: from, toDate: to, filters, by: req.user.userName });
    res.json({
      success: true,
      message: `Rent Schedule generated: ${result.lines} line(s) for ${result.rentCodes} Rent Code(s), ${monthLabel(monthStart(from))} to ${monthLabel(monthStart(to))}.`
        + (result.messages.length ? ` ${result.messages.length} message(s) to review.` : ''),
      data: { runId: result.run.run_id, lines: result.lines, rentCodes: result.rentCodes, messages: result.messages },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/rent/schedule/runs
async function runs(req, res, next) {
  try {
    res.json({ success: true, data: await scheduleModel.recentRuns(30) });
  } catch (err) {
    next(err);
  }
}

const OUTPUT_HEADERS = [
  'Rent Code', 'SD Code', 'Cost Center', 'Floor', 'Landlord Name', 'LL Status', 'Agreement Status', 'Agreement Header',
  'Rent Month', 'Schedule Date', 'Period To', 'Days', 'Base Rent Amount', 'Rule Percentage', 'Escalated Amount',
  'Waiver Amount', 'Final Rent Amount', 'LCD', 'RCD', 'LED',
];

// GET /api/rent/schedule/export - lines (scope 6.5 columns) plus a summary sheet per Agreement Header
async function exportLines(req, res, next) {
  try {
    const f = filtersOf(req.query);
    const { rows, totals } = await scheduleModel.getLines(f, { pageSize: 0 });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Rent Schedule', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(OUTPUT_HEADERS).font = { bold: true };
    rows.forEach((l) => ws.addRow([
      l.rent_code, l.sd_code, l.cost_center_name, l.floor, l.landlord_name, l.ll_status, l.agreement_status,
      BY_CODE[l.component_code]?.label || l.component_code, monthLabel(l.rent_month), formatDMY(l.period_from), formatDMY(l.period_to),
      l.days_charged, num(l.base_amount), l.rule_percentage === null ? '' : num(l.rule_percentage) / 100, num(l.escalated_amount),
      num(l.waiver_amount), num(l.final_amount), formatDMY(l.lcd), formatDMY(l.rcd), formatDMY(l.led),
    ]));
    const total = ws.addRow(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', num(totals.base_amount), '',
      num(totals.escalated_amount), num(totals.waiver_amount), num(totals.final_amount)]);
    total.font = { bold: true };
    ws.columns.forEach((col, i) => {
      col.width = Math.max(12, OUTPUT_HEADERS[i].length + 3);
      if ([12, 14, 15, 16].includes(i)) col.numFmt = '#,##,##0.00';
      if (i === 13) col.numFmt = '0.00%';
    });
    ws.getColumn(8).width = 34;

    const summary = wb.addWorksheet('By Agreement Header');
    summary.addRow(['Agreement Header', 'Lines', 'Escalated Amount', 'Waiver Amount', 'Final Rent Amount']).font = { bold: true };
    (await scheduleModel.getSummary(f, 'component')).forEach((s) => summary.addRow([
      BY_CODE[s.group_key]?.label || s.group_key, s.lines, num(s.escalated_amount), num(s.waiver_amount), num(s.final_amount),
    ]));
    summary.columns.forEach((col, i) => { col.width = i === 0 ? 36 : 18; if (i >= 2) col.numFmt = '#,##,##0.00'; });

    await sendWorkbook(res, `Rent_Schedule_${dateStamp()}.xlsx`, Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err) {
    next(err);
  }
}

// GET /api/rent/lookups - choices for the Rent Transaction screens (any logged-in user)
async function lookups(req, res, next) {
  try {
    const rents = await rentMasterModel.options();
    const sds = (await pool.query(
      `SELECT s.sd_id AS id, s.sd_code, s.floor, s.landlord_name, s.landlord_status, s.building_status, cc.cost_center_name,
              s.lease_commencement_date AS lcd, s.rent_commencement_date AS rcd, s.lease_end_date AS led
       FROM sd_master s JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id ORDER BY s.sd_code`
    )).rows;
    const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    res.json({
      success: true,
      data: {
        rents,
        sds,
        floors: uniq(sds.map((s) => s.floor)),
        landlords: uniq(rents.map((r) => r.landlord_name)),
        components: COMPONENTS.map((c) => ({ code: c.code, label: c.label, unit: c.unit, startsFrom: c.startsFrom })),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLines, getSummary, generate, runs, exportLines, lookups };
