const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

const can = (action) => requireRight(SCREENS.USER, action);

router.use(authenticateToken); // all User Master routes require a valid login

router.get('/', can('view'), userController.getAllUsers);
router.get('/export', can('view'), userController.exportUsers);
router.get('/template', can('upload'), userController.downloadTemplate);
router.post('/', can('add'), userController.createUser);
router.put('/:id', can('edit'), userController.updateUser);
router.put('/:id/password', can('edit'), userController.resetUserPassword);
router.delete('/:id', can('delete'), userController.deleteUser);
router.post('/bulk-upload', can('upload'), upload.single('file'), userController.bulkUploadUsers);

module.exports = router;
