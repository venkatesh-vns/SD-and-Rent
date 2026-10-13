const { withTransaction } = require('../config/db');
const agreementModel = require('../models/rentAgreementModel');
const rentMasterModel = require('../models/rentMasterModel');
const ruleModel = require('../models/rentRuleModel');
const waiverModel = require('../models/rentWaiverModel');
const service = require('../services/rentService');
const schedule = require('../services/rentScheduleService');
const { COMPONENTS, excelHeaders } = require('../services/rentComponents');
const { escalationChain } = require('../services/rentCalc');
const { logAudit } = require('../utils/audit');
const { formatDMY } = require('../utils/dates');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');
const { paging, badRequest, cell } = require('./rentHelpers');

// Rent Code + Agreement Status identify the record: an active agreement for
// the pair is updated (blank cells keep values), otherwise a new one is added.
const HEADER_COLUMNS = [
  { header: 'Rent Code', required: true },
  { header: 'Agreement Status', required: true },
  { header: 'Status', required: false },
  { header: 'Transfer From Rent Code', required: false },
  { header: 'Transfer Effective Date', required: false },
  { header: 'Remark', required: false },
];
const COMPONENT_COLUMNS = COMPONENTS.flatMap((c) => {
  const h = excelHeaders(c);
  return [h.trigger, h.rate, h.percentage].filter(Boolean).map((header) => ({ header, required: false }));
});
const COLUMNS = [...HEADER_COLUMNS, ...COMPONENT_COLUMNS];

const fromBody = (b) => ({
  rentId: b.rentId, agreementStatus: b.agreementStatus, status: b.status, transferFromRentId: b.transferFromRentId,
  transferEffectiveDate: b.transferEffectiveDate, remark: b.remark, components: b.components || {},
});

// Stored components -> { CODE: { quantity, rate, percentage } } (the screen / upload shape)
function componentInput(components = []) {
  return Object.fromEntries(components.map((c) => {
    const def = COMPONENTS.find((x) => x.code === c.component_code);
    return [c.component_code, def.unit === 'month'
      ? { rate: String(Number(c.rate)), percentage: String(Number(c.percentage)) }
      : { quantity: String(Number(c.quantity)), rate: String(Number(c.rate)), percentage: String(Number(c.percentage)) }];
  }));
}

const audit = (db, by, action, rec, before, details) => logAudit({
  tableName: 'rent_agreements', recordId: rec.agreement_id, action, actionBy: by, oldValues: before || null, newValues: rec, details: details || null,
}, db);

/**
 * A new Transfer takes over the source Rent Code's escalation rules (when the
 * new Rent Code has none) and its waivers from the effective date onward.
 */
async function copyTransferConfiguration(agreement, by, db) {
  if (agreement.agreement_status !== 'Transfer' || agreement.status !== 'Active') return [];
  const notes = [];
  const target = await rentMasterModel.findById(agreement.rent_id, db);
  const targetRules = await ruleModel.forRent(agreement.rent_id, db);
  if (!targetRules.length) {
    const sourceRules = (await ruleModel.forRent(agreement.transfer_from_rent_id, db)).filter((r) => r.status === 'Active');
    for (const r of sourceRules) {
      await ruleModel.create({ ...r, rent_id: agreement.rent_id }, by, {}, db);
    }
    if (sourceRules.length) {
      await ruleModel.saveEffectiveDates(escalationChain(await ruleModel.forRent(agreement.rent_id, db), target), db);
      notes.push(`${sourceRules.length} rule(s) copied`);
    }
  }
  const sourceWaivers = (await waiverModel.forRents([agreement.transfer_from_rent_id], db))
    .filter((w) => w.waiver_status === 'Yes' && w.to_date >= agreement.transfer_effective_date);
  for (const w of sourceWaivers) {
    const from = w.from_date > agreement.transfer_effective_date ? w.from_date : agreement.transfer_effective_date;
    const clash = await waiverModel.overlapping(agreement.rent_id, from, w.to_date, w.component_code, null, db);
    if (!clash.length) await waiverModel.create({ ...w, rent_id: agreement.rent_id, from_date: from, remark: `Transferred from ${w.rent_code}` }, by, {}, db);
  }
  if (sourceWaivers.length) notes.push(`${sourceWaivers.length} waiver(s) copied`);
  return notes;
}

async function getAll(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total } = await agreementModel.getAll(req.query, p);
    res.json({ success: true, data: rows, total, ...p });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const rec = await agreementModel.findById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Rent Agreement not found.' });
    res.json({ success: true, data: { ...rec, usage: await agreementModel.usage(rec) } });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { rec, errors } = await service.validateAgreement(fromBody(req.body));
    if (errors.length) return badRequest(res, errors);
    const by = req.user.userName;
    const { created, notes } = await withTransaction(async (db) => {
      const c = await agreementModel.create(rec, by, {}, db);
      const n = await copyTransferConfiguration(c, by, db);
      await audit(db, by, 'INSERT', c, null, n.join('; '));
      await schedule.regenerateFuture([c.rent_id, c.transfer_from_rent_id], { by, trigger: 'Rent Agreement change' }, db);
      return { created: c, notes: n };
    });
    res.status(201).json({
      success: true,
      message: `Agreement for ${created.rent_code} created successfully${notes.length ? ` (${notes.join(', ')} from ${created.transfer_from_rent_code})` : ''}.`,
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const before = await agreementModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Rent Agreement not found.' });
    const { rec, errors } = await service.validateAgreement(fromBody(req.body), before);
    if (errors.length) return badRequest(res, errors);
    const by = req.user.userName;
    const updated = await withTransaction(async (db) => {
      const used = await agreementModel.usage(before, db);
      const after = used.rules || used.schedule_lines
        ? await agreementModel.setStatus(before.agreement_id, rec.status, rec.remark, by, db)
        : await agreementModel.update(before.agreement_id, rec, by, {}, db);
      if (before.status !== 'Active' && after.status === 'Active') await copyTransferConfiguration(after, by, db);
      await audit(db, by, before.status !== after.status ? 'STATUS_CHANGE' : 'UPDATE', after, before,
        before.status !== after.status ? `Status ${before.status} -> ${after.status}` : null);
      await schedule.regenerateFuture([after.rent_id, after.transfer_from_rent_id, before.transfer_from_rent_id], { by, trigger: 'Rent Agreement change' }, db);
      return after;
    });
    res.json({ success: true, message: `Agreement for ${updated.rent_code} updated successfully.`, data: updated });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const before = await agreementModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Rent Agreement not found.' });
    const used = await agreementModel.usage(before);
    if (used.rules || used.schedule_lines) {
      return res.status(409).json({ success: false, message: `This agreement is used in ${used.rules ? 'Rule Master' : 'Rent Schedule'}; it cannot be deleted, only made Inactive.` });
    }
    await withTransaction(async (db) => {
      await agreementModel.remove(before.agreement_id, db);
      await logAudit({ tableName: 'rent_agreements', recordId: before.agreement_id, action: 'DELETE', actionBy: req.user.userName, oldValues: before }, db);
      await schedule.regenerateFuture([before.rent_id, before.transfer_from_rent_id], { by: req.user.userName, trigger: 'Rent Agreement deleted' }, db);
    });
    res.json({ success: true, message: `Agreement for ${before.rent_code} deleted successfully.` });
  } catch (err) {
    next(err);
  }
}

async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'Rent_Agreement_Template.xlsx', buildWorkbook('Rent Agreement', COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

function excelRow(a) {
  const comps = componentInput(a.components);
  const values = COMPONENTS.flatMap((c) => {
    const v = comps[c.code] || {};
    const n = (x) => (x === undefined || x === null || x === '' ? '' : Number(x));
    return c.unit === 'month' ? [n(v.rate), n(v.percentage)] : [n(v.quantity), n(v.rate), n(v.percentage)];
  });
  return [a.rent_code, a.agreement_status, a.status, a.transfer_from_rent_code || '', formatDMY(a.transfer_effective_date), a.remark || '', ...values];
}

async function exportAll(req, res, next) {
  try {
    const { rows } = await agreementModel.getAll(req.query, { pageSize: 0 });
    await sendWorkbook(res, `Rent_Agreements_${dateStamp()}.xlsx`, buildWorkbook('Rent Agreement',
      [...COLUMNS.map((c) => c.header), 'SD Code', 'Landlord Name', 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      rows.map((a) => [...excelRow(a), a.sd_code, a.landlord_name, a.created_by, a.created_date, a.modified_by, a.modified_date])));
  } catch (err) {
    next(err);
  }
}

async function bulkUpload(req, res, next) {
  try {
    const resolved = new Map();
    const result = await processUpload(req, {
      screenCode: SCREENS.RENT_AGREEMENT,
      columns: COLUMNS,
      keyOf: (row) => `${cell(row, 'Rent Code') || '?'} / ${cell(row, 'Agreement Status') || '?'}`,
      validateRow: async (row, { seen, rowNumber }) => {
        const rent = await rentMasterModel.findByCode(cell(row, 'Rent Code'));
        const status = service.AGREEMENT_STATUSES.find((s) => s.toLowerCase() === cell(row, 'Agreement Status').toLowerCase());
        const before = rent && status ? await agreementModel.findActive(rent.rent_id, status) : null;
        const keep = (header, current) => cell(row, header) || current || '';
        // Components: values in the row; on an update, components left blank keep their stored values
        const stored = componentInput(before?.components);
        const components = {};
        COMPONENTS.forEach((c) => {
          const h = excelHeaders(c);
          const given = { quantity: h.rate ? cell(row, h.trigger) : undefined, rate: h.rate ? cell(row, h.rate) : cell(row, h.trigger), percentage: cell(row, h.percentage) };
          const any = Object.values(given).some((v) => v);
          components[c.code] = any ? given : (stored[c.code] || {});
        });
        const input = {
          rentCode: cell(row, 'Rent Code'),
          agreementStatus: cell(row, 'Agreement Status'),
          status: keep('Status', before?.status),
          transferFromRentCode: keep('Transfer From Rent Code', before?.transfer_from_rent_code),
          transferEffectiveDate: keep('Transfer Effective Date', formatDMY(before?.transfer_effective_date)),
          remark: keep('Remark', before?.remark),
          components,
        };
        const { rec, errors } = await service.validateAgreement(input, before);
        const k = `${input.rentCode.toUpperCase()}|${(status || input.agreementStatus).toLowerCase()}`;
        if (errors.length === 0) {
          if (seen.has(k)) errors.push({ field: 'Rent Code', value: input.rentCode, error: `Same Rent Code and Agreement Status as row ${seen.get(k)}.` });
          else seen.set(k, rowNumber);
        }
        if (errors.length === 0) resolved.set(rowNumber, { rec, before });
        return errors;
      },
      saveRow: async (row, db, by, rowNumber) => {
        const { rec, before } = resolved.get(rowNumber);
        let saved;
        if (before) {
          const used = await agreementModel.usage(before, db);
          saved = used.rules || used.schedule_lines
            ? await agreementModel.setStatus(before.agreement_id, rec.status, rec.remark, by, db)
            : await agreementModel.update(before.agreement_id, rec, by, { uploaded: true }, db);
          await audit(db, by, 'UPLOAD', saved, before, 'Bulk update');
        } else {
          saved = await agreementModel.create(rec, by, { uploaded: true }, db);
          const notes = await copyTransferConfiguration(saved, by, db);
          await audit(db, by, 'UPLOAD', saved, null, notes.join('; '));
        }
        await schedule.regenerateFuture([saved.rent_id, saved.transfer_from_rent_id], { by, trigger: 'Rent Agreement upload' }, db);
      },
    });
    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} rejected.`, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, remove, downloadTemplate, exportAll, bulkUpload, COMPONENT_COLUMNS };
