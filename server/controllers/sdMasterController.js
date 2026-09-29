const { withTransaction } = require('../config/db');
const sdMasterModel = require('../models/sdMasterModel');
const costCenterModel = require('../models/costCenterModel');
const locationModel = require('../models/locationModel');
const service = require('../services/sdMasterService');
const { notifyStatusChanges } = require('../services/notificationService');
const { logAudit } = require('../utils/audit');
const { parseDMY, formatDMY } = require('../utils/dates');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');

const { FIELDS } = sdMasterModel;
const { LABELS, blank, text, parseAmount } = service;

// Excel columns. SD Code blank = new record; filled = bulk update of that record
// (blank cells then keep the stored value).
const TEMPLATE_COLUMNS = [
  { header: 'SD Code', required: false },
  { header: 'Lease ID', required: false },
  { header: 'Agreement No.', required: false },
  { header: 'Cost Center', required: true },
  { header: 'Location Level 1', required: true },
  { header: 'Location Level 2', required: true },
  { header: 'Location Level 3', required: true },
  { header: 'Landlord Name', required: false },
  { header: 'Landlord Status', required: true },
  { header: 'Building Status', required: true },
  { header: 'Floor', required: true },
  { header: 'Agreement Value', required: true },
  { header: 'Lease Commencement Date', required: false },
  { header: 'Rent Commencement Date', required: false },
  { header: 'Lease End Date', required: false },
];

// Keeps only the editable columns of a stored record
function pickFields(record) {
  const rec = {};
  FIELDS.forEach((f) => { rec[f] = record[f]; });
  rec.agreement_value = Number(record.agreement_value);
  return rec;
}

function badRequest(res, errors) {
  return res.status(400).json({ success: false, message: errors.map((e) => e.error).join(' '), errors });
}

// Saves status history rows for Landlord / Building Status changes
async function recordStatusChanges(before, after, changedBy, db) {
  const changes = service.statusChanges(before, after);
  for (const c of changes) {
    await sdMasterModel.addStatusHistory(after.sd_id, c.statusType, c.oldStatus, c.newStatus, changedBy, db);
  }
  return changes;
}

// Query filters with the DD/MM/YYYY lease-end range turned into dates
function listFilters(query) {
  return { ...query, leaseEndFrom: parseDMY(query.leaseEndFrom) || null, leaseEndTo: parseDMY(query.leaseEndTo) || null };
}

// GET /api/sd-master?page=&pageSize=&search=&costCenterId=&l1Id=&l2Id=&l3Id=&landlordStatus=&buildingStatus=
async function getAll(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);
    const { rows, total } = await sdMasterModel.getAll(listFilters(req.query), { page, pageSize });
    res.json({ success: true, data: rows, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

// GET /api/sd-master/:id  - record + status history
async function getOne(req, res, next) {
  try {
    const record = await sdMasterModel.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'SD record not found.' });
    res.json({ success: true, data: { ...record, statusHistory: await sdMasterModel.getStatusHistory(record.sd_id) } });
  } catch (err) {
    next(err);
  }
}

// POST /api/sd-master
async function create(req, res, next) {
  try {
    const { rec, raw } = service.fromBody(req.body);
    const errors = await service.validateRecord(rec, raw);
    if (errors.length) return badRequest(res, errors);

    const created = await withTransaction(async (db) => {
      const row = await sdMasterModel.create(rec, req.user.userName, {}, db);
      await logAudit({ tableName: 'sd_master', recordId: row.sd_id, action: 'INSERT', actionBy: req.user.userName, newValues: row }, db);
      return row;
    });
    res.status(201).json({ success: true, message: `${created.sd_code} created successfully.`, data: created });
  } catch (err) {
    next(err);
  }
}

// PUT /api/sd-master/:id
async function update(req, res, next) {
  try {
    const before = await sdMasterModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'SD record not found.' });

    const { rec, raw } = service.fromBody(req.body);
    const errors = await service.validateRecord(rec, raw, before);
    if (errors.length) return badRequest(res, errors);

    const { after: updated, changes } = await withTransaction(async (db) => {
      const after = await sdMasterModel.update(before.sd_id, rec, req.user.userName, {}, db);
      const changes = await recordStatusChanges(before, after, req.user.userName, db);
      await logAudit({
        tableName: 'sd_master', recordId: after.sd_id,
        action: changes.length ? 'STATUS_CHANGE' : 'UPDATE',
        actionBy: req.user.userName, oldValues: before, newValues: after,
        details: changes.map((c) => `${c.statusType} Status ${c.oldStatus} -> ${c.newStatus}`).join('; ') || null,
      }, db);
      return { after, changes };
    });
    // Emails go out only once the change is committed
    await notifyStatusChanges(updated, changes, req.user.userName);
    res.json({ success: true, message: `${updated.sd_code} updated successfully.`, data: updated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/sd-master/:id
async function remove(req, res, next) {
  try {
    const before = await sdMasterModel.findById(req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'SD record not found.' });
    await withTransaction(async (db) => {
      await sdMasterModel.remove(before.sd_id, db);
      await logAudit({ tableName: 'sd_master', recordId: before.sd_id, action: 'DELETE', actionBy: req.user.userName, oldValues: before }, db);
    });
    res.json({ success: true, message: `${before.sd_code} deleted successfully.` });
  } catch (err) {
    next(err);
  }
}

// GET /api/sd-master/template
async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'SD_Master_Template.xlsx', buildWorkbook('SD Master', TEMPLATE_COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

// Values in template column order, so an export can be edited and uploaded back
function toExcelRow(r) {
  return [
    r.sd_code, r.lease_id, r.agreement_no, r.cost_center_name, r.l1_name, r.l2_name, r.l3_name,
    r.landlord_name, r.landlord_status, r.building_status, r.floor, Number(r.agreement_value),
    formatDMY(r.lease_commencement_date), formatDMY(r.rent_commencement_date), formatDMY(r.lease_end_date),
  ];
}

// GET /api/sd-master/export  (same filters as the list, all pages)
async function exportAll(req, res, next) {
  try {
    const { rows } = await sdMasterModel.getAll(listFilters(req.query), { pageSize: 0 });
    const buffer = buildWorkbook(
      'SD Master',
      [...TEMPLATE_COLUMNS.map((c) => c.header), 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      rows.map((r) => [...toExcelRow(r), r.created_by, r.created_date, r.modified_by, r.modified_date])
    );
    await sendWorkbook(res, `SD_Master_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// Turns one Excel row into { rec, raw, before, errors } ready for validation.
// Cost Center is matched by code or name; locations by code or by name
// within their parent. On an update row, blank cells keep stored values.
async function resolveUploadRow(row) {
  const errors = [];
  const raw = {};
  const sdCode = text(row['SD Code']);
  let before = null;

  if (sdCode) {
    before = await sdMasterModel.findByCode(sdCode);
    if (!before) {
      errors.push({ field: 'SD Code', value: sdCode, error: 'SD Code not found. Leave SD Code blank to create a new record.' });
      return { errors };
    }
  }

  const rec = before ? pickFields(before) : Object.fromEntries(FIELDS.map((f) => [f, null]));
  const cell = (header) => (blank(row[header]) ? null : String(row[header]).trim());

  [['Lease ID', 'lease_id'], ['Agreement No.', 'agreement_no'], ['Landlord Name', 'landlord_name'], ['Floor', 'floor']]
    .forEach(([h, f]) => { if (cell(h) !== null) rec[f] = cell(h); });

  [['Landlord Status', 'landlord_status'], ['Building Status', 'building_status']].forEach(([h, f]) => {
    const v = cell(h);
    if (v !== null) rec[f] = service.SD_STATUSES.find((s) => s.toLowerCase() === v.toLowerCase()) || v;
  });

  const ccValue = cell('Cost Center');
  if (ccValue !== null) {
    const cc = await costCenterModel.findByCodeOrName(ccValue);
    rec.cost_center_id = cc ? cc.cost_center_id : null;
    if (!cc) {
      raw.cost_center_id = ccValue;
      errors.push({ field: LABELS.cost_center_id, value: ccValue, error: 'Cost Center not found.' });
    }
  }

  for (const level of [1, 2, 3]) {
    const f = `l${level}_id`;
    const value = cell(`Location Level ${level}`);
    if (value === null) continue;
    const parentId = level === 1 ? null : rec[`l${level - 1}_id`];
    const loc = await locationModel.findByCodeOrName(level, value, parentId);
    rec[f] = loc ? loc[f] : null;
    if (!loc) {
      raw[f] = value;
      errors.push({
        field: LABELS[f], value,
        error: level === 1 ? 'Location Level 1 not found.' : `Location Level ${level} not found under the given Level ${level - 1}.`,
      });
    }
  }

  const amount = cell('Agreement Value');
  if (amount !== null) {
    rec.agreement_value = parseAmount(amount);
    raw.agreement_value = amount;
  }

  [['Lease Commencement Date', 'lease_commencement_date'], ['Rent Commencement Date', 'rent_commencement_date'], ['Lease End Date', 'lease_end_date']]
    .forEach(([h, f]) => {
      const v = cell(h);
      if (v !== null) {
        rec[f] = parseDMY(v);
        raw[f] = v;
      }
    });

  return { rec, raw, before, errors };
}

// POST /api/sd-master/bulk-upload
async function bulkUpload(req, res, next) {
  try {
    const resolved = new Map();
    const statusNotices = []; // [{ after, changes }] emailed once the upload commits

    const result = await processUpload(req, {
      screenCode: SCREENS.SD_MASTER,
      columns: TEMPLATE_COLUMNS,
      keyOf: (row) => text(row['SD Code']) || (text(row['Lease ID']) ? `New: ${text(row['Lease ID'])}` : '(new)'),
      validateRow: async (row, { seen, rowNumber }) => {
        const { rec, raw, before, errors } = await resolveUploadRow(row);
        if (!rec) return errors;
        errors.push(...(await service.validateRecord(rec, raw, before)));

        // Duplicates within this file
        let repeated = false;
        if (before) {
          const key = `code:${before.sd_code}`;
          repeated = seen.has(key);
          if (repeated) errors.push({ field: 'SD Code', value: before.sd_code, error: `SD Code repeated from row ${seen.get(key)}.` });
          else seen.set(key, rowNumber);
        }
        if (!repeated && rec.floor && (rec.lease_id || rec.agreement_no)) {
          const key = `bk:${[rec.lease_id, rec.agreement_no, rec.floor].map((v) => String(v || '').toLowerCase()).join('|')}`;
          if (seen.has(key)) {
            errors.push({ field: LABELS.lease_id, value: [rec.lease_id, rec.agreement_no, rec.floor].filter(Boolean).join(' / '), error: `Same Lease ID + Agreement No. + Floor as row ${seen.get(key)}.` });
          } else seen.set(key, rowNumber);
        }

        if (errors.length === 0) resolved.set(rowNumber, { rec, before });
        return errors;
      },
      saveRow: async (row, db, uploadedBy, rowNumber) => {
        const { rec, before } = resolved.get(rowNumber);
        if (before) {
          const after = await sdMasterModel.update(before.sd_id, rec, uploadedBy, { uploaded: true }, db);
          const changes = await recordStatusChanges(before, after, uploadedBy, db);
          if (changes.length) statusNotices.push({ after, changes });
          await logAudit({
            tableName: 'sd_master', recordId: after.sd_id, action: 'UPLOAD', actionBy: uploadedBy,
            oldValues: before, newValues: after,
            details: ['Bulk update', ...changes.map((c) => `${c.statusType} Status ${c.oldStatus} -> ${c.newStatus}`)].join('; '),
          }, db);
        } else {
          const created = await sdMasterModel.create(rec, uploadedBy, { uploaded: true }, db);
          await logAudit({ tableName: 'sd_master', recordId: created.sd_id, action: 'UPLOAD', actionBy: uploadedBy, newValues: created }, db);
        }
      },
    });

    for (const n of statusNotices) await notifyStatusChanges(n.after, n.changes, req.user.userName);
    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} failed.`, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, remove, downloadTemplate, exportAll, bulkUpload };
