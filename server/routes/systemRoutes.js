// System Health (administrators): application workers, database, sessions,
// backups and logs; Back up now
const fs = require('fs');
const path = require('path');
const express = require('express');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/rightsMiddleware');
const metrics = require('../utils/metrics');
const systemModel = require('../models/systemModel');
const sessionModel = require('../models/sessionModel');
const backup = require('../services/backupService');
const retention = require('../services/logRetention');
const { workerCount } = require('../cluster');

const router = express.Router();
router.use(authenticateToken, requireAdmin);

// GET /api/system/health
router.get('/health', async (req, res, next) => {
  try {
    const [app, database, sessions, backups, logRetention] = await Promise.all([
      metrics.allWorkers(), systemModel.databaseHealth(), sessionModel.listOpen(), backup.status(), retention.status(),
    ]);
    res.json({
      success: true,
      data: {
        at: new Date().toISOString(), host: metrics.host(), configuredWorkers: workerCount(),
        app, database, sessions: { open: sessions.length, responding: sessions.filter((s) => s.responding).length }, backups, logRetention,
        logDir: metrics.logDir(), slowRequestMs: Number(process.env.SLOW_REQUEST_MS) || 2000,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/system/backup  - Back up now
router.post('/backup', async (req, res, next) => {
  try {
    const run = await backup.runBackup({ reason: 'Manual', by: req.user.userName });
    if (!run.ok) return res.status(500).json({ success: false, message: `Backup failed: ${run.message}`, data: run });
    res.json({ success: true, message: `Backup saved and verified: ${path.basename(run.file_path)} (${(run.size_bytes / 1048576).toFixed(1)} MB).`, data: run });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/system/log-retention  - run the log clean-up now
router.post('/log-retention', async (req, res, next) => {
  try {
    const run = await retention.runRetention({ by: req.user.userName });
    const removed = run.details.tables.reduce((n, t) => n + t.deleted, 0);
    if (!run.ok) return res.status(500).json({ success: false, message: `Log clean-up finished with errors: ${run.details.error}`, data: run });
    res.json({ success: true, message: removed ? `${removed} log entries older than ${run.details.months} months archived and removed.` : `No log entries older than ${run.details.months} months.`, data: run });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ success: false, message: err.message });
    next(err);
  }
});

// GET /api/system/logs?kind=slow-requests|errors  - the latest 100 entries of this month
router.get('/logs', (req, res) => {
  const kind = req.query.kind === 'errors' ? 'errors' : 'slow-requests';
  const file = path.join(metrics.logDir(), `${kind}-${new Date().toISOString().slice(0, 7)}.log`);
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-100).reverse().map((l) => JSON.parse(l)); } catch { /* none yet */ }
  res.json({ success: true, data: lines });
});

module.exports = router;
