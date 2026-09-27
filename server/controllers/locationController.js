const { withTransaction } = require('../config/db');
const locationModel = require('../models/locationModel');
const { logAudit } = require('../utils/audit');
const { STATUSES } = require('../utils/validators');
const { httpError } = require('../utils/httpError');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');

const { LEVELS } = locationModel;

// Excel columns per level (templates, upload, export)
const TEMPLATE_COLUMNS = {
  1: [{ header: 'Level 1 Name', required: true }, { header: 'Status', required: false }],
  2: [
    { header: 'Level 1 Name', required: true },
    { header: 'Level 2 Name', required: true },
    { header: 'Status', required: false },
  ],
  3: [
    { header: 'Level 1 Name', required: true },
    { header: 'Level 2 Name', required: true },
    { header: 'Level 3 Name', required: true },
    { header: 'Status', required: false },
  ],
};

function levelOf(req) {
  const level = Number(req.params.level);
  if (![1, 2, 3].includes(level)) throw httpError(404, 'Location level must be 1, 2 or 3.');
  return level;
}

const toId = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * Validates a manual add/edit and resolves its parents.
 * `before` is the record being edited (null on add). A parent must be
 * Active unless the record already had that parent.
 * Returns { name, status, l1Id, l2Id } or throws a 400/409 httpError.
 */
async function validateInput(level, body, before = null) {
  const name = String(body.name || '').trim();
  const status = body.status || (before ? before.status : 'Active');
  if (!name) throw httpError(400, `Level ${level} Name is required.`);
  if (name.length > 150) throw httpError(400, `Level ${level} Name must be 150 characters or fewer.`);
  if (!STATUSES.includes(status)) throw httpError(400, 'Status must be Active or Inactive.');

  let l1Id = null;
  let l2Id = null;

  if (level >= 2) {
    l1Id = toId(body.l1Id);
    if (!l1Id) throw httpError(400, 'Level 1 is required.');
    const l1 = await locationModel.findById(1, l1Id);
    if (!l1) throw httpError(400, 'Selected Level 1 does not exist.');
    if (l1.status !== 'Active' && l1Id !== before?.l1_id) throw httpError(400, `Level 1 '${l1.l1_name}' is Inactive.`);
  }

  if (level === 3) {
    l2Id = toId(body.l2Id);
    if (!l2Id) throw httpError(400, 'Level 2 is required.');
    const l2 = await locationModel.findById(2, l2Id);
    if (!l2) throw httpError(400, 'Selected Level 2 does not exist.');
    if (l2.l1_id !== l1Id) throw httpError(400, `Level 2 '${l2.l2_name}' does not belong to the selected Level 1.`);
    if (l2.status !== 'Active' && l2Id !== before?.l2_id) throw httpError(400, `Level 2 '${l2.l2_name}' is Inactive.`);
  }

  const parentId = level === 2 ? l1Id : l2Id;
  const duplicate = await locationModel.findByName(level, name, parentId, before ? before[LEVELS[level].id] : null);
  if (duplicate) {
    const scope = level === 1 ? '' : level === 2 ? ' under this Level 1' : ' under this Level 2';
    throw httpError(409, `Level ${level} Name '${name}' already exists${scope}.`);
  }

  return { name, status, l1Id, l2Id };
}

// GET /api/locations/:level?search=&status=&l1Id=&l2Id=
async function getAll(req, res, next) {
  try {
    res.json({ success: true, data: await locationModel.getAll(levelOf(req), req.query) });
  } catch (err) {
    next(err);
  }
}

// POST /api/locations/:level
async function create(req, res, next) {
  try {
    const level = levelOf(req);
    const data = await validateInput(level, req.body);
    const created = await withTransaction(async (db) => {
      const row = await locationModel.create(level, data, req.user.userName, {}, db);
      await logAudit({
        tableName: LEVELS[level].table, recordId: row[LEVELS[level].id], action: 'INSERT',
        actionBy: req.user.userName, newValues: row,
      }, db);
      return row;
    });
    res.status(201).json({
      success: true,
      message: `Level ${level} ${created[LEVELS[level].code]} created successfully.`,
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/locations/:level/:id
async function update(req, res, next) {
  try {
    const level = levelOf(req);
    const before = await locationModel.findById(level, req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Location not found.' });

    const data = await validateInput(level, req.body, before);
    const updated = await withTransaction(async (db) => {
      const after = await locationModel.update(level, req.params.id, data, req.user.userName, db);
      await logAudit({
        tableName: LEVELS[level].table, recordId: after[LEVELS[level].id],
        action: before.status !== after.status ? 'STATUS_CHANGE' : 'UPDATE',
        actionBy: req.user.userName, oldValues: before, newValues: after,
      }, db);
      return after;
    });
    res.json({ success: true, message: `Level ${level} ${updated[LEVELS[level].code]} updated successfully.`, data: updated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/locations/:level/:id  - only when nothing uses it
async function remove(req, res, next) {
  try {
    const level = levelOf(req);
    const before = await locationModel.findById(level, req.params.id);
    if (!before) return res.status(404).json({ success: false, message: 'Location not found.' });

    const children = await locationModel.countChildren(level, req.params.id);
    if (children > 0) {
      return res.status(409).json({
        success: false,
        message: `${before[LEVELS[level].name]} has ${children} Level ${level + 1} record(s) under it and cannot be deleted. Mark it Inactive instead.`,
      });
    }

    await withTransaction(async (db) => {
      await locationModel.remove(level, req.params.id, db);
      await logAudit({
        tableName: LEVELS[level].table, recordId: before[LEVELS[level].id], action: 'DELETE',
        actionBy: req.user.userName, oldValues: before,
      }, db);
    });
    res.json({ success: true, message: `Level ${level} ${before[LEVELS[level].code]} deleted successfully.` });
  } catch (err) {
    next(err);
  }
}

// GET /api/locations/:level/template
async function downloadTemplate(req, res, next) {
  try {
    const level = levelOf(req);
    await sendWorkbook(res, `Location_Level${level}_Template.xlsx`, buildWorkbook(`Level ${level}`, TEMPLATE_COLUMNS[level].map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

// GET /api/locations/:level/export
async function exportLevel(req, res, next) {
  try {
    const level = levelOf(req);
    const rows = await locationModel.getAll(level, req.query);
    const parentHeaders = [];
    if (level >= 2) parentHeaders.push('Level 1 Code', 'Level 1 Name');
    if (level === 3) parentHeaders.push('Level 2 Code', 'Level 2 Name');
    const buffer = buildWorkbook(
      `Level ${level}`,
      [...parentHeaders, `Level ${level} Code`, `Level ${level} Name`, 'Status', 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      rows.map((r) => {
        const parents = [];
        if (level >= 2) parents.push(r.l1_code, r.l1_name);
        if (level === 3) parents.push(r.l2_code, r.l2_name);
        const def = LEVELS[level];
        return [...parents, r[def.code], r[def.name], r.status, r.created_by, r.created_date, r.modified_by, r.modified_date];
      })
    );
    await sendWorkbook(res, `Location_Level${level}_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// POST /api/locations/:level/bulk-upload
// Parents are matched by name and must be Active.
async function bulkUpload(req, res, next) {
  try {
    const level = levelOf(req);
    const nameCol = `Level ${level} Name`;
    // Parent records resolved during validation, reused when saving
    const resolved = new Map();

    const result = await processUpload(req, {
      screenCode: SCREENS.LOCATION,
      columns: TEMPLATE_COLUMNS[level],
      keyOf: (row) => [row['Level 1 Name'], level === 3 ? row['Level 2 Name'] : null, level > 1 ? row[nameCol] : null]
        .filter(Boolean).join(' > ') || row[nameCol],
      validateRow: async (row, { seen, rowNumber }) => {
        const errors = [];
        const name = row[nameCol];
        const status = row['Status'] || 'Active';
        let l1 = null;
        let l2 = null;

        if (level >= 2) {
          const l1Name = row['Level 1 Name'];
          if (!l1Name) errors.push({ field: 'Level 1 Name', value: l1Name, error: 'Level 1 Name is required.' });
          else {
            l1 = await locationModel.findByName(1, l1Name);
            if (!l1) errors.push({ field: 'Level 1 Name', value: l1Name, error: 'Level 1 not found.' });
            else if (l1.status !== 'Active') errors.push({ field: 'Level 1 Name', value: l1Name, error: 'Level 1 is Inactive.' });
          }
        }
        if (level === 3 && l1) {
          const l2Name = row['Level 2 Name'];
          if (!l2Name) errors.push({ field: 'Level 2 Name', value: l2Name, error: 'Level 2 Name is required.' });
          else {
            l2 = await locationModel.findByName(2, l2Name, l1.l1_id);
            if (!l2) errors.push({ field: 'Level 2 Name', value: l2Name, error: `Level 2 not found under Level 1 '${l1.l1_name}'.` });
            else if (l2.status !== 'Active') errors.push({ field: 'Level 2 Name', value: l2Name, error: 'Level 2 is Inactive.' });
          }
        }

        if (!name) errors.push({ field: nameCol, value: name, error: `${nameCol} is required.` });
        else if (name.length > 150) errors.push({ field: nameCol, value: name, error: 'Must be 150 characters or fewer.' });
        if (!STATUSES.includes(status)) errors.push({ field: 'Status', value: status, error: 'Status must be Active or Inactive.' });

        const parentOk = level === 1 || (level === 2 ? l1 : l2);
        if (name && parentOk) {
          const parentId = level === 2 ? l1.l1_id : level === 3 ? l2.l2_id : null;
          const key = `${parentId}:${name.toLowerCase()}`;
          if (seen.has(key)) {
            errors.push({ field: nameCol, value: name, error: `Duplicate of row ${seen.get(key)} in this file.` });
          } else {
            seen.set(key, rowNumber);
            if (await locationModel.findByName(level, name, parentId)) {
              errors.push({ field: nameCol, value: name, error: `${nameCol} already exists${level > 1 ? ' under this parent' : ''}.` });
            }
          }
        }

        if (errors.length === 0) resolved.set(rowNumber, { l1Id: l1?.l1_id, l2Id: l2?.l2_id });
        return errors;
      },
      saveRow: async (row, db, uploadedBy, rowNumber) => {
        const parents = resolved.get(rowNumber);
        const created = await locationModel.create(
          level,
          { name: row[nameCol], status: row['Status'] || 'Active', ...parents },
          uploadedBy,
          { uploaded: true },
          db
        );
        await logAudit({
          tableName: LEVELS[level].table, recordId: created[LEVELS[level].id], action: 'UPLOAD',
          actionBy: uploadedBy, newValues: created,
        }, db);
      },
    });

    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} failed.`, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, create, update, remove, downloadTemplate, exportLevel, bulkUpload };
