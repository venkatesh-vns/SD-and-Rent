// SD Document Upload (bulk) - see services/sdDocumentBatchService.js
// Rights: SD Document Upload view = see batches, upload = template upload;
// bulk delete = administrators only.
const express = require('express');
const multer = require('multer');
const service = require('../services/sdDocumentBatchService');
const docs = require('../services/sdDocumentService');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, requireAdmin, SCREENS } = require('../middleware/rightsMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const { parseDMY } = require('../utils/dates');
const { sendWorkbook } = require('../utils/excel');

const router = express.Router();
const can = (action) => requireRight(SCREENS.SD_DOCUMENT_UPLOAD, action);
const handle = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };
const oneDocument = (req, res, next) => {
  req.uploadLimitMb = docs.maxMb();
  multer({ storage: multer.memoryStorage(), limits: { fileSize: docs.maxMb() * 1024 * 1024, files: 1 } }).single('file')(req, res, next);
};
const criteria = (body) => ({ batchId: Number(body.batchId) || null, date: body.date ? parseDMY(body.date) || body.date : null });

router.use(authenticateToken);

// GET /api/sd-document-batches/template
router.get('/template', can('view'), handle(async (req, res) => {
  await sendWorkbook(res, 'SD_Document_Upload_Template.xlsx', await service.template());
}));

// GET /api/sd-document-batches/settings
router.get('/settings', can('view'), (req, res) => {
  res.json({ success: true, data: { types: docs.DOCUMENT_TYPES, maxMb: docs.maxMb(), serverFolders: service.importRoots() } });
});

// GET /api/sd-document-batches?page=&date=DD/MM/YYYY
router.get('/', can('view'), handle(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 200);
  const { rows, total } = await service.list({ page, pageSize, date: parseDMY(req.query.date) || null });
  res.json({ success: true, data: rows, total, page, pageSize });
}));

// GET /api/sd-document-batches/:id  - batch with a status per row
router.get('/:id(\\d+)', can('view'), handle(async (req, res) => {
  res.json({ success: true, data: await service.getBatch(req.params.id) });
}));

// POST /api/sd-document-batches  (multipart: file = filled template)
router.post('/', can('upload'), upload.single('file'), handle(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose the filled template (.xlsx).' });
  const batch = await service.createBatch({ templatePath: req.file.path, templateName: req.file.originalname, by: req.user.userName });
  res.status(201).json({ success: true, data: batch });
}));

// POST /api/sd-document-batches/:id/rows/:rowNo/file  (multipart: file = the row's document)
router.post('/:id(\\d+)/rows/:rowNo(\\d+)/file', can('upload'), oneDocument, handle(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file sent.' });
  const row = await service.processRow({ batchId: Number(req.params.id), rowNo: Number(req.params.rowNo), file: req.file, by: req.user.userName });
  res.json({ success: true, data: row });
}));

// POST /api/sd-document-batches/:id/complete  { notFound: [{ rowNo, message }] }
router.post('/:id(\\d+)/complete', can('upload'), handle(async (req, res) => {
  const notFound = Array.isArray(req.body?.notFound) ? req.body.notFound : [];
  await service.complete({ batchId: Number(req.params.id), notFound, by: req.user.userName });
  res.json({ success: true, data: await service.getBatch(req.params.id) });
}));

// POST /api/sd-document-batches/bulk-delete/preview  { batchId | date }  (administrators)
router.post('/bulk-delete/preview', requireAdmin, handle(async (req, res) => {
  res.json({ success: true, data: await service.previewDelete(criteria(req.body || {})) });
}));

// POST /api/sd-document-batches/bulk-delete  { batchId | date, reason }  (administrators)
router.post('/bulk-delete', requireAdmin, handle(async (req, res) => {
  const out = await service.bulkDelete({ ...criteria(req.body || {}), reason: req.body?.reason, by: req.user.userName });
  res.json({
    success: true,
    message: `${out.deleted} document${out.deleted === 1 ? '' : 's'} deleted from ${out.batches.map((b) => b.batch_no).join(', ')}.${out.skipped.length ? ` ${out.skipped.length} skipped (later versions).` : ''}`,
    data: out,
  });
}));

module.exports = router;
