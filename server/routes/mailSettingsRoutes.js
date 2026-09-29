// Mail server (SMTP) and sender settings - administrators only, because
// they hold the credentials used to send mail on the company's behalf.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/mailSettingsController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/rightsMiddleware');

router.use(authenticateToken, requireAdmin);

router.get('/', controller.get);
router.put('/', controller.save);
router.post('/test', controller.test);

module.exports = router;
