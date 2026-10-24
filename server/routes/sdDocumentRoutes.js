// SD Master documents (PDF / Word) - see services/sdDocumentService.js
// Rights follow SD Master: view = list / view / download, add or edit = upload and
// new versions, delete = delete.
const express = require('express');
const multer = require('multer');
const service = require('../services/sdDocumentService');
const sessionModel = require('../models/sessionModel');
const userModel = require('../models/userModel');
const userRightsModel = require('../models/userRightsModel');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');

const router = express.Router();
const can = (action) => requireRight(SCREENS.SD_MASTER, action);
const canAny = (...actions) => async (req, res, next) => {
  try {
    if (req.user.isAdmin) return next();
    for (const a of actions) if (await userRightsModel.hasRight(req.user.userId, SCREENS.SD_MASTER, a)) return next();
    res.status(403).json({ success: false, message: `You do not have ${actions.join(' or ')} permission for SD Master.` });
  } catch (err) {
    next(err);
  }
};
// Held in memory (checked before anything is written), one file per request
const oneFile = (req, res, next) => {
  req.uploadLimitMb = service.maxMb();
  multer({ storage: multer.memoryStorage(), limits: { fileSize: service.maxMb() * 1024 * 1024, files: 1 } }).single('file')(req, res, next);
};
const handle = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

function sendFile(res, { doc, file }, disposition) {
  const name = service.downloadName(doc);
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `${disposition}; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  // the browser's own PDF viewer must not be held back by the app pages' Content-Security-Policy
  if (disposition === 'inline') res.removeHeader('Content-Security-Policy');
  res.sendFile(file);
}

// GET /api/sd-documents/view/:token  - opens a PDF in a new tab (signed link, no login header)
router.get('/view/:token', handle(async (req, res) => {
  const t = service.readViewToken(req.params.token);
  const refuse = (msg) => res.status(403).type('text').send(`${msg} Go back to the application and choose View again.`);
  if (!t) return refuse('This document link has expired.');
  const session = await sessionModel.find(t.s);
  if (!session || session.ended_at || session.idle || session.user_id !== t.u) return refuse('Your login session has ended.');
  const user = await userModel.findById(t.u);
  if (!user || user.status !== 'Active') return refuse('Your login session has ended.');
  if (!user.is_admin && !(await userRightsModel.hasRight(user.user_id, SCREENS.SD_MASTER, 'view'))) return refuse('You do not have view permission for SD Master.');
  sendFile(res, await service.open({ documentId: t.d, by: user.user_name, action: 'DOC_VIEW' }), 'inline');
}));

router.use(authenticateToken);

// GET /api/sd-documents/types
router.get('/types', can('view'), (req, res) => res.json({ success: true, data: { types: service.DOCUMENT_TYPES, maxMb: service.maxMb() } }));

// GET /api/sd-documents?sdId=  - latest version of each document
router.get('/', can('view'), handle(async (req, res) => {
  res.json({ success: true, data: await service.list(Number(req.query.sdId) || 0) });
}));

// GET /api/sd-documents/:id/versions
router.get('/:id/versions', can('view'), handle(async (req, res) => {
  res.json({ success: true, data: await service.versions(req.params.id) });
}));

// POST /api/sd-documents  (multipart: sdId, documentType, title, remarks, file)
router.post('/', canAny('add', 'edit'), oneFile, handle(async (req, res) => {
  const doc = await service.upload({ ...req.body, sdId: Number(req.body.sdId) || 0, file: req.file, by: req.user.userName });
  res.status(201).json({ success: true, message: `${doc.title} uploaded.`, data: doc });
}));

// POST /api/sd-documents/:id/versions  (multipart: remarks, file)
router.post('/:id/versions', canAny('add', 'edit'), oneFile, handle(async (req, res) => {
  const doc = await service.addVersion({ documentId: req.params.id, remarks: req.body.remarks, file: req.file, by: req.user.userName });
  res.status(201).json({ success: true, message: `${doc.title}: version ${doc.version_no} uploaded.`, data: doc });
}));

// POST /api/sd-documents/:id/view-link  - signed link valid for 2 minutes
router.post('/:id/view-link', can('view'), handle(async (req, res) => {
  const token = service.viewToken({ documentId: req.params.id, userId: req.user.userId, sessionId: req.user.sessionId });
  res.json({ success: true, data: { url: `/api/sd-documents/view/${token}` } });
}));

// GET /api/sd-documents/:id/download
router.get('/:id/download', can('view'), handle(async (req, res) => {
  sendFile(res, await service.open({ documentId: req.params.id, by: req.user.userName, action: 'DOC_DOWNLOAD' }), 'attachment');
}));

// DELETE /api/sd-documents/:id  (body: reason)
router.delete('/:id', can('delete'), handle(async (req, res) => {
  const doc = await service.remove({ documentId: req.params.id, reason: req.body?.reason, by: req.user.userName });
  res.json({ success: true, message: `${doc.title} deleted.` });
}));

module.exports = router;
