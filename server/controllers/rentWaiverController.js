const { withTransaction } = require('../config/db');
const waiverModel = require('../models/rentWaiverModel');
const rentMasterModel = require('../models/rentMasterModel');
const service = require('../services/rentService');
const { APPLIES_TO_COLUMNS, componentsFromRow, appliesToValues } = require('../services/rentComponents');
const { logAudit } = require('../utils/audit');
const { formatDMY, parseDMY } = require('../utils/dates');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');
const {
  paging, badRequest, withDates, cell, editWorkbook, changeBlock, sameList, monthLabel,
} = require('./rentHelpers');

// Waiver ID filled = update that waiver; otherwise the same Rent Code + From Date
// + To Date updates the existing waiver (e.g. to set Status No), else a new one is added
const COLUMNS = [
  { header: 'Waiver ID', required: false },
  { header: 'Rent Code', required: true },
  { header: 'From Date', required: true },
  { header: 'To Date', required: true },
  { header: 'Waiver Status', required: true },
  { header: 'Remark', required: false },
  // One Yes/No column per component; all blank = all components
  ...APPLIES_TO_COLUMNS,
];

const fromBody = (b) => ({
  rentId: b.rentId, fromDate: b.fromDate, toDate: b.toDate, waiverStatus: b.waiverStatus, componentCodes: b.componentCodes, remark: b.remark,
});

async function getAll(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total } = await waiverModel.getAll(withDates(req.query, ['dateFrom', 'dateTo']), p);
    res.json({ success: true, data: rows, total, ...p });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const rec = await waiverModel.findById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Waiver not found.' });
    res.json({ success: true, data: rec });
  } catch (err) {
    next(err);
  }
}

async function save(req, res, before) {
  const { rec, errors, rent } = await service.validateWaiver(fromBody(req.body), before);
  if (errors.length) return badRequest(res, errors);
  // No generated Rent Schedule in the old or new waiver period (unchanged saves are fine)
  if (!(before && sameWaiver(before, rec))) {
    const block = await changeBlock('waiver', before, rec, { rent });
    if (block) return badRequest(res, [{ field: 'Rent Schedule', value: rent.rent_code, error: block }]);
  }
  const by = req.user.userName;
  const saved = await withTransaction(async (db) => {
    const w = before ? await waiverModel.update(before.waiver_id, rec, by, {}, db) : await waiverModel.create(rec, by, {}, db);
    await logAudit({
      tableName: 'rent_waivers', recordId: w.waiver_id, action: !before ? 'INSERT' : before.waiver_status !== w.waiver_status ? 'STATUS_CHANGE' : 'UPDATE',
      actionBy: by, oldValues: before, newValues: w,
    }, db);
    return w;
  });
  return res.status(before ? 200 : 201).json({ success: true, message: `Waiver for ${saved.rent_code} saved.`, data: saved });
}

async function create(req, res, next) {
  try {
    return await save(req, res, null);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const before = await waiverModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Waiver not found.' });
    return await save(req, res, before);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const before = await waiverModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Waiver not found.' });
    const block = await changeBlock('waiver', before, null);
    if (block) return badRequest(res, [{ field: 'Rent Schedule', value: before.rent_code, error: block }]);
    await withTransaction(async (db) => {
      await waiverModel.remove(before.waiver_id, db);
      await logAudit({ tableName: 'rent_waivers', recordId: before.waiver_id, action: 'DELETE', actionBy: req.user.userName, oldValues: before }, db);
    });
    res.json({ success: true, message: `Waiver of ${before.rent_code} deleted.` });
  } catch (err) {
    next(err);
  }
}

async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'Waiver_Master_Template.xlsx', buildWorkbook('Waiver Master', COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

async function exportAll(req, res, next) {
  try {
    const { rows } = await waiverModel.getAll(withDates(req.query, ['dateFrom', 'dateTo']), { pageSize: 0 });
    await sendWorkbook(res, `Waiver_Master_${dateStamp()}.xlsx`, buildWorkbook('Waiver Master',
      [...COLUMNS.map((c) => c.header), 'SD Code', 'Landlord Name', 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      rows.map((w) => [w.waiver_id, w.rent_code, formatDMY(w.from_date), formatDMY(w.to_date), w.waiver_status,
        w.remark || '', ...appliesToValues(w.component_codes), w.sd_code, w.landlord_name,
        w.created_by, w.created_date, w.modified_by, w.modified_date])));
  } catch (err) {
    next(err);
  }
}

// The waiver as it stood vs the uploaded values: nothing to save
const sameWaiver = (before, rec) => before.rent_id === rec.rent_id && before.from_date === rec.from_date && before.to_date === rec.to_date
  && before.waiver_status === rec.waiver_status && (before.remark || null) === (rec.remark || null)
  && sameList(before.component_codes, rec.component_codes);

/**
 * Waiver Master Excel upload.
 *  Upload (editOnly false): Waiver ID, or the same Rent Code + From Date + To Date,
 *    updates a waiver; otherwise one is added.
 *  Bulk Edit (editOnly true): every row needs a Waiver ID.
 *  Both: unchanged rows are skipped; a new or changed waiver is refused while Rent
 *  Schedule lines exist in its old or new period (delete them first, regenerate after).
 */
async function runUpload(req, res, next, { editOnly }) {
  try {
    const resolved = new Map();
    const result = await processUpload(req, {
      screenCode: SCREENS.RENT_WAIVER,
      columns: editOnly ? COLUMNS.map((c) => (c.header === 'Waiver ID' ? { ...c, required: true } : c)) : COLUMNS,
      keyOf: (row) => (editOnly && cell(row, 'Waiver ID') ? `Waiver ${cell(row, 'Waiver ID')}` : `${cell(row, 'Rent Code') || '?'} ${cell(row, 'From Date')} - ${cell(row, 'To Date')}`),
      validateRow: async (row, { seen, rowNumber }) => {
        const id = cell(row, 'Waiver ID');
        let before = null;
        if (!id && editOnly) return [{ field: 'Waiver ID', value: '', error: 'Waiver ID is required in Bulk Edit. Use "Download for Bulk Edit", or add new waivers with Upload.' }];
        if (id) {
          before = /^\d+$/.test(id) ? await waiverModel.findById(Number(id)) : null;
          if (!before) return [{ field: 'Waiver ID', value: id, error: editOnly ? 'Waiver ID not found.' : 'Waiver ID not found. Leave it blank to add a new waiver.' }];
        } else {
          const rent = await rentMasterModel.findByCode(cell(row, 'Rent Code'));
          const from = parseDMY(cell(row, 'From Date'));
          const to = parseDMY(cell(row, 'To Date'));
          if (rent && from && to) {
            before = (await waiverModel.forRents([rent.rent_id])).find((w) => w.from_date === from && w.to_date === to) || null;
          }
        }
        const keep = (header, current) => cell(row, header) || current || '';
        const input = {
          rentCode: keep('Rent Code', before?.rent_code),
          fromDate: keep('From Date', formatDMY(before?.from_date)),
          toDate: keep('To Date', formatDMY(before?.to_date)),
          waiverStatus: keep('Waiver Status', before?.waiver_status),
          remark: keep('Remark', before?.remark),
        };
        // Applies to: the row's Yes/No columns, or (all blank) the stored list on an update
        const applies = componentsFromRow(row);
        if (applies.errors.length) return applies.errors;
        input.componentCodes = applies.given ? applies.codes : (before?.component_codes || []);
        const { rec, errors, rent } = await service.validateWaiver(input, before);
        if (errors.length === 0 && before) {
          const k = `waiver:${before.waiver_id}`;
          if (seen.has(k)) errors.push({ field: 'Waiver ID', value: before.waiver_id, error: `Same waiver as row ${seen.get(k)}.` });
          else seen.set(k, rowNumber);
        }
        const unchanged = errors.length === 0 && Boolean(before) && sameWaiver(before, rec);
        // No generated Rent Schedule in the old or new waiver period
        if (errors.length === 0 && !unchanged) {
          const block = await changeBlock('waiver', before, rec, { rent });
          if (block) errors.push({ field: 'Rent Schedule', value: rent.rent_code, error: block });
        }
        if (errors.length === 0) resolved.set(rowNumber, { rec, before, rent, unchanged });
        return errors;
      },
      // Active (Yes) waivers of one Rent Code in the same file must not overlap each other
      afterValidate: async (valid) => {
        const errors = [];
        const kept = [];
        for (const v of valid) {
          const { rec, rent } = resolved.get(v.rowNumber);
          if (rec.waiver_status !== 'Yes') continue;
          const clash = kept.find((k) => k.rent_id === rec.rent_id && k.from_date <= rec.to_date && k.to_date >= rec.from_date
            && (!k.component_codes || !rec.component_codes || k.component_codes.some((c) => rec.component_codes.includes(c))));
          if (clash) {
            errors.push({ rowNumber: v.rowNumber, field: 'From Date', value: formatDMY(rec.from_date), error: `Overlaps the waiver in row ${clash.rowNumber} for ${rent.rent_code}.` });
          } else kept.push({ ...rec, rowNumber: v.rowNumber });
        }
        return errors;
      },
      saveRow: async (row, db, by, rowNumber) => {
        const { rec, before, unchanged } = resolved.get(rowNumber);
        if (unchanged) return 'Unchanged';
        const saved = before ? await waiverModel.update(before.waiver_id, rec, by, { uploaded: true }, db) : await waiverModel.create(rec, by, { uploaded: true }, db);
        await logAudit({
          tableName: 'rent_waivers', recordId: saved.waiver_id, action: editOnly ? 'UPDATE' : 'UPLOAD', actionBy: by, oldValues: before, newValues: saved,
          details: editOnly ? 'Bulk Edit' : before ? 'Bulk update' : null,
        }, db);
        // The user regenerates the Rent Schedule afterwards
        return 'Saved';
      },
    });
    const unchanged = result.unchanged ? `, ${result.unchanged} unchanged` : '';
    res.json({ success: true, message: `${editOnly ? 'Bulk Edit' : 'Upload'} processed: ${result.passed} saved${unchanged}, ${result.failed} rejected.`, data: result });
  } catch (err) {
    next(err);
  }
}

const bulkUpload = (req, res, next) => runUpload(req, res, next, { editOnly: false });
const bulkEdit = (req, res, next) => runUpload(req, res, next, { editOnly: true });

// GET /api/rent/waivers/bulk-edit - the filtered waivers in the upload layout, Waiver ID filled
async function bulkEditExport(req, res, next) {
  try {
    const { rows } = await waiverModel.getAll(withDates(req.query, ['dateFrom', 'dateTo']), { pageSize: 0 });
    const buffer = await editWorkbook({
      sheet: 'Waiver Master',
      editable: COLUMNS.map((c) => c.header),
      info: ['SD Code', 'Landlord Name', 'Rent Schedule Generated Up To'],
      rows: rows.map((w) => [w.waiver_id, w.rent_code, formatDMY(w.from_date), formatDMY(w.to_date), w.waiver_status,
        w.remark || '', ...appliesToValues(w.component_codes),
        w.sd_code, w.landlord_name, w.schedule_to_month ? monthLabel(w.schedule_to_month) : 'Not generated']),
      steps: [
        'If the Rent Schedule is already generated for the months you will change (old and new waiver period), first delete those lines in Rent Schedule (Delete Schedule) for that period.',
        'Change the green columns of the waivers you want to edit. Do not add rows here; add new waivers with Upload.',
        'Save the file and upload it with "Upload Bulk Edit" on the Waiver Master screen. Check the report for any rejected rows.',
        'Regenerate the Rent Schedule for the deleted period.',
      ],
    });
    await sendWorkbook(res, `Waiver_Master_Bulk_Edit_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, remove, downloadTemplate, exportAll, bulkUpload, bulkEdit, bulkEditExport };
