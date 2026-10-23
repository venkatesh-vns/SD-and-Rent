// Reference lists for dropdowns on other screens (e.g. SD Master picks a
// cost center and locations). Any logged-in user may read these: they carry
// only codes, names and status, and the owning master screens stay protected.
const express = require('express');
const router = express.Router();
const costCenterModel = require('../models/costCenterModel');
const locationModel = require('../models/locationModel');
const { pool } = require('../config/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const { httpError } = require('../utils/httpError');
const { cacheResponse } = require('../utils/cache');

router.use(authenticateToken);

// GET /api/lookups/filter-combos?source=sd|rent|all
// Every Cost Center + Landlord Name + Floor combination, so screens can narrow the
// Landlord list by Cost Center and the Floor list by Cost Center and Landlord.
//   sd   - SD Master landlords (blank = "(Not given)")
//   rent - Rent Master landlords (with their SD's cost center and floor)
//   all  - both
router.get('/filter-combos', cacheResponse(['sd_master', 'rent_master']), async (req, res, next) => {
  try {
    const source = ['sd', 'rent', 'all'].includes(req.query.source) ? req.query.source : 'sd';
    const parts = [];
    if (source !== 'rent') {
      parts.push(`SELECT s.cost_center_id, COALESCE(NULLIF(TRIM(s.landlord_name), ''), '(Not given)') AS landlord_name, s.floor FROM sd_master s`);
    }
    if (source !== 'sd') {
      parts.push('SELECT s.cost_center_id, r.landlord_name, s.floor FROM rent_master r JOIN sd_master s ON s.sd_id = r.sd_id');
    }
    const rows = (await pool.query(`SELECT DISTINCT * FROM (${parts.join(' UNION ')}) c ORDER BY landlord_name, floor`)).rows;
    res.json({ success: true, data: rows.map((r) => ({ costCenterId: r.cost_center_id, landlord: r.landlord_name, floor: r.floor })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/lookups/cost-centers
router.get('/cost-centers', cacheResponse(['cost_centers']), async (req, res, next) => {
  try {
    const rows = (await costCenterModel.getAll()).sort((a, b) => a.cost_center_name.localeCompare(b.cost_center_name));
    res.json({
      success: true,
      data: rows.map((r) => ({ id: r.cost_center_id, code: r.cost_center_code, name: r.cost_center_name, status: r.status })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/lookups/fys - financial years used by SD transactions, newest first
router.get('/fys', cacheResponse(['sd_transactions']), async (req, res, next) => {
  try {
    const rows = (await pool.query('SELECT DISTINCT fy FROM sd_transactions WHERE fy IS NOT NULL ORDER BY fy DESC')).rows;
    res.json({ success: true, data: rows.map((r) => r.fy) });
  } catch (err) {
    next(err);
  }
});

// GET /api/lookups/locations/:level?parentId=   (parent = Level 1 for level 2, Level 2 for level 3;
// several parents may be given as a comma-separated list)
router.get('/locations/:level', cacheResponse(['location_l1', 'location_l2', 'location_l3']), async (req, res, next) => {
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
