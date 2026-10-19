// Reports, logs and notification runs
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, requireAdmin, SCREENS } = require('../middleware/rightsMiddleware');

// Mounted at /api, so authentication is attached per route rather than with
// router.use (which would also catch /api/health and unknown /api paths).
const auth = authenticateToken;

router.get('/reports/sd-balance', auth, requireRight(SCREENS.SD_REPORT, 'view'), reportController.sdBalance);
router.get('/reports/sd-balance/options', auth, requireRight(SCREENS.SD_REPORT, 'view'), reportController.sdBalanceOptions);
router.get('/reports/sd-balance/export', auth, requireRight(SCREENS.SD_REPORT, 'view'), reportController.sdBalanceExport);

router.get('/logs/email', auth, requireRight(SCREENS.EMAIL_LOG, 'view'), reportController.emailLog);
router.get('/logs/email/export', auth, requireRight(SCREENS.EMAIL_LOG, 'view'), reportController.emailLogExport);
router.get('/logs/audit', auth, requireRight(SCREENS.AUDIT_LOG, 'view'), reportController.auditLog);
router.get('/logs/audit/export', auth, requireRight(SCREENS.AUDIT_LOG, 'view'), reportController.auditLogExport);

router.post('/notifications/run-reminders', auth, requireAdmin, reportController.runReminders);

module.exports = router;
