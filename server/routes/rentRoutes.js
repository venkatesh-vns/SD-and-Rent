// Rent Transaction menu: /api/rent/master, /agreements, /rules, /waivers, /schedule, /lookups
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireRight, SCREENS } = require('../middleware/rightsMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const masterController = require('../controllers/rentMasterController');
const agreementController = require('../controllers/rentAgreementController');
const ruleController = require('../controllers/rentRuleController');
const waiverController = require('../controllers/rentWaiverController');
const scheduleController = require('../controllers/rentScheduleController');

router.use(authenticateToken);

router.get('/lookups', scheduleController.lookups);

// Standard master routes: list, export, template, one, add, edit, delete, bulk upload
function crud(path, screen, c) {
  const can = (action) => requireRight(screen, action);
  router.get(`/${path}`, can('view'), c.getAll);
  router.get(`/${path}/export`, can('view'), c.exportAll);
  router.get(`/${path}/template`, can('upload'), c.downloadTemplate);
  router.get(`/${path}/:id(\\d+)`, can('view'), c.getOne);
  router.post(`/${path}`, can('add'), c.create);
  router.put(`/${path}/:id(\\d+)`, can('edit'), c.update);
  router.delete(`/${path}/:id(\\d+)`, can('delete'), c.remove);
  router.post(`/${path}/bulk-upload`, can('upload'), upload.single('file'), c.bulkUpload);
}
crud('master', SCREENS.RENT_MASTER, masterController);
crud('agreements', SCREENS.RENT_AGREEMENT, agreementController);
crud('rules', SCREENS.RENT_RULE, ruleController);
crud('waivers', SCREENS.RENT_WAIVER, waiverController);

const canSchedule = (action) => requireRight(SCREENS.RENT_SCHEDULE, action);
router.get('/schedule', canSchedule('view'), scheduleController.getLines);
router.get('/schedule/summary', canSchedule('view'), scheduleController.getSummary);
router.get('/schedule/export', canSchedule('view'), scheduleController.exportLines);
router.get('/schedule/runs', canSchedule('view'), scheduleController.runs);
router.post('/schedule/generate', canSchedule('add'), scheduleController.generate);

module.exports = router;
