const { withTransaction } = require('../config/db');
const txnModel = require('../models/sdTransactionModel');
const sdMasterModel = require('../models/sdMasterModel');
const service = require('../services/sdTransactionService');
const { blank, text, parseAmount } = require('../services/sdMasterService');
const { logAudit } = require('../utils/audit');
const { httpError } = require('../utils/httpError');
const { parseDMY, formatDMY } = require('../utils/dates');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');

const { AMOUNT_FIELDS, FIELDS } = txnModel;
const { LABELS } = service;

// Excel columns. Transaction No. blank = new transaction; filled = bulk
// update of that transaction (blank cells then keep the stored value).
const TEMPLATE_COLUMNS = [
  { header: 'Transaction No.', required: false },
  { header: 'SD Code', required: true },
  { header: 'SD Type', required: true },
  { header: 'FY', required: true },
  { header: 'SD Transaction Date', required: true },
  { header: 'Agreement Status', required: true },
  { header: 'SD Paid Amount', required: false },
  { header: 'SD Transfer Amount', required: false },
  { header: 'SD Adjustment Amount', required: false },
  { header: 'SD Refund Amount', required: false },
  { header: 'Remarks', required: false },
];

const AMOUNT_HEADERS = {
  paid_amount: 'SD Paid Amount',
  transfer_amount: 'SD Transfer Amount',
  adjustment_amount: 'SD Adjustment Amount',
  refund_amount: 'SD Refund Amount',
};

// 400 carrying the field-level error list
function validationError(errors) {
  const err = httpError(400, errors.map((e) => e.error).join(' '));
  err.errors = errors;
  return err;
}

function pickFields(record) {
  const rec = {};
  FIELDS.forEach((f) => { rec[f] = record[f]; });
  AMOUNT_FIELDS.forEach((f) => { rec[f] = Number(record[f]); });
  return rec;
}

// Ledger check under a row lock on the SD Code, so two saves at the same
// moment cannot both push it over the limits. Throws a 400 when it fails.
async function lockAndCheck(db, sdId, { removeIds, entries }) {
  const sd = await txnModel.lockSd(sdId, db);
  const ledger = await txnModel.getLedger(sdId, db);
  const errors = service.checkLedger({ agreementValue: sd.agreement_value, ledger, removeIds, entries });
  if (errors.length) throw validationError(errors);
}

function listFilters(query) {
  return {
    ...query,
    dateFrom: parseDMY(query.dateFrom) || null,
    dateTo: parseDMY(query.dateTo) || null,
  };
}

// GET /api/sd-transactions?sdId=&search=&sdType=&fy=&agreementStatus=&costCenterId=&dateFrom=&dateTo=&page=&pageSize=
async function getAll(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);
    const { rows, total } = await txnModel.getAll(listFilters(req.query), { page, pageSize });
    res.json({ success: true, data: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

// GET /api/sd-transactions/sd-search?q=
async function searchSd(req, res, next) {
  try {
    res.json({ success: true, data: await txnModel.searchSd(req.query.q) });
  } catch (err) {
    next(err);
  }
}

// GET /api/sd-transactions/summary/:sdId  - SD Master details (read-only) + balances
async function getSummary(req, res, next) {
  try {
    const sd = await sdMasterModel.findById(req.params.sdId);
    if (!sd) return res.status(404).json({ success: false, message: 'SD Code not found.' });
    res.json({ success: true, data: { sd, balance: await txnModel.getBalance(sd.sd_id) } });
  } catch (err) {
    next(err);
  }
}

// GET /api/sd-transactions/:id
async function getOne(req, res, next) {
  try {
    const txn = await txnModel.findById(req.params.id);
    if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found.' });
    res.json({ success: true, data: txn });
  } catch (err) {
    next(err);
  }
}

// POST /api/sd-transactions
async function create(req, res, next) {
  try {
    const { rec, raw } = service.fromBody(req.body);
    const sd = rec.sd_id ? await sdMasterModel.findById(rec.sd_id) : null;
    if (rec.sd_id && !sd) raw.sd_id = req.body.sdId;
    const errors = service.validateFields(rec, raw, { sd, isNew: true });
    if (rec.sd_id && !sd) errors.unshift({ field: LABELS.sd_id, value: req.body.sdId, error: 'SD Code not found.' });
    if (errors.length) throw validationError(errors);

    const created = await withTransaction(async (db) => {
      await lockAndCheck(db, sd.sd_id, { entries: [rec] });
      const row = await txnModel.create(rec, req.user.userName, {}, db);
      await logAudit({
        tableName: 'sd_transactions', recordId: row.txn_id, action: 'INSERT', actionBy: req.user.userName,
        newValues: row, details: `${sd.sd_code} ${row.txn_no}`,
      }, db);
      return row;
    });
    res.status(201).json({ success: true, message: `${created.txn_no} saved for ${created.sd_code}.`, data: created });
  } catch (err) {
    next(err);
  }
}

// PUT /api/sd-transactions/:id  (a transaction stays on its SD Code)
async function update(req, res, next) {
  try {
    const before = await txnModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Transaction not found.' });

    const { rec, raw } = service.fromBody({ ...req.body, sdId: before.sd_id });
    const sd = await sdMasterModel.findById(before.sd_id);
    const errors = service.validateFields(rec, raw, { sd, isNew: false });
    if (errors.length) throw validationError(errors);

    const updated = await withTransaction(async (db) => {
      await lockAndCheck(db, before.sd_id, { removeIds: new Set([before.txn_id]), entries: [{ ...rec, txn_id: before.txn_id }] });
      const after = await txnModel.update(before.txn_id, rec, req.user.userName, {}, db);
      await logAudit({
        tableName: 'sd_transactions', recordId: after.txn_id, action: 'UPDATE', actionBy: req.user.userName,
        oldValues: before, newValues: after,
        details: [`${after.sd_code} ${after.txn_no}`, service.changeSummary(before, after)].filter(Boolean).join(': '),
      }, db);
      return after;
    });
    res.json({ success: true, message: `${updated.txn_no} updated.`, data: updated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/sd-transactions/:id
async function remove(req, res, next) {
  try {
    const before = await txnModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Transaction not found.' });
    await withTransaction(async (db) => {
      await lockAndCheck(db, before.sd_id, { removeIds: new Set([before.txn_id]) });
      await txnModel.remove(before.txn_id, db);
      await logAudit({
        tableName: 'sd_transactions', recordId: before.txn_id, action: 'DELETE', actionBy: req.user.userName,
        oldValues: before, details: `${before.sd_code} ${before.txn_no}`,
      }, db);
    });
    res.json({ success: true, message: `${before.txn_no} deleted.` });
  } catch (err) {
    next(err);
  }
}

// GET /api/sd-transactions/template
async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'SD_Transaction_Template.xlsx', buildWorkbook('SD Transactions', TEMPLATE_COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

// GET /api/sd-transactions/export  (same filters as the list, all pages)
async function exportAll(req, res, next) {
  try {
    const { rows } = await txnModel.getAll(listFilters(req.query), { pageSize: 0 });
    const buffer = buildWorkbook(
      'SD Transactions',
      [
        ...TEMPLATE_COLUMNS.map((c) => c.header),
        'Agreement Value', 'SD Balance (running)', 'SD Balance Repayable (running)',
        'Cost Center', 'Location', 'Created By', 'Created Date', 'Modified By', 'Modified Date',
      ],
      rows.map((r) => [
        r.txn_no, r.sd_code, r.sd_type, r.fy, formatDMY(r.txn_date), r.agreement_status,
        ...AMOUNT_FIELDS.map((f) => Number(r[f])), r.remarks,
        Number(r.agreement_value), Number(r.running_sd_balance), Number(r.running_repayable),
        r.cost_center_code, `${r.l1_name} > ${r.l2_name} > ${r.l3_name}`,
        r.created_by, r.created_date, r.modified_by, r.modified_date,
      ])
    );
    await sendWorkbook(res, `SD_Transactions_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// Turns one Excel row into { rec, raw, before, sd, errors }
async function resolveUploadRow(row) {
  const errors = [];
  const raw = {};
  const cell = (h) => (blank(row[h]) ? null : String(row[h]).trim());
  const txnNo = cell('Transaction No.');
  const sdCode = cell('SD Code');
  let before = null;
  let sd = null;

  if (txnNo) {
    before = await txnModel.findByNo(txnNo);
    if (!before) {
      errors.push({ field: 'Transaction No.', value: txnNo, error: 'Transaction No. not found. Leave it blank to add a new transaction.' });
      return { errors };
    }
    if (sdCode && sdCode.toUpperCase() !== before.sd_code.toUpperCase()) {
      errors.push({ field: LABELS.sd_id, value: sdCode, error: `${before.txn_no} belongs to ${before.sd_code}; a transaction cannot move to another SD Code.` });
      return { errors };
    }
    sd = await sdMasterModel.findById(before.sd_id);
  } else if (sdCode) {
    sd = await sdMasterModel.findByCode(sdCode);
    if (!sd) {
      raw.sd_id = sdCode;
      errors.push({ field: LABELS.sd_id, value: sdCode, error: 'SD Code not found.' });
    }
  }

  const rec = before
    ? pickFields(before)
    : { ...Object.fromEntries(FIELDS.map((f) => [f, null])), ...Object.fromEntries(AMOUNT_FIELDS.map((f) => [f, 0])) };
  if (sd) rec.sd_id = sd.sd_id;

  if (cell('SD Type') !== null) rec.sd_type = service.canonical(cell('SD Type'), service.SD_TYPES);
  if (cell('FY') !== null) rec.fy = cell('FY');
  if (cell('Agreement Status') !== null) rec.agreement_status = service.canonical(cell('Agreement Status'), service.AGREEMENT_STATUSES);
  if (cell('SD Transaction Date') !== null) {
    raw.txn_date = cell('SD Transaction Date');
    rec.txn_date = parseDMY(raw.txn_date);
  }
  Object.entries(AMOUNT_HEADERS).forEach(([f, h]) => {
    if (cell(h) !== null) {
      raw[f] = cell(h);
      rec[f] = parseAmount(raw[f]);
    }
  });
  if (cell('Remarks') !== null) rec.remarks = text(row['Remarks']);

  errors.push(...service.validateFields(rec, raw, { sd, isNew: !before }));
  return { rec, raw, before, sd, errors };
}

// POST /api/sd-transactions/bulk-upload
async function bulkUpload(req, res, next) {
  try {
    const resolved = new Map();

    const result = await processUpload(req, {
      screenCode: SCREENS.SD_TRANSACTION,
      columns: TEMPLATE_COLUMNS,
      keyOf: (row) => [text(row['SD Code']), text(row['Transaction No.'])].filter(Boolean).join(' / ') || '(blank)',
      validateRow: async (row, { seen, rowNumber }) => {
        const { rec, before, sd, errors } = await resolveUploadRow(row);
        if (before) {
          const key = `txn:${before.txn_no}`;
          if (seen.has(key)) errors.push({ field: 'Transaction No.', value: before.txn_no, error: `Transaction No. repeated from row ${seen.get(key)}.` });
          else seen.set(key, rowNumber);
        }
        if (errors.length === 0) resolved.set(rowNumber, { rec, before, sd });
        return errors;
      },
      // Ledger check per SD Code, row by row in file order: each row is
      // checked together with the stored ledger and the rows accepted before
      // it, so only the row that breaks the ledger fails.
      afterValidate: async (valid) => {
        const groups = new Map();
        valid.forEach((v) => {
          const r = resolved.get(v.rowNumber);
          if (!groups.has(r.sd.sd_id)) groups.set(r.sd.sd_id, []);
          groups.get(r.sd.sd_id).push({ rowNumber: v.rowNumber, ...r });
        });
        const failures = [];
        for (const [sdId, items] of groups) {
          const ledger = await txnModel.getLedger(sdId);
          const accepted = [];
          for (const item of items) {
            const batch = [...accepted, item];
            const errors = service.checkLedger({
              agreementValue: item.sd.agreement_value,
              ledger,
              removeIds: new Set(batch.filter((i) => i.before).map((i) => i.before.txn_id)),
              entries: batch.map((i) => ({ ...i.rec, txn_id: i.before?.txn_id })),
            });
            if (errors.length === 0) {
              accepted.push(item);
              continue;
            }
            const note = accepted.length ? ` (includes ${accepted.length} earlier row(s) for this SD Code in this file)` : '';
            errors.forEach((e) => failures.push({
              rowNumber: item.rowNumber, field: e.field, value: e.value, error: `${item.sd.sd_code}: ${e.error}${note}`,
            }));
          }
        }
        return failures;
      },
      saveRow: async (row, db, uploadedBy, rowNumber) => {
        const { rec, before, sd } = resolved.get(rowNumber);
        if (before) {
          const after = await txnModel.update(before.txn_id, rec, uploadedBy, { uploaded: true }, db);
          await logAudit({
            tableName: 'sd_transactions', recordId: after.txn_id, action: 'UPLOAD', actionBy: uploadedBy,
            oldValues: before, newValues: after,
            details: [`Bulk update ${sd.sd_code} ${after.txn_no}`, service.changeSummary(before, after)].filter(Boolean).join(': '),
          }, db);
        } else {
          const created = await txnModel.create(rec, uploadedBy, { uploaded: true }, db);
          await logAudit({
            tableName: 'sd_transactions', recordId: created.txn_id, action: 'UPLOAD', actionBy: uploadedBy,
            newValues: created, details: `${sd.sd_code} ${created.txn_no}`,
          }, db);
        }
      },
    });

    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} failed.`, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAll, searchSd, getSummary, getOne, create, update, remove, downloadTemplate, exportAll, bulkUpload,
};
