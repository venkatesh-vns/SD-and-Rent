const express = require('express');
const router = express.Router();
const userRightsController = require('../controllers/userRightsController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');

const can = (action) => requireRight(SCREENS.USER_RIGHTS, action);

router.use(authenticateToken);

router.get('/users', can('view'), userRightsController.getUsers);
router.get('/screens', can('view'), userRightsController.getScreens);
router.get('/:userId', can('view'), userRightsController.getUserRights);
router.put('/:userId', can('edit'), userRightsController.saveUserRights);

module.exports = router;
