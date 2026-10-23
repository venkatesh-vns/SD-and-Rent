// SD Dashboard (read-only). Filters as query parameters; multi-select values comma-separated.
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { cacheResponse } = require('../utils/cache');

// Cached until SD data changes (see utils/cache.js)
const cached = cacheResponse(['sd_master', 'sd_transactions', 'sd_status_history', 'cost_centers', 'location_l1', 'location_l2', 'location_l3', 'email_log']);

router.use(authenticateToken, requireRight(SCREENS.SD_DASHBOARD, 'view'));

router.get('/', cached, dashboardController.getDashboard);
router.get('/options', cached, dashboardController.getOptions);
router.get('/export', dashboardController.exportDashboard);

module.exports = router;
