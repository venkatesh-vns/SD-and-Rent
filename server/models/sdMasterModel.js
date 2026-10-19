const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');

// Editable columns, in the order create/update write them
const FIELDS = [
  'lease_id', 'agreement_no', 'cost_center_id', 'l1_id', 'l2_id', 'l3_id',
  'landlord_name', 'landlord_status', 'building_status', 'floor', 'agreement_value',
  'lease_commencement_date', 'rent_commencement_date', 'lease_end_date',
];

const SELECT = `
  SELECT s.*,
         cc.cost_center_code, cc.cost_center_name, cc.status AS cost_center_status,
         l1.l1_code, l1.l1_name, l2.l2_code, l2.l2_name, l3.l3_code, l3.l3_name,
         l1.status AS l1_status, l2.status AS l2_status, l3.status AS l3_status
  FROM sd_master s
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
  JOIN location_l1 l1 ON l1.l1_id = s.l1_id
  JOIN location_l2 l2 ON l2.l2_id = s.l2_id
  JOIN location_l3 l3 ON l3.l3_id = s.l3_id`;

// The list also shows each record's balances (from v_sd_balance)
const LIST_SELECT = SELECT.replace(
  'FROM sd_master s',
  `, b.total_paid, b.sd_balance, b.sd_balance_repayable, b.txn_count
  FROM sd_master s
  JOIN v_sd_balance b ON b.sd_id = s.sd_id`
);

// Builds the WHERE clause shared by the list and the export. The id and
// status filters accept one or more values (a record matches any of them).
function filterClause({ search, costCenterId, l1Id, l2Id, l3Id, landlordStatus, buildingStatus, leaseEndFrom, leaseEndTo, landlordName, floor }) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(s.sd_code ILIKE ${p} OR s.lease_id ILIKE ${p} OR s.agreement_no ILIKE ${p}
                 OR s.landlord_name ILIKE ${p} OR s.floor ILIKE ${p})`);
  }
  const ids = (col, v) => { if (idsOf(v).length) add(`${col} = ANY(?::int[])`, idsOf(v)); };
  const any = (col, v) => { if (listOf(v).length) add(`${col} = ANY(?)`, listOf(v)); };
  ids('s.cost_center_id', costCenterId);
  ids('s.l1_id', l1Id);
  ids('s.l2_id', l2Id);
  ids('s.l3_id', l3Id);
  // Landlord Name (blank = "(Not given)") and Floor, one or more each
  any("COALESCE(NULLIF(TRIM(s.landlord_name), ''), '(Not given)')", landlordName);
  any('s.floor', floor);
  any('s.landlord_status', landlordStatus);
  any('s.building_status', buildingStatus);
  if (leaseEndFrom) add('s.lease_end_date >= ?', leaseEndFrom);
  if (leaseEndTo) add('s.lease_end_date <= ?', leaseEndTo);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// Paged list: returns { rows, total }. pageSize 0 = no limit (export).
async function getAll(filters = {}, { page = 1, pageSize = 50 } = {}) {
  const { sql, params } = filterClause(filters);
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM sd_master s ${sql}`, params)).rows[0].n;
  let paging = '';
  if (pageSize > 0) {
    params.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const rows = (await pool.query(`${LIST_SELECT} ${sql} ORDER BY s.sd_id DESC ${paging}`, params)).rows;
  return { rows, total };
}

async function findById(sdId, db = pool) {
  const result = await db.query(`${SELECT} WHERE s.sd_id = $1`, [sdId]);
  return result.rows[0];
}

async function findByCode(sdCode, db = pool) {
  const result = await db.query(`${SELECT} WHERE UPPER(s.sd_code) = UPPER($1)`, [sdCode]);
  return result.rows[0];
}

// Another record with the same Lease ID + Agreement No. + Floor, if any
async function findByBusinessKey({ lease_id, agreement_no, floor }, excludeId = null) {
  if (!lease_id && !agreement_no) return null;
  const params = [lease_id || '', agreement_no || '', floor];
  let query = `SELECT sd_id, sd_code FROM sd_master
               WHERE LOWER(COALESCE(lease_id, '')) = LOWER($1)
                 AND LOWER(COALESCE(agreement_no, '')) = LOWER($2)
                 AND LOWER(floor) = LOWER($3)
                 AND (lease_id IS NOT NULL OR agreement_no IS NOT NULL)`;
  if (excludeId) {
    params.push(excludeId);
    query += ` AND sd_id <> $4`;
  }
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

// data uses the column names in FIELDS; the SD Code is generated
async function create(data, createdBy, { uploaded = false } = {}, db = pool) {
  const columns = [...FIELDS, 'created_by', 'uploaded_by', 'uploaded_date'];
  const values = [...FIELDS.map((f) => data[f] ?? null), createdBy, uploaded ? createdBy : null, uploaded ? new Date() : null];
  const result = await db.query(
    `INSERT INTO sd_master (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING sd_id`,
    values
  );
  return findById(result.rows[0].sd_id, db);
}

async function update(sdId, data, modifiedBy, { uploaded = false } = {}, db = pool) {
  const sets = FIELDS.map((f, i) => `${f} = $${i + 1}`);
  const values = FIELDS.map((f) => data[f] ?? null);
  values.push(modifiedBy);
  sets.push(`modified_by = $${values.length}`, 'modified_date = NOW()');
  if (uploaded) {
    sets.push(`uploaded_by = $${values.length}`, 'uploaded_date = NOW()');
  }
  values.push(sdId);
  await db.query(`UPDATE sd_master SET ${sets.join(', ')} WHERE sd_id = $${values.length}`, values);
  return findById(sdId, db);
}

async function remove(sdId, db = pool) {
  await db.query('DELETE FROM sd_master WHERE sd_id = $1', [sdId]);
}

async function addStatusHistory(sdId, statusType, oldStatus, newStatus, changedBy, db = pool) {
  await db.query(
    `INSERT INTO sd_status_history (sd_id, status_type, old_status, new_status, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [sdId, statusType, oldStatus, newStatus, changedBy]
  );
}

async function getStatusHistory(sdId) {
  const result = await pool.query(
    'SELECT * FROM sd_status_history WHERE sd_id = $1 ORDER BY changed_date DESC, history_id DESC',
    [sdId]
  );
  return result.rows;
}

module.exports = {
  FIELDS, filterClause, getAll, findById, findByCode, findByBusinessKey, create, update, remove,
  addStatusHistory, getStatusHistory,
};
