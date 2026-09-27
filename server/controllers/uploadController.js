const { findBatch } = require('../utils/bulkUpload');
const userRightsModel = require('../models/userRightsModel');
const { buildWorkbook, sendWorkbook } = require('../utils/excel');

// GET /api/uploads/:batchId/report  - the validation report as Excel.
// Needs Upload permission on the screen the batch belongs to.
async function downloadReport(req, res, next) {
  try {
    const batch = await findBatch(req.params.batchId);
    if (!batch) return res.status(404).json({ success: false, message: 'Upload not found.' });

    const allowed = req.user.isAdmin
      || (await userRightsModel.hasRight(req.user.userId, batch.screen_code, 'upload'));
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'You do not have upload permission for this screen.' });
    }

    const buffer = buildWorkbook(
      'Validation Report',
      ['Row', 'Key', 'Field', 'Uploaded Value', 'Status', 'Error'],
      batch.report.map((r) => [r.row, r.key, r.field, r.value, r.status, r.error])
    );
    await sendWorkbook(res, `UploadReport_${batch.batch_id}.xlsx`, buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = { downloadReport };
