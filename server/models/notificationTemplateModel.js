const { pool } = require('../config/db');
const { TYPES, defaultRow } = require('../services/notificationTemplates');

const COLUMNS = ['is_enabled', 'to_recipients', 'cc_recipients', 'days_before', 'subject', 'body', 'include_details'];

// Creates any template rows that do not exist yet from the defaults
async function ensureDefaults(db = pool) {
  for (const type of TYPES) {
    const d = defaultRow(type);
    await db.query(
      `INSERT INTO notification_templates (notification_type, ${COLUMNS.join(', ')}, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'System')
       ON CONFLICT (notification_type) DO NOTHING`,
      [type, ...COLUMNS.map((c) => d[c])]
    );
  }
}

async function getAll() {
  await ensureDefaults();
  const result = await pool.query('SELECT * FROM notification_templates');
  // Screen order follows the definitions
  return TYPES.map((t) => result.rows.find((r) => r.notification_type === t)).filter(Boolean);
}

async function get(type, db = pool) {
  let result = await db.query('SELECT * FROM notification_templates WHERE notification_type = $1', [type]);
  if (!result.rows[0]) {
    await ensureDefaults(db);
    result = await db.query('SELECT * FROM notification_templates WHERE notification_type = $1', [type]);
  }
  return result.rows[0];
}

async function update(type, data, modifiedBy, db = pool) {
  const sets = COLUMNS.map((c, i) => `${c} = $${i + 1}`);
  const values = COLUMNS.map((c) => data[c]);
  values.push(modifiedBy, type);
  const result = await db.query(
    `UPDATE notification_templates SET ${sets.join(', ')}, modified_by = $${values.length - 1}, modified_date = NOW()
     WHERE notification_type = $${values.length}
     RETURNING *`,
    values
  );
  return result.rows[0];
}

module.exports = { COLUMNS, ensureDefaults, getAll, get, update };
