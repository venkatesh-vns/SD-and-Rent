const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// Rights are checked in the controller against the batch's own screen
router.get('/:batchId/report', uploadController.downloadReport);

module.exports = router;
