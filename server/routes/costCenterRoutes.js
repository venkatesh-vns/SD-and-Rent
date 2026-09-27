const express = require('express');
const router = express.Router();
const costCenterController = require('../controllers/costCenterController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

const can = (action) => requireRight(SCREENS.COST_CENTER, action);

router.use(authenticateToken); // all Cost Center Master routes require a valid login

router.get('/', can('view'), costCenterController.getAllCostCenters);
router.get('/export', can('view'), costCenterController.exportCostCenters);
router.get('/template', can('upload'), costCenterController.downloadTemplate);
router.post('/', can('add'), costCenterController.createCostCenter);
router.put('/:id', can('edit'), costCenterController.updateCostCenter);
router.delete('/:id', can('delete'), costCenterController.deleteCostCenter);
router.post('/bulk-upload', can('upload'), upload.single('file'), costCenterController.bulkUploadCostCenters);

module.exports = router;
