const { pool } = require('../config/db');

const ACTION_COLUMNS = {
  view: 'can_view',
  add: 'can_add',
  edit: 'can_edit',
  delete: 'can_delete',
  upload: 'can_upload',
};

function toRight(row) {
  return {
    screenCode: row.screen_code,
    screenName: row.screen_name,
    menuGroup: row.menu_group,
    canView: row.can_view,
    canAdd: row.can_add,
    canEdit: row.can_edit,
    canDelete: row.can_delete,
    canUpload: row.can_upload,
  };
}

async function getScreens() {
  const result = await pool.query('SELECT * FROM screens ORDER BY sort_order');
  return result.rows;
}

// Every screen with this user's flags (all false where no row exists).
// Admin users get every flag.
async function getForUser(userId, isAdmin = false) {
  const result = await pool.query(
    `SELECT s.screen_code, s.screen_name, s.menu_group,
            COALESCE(r.can_view, FALSE)   AS can_view,
            COALESCE(r.can_add, FALSE)    AS can_add,
            COALESCE(r.can_edit, FALSE)   AS can_edit,
            COALESCE(r.can_delete, FALSE) AS can_delete,
            COALESCE(r.can_upload, FALSE) AS can_upload
     FROM screens s
     LEFT JOIN user_rights r ON r.screen_code = s.screen_code AND r.user_id = $1
     ORDER BY s.sort_order`,
    [userId]
  );
  return result.rows.map((row) =>
    isAdmin
      ? { ...toRight(row), canView: true, canAdd: true, canEdit: true, canDelete: true, canUpload: true }
      : toRight(row)
  );
}

async function hasRight(userId, screenCode, action) {
  const column = ACTION_COLUMNS[action];
  if (!column) throw new Error(`Unknown right '${action}'.`);
  const result = await pool.query(
    `SELECT ${column} AS allowed FROM user_rights WHERE user_id=$1 AND screen_code=$2`,
    [userId, screenCode]
  );
  return Boolean(result.rows[0]?.allowed);
}

async function findRow(userId, screenCode, db = pool) {
  const result = await db.query(
    'SELECT * FROM user_rights WHERE user_id=$1 AND screen_code=$2',
    [userId, screenCode]
  );
  return result.rows[0];
}

async function upsert(userId, right, actionBy, db = pool) {
  const result = await db.query(
    `INSERT INTO user_rights (user_id, screen_code, can_view, can_add, can_edit, can_delete, can_upload, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, screen_code) DO UPDATE SET
       can_view=EXCLUDED.can_view, can_add=EXCLUDED.can_add, can_edit=EXCLUDED.can_edit,
       can_delete=EXCLUDED.can_delete, can_upload=EXCLUDED.can_upload,
       modified_by=$8, modified_date=NOW()
     RETURNING *`,
    [userId, right.screenCode, right.canView, right.canAdd, right.canEdit, right.canDelete, right.canUpload, actionBy]
  );
  return result.rows[0];
}

module.exports = { ACTION_COLUMNS, getScreens, getForUser, hasRight, findRow, upsert };
