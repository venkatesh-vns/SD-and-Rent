// Log files of the desktop app (app.log, postgres.log): rotated at start-up so they
// do not grow without limit. A file over maxBytes is renamed <name>-YYYYMMDD-HHMMSS.log;
// rotated files older than keepMonths (LOG_RETENTION_MONTHS, default 5) are deleted.
const fs = require('fs');
const path = require('path');

function rotateLog(file, { maxBytes = 10 * 1024 * 1024, keepMonths = Number(process.env.LOG_RETENTION_MONTHS) || 5 } = {}) {
  const dir = path.dirname(file);
  const base = path.basename(file, '.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
      const s = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
      fs.renameSync(file, path.join(dir, `${base}-${s}.log`));
    }
    const cutoff = Date.now() - keepMonths * 31 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!new RegExp(`^${base}-\\d{8}-\\d{6}\\.log$`).test(f)) continue;
      const full = path.join(dir, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
  } catch { /* a log file problem must never stop the app */ }
}

module.exports = { rotateLog };
