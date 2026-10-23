// SD & Rent Transaction Summary Report (read-only)
const express = require('express');
const router = express.Router();
const controller = require('../controllers/sdRentReportController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { cacheResponse } = require('../utils/cache');

const cached = cacheResponse(['rent_schedule_lines', 'rent_master', 'rent_agreements', 'rent_agreement_components', 'sd_master', 'sd_transactions', 'cost_centers']);

router.use(authenticateToken, requireRight(SCREENS.SD_RENT_REPORT, 'view'));

router.get('/', cached, controller.getLines);
router.get('/summary', cached, controller.getSummary);
router.get('/options', cached, controller.getOptions);
router.get('/export', controller.exportReport);

module.exports = router;
