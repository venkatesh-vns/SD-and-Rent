// SD Dashboard (read-only). Filters as query parameters; multi-select values comma-separated.
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');

router.use(authenticateToken, requireRight(SCREENS.SD_DASHBOARD, 'view'));

router.get('/', dashboardController.getDashboard);
router.get('/options', dashboardController.getOptions);
router.get('/export', dashboardController.exportDashboard);

module.exports = router;
