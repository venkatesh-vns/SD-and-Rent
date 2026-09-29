const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificationTemplateController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');

const can = (action) => requireRight(SCREENS.NOTIFICATION, action);

router.use(authenticateToken); // all Email Notification Master routes require a valid login

router.get('/', can('view'), controller.list);
router.post('/:type/preview', can('view'), controller.preview);
router.put('/:type', can('edit'), controller.update);
router.post('/:type/reset', can('edit'), controller.reset);

module.exports = router;
