const { withTransaction } = require('../config/db');
const ruleModel = require('../models/rentRuleModel');
const rentMasterModel = require('../models/rentMasterModel');
const service = require('../services/rentService');
const { APPLIES_TO_COLUMNS, componentsFromRow, appliesToValues } = require('../services/rentComponents');
const { escalationChain } = require('../services/rentCalc');
const { logAudit } = require('../utils/audit');
const { formatDMY } = require('../utils/dates');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');
const {
  paging, badRequest, cell, editWorkbook, changeBlock, sameList, monthLabel,
} = require('./rentHelpers');

// Rule ID blank = new rule; filled = update of that rule (blank cells keep values)
const COLUMNS = [
  { header: 'Rule ID', required: false },
  { header: 'Rent Code', required: true },
  { header: 'Rule Type', required: true },
  { header: 'Escalation Month', required: false },
  { header: 'From Date', required: false },
  { header: 'To Date', required: false },
  { header: 'Percentage', required: true },
  { header: 'Status', required: false },
  // One Yes/No column per component; all blank = all components
  ...APPLIES_TO_COLUMNS,
];

const fromBody = (b) => ({
  rentId: b.rentId, ruleType: b.ruleType, escalationMonths: b.escalationMonths, fromDate: b.fromDate, toDate: b.toDate,
  percentage: b.percentage, componentCodes: b.componentCodes, status: b.status,
});

// Re-calculates and stores the escalation dates of a Rent Code's rules
async function refreshChain(rentId, db) {
  const rent = await rentMasterModel.findById(rentId, db);
  const rules = await ruleModel.forRent(rentId, db);
  const chain = escalationChain(rules, rent);
  const byId = Object.fromEntries(chain.map((r) => [r.rule_id, r.effective_date]));
  await ruleModel.saveEffectiveDates(rules.map((r) => ({ rule_id: r.rule_id, effective_date: byId[r.rule_id] ?? null })), db);
}

// Escalation dates worked out from the current SD Master dates (they may have changed)
async function withLiveDates(rows) {
  const rentIds = [...new Set(rows.map((r) => r.rent_id))];
  const all = await ruleModel.forRents(rentIds);
  const live = {};
  rentIds.forEach((id) => {
    const rules = all.filter((r) => r.rent_id === id);
    if (rules.length) escalationChain(rules, rules[0]).forEach((r) => { live[r.rule_id] = r.effective_date; });
  });
  return rows.map((r) => ({ ...r, effective_date: r.rule_type === 'Normal Day' ? r.from_date : live[r.rule_id] ?? null }));
}

async function getAll(req, res, next) {
  try {
    const p = paging(req.query);
    const { rows, total } = await ruleModel.getAll(req.query, p);
    res.json({ success: true, data: await withLiveDates(rows), total, ...p });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const rec = await ruleModel.findById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Rule not found.' });
    res.json({ success: true, data: (await withLiveDates([rec]))[0] });
  } catch (err) {
    next(err);
  }
}

async function save(req, res, next, before) {
  const { rec, errors, rent, chain } = await service.validateRule(fromBody(req.body), before);
  if (errors.length) return badRequest(res, errors);
  // No generated Rent Schedule in the months the change affects (unchanged saves are fine)
  if (!(before && sameRule(before, rec))) {
    const id = before?.rule_id ?? Number.MAX_SAFE_INTEGER;
    const block = await changeBlock('rule', before, rec, { rent, newEffective: chain.find((r) => r.rule_id === id)?.effective_date });
    if (block) return badRequest(res, [{ field: 'Rent Schedule', value: rent.rent_code, error: block }]);
  }
  const by = req.user.userName;
  const saved = await withTransaction(async (db) => {
    const r = before ? await ruleModel.update(before.rule_id, rec, by, {}, db) : await ruleModel.create(rec, by, {}, db);
    await refreshChain(r.rent_id, db);
    if (before && before.rent_id !== r.rent_id) await refreshChain(before.rent_id, db);
    const after = await ruleModel.findById(r.rule_id, db);
    await logAudit({
      tableName: 'rent_rules', recordId: after.rule_id, action: !before ? 'INSERT' : before.status !== after.status ? 'STATUS_CHANGE' : 'UPDATE',
      actionBy: by, oldValues: before, newValues: after,
    }, db);
    return after;
  });
  const when = saved.effective_date ? ` Escalates on ${formatDMY(saved.effective_date)}.` : '';
  return res.status(before ? 200 : 201).json({ success: true, message: `Rule for ${saved.rent_code} saved.${when}`, data: saved });
}

async function create(req, res, next) {
  try {
    return await save(req, res, next, null);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const before = await ruleModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Rule not found.' });
    return await save(req, res, next, before);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const before = await ruleModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Rule not found.' });
    const block = await changeBlock('rule', before, null);
    if (block) return badRequest(res, [{ field: 'Rent Schedule', value: before.rent_code, error: block }]);
    await withTransaction(async (db) => {
      await ruleModel.remove(before.rule_id, db);
      await refreshChain(before.rent_id, db);
      await logAudit({ tableName: 'rent_rules', recordId: before.rule_id, action: 'DELETE', actionBy: req.user.userName, oldValues: before }, db);
    });
    res.json({ success: true, message: `Rule ${before.rule_id} of ${before.rent_code} deleted.` });
  } catch (err) {
    next(err);
  }
}

async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'Rule_Master_Template.xlsx', buildWorkbook('Rule Master', COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

async function exportAll(req, res, next) {
  try {
    const { rows } = await ruleModel.getAll(req.query, { pageSize: 0 });
    const data = await withLiveDates(rows);
    await sendWorkbook(res, `Rule_Master_${dateStamp()}.xlsx`, buildWorkbook('Rule Master',
      [...COLUMNS.map((c) => c.header), 'Escalation Date', 'LCD', 'RCD', 'LED', 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      data.map((r) => [r.rule_id, r.rent_code, r.rule_type, r.escalation_months ?? '', formatDMY(r.from_date), formatDMY(r.to_date),
        Number(r.percentage), r.status, ...appliesToValues(r.component_codes),
        formatDMY(r.effective_date), formatDMY(r.lcd), formatDMY(r.rcd), formatDMY(r.led),
        r.created_by, r.created_date, r.modified_by, r.modified_date])));
  } catch (err) {
    next(err);
  }
}

// The rule as it stood vs the uploaded values: nothing to save
const sameRule = (before, rec) => before.rent_id === rec.rent_id && before.rule_type === rec.rule_type
  && (before.escalation_months ?? null) === (rec.escalation_months ?? null)
  && (before.from_date || null) === (rec.from_date || null) && (before.to_date || null) === (rec.to_date || null)
  && Number(before.percentage) === Number(rec.percentage) && before.status === rec.status
  && sameList(before.component_codes, rec.component_codes);

/**
 * Rule Master Excel upload.
 *  Upload (editOnly false): Rule ID blank = new rule, filled = update (blank cells keep values).
 *  Bulk Edit (editOnly true): every row needs a Rule ID.
 *  Both: unchanged rows are skipped; a new or changed rule is refused while Rent Schedule
 *  lines exist in the months it affects (delete them first, regenerate after the change).
 */
async function runUpload(req, res, next, { editOnly }) {
  try {
    const resolved = new Map();
    const result = await processUpload(req, {
      screenCode: SCREENS.RENT_RULE,
      columns: editOnly ? COLUMNS.map((c) => (c.header === 'Rule ID' ? { ...c, required: true } : c)) : COLUMNS,
      keyOf: (row) => (cell(row, 'Rule ID') ? `Rule ${cell(row, 'Rule ID')}` : `${cell(row, 'Rent Code') || '?'} (new)`),
      validateRow: async (row, { seen, rowNumber }) => {
        const id = cell(row, 'Rule ID');
        let before = null;
        if (!id && editOnly) return [{ field: 'Rule ID', value: '', error: 'Rule ID is required in Bulk Edit. Use "Download for Bulk Edit", or add new rules with Upload.' }];
        if (id) {
          before = /^\d+$/.test(id) ? await ruleModel.findById(Number(id)) : null;
          if (!before) return [{ field: 'Rule ID', value: id, error: editOnly ? 'Rule ID not found.' : 'Rule ID not found. Leave it blank to add a new rule.' }];
          if (seen.has(`rule:${id}`)) return [{ field: 'Rule ID', value: id, error: `Rule ID repeated from row ${seen.get(`rule:${id}`)}.` }];
          seen.set(`rule:${id}`, rowNumber);
        }
        const keep = (header, current) => cell(row, header) || (current === null || current === undefined ? '' : String(current));
        const input = {
          rentCode: keep('Rent Code', before?.rent_code),
          ruleType: keep('Rule Type', before?.rule_type),
          escalationMonths: keep('Escalation Month', before?.escalation_months),
          fromDate: keep('From Date', formatDMY(before?.from_date)),
          toDate: keep('To Date', formatDMY(before?.to_date)),
          percentage: keep('Percentage', before ? Number(before.percentage) : ''),
          status: keep('Status', before?.status),
        };
        // Applies to: the row's Yes/No columns, or (all blank) the stored list on an update
        const applies = componentsFromRow(row);
        if (applies.errors.length) return applies.errors;
        input.componentCodes = applies.given ? applies.codes : (before?.component_codes || []);
        const { rec, errors, rent } = await service.validateRule(input, before);
        if (errors.length === 0) resolved.set(rowNumber, { rec, before, rent, unchanged: Boolean(before) && sameRule(before, rec) });
        return errors;
      },
      // Rules of one Rent Code in the same file are checked together, in row order
      afterValidate: async (valid) => {
        const errors = [];
        const byRent = new Map();
        valid.forEach((v) => {
          const r = resolved.get(v.rowNumber);
          if (!byRent.has(r.rent.rent_id)) byRent.set(r.rent.rent_id, []);
          byRent.get(r.rent.rent_id).push({ ...r, rowNumber: v.rowNumber });
        });
        for (const [rentId, items] of byRent) {
          const rent = items[0].rent;
          const editedIds = new Set(items.filter((i) => i.before).map((i) => i.before.rule_id));
          let nextId = Number.MAX_SAFE_INTEGER - 1000;
          const stored = (await ruleModel.forRent(rentId)).filter((r) => !editedIds.has(r.rule_id));
          const candidates = items.map((i) => ({ ...i.rec, rule_id: i.before ? i.before.rule_id : (nextId += 1), rowNumber: i.rowNumber }));
          const all = [...stored, ...candidates];
          const active = all.filter((r) => r.status === 'Active');
          if (active.some((r) => r.rule_type === 'LCD') && active.some((r) => r.rule_type === 'RCD')) {
            candidates.filter((c) => c.status === 'Active' && ['LCD', 'RCD'].includes(c.rule_type)).forEach((c) => errors.push({
              rowNumber: c.rowNumber, field: 'Rule Type', value: c.rule_type, error: `${rent.rent_code} would have both LCD and RCD rules; they cannot be combined.`,
            }));
            continue;
          }
          const chain = escalationChain(all, rent);
          chain.forEach((r) => {
            if (!r.rowNumber || !r.effective_date || !rent.led) return;
            const tooLate = r.rule_type === 'RCD' ? r.effective_date >= rent.led : r.effective_date > rent.led;
            if (tooLate) errors.push({ rowNumber: r.rowNumber, field: 'Escalation Month', value: r.escalation_months, error: `Escalates on ${formatDMY(r.effective_date)}, which is ${r.rule_type === 'RCD' ? 'not before' : 'after'} the LED (${formatDMY(rent.led)}).` });
          });

          // No generated Rent Schedule in the months a change affects
          const newDates = Object.fromEntries(chain.map((r) => [r.rule_id, r.effective_date]));
          for (const c of candidates) {
            const i = items.find((x) => x.rowNumber === c.rowNumber);
            if (i.unchanged || errors.some((e) => e.rowNumber === i.rowNumber)) continue;
            const block = await changeBlock('rule', i.before, i.rec, { rent, newEffective: newDates[c.rule_id] });
            if (block) errors.push({ rowNumber: i.rowNumber, field: 'Rent Schedule', value: rent.rent_code, error: block });
          }
        }
        return errors;
      },
      saveRow: async (row, db, by, rowNumber) => {
        const { rec, before, unchanged } = resolved.get(rowNumber);
        if (unchanged) return 'Unchanged';
        const saved = before ? await ruleModel.update(before.rule_id, rec, by, { uploaded: true }, db) : await ruleModel.create(rec, by, { uploaded: true }, db);
        await refreshChain(saved.rent_id, db);
        if (before && before.rent_id !== saved.rent_id) await refreshChain(before.rent_id, db);
        await logAudit({
          tableName: 'rent_rules', recordId: saved.rule_id, action: editOnly ? 'UPDATE' : 'UPLOAD', actionBy: by, oldValues: before, newValues: saved,
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

// GET /api/rent/rules/bulk-edit - the filtered rules in the upload layout, Rule ID filled
async function bulkEditExport(req, res, next) {
  try {
    const { rows } = await ruleModel.getAll(req.query, { pageSize: 0 });
    const data = await withLiveDates(rows);
    const buffer = await editWorkbook({
      sheet: 'Rule Master',
      editable: COLUMNS.map((c) => c.header),
      info: ['SD Code', 'Landlord Name', 'Escalation Date', 'LCD', 'RCD', 'LED', 'Rent Schedule Generated Up To'],
      rows: data.map((r) => [r.rule_id, r.rent_code, r.rule_type, r.escalation_months ?? '', formatDMY(r.from_date), formatDMY(r.to_date),
        Number(r.percentage), r.status, ...appliesToValues(r.component_codes),
        r.sd_code, r.landlord_name, formatDMY(r.effective_date), formatDMY(r.lcd), formatDMY(r.rcd), formatDMY(r.led),
        r.schedule_to_month ? monthLabel(r.schedule_to_month) : 'Not generated']),
      steps: [
        'If the Rent Schedule is already generated for the months you will change, first delete those lines in Rent Schedule (Delete Schedule) for that period.',
        'Change the green columns of the rules you want to edit. Do not add rows here; add new rules with Upload.',
        'Save the file and upload it with "Upload Bulk Edit" on the Rule Master screen. Check the report for any rejected rows.',
        'Regenerate the Rent Schedule for the deleted period.',
      ],
    });
    await sendWorkbook(res, `Rule_Master_Bulk_Edit_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, remove, downloadTemplate, exportAll, bulkUpload, bulkEdit, bulkEditExport };
