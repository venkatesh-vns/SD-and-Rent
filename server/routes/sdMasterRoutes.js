const express = require('express');
const router = express.Router();
const sdMasterController = require('../controllers/sdMasterController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

const can = (action) => requireRight(SCREENS.SD_MASTER, action);

router.use(authenticateToken); // all SD Master routes require a valid login

router.get('/', can('view'), sdMasterController.getAll);
router.get('/export', can('view'), sdMasterController.exportAll);
router.get('/template', can('upload'), sdMasterController.downloadTemplate);
router.get('/:id', can('view'), sdMasterController.getOne);
router.post('/', can('add'), sdMasterController.create);
router.put('/:id', can('edit'), sdMasterController.update);
router.delete('/:id', can('delete'), sdMasterController.remove);
router.post('/bulk-upload', can('upload'), upload.single('file'), sdMasterController.bulkUpload);

module.exports = router;
