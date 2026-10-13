const { withTransaction } = require('../config/db');
const waiverModel = require('../models/rentWaiverModel');
const rentMasterModel = require('../models/rentMasterModel');
const service = require('../services/rentService');
const schedule = require('../services/rentScheduleService');
const { BY_CODE } = require('../services/rentComponents');
const { logAudit } = require('../utils/audit');
const { formatDMY, parseDMY } = require('../utils/dates');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');
const { paging, badRequest, withDates, cell } = require('./rentHelpers');

// Waiver ID filled = update that waiver; otherwise the same Rent Code + From Date
// + To Date updates the existing waiver (e.g. to set Status No), else a new one is added
const COLUMNS = [
  { header: 'Waiver ID', required: false },
  { header: 'Rent Code', required: true },
  { header: 'From Date', required: true },
  { header: 'To Date', required: true },
  { header: 'Waiver Status', required: true },
  { header: 'Component', required: false },
  { header: 'Remark', required: false },
];

const fromBody = (b) => ({
  rentId: b.rentId, fromDate: b.fromDate, toDate: b.toDate, waiverStatus: b.waiverStatus, componentCode: b.componentCode, remark: b.remark,
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
  const { rec, errors } = await service.validateWaiver(fromBody(req.body), before);
  if (errors.length) return badRequest(res, errors);
  const by = req.user.userName;
  const saved = await withTransaction(async (db) => {
    const w = before ? await waiverModel.update(before.waiver_id, rec, by, {}, db) : await waiverModel.create(rec, by, {}, db);
    await logAudit({
      tableName: 'rent_waivers', recordId: w.waiver_id, action: !before ? 'INSERT' : before.waiver_status !== w.waiver_status ? 'STATUS_CHANGE' : 'UPDATE',
      actionBy: by, oldValues: before, newValues: w,
    }, db);
    await schedule.regenerateFuture([w.rent_id, before?.rent_id], { by, trigger: 'Waiver Master change' }, db);
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
    await withTransaction(async (db) => {
      await waiverModel.remove(before.waiver_id, db);
      await logAudit({ tableName: 'rent_waivers', recordId: before.waiver_id, action: 'DELETE', actionBy: req.user.userName, oldValues: before }, db);
      await schedule.regenerateFuture([before.rent_id], { by: req.user.userName, trigger: 'Waiver deleted' }, db);
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
        w.component_code ? BY_CODE[w.component_code].label : '', w.remark || '', w.sd_code, w.landlord_name,
        w.created_by, w.created_date, w.modified_by, w.modified_date])));
  } catch (err) {
    next(err);
  }
}

async function bulkUpload(req, res, next) {
  try {
    const resolved = new Map();
    const result = await processUpload(req, {
      screenCode: SCREENS.RENT_WAIVER,
      columns: COLUMNS,
      keyOf: (row) => `${cell(row, 'Rent Code') || '?'} ${cell(row, 'From Date')} - ${cell(row, 'To Date')}`,
      validateRow: async (row, { seen, rowNumber }) => {
        const id = cell(row, 'Waiver ID');
        let before = null;
        if (id) {
          before = /^\d+$/.test(id) ? await waiverModel.findById(Number(id)) : null;
          if (!before) return [{ field: 'Waiver ID', value: id, error: 'Waiver ID not found. Leave it blank to add a new waiver.' }];
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
          componentCode: keep('Component', before?.component_code),
          remark: keep('Remark', before?.remark),
        };
        const { rec, errors, rent } = await service.validateWaiver(input, before);
        if (errors.length === 0 && before) {
          const k = `waiver:${before.waiver_id}`;
          if (seen.has(k)) errors.push({ field: 'Waiver ID', value: before.waiver_id, error: `Same waiver as row ${seen.get(k)}.` });
          else seen.set(k, rowNumber);
        }
        if (errors.length === 0) resolved.set(rowNumber, { rec, before, rent });
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
            && (!k.component_code || !rec.component_code || k.component_code === rec.component_code));
          if (clash) {
            errors.push({ rowNumber: v.rowNumber, field: 'From Date', value: formatDMY(rec.from_date), error: `Overlaps the waiver in row ${clash.rowNumber} for ${rent.rent_code}.` });
          } else kept.push({ ...rec, rowNumber: v.rowNumber });
        }
        return errors;
      },
      saveRow: async (row, db, by, rowNumber) => {
        const { rec, before } = resolved.get(rowNumber);
        const saved = before ? await waiverModel.update(before.waiver_id, rec, by, { uploaded: true }, db) : await waiverModel.create(rec, by, { uploaded: true }, db);
        await logAudit({ tableName: 'rent_waivers', recordId: saved.waiver_id, action: 'UPLOAD', actionBy: by, oldValues: before, newValues: saved, details: before ? 'Bulk update' : null }, db);
        await schedule.regenerateFuture([saved.rent_id], { by, trigger: 'Waiver Master upload' }, db);
      },
    });
    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} rejected.`, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, remove, downloadTemplate, exportAll, bulkUpload };
