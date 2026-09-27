const { pool } = require('../config/db');

const AMOUNT_FIELDS = ['paid_amount', 'transfer_amount', 'adjustment_amount', 'refund_amount'];

// Editable columns, in the order create/update write them
const FIELDS = ['sd_id', 'sd_type', 'fy', 'txn_date', 'agreement_status', ...AMOUNT_FIELDS, 'remarks'];

const SELECT = `
  SELECT l.*,
         s.lease_id, s.agreement_no, s.landlord_name, s.floor,
         cc.cost_center_code, l1.l1_name, l2.l2_name, l3.l3_name
  FROM v_sd_ledger l
  JOIN sd_master s ON s.sd_id = l.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
  JOIN location_l1 l1 ON l1.l1_id = s.l1_id
  JOIN location_l2 l2 ON l2.l2_id = s.l2_id
  JOIN location_l3 l3 ON l3.l3_id = s.l3_id`;

// Filters: sdId, search (Txn No, SD Code, Remarks), sdType, fy,
// agreementStatus, costCenterId, dateFrom/dateTo ('YYYY-MM-DD')
function filterClause(f) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.sdId) add('l.sd_id = ?', f.sdId);
  if (f.search) {
    params.push(`%${f.search}%`);
    const p = `$${params.length}`;
    where.push(`(l.txn_no ILIKE ${p} OR l.sd_code ILIKE ${p} OR l.remarks ILIKE ${p})`);
  }
  if (f.sdType) add('l.sd_type = ?', f.sdType);
  if (f.fy) add('l.fy = ?', f.fy);
  if (f.agreementStatus) add('l.agreement_status = ?', f.agreementStatus);
  if (f.costCenterId) add('s.cost_center_id = ?', f.costCenterId);
  if (f.dateFrom) add('l.txn_date >= ?', f.dateFrom);
  if (f.dateTo) add('l.txn_date <= ?', f.dateTo);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// Paged list with running balances: { rows, total }. pageSize 0 = all.
// One SD Code reads oldest first (a ledger); across SD Codes, newest first.
async function getAll(filters = {}, { page = 1, pageSize = 50 } = {}) {
  const { sql, params } = filterClause(filters);
  const total = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM v_sd_ledger l JOIN sd_master s ON s.sd_id = l.sd_id ${sql}`, params
  )).rows[0].n;
  const order = filters.sdId ? 'l.txn_date, l.txn_id' : 'l.txn_date DESC, l.txn_id DESC';
  let paging = '';
  if (pageSize > 0) {
    params.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const rows = (await pool.query(`${SELECT} ${sql} ORDER BY ${order} ${paging}`, params)).rows;
  return { rows, total };
}

async function findById(txnId, db = pool) {
  const result = await db.query(`${SELECT} WHERE l.txn_id = $1`, [txnId]);
  return result.rows[0];
}

async function findByNo(txnNo, db = pool) {
  const result = await db.query(`${SELECT} WHERE UPPER(l.txn_no) = UPPER($1)`, [txnNo]);
  return result.rows[0];
}

// All transactions of one SD Code (amounts as numbers) for ledger checks
async function getLedger(sdId, db = pool) {
  const result = await db.query(
    `SELECT txn_id, txn_no, txn_date, ${AMOUNT_FIELDS.join(', ')}
     FROM sd_transactions WHERE sd_id = $1 ORDER BY txn_date, txn_id`,
    [sdId]
  );
  return result.rows.map((r) => ({ ...r, ...Object.fromEntries(AMOUNT_FIELDS.map((f) => [f, Number(r[f])])) }));
}

async function getBalance(sdId, db = pool) {
  const result = await db.query('SELECT * FROM v_sd_balance WHERE sd_id = $1', [sdId]);
  return result.rows[0];
}

async function create(data, createdBy, { uploaded = false } = {}, db = pool) {
  const columns = [...FIELDS, 'created_by', 'uploaded_by', 'uploaded_date'];
  const values = [...FIELDS.map((f) => data[f] ?? null), createdBy, uploaded ? createdBy : null, uploaded ? new Date() : null];
  const result = await db.query(
    `INSERT INTO sd_transactions (${columns.join(', ')})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING txn_id`,
    values
  );
  return findById(result.rows[0].txn_id, db);
}

async function update(txnId, data, modifiedBy, { uploaded = false } = {}, db = pool) {
  const sets = FIELDS.map((f, i) => `${f} = $${i + 1}`);
  const values = FIELDS.map((f) => data[f] ?? null);
  values.push(modifiedBy);
  sets.push(`modified_by = $${values.length}`, 'modified_date = NOW()');
  if (uploaded) sets.push(`uploaded_by = $${values.length}`, 'uploaded_date = NOW()');
  values.push(txnId);
  await db.query(`UPDATE sd_transactions SET ${sets.join(', ')} WHERE txn_id = $${values.length}`, values);
  return findById(txnId, db);
}

async function remove(txnId, db = pool) {
  await db.query('DELETE FROM sd_transactions WHERE txn_id = $1', [txnId]);
}

// Locks an SD Code's master row so concurrent saves check the ledger in turn
async function lockSd(sdId, db) {
  const result = await db.query(
    'SELECT sd_id, sd_code, agreement_value FROM sd_master WHERE sd_id = $1 FOR UPDATE',
    [sdId]
  );
  return result.rows[0];
}

// SD Codes matching a search, for the transaction screen's picker
async function searchSd(q, limit = 20) {
  const result = await pool.query(
    `SELECT s.sd_id, s.sd_code, s.lease_id, s.agreement_no, s.landlord_name, s.floor,
            s.landlord_status, s.building_status, cc.cost_center_code
     FROM sd_master s JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
     WHERE s.sd_code ILIKE $1 OR s.lease_id ILIKE $1 OR s.agreement_no ILIKE $1 OR s.landlord_name ILIKE $1
     ORDER BY s.sd_code LIMIT $2`,
    [`%${q || ''}%`, limit]
  );
  return result.rows;
}

module.exports = {
  AMOUNT_FIELDS, FIELDS, getAll, findById, findByNo, getLedger, getBalance,
  create, update, remove, lockSd, searchSd,
};
