const { pool } = require('../config/db');
const { listOf } = require('../utils/filters');

// Columns safe to return to the client (never password_hash / token_version)
const PUBLIC_COLUMNS = `user_id, user_name, user_email, status, is_admin, created_date, modified_date,
  created_by, modified_by, uploaded_by, uploaded_date, locked_until`;

// Find a user by their username (used at login)
async function findByUserName(userName) {
  const result = await pool.query('SELECT * FROM users WHERE user_name = $1', [userName]);
  return result.rows[0];
}

async function findByEmail(email) {
  const result = await pool.query('SELECT * FROM users WHERE LOWER(user_email) = LOWER($1)', [email]);
  return result.rows[0];
}

async function findById(userId, db = pool) {
  const result = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return result.rows[0];
}

// Optional filters: search (name or email, partial match), status (one or more)
async function getAll({ search, status } = {}) {
  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(user_name ILIKE $${params.length} OR user_email ILIKE $${params.length})`);
  }
  if (listOf(status).length) {
    params.push(listOf(status));
    where.push(`status = ANY($${params.length})`);
  }
  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY user_id DESC`,
    params
  );
  return result.rows;
}

async function create({ userName, userEmail, passwordHash, status, createdBy, uploaded = false }, db = pool) {
  const result = await db.query(
    `INSERT INTO users (user_name, user_email, password_hash, status, created_by, uploaded_by, uploaded_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${PUBLIC_COLUMNS}`,
    [
      userName, userEmail, passwordHash, status || 'Active', createdBy || 'System',
      uploaded ? createdBy : null, uploaded ? new Date() : null,
    ]
  );
  return result.rows[0];
}

async function update(userId, { userName, userEmail, status, modifiedBy }, db = pool) {
  const result = await db.query(
    `UPDATE users SET user_name=$1, user_email=$2, status=$3, modified_by=$4, modified_date=NOW()
     WHERE user_id=$5
     RETURNING ${PUBLIC_COLUMNS}`,
    [userName, userEmail, status, modifiedBy || 'System', userId]
  );
  return result.rows[0];
}

// Sets a new password and ends every existing session of the user.
// Returns the new token_version.
async function updatePassword(userId, passwordHash, modifiedBy, db = pool) {
  const result = await db.query(
    `UPDATE users SET password_hash=$1, token_version=token_version + 1, failed_logins=0, locked_until=NULL,
       modified_by=$2, modified_date=NOW()
     WHERE user_id=$3
     RETURNING token_version`,
    [passwordHash, modifiedBy || 'System', userId]
  );
  return result.rows[0]?.token_version;
}

// Ends every existing session of the user (logout)
async function bumpTokenVersion(userId, db = pool) {
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE user_id=$1', [userId]);
}

// True when the user has added, changed, deleted or uploaded any record,
// SD transactions included. Such users are kept (made Inactive) so their
// history stays traceable.
async function hasActivity(userName) {
  const result = await pool.query(
    `SELECT 1 FROM audit_log
     WHERE action_by = $1
       AND action IN ('INSERT', 'UPDATE', 'DELETE', 'UPLOAD', 'STATUS_CHANGE', 'RIGHTS_CHANGE')
     LIMIT 1`,
    [userName]
  );
  return result.rows.length > 0;
}

async function remove(userId, db = pool) {
  await db.query('DELETE FROM users WHERE user_id=$1', [userId]);
}

// Case-insensitive duplicate check on name or email
async function existsByNameOrEmail(userName, userEmail, excludeUserId = null) {
  let query = 'SELECT user_id, user_name, user_email FROM users WHERE (LOWER(user_name)=LOWER($1) OR LOWER(user_email)=LOWER($2))';
  const params = [userName, userEmail];
  if (excludeUserId) {
    query += ' AND user_id <> $3';
    params.push(excludeUserId);
  }
  const result = await pool.query(query, params);
  return result.rows;
}

module.exports = {
  findByUserName,
  findByEmail,
  findById,
  getAll,
  create,
  update,
  updatePassword,
  bumpTokenVersion,
  hasActivity,
  remove,
  existsByNameOrEmail,
};
