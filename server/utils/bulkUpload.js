const fs = require('fs');
const { pool, withTransaction } = require('../config/db');
const { readSheet } = require('./excel');
const { httpError } = require('./httpError');

/**
 * Standard bulk upload: read Excel -> validate every row -> save valid rows
 * -> store and return a row-level validation report.
 *
 *   screenCode      screens.screen_code the upload belongs to
 *   columns         [{ header, required }] expected in the template
 *   keyOf(row)      value shown in the report's Key column (e.g. SD Code)
 *   validateRow(row, ctx)
 *                   returns [{ field, value, error }] (empty when valid);
 *                   ctx.rowNumber is the Excel row; ctx.seen is a Map shared
 *                   across rows for spotting in-file duplicates
 *   afterValidate(valid)
 *                   optional; checks the rows that passed as a group (e.g. a
 *                   ledger across several rows) and returns
 *                   [{ rowNumber, field, value, error }] for rows to fail
 *   saveRow(row, db, uploadedBy, rowNumber)
 *                   saves one valid row inside the upload transaction
 *
 * Valid rows are saved in one transaction, so a failure part-way through
 * saves nothing. Failed rows are never saved.
 */
async function processUpload(req, { screenCode, columns, keyOf, validateRow, afterValidate, saveRow }) {
  if (!req.file) throw httpError(400, 'No file uploaded.');

  try {
    const { headers, rows } = await readSheet(req.file.path);

    const missing = columns.filter((c) => c.required && !headers.includes(c.header)).map((c) => c.header);
    if (missing.length > 0) {
      throw httpError(400, `The file is missing required column(s): ${missing.join(', ')}. Download the template and try again.`);
    }

    const report = [];
    const valid = [];
    const ctx = { seen: new Map() };

    for (const { rowNumber, values: row } of rows) {
      const key = keyOf(row);
      const errors = await validateRow(row, { ...ctx, rowNumber });
      if (errors.length > 0) {
        errors.forEach((e) =>
          report.push({ row: rowNumber, key, field: e.field, value: e.value ?? '', status: 'Failed', error: e.error })
        );
      } else {
        valid.push({ rowNumber, key, row });
      }
    }

    if (afterValidate && valid.length > 0) {
      const groupErrors = await afterValidate(valid);
      const failedRows = new Set(groupErrors.map((e) => e.rowNumber));
      groupErrors.forEach((e) => {
        const v = valid.find((x) => x.rowNumber === e.rowNumber);
        report.push({ row: e.rowNumber, key: v?.key, field: e.field, value: e.value ?? '', status: 'Failed', error: e.error });
      });
      for (let i = valid.length - 1; i >= 0; i--) {
        if (failedRows.has(valid[i].rowNumber)) valid.splice(i, 1);
      }
    }

    const uploadedBy = req.user.userName;
    const totalRows = valid.length + new Set(report.map((r) => r.row)).size;

    if (totalRows === 0) throw httpError(400, 'The file has no data rows.');

    const batch = await withTransaction(async (db) => {
      for (const v of valid) {
        await saveRow(v.row, db, uploadedBy, v.rowNumber);
        report.push({ row: v.rowNumber, key: v.key, field: '-', value: '-', status: 'Passed', error: '' });
      }
      report.sort((a, b) => a.row - b.row);
      const result = await db.query(
        `INSERT INTO upload_batches (screen_code, file_name, total_rows, passed_rows, failed_rows, report, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING batch_id`,
        [screenCode, req.file.originalname, totalRows, valid.length, totalRows - valid.length, JSON.stringify(report), uploadedBy]
      );
      return result.rows[0];
    });

    return {
      batchId: batch.batch_id,
      totalRows,
      passed: valid.length,
      failed: totalRows - valid.length,
      report,
    };
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}

async function findBatch(batchId) {
  const result = await pool.query('SELECT * FROM upload_batches WHERE batch_id=$1', [batchId]);
  return result.rows[0];
}

module.exports = { processUpload, findBatch };
