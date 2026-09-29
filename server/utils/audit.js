const { pool } = require('../config/db');

// Columns that must never be copied into the audit trail
const HIDDEN_FIELDS = ['password_hash', 'token_version', 'smtp_password_enc'];

function clean(values) {
  if (!values) return null;
  const copy = { ...values };
  HIDDEN_FIELDS.forEach((f) => delete copy[f]);
  return JSON.stringify(copy);
}

/**
 * Writes one audit_log row. Pass the transaction client as `db` so the
 * audit row commits or rolls back with the change it describes.
 * action: INSERT | UPDATE | DELETE | UPLOAD | STATUS_CHANGE | LOGIN | LOGOUT
 *         | PASSWORD_CHANGE | PASSWORD_RESET | RIGHTS_CHANGE
 */
async function logAudit(
  { tableName, recordId, action, actionBy, oldValues = null, newValues = null, details = null },
  db = pool
) {
  await db.query(
    `INSERT INTO audit_log (table_name, record_id, action, action_by, old_values, new_values, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tableName, recordId, action, actionBy || 'System', clean(oldValues), clean(newValues), details]
  );
}

module.exports = { logAudit };
