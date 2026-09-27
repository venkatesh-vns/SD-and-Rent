const { withTransaction } = require('../config/db');
const costCenterModel = require('../models/costCenterModel');
const { logAudit } = require('../utils/audit');
const { STATUSES } = require('../utils/validators');
const { processUpload } = require('../utils/bulkUpload');
const { buildWorkbook, sendWorkbook, dateStamp } = require('../utils/excel');
const { SCREENS } = require('../middleware/rightsMiddleware');

const TEMPLATE_COLUMNS = [
  { header: 'Cost Center Name', required: true },
  { header: 'Status', required: false },
];

// Returns an error message for name/status, or null when valid
function validate({ name, status }) {
  if (!name || !String(name).trim()) return 'Cost Center Name is required.';
  if (String(name).trim().length > 150) return 'Cost Center Name must be 150 characters or fewer.';
  if (status && !STATUSES.includes(status)) return 'Status must be Active or Inactive.';
  return null;
}

// GET /api/cost-centers?search=&status=
async function getAllCostCenters(req, res, next) {
  try {
    const data = await costCenterModel.getAll(req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// POST /api/cost-centers  (code is auto-generated)
async function createCostCenter(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    const status = req.body.status || 'Active';

    const error = validate({ name, status });
    if (error) return res.status(400).json({ success: false, message: error });

    if (await costCenterModel.existsByName(name)) {
      return res.status(409).json({ success: false, message: 'Cost Center Name already exists.' });
    }

    const created = await withTransaction(async (db) => {
      const row = await costCenterModel.create({ name, status, createdBy: req.user.userName }, db);
      await logAudit({
        tableName: 'cost_centers', recordId: row.cost_center_id, action: 'INSERT',
        actionBy: req.user.userName, newValues: row,
      }, db);
      return row;
    });

    res.status(201).json({
      success: true,
      message: `Cost Center ${created.cost_center_code} created successfully.`,
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/cost-centers/:id  (name and status only)
async function updateCostCenter(req, res, next) {
  try {
    const { id } = req.params;
    const name = String(req.body.name || '').trim();
    const { status } = req.body;

    const error = validate({ name, status }) || (!status ? 'Status is required.' : null);
    if (error) return res.status(400).json({ success: false, message: error });

    if (await costCenterModel.existsByName(name, id)) {
      return res.status(409).json({ success: false, message: 'Cost Center Name already used by another record.' });
    }

    const updated = await withTransaction(async (db) => {
      const before = await costCenterModel.findById(id, db);
      if (!before) return null;
      const after = await costCenterModel.update(id, { name, status, modifiedBy: req.user.userName }, db);
      await logAudit({
        tableName: 'cost_centers', recordId: after.cost_center_id,
        action: before.status !== after.status ? 'STATUS_CHANGE' : 'UPDATE',
        actionBy: req.user.userName, oldValues: before, newValues: after,
      }, db);
      return after;
    });
    if (!updated) return res.status(404).json({ success: false, message: 'Cost Center not found.' });

    res.json({ success: true, message: 'Cost Center updated successfully.', data: updated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/cost-centers/:id
async function deleteCostCenter(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await withTransaction(async (db) => {
      const before = await costCenterModel.findById(id, db);
      if (!before) return false;
      await costCenterModel.remove(id, db);
      await logAudit({
        tableName: 'cost_centers', recordId: before.cost_center_id, action: 'DELETE',
        actionBy: req.user.userName, oldValues: before,
      }, db);
      return true;
    });
    if (!deleted) return res.status(404).json({ success: false, message: 'Cost Center not found.' });

    res.json({ success: true, message: 'Cost Center deleted successfully.' });
  } catch (err) {
    next(err);
  }
}

// GET /api/cost-centers/template
async function downloadTemplate(req, res, next) {
  try {
    await sendWorkbook(res, 'CostCenter_Template.xlsx', buildWorkbook('Cost Centers', TEMPLATE_COLUMNS.map((c) => c.header)));
  } catch (err) {
    next(err);
  }
}

// GET /api/cost-centers/export?search=&status=
async function exportCostCenters(req, res, next) {
  try {
    const rows = await costCenterModel.getAll(req.query);
    const buffer = buildWorkbook(
      'Cost Centers',
      ['Cost Center Code', 'Cost Center Name', 'Status', 'Created By', 'Created Date', 'Modified By', 'Modified Date'],
      rows.map((r) => [
        r.cost_center_code, r.cost_center_name, r.status,
        r.created_by, r.created_date, r.modified_by, r.modified_date,
      ])
    );
    await sendWorkbook(res, `CostCenters_${dateStamp()}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

// POST /api/cost-centers/bulk-upload
async function bulkUploadCostCenters(req, res, next) {
  try {
    const result = await processUpload(req, {
      screenCode: SCREENS.COST_CENTER,
      columns: TEMPLATE_COLUMNS,
      keyOf: (row) => row['Cost Center Name'],
      validateRow: async (row, { seen, rowNumber }) => {
        const name = row['Cost Center Name'];
        const status = row['Status'] || 'Active';
        const errors = [];
        if (!name) {
          errors.push({ field: 'Cost Center Name', value: name, error: 'Cost Center Name is required.' });
        } else if (name.length > 150) {
          errors.push({ field: 'Cost Center Name', value: name, error: 'Must be 150 characters or fewer.' });
        } else if (seen.has(name.toLowerCase())) {
          errors.push({ field: 'Cost Center Name', value: name, error: `Duplicate of row ${seen.get(name.toLowerCase())} in this file.` });
        } else if (await costCenterModel.existsByName(name)) {
          errors.push({ field: 'Cost Center Name', value: name, error: 'Cost Center Name already exists.' });
        }
        if (!STATUSES.includes(status)) {
          errors.push({ field: 'Status', value: status, error: 'Status must be Active or Inactive.' });
        }
        if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), rowNumber);
        return errors;
      },
      saveRow: async (row, db, uploadedBy) => {
        const created = await costCenterModel.create(
          { name: row['Cost Center Name'], status: row['Status'] || 'Active', createdBy: uploadedBy, uploaded: true },
          db
        );
        await logAudit({
          tableName: 'cost_centers', recordId: created.cost_center_id, action: 'UPLOAD',
          actionBy: uploadedBy, newValues: created,
        }, db);
      },
    });

    res.json({ success: true, message: `Upload processed: ${result.passed} saved, ${result.failed} failed.`, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllCostCenters, createCostCenter, updateCostCenter, deleteCostCenter,
  downloadTemplate, exportCostCenters, bulkUploadCostCenters,
};
