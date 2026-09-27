const ExcelJS = require('exceljs');
const { httpError } = require('./httpError');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Builds a one-sheet .xlsx from a header row and data rows (arrays).
 * Header bold and frozen; JS Dates written as dates (timestamps with time).
 * Resolves to a Buffer.
 */
async function buildWorkbook(sheetName, headers, rows = []) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(headers).font = { bold: true };
  rows.forEach((values) => {
    const row = sheet.addRow(values.map((v) => (v === null || v === undefined ? '' : v)));
    row.eachCell((cell) => {
      if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
    });
  });
  sheet.columns.forEach((col, i) => {
    col.width = Math.max(16, String(headers[i] || '').length + 4);
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function sendWorkbook(res, fileName, buffer) {
  const data = await buffer; // accepts a Buffer or buildWorkbook()'s promise
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(data);
}

const pad = (n) => String(n).padStart(2, '0');

// A cell value as the text the user sees; dates as DD/MM/YYYY
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // exceljs gives date cells as UTC midnight of the calendar date
    return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return cellText(value.result); // formula: use its result
    if ('text' in value) return cellText(value.text); // hyperlink
    if ('error' in value) return String(value.error);
    return '';
  }
  return String(value);
}

/**
 * Reads the first sheet of an .xlsx file.
 * Returns { headers, rows } where rows = [{ rowNumber, values: { header: text } }]
 * for every non-blank row below the header, values trimmed.
 */
async function readSheet(filePath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    throw httpError(400, 'The file could not be read as an Excel workbook (.xlsx). Download the template and try again.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellText(cell.value).trim();
  });

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = {};
    headers.forEach((h, col) => {
      if (h) values[h] = cellText(row.getCell(col).value).trim();
    });
    if (Object.values(values).some((v) => v !== '')) rows.push({ rowNumber, values });
  });

  return { headers: headers.filter(Boolean), rows };
}

// Today's date as YYYYMMDD, for export file names
function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

module.exports = { buildWorkbook, sendWorkbook, readSheet, cellText, dateStamp };
