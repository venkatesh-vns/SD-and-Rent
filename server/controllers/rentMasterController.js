const { withTransaction } = require('../config/db');
const rentMasterModel = require('../models/rentMasterModel');
const agreementModel = require('../models/rentAgreementModel');
const service = require('../services/rentService');
const schedule = require('../services/rentScheduleService');
const { logAudit } = require('../utils/audit');
const { formatDMY } = require('../utils/dates');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');
const { paging, badRequest, cell } = require('./rentHelpers');

// Rent Code blank = new record; filled = update of that Rent Code (blank cells keep values).
// Cost Center, Floor, LCD, RCD and LED come from SD Master; if filled they must match it.
const COLUMNS = [
  { header: 'Rent Code', required: false },
  { header: 'SD Code', required: true },
  { header: 'Cost Center', required: false },
  { header: 'Floor', required: false },
  { header: 'LCD', required: false },
  { header: 'RCD', required: false },
  { header: 'LED', required: false },
  { header: 'Landlord Name', required: true },
  { header: 'LL Status', required: true },
  { header: 'Inactive End Date', required: false },
];

const fromBody = (b) => ({
  sdId: b.sdId, sdCode: b.sdCode, landlordName: b.landlordName, llStatus: b.llStatus, inactiveEndDate: b.inactiveEndDate,
});

const statusChanged = (before, after) => before.ll_status !== after.ll_status
  || (before.inactive_end_date || null) !== (after.inactive_end_date || null) || before.sd_id !== after.sd_id;

async function getAll(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total } = await rentMasterModel.getAll(req.query, p);
    res.json({ success: true, data: rows, total, ...p });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const rec = await rentMasterModel.findById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Rent Code not found.' });
    const usage = await rentMasterModel.usage(rec.rent_id);
    const agreements = await agreementModel.forRents([rec.rent_id]);
    res.json({ success: true, data: { ...rec, usage, agreements } });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { rec, errors } = await service.validateRentMaster(fromBody(req.body));
    if (errors.length) return badRequest(res, errors);
    const created = await withTransaction(async (db) => {
      const c = await rentMasterModel.create(rec, req.user.userName, {}, db);
      await logAudit({ tableName: 'rent_master', recordId: c.rent_id, action: 'INSERT', actionBy: req.user.userName, newValues: c }, db);
      return c;
    });
    res.status(201).json({ success: true, message: `${created.rent_code} created successfully.`, data: created });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const before = await rentMasterModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Rent Code not found.' });
    const { rec, errors } = await service.validateRentMaster(fromBody(req.body), before);
    if (errors.length) return badRequest(res, errors);
    const updated = await withTransaction(async (db) => {
      const after = await rentMasterModel.update(before.rent_id, rec, req.user.userName, {}, db);
      await logAudit({
        tableName: 'rent_master', recordId: after.rent_id, action: before.ll_status !== after.ll_status ? 'STATUS_CHANGE' : 'UPDATE',
        actionBy: req.user.userName, oldValues: before, newValues: after,
        details: before.ll_status !== after.ll_status ? `LL Status ${before.ll_status} -> ${after.ll_status}` : null,
      }, db);
      if (statusChanged(before, after)) await schedule.regenerateFuture([after.rent_id], { by: req.user.userName, trigger: 'Rent Master change' }, db);
      return after;
    });
    res.json({ success: true, message: `${updated.rent_code} updated successfully.`, data: updated });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const before = await rentMasterModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Rent Code not found.' });
    const used = await rentMasterModel.usage(before.rent_id);
    if (used.agreements || used.transfers || used.rules || used.waivers) {
      return res.status(409).json({
        success: false,
        message: `${before.rent_code} is used by ${used.agreements + used.transfers} agreement(s), ${used.rules} rule(s) and ${used.waivers} waiver(s); it cannot be deleted. Set LL Status to Inactive instead.`,
      });
    }
    await withTransaction(async (db) => {
      await rentMasterModel.remove(before.rent_id, db);
      await logAudit({ tableName: 'rent_master', recordId: before.rent_id, action: 'DELETE', actionBy: req.user.userName, oldValues: before }, db);
    });
    res.json({ success: true, message: `${before.rent_code} deleted successfully.` });
  } catch (err) {
    next(err);
  }
}

async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'Rent_Master_Template.xlsx', buildWorkbook('Rent Master', COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

const excelRow = (r) => [
  r.rent_code, r.sd_code, r.cost_center_name, r.floor, formatDMY(r.lcd), formatDMY(r.rcd), formatDMY(r.led),
  r.landlord_name, r.ll_status, formatDMY(r.inactive_end_date),
];

async function exportAll(req, res, next) {
  try {
    const { rows } = await rentMasterModel.getAll(req.query, { pageSize: 0 });
    await sendWorkbook(res, `Rent_Master_${dateStamp()}.xlsx`, buildWorkbook('Rent Master',
      [...COLUMNS.map((c) => c.header), 'Business Key', 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      rows.map((r) => [...excelRow(r), r.business_key, r.created_by, r.created_date, r.modified_by, r.modified_date])));
  } catch (err) {
    next(err);
  }
}

async function bulkUpload(req, res, next) {
  try {
    const resolved = new Map();
    const result = await processUpload(req, {
      screenCode: SCREENS.RENT_MASTER,
      columns: COLUMNS,
      keyOf: (row) => cell(row, 'Rent Code') || `New: ${cell(row, 'SD Code') || '?'} / ${cell(row, 'Landlord Name') || '?'}`,
      validateRow: async (row, { seen, rowNumber }) => {
        const code = cell(row, 'Rent Code');
        let before = null;
        if (code) {
          before = await rentMasterModel.findByCode(code);
          if (!before) return [{ field: 'Rent Code', value: code, error: 'Rent Code not found. Leave it blank to add a new Rent Code.' }];
        }
        const keep = (header, current) => cell(row, header) || current || '';
        const input = {
          sdCode: keep('SD Code', before?.sd_code),
          costCenter: cell(row, 'Cost Center'), floor: cell(row, 'Floor'),
          lcd: cell(row, 'LCD'), rcd: cell(row, 'RCD'), led: cell(row, 'LED'),
          landlordName: keep('Landlord Name', before?.landlord_name),
          llStatus: keep('LL Status', before?.ll_status),
          inactiveEndDate: keep('Inactive End Date', formatDMY(before?.inactive_end_date)),
        };
        const { rec, errors } = await service.validateRentMaster(input, before);
        // Duplicates within this file: the same Rent Code, or the same Business Key
        if (errors.length === 0) {
          const keys = [
            before && [`code:${before.rent_code}`, 'Rent Code', before.rent_code],
            [`bk:${rec.business_key}`, 'Landlord Name', input.landlordName],
          ].filter(Boolean);
          const hit = keys.find(([k]) => seen.has(k));
          if (hit) {
            errors.push({ field: hit[1], value: hit[2], error: `Same ${hit[1] === 'Rent Code' ? 'Rent Code' : 'Cost Center + SD Code + Floor + Landlord Name'} as row ${seen.get(hit[0])}.` });
          } else keys.forEach(([k]) => seen.set(k, rowNumber));
        }
        if (errors.length === 0) resolved.set(rowNumber, { rec, before });
        return errors;
      },
      saveRow: async (row, db, by, rowNumber) => {
        const { rec, before } = resolved.get(rowNumber);
        if (before) {
          const after = await rentMasterModel.update(before.rent_id, rec, by, { uploaded: true }, db);
          await logAudit({ tableName: 'rent_master', recordId: after.rent_id, action: 'UPLOAD', actionBy: by, oldValues: before, newValues: after, details: 'Bulk update' }, db);
          if (statusChanged(before, after)) await schedule.regenerateFuture([after.rent_id], { by, trigger: 'Rent Master upload' }, db);
        } else {
          const created = await rentMasterModel.create(rec, by, { uploaded: true }, db);
          await logAudit({ tableName: 'rent_master', recordId: created.rent_id, action: 'UPLOAD', actionBy: by, newValues: created }, db);
        }
      },
    });
    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} rejected.`, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, remove, downloadTemplate, exportAll, bulkUpload };
