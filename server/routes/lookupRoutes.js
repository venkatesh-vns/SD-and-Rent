// Reference lists for dropdowns on other screens (e.g. SD Master picks a
// cost center and locations). Any logged-in user may read these: they carry
// only codes, names and status, and the owning master screens stay protected.
const express = require('express');
const router = express.Router();
const costCenterModel = require('../models/costCenterModel');
const locationModel = require('../models/locationModel');
const { authenticateToken } = require('../middleware/authMiddleware');
const { httpError } = require('../utils/httpError');

router.use(authenticateToken);

// GET /api/lookups/cost-centers
router.get('/cost-centers', async (req, res, next) => {
  try {
    const rows = await costCenterModel.getAll();
    res.json({
      success: true,
      data: rows.map((r) => ({ id: r.cost_center_id, code: r.cost_center_code, name: r.cost_center_name, status: r.status })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/lookups/locations/:level?parentId=   (parent = Level 1 for level 2, Level 2 for level 3)
router.get('/locations/:level', async (req, res, next) => {
  try {
    const level = Number(req.params.level);
    if (![1, 2, 3].includes(level)) throw httpError(404, 'Location level must be 1, 2 or 3.');
    const { parentId } = req.query;
    if (level > 1 && !parentId) return res.json({ success: true, data: [] });
    const rows = await locationModel.getAll(level, level === 2 ? { l1Id: parentId } : level === 3 ? { l2Id: parentId } : {});
    res.json({
      success: true,
      data: rows.map((r) => ({ id: r[`l${level}_id`], code: r[`l${level}_code`], name: r[`l${level}_name`], status: r.status })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
