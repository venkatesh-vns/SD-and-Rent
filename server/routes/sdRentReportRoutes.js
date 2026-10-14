// SD & Rent Transaction Summary Report (read-only)
const express = require('express');
const router = express.Router();
const controller = require('../controllers/sdRentReportController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');

router.use(authenticateToken, requireRight(SCREENS.SD_RENT_REPORT, 'view'));

router.get('/', controller.getLines);
router.get('/summary', controller.getSummary);
router.get('/options', controller.getOptions);
router.get('/export', controller.exportReport);

module.exports = router;
