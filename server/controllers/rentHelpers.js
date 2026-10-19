// Shared bits of the Rent Transaction controllers
const ExcelJS = require('exceljs');
const { parseDMY } = require('../utils/dates');
const scheduleModel = require('../models/rentScheduleModel');

function paging(query) {
  return {
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    pageSize: Math.min(Math.max(parseInt(query.pageSize, 10) || 50, 1), 500),
  };
}

function badRequest(res, errors) {
  return res.status(400).json({ success: false, message: errors.map((e) => e.error).join(' '), errors });
}

// DD/MM/YYYY query dates -> 'YYYY-MM-DD' (invalid = ignored)
function withDates(query, keys) {
  const out = { ...query };
  keys.forEach((k) => { out[k] = parseDMY(query[k]) || null; });
  return out;
}

// Excel cell -> trimmed text ('' for blank)
const cell = (row, header) => (row[header] === undefined || row[header] === null ? '' : String(row[header]).trim());

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso) => `${MONTHS[+String(iso).slice(5, 7) - 1]}-${String(iso).slice(0, 4)}`;
const monthOf = (iso) => `${String(iso).slice(0, 7)}-01`;

/**
 * Bulk Edit workbook: the editable columns (ID first) followed by grey
 * "for reference" columns that are not read back, plus a How to use sheet.
 * Returns a Buffer.
 */
async function editWorkbook({ sheet, editable, info, rows, steps }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const headers = [...editable, ...info.map((h) => `${h} (reference)`)];
  const head = ws.addRow(headers);
  head.font = { bold: true };
  head.eachCell((c, i) => {
    const ref = i > editable.length;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 1 ? 'FFFDE68A' : ref ? 'FFE5E7EB' : 'FFDCFCE7' } };
  });
  rows.forEach((r) => {
    const row = ws.addRow(r);
    for (let i = editable.length + 1; i <= headers.length; i++) row.getCell(i).font = { color: { argb: 'FF6B7280' } };
  });
  ws.columns.forEach((col, i) => { col.width = Math.max(12, Math.min(40, headers[i].length + 3)); });

  const how = wb.addWorksheet('How to use');
  how.getColumn(1).width = 120;
  how.addRow(['Bulk Edit - how to use']).font = { bold: true, size: 13 };
  steps.forEach((s, i) => how.addRow([`${i + 1}. ${s}`]));
  how.addRow([]);
  how.addRow(['Yellow column: record ID - do not change. Green columns: edit as needed. Grey "(reference)" columns are for information only and are ignored on upload.']);
  how.addRow(['Rows you do not change are reported as Unchanged and are not saved. Rows with errors are not saved; download the report to see why.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Rent Schedule lines already generated for a Rent Code in the months a change
 * affects (fromDate .. toDate, toDate null = to the end). Returns an error
 * message, or null when nothing is generated there.
 */
async function scheduleBlock(rent, fromDate, toDate = null) {
  if (!rent || !fromDate) return null;
  const found = await scheduleModel.linesWithin(rent.rent_id, monthOf(fromDate), toDate ? monthOf(toDate) : null);
  if (!found) return null;
  const affects = toDate ? `${monthLabel(fromDate)} to ${monthLabel(toDate)}` : `${monthLabel(fromDate)} onward`;
  return `Rent Schedule is already generated for ${rent.rent_code} in the months this change affects (${affects}; generated lines `
    + `${monthLabel(found.first_month)} to ${monthLabel(found.last_month)}). Delete those Rent Schedule lines first `
    + '(Rent Schedule > Delete Schedule), upload the Bulk Edit again, then regenerate the schedule.';
}

// Earliest / latest of ISO dates, ignoring blanks
const earliest = (...d) => d.filter(Boolean).sort()[0] || null;
const latest = (...d) => d.filter(Boolean).sort().pop() || null;

// Two lists of component codes hold the same items
const sameList = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

module.exports = { paging, badRequest, withDates, cell, editWorkbook, scheduleBlock, earliest, latest, sameList, monthLabel };

