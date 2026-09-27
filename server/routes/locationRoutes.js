const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

const can = (action) => requireRight(SCREENS.LOCATION, action);

router.use(authenticateToken); // all Location Master routes require a valid login

// :level is 1, 2 or 3
router.get('/:level', can('view'), locationController.getAll);
router.get('/:level/export', can('view'), locationController.exportLevel);
router.get('/:level/template', can('upload'), locationController.downloadTemplate);
router.post('/:level', can('add'), locationController.create);
router.put('/:level/:id', can('edit'), locationController.update);
router.delete('/:level/:id', can('delete'), locationController.remove);
router.post('/:level/bulk-upload', can('upload'), upload.single('file'), locationController.bulkUpload);

module.exports = router;
