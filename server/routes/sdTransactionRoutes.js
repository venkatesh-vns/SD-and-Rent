const express = require('express');
const router = express.Router();
const txnController = require('../controllers/sdTransactionController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

const can = (action) => requireRight(SCREENS.SD_TRANSACTION, action);

router.use(authenticateToken); // all SD Transaction routes require a valid login

router.get('/', can('view'), txnController.getAll);
router.get('/export', can('view'), txnController.exportAll);
router.get('/template', can('upload'), txnController.downloadTemplate);
router.get('/sd-search', can('view'), txnController.searchSd);
router.get('/summary/:sdId', can('view'), txnController.getSummary);
router.get('/:id', can('view'), txnController.getOne);
router.post('/', can('add'), txnController.create);
router.put('/:id', can('edit'), txnController.update);
router.delete('/:id', can('delete'), txnController.remove);
router.post('/bulk-upload', can('upload'), upload.single('file'), txnController.bulkUpload);

module.exports = router;
