const ExcelJS = require('exceljs');
const { findBatch } = require('../utils/bulkUpload');
const userRightsModel = require('../models/userRightsModel');
const { buildWorkbook, sendWorkbook } = require('../utils/excel');

// Rent Transaction uploads report each row as Success / Rejected with a Remark,
// highlighted green / red (scope document 7.1)
async function rentReport(batch) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Upload Result', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(['Row', 'Key', 'Status', 'Field', 'Uploaded Value', 'Remark']).font = { bold: true };
  // One line per row: Success, or Rejected with every reason
  const byRow = new Map();
  batch.report.forEach((r) => {
    const cur = byRow.get(r.row) || { row: r.row, key: r.key, status: r.status, fields: [], values: [], remarks: [] };
    if (r.status === 'Failed') {
      cur.status = 'Failed';
      cur.fields.push(r.field);
      cur.values.push(r.value);
      cur.remarks.push(r.error);
    }
    byRow.set(r.row, cur);
  });
  [...byRow.values()].sort((a, b) => a.row - b.row).forEach((r) => {
    const ok = r.status !== 'Failed';
    const line = ws.addRow([r.row, r.key, ok ? 'Success' : 'Rejected', r.fields.join('; '), r.values.join('; '), ok ? 'Uploaded' : r.remarks.join(' ')]);
    line.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ok ? 'FFE7F6EC' : 'FFFDE8E8' } }; });
  });
  ws.columns = [{ width: 8 }, { width: 28 }, { width: 12 }, { width: 28 }, { width: 28 }, { width: 80 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

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

    const buffer = batch.screen_code.startsWith('RENT_')
      ? await rentReport(batch)
      : buildWorkbook(
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
