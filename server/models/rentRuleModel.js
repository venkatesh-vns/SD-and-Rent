const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');

const SELECT = `
  SELECT u.*, r.rent_code, r.landlord_name, s.sd_code, s.floor, cc.cost_center_name,
         s.lease_commencement_date AS lcd, s.rent_commencement_date AS rcd, s.lease_end_date AS led
  FROM rent_rules u
  JOIN rent_master r ON r.rent_id = u.rent_id
  JOIN sd_master s ON s.sd_id = r.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id`;

async function getAll(f = {}, { page = 1, pageSize = 50 } = {}) {
  const params = [];
  const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (f.search) {
    const s = p(`%${f.search}%`);
    where.push(`(r.rent_code ILIKE ${s} OR s.sd_code ILIKE ${s} OR r.landlord_name ILIKE ${s})`);
  }
  if (idsOf(f.rentId).length) where.push(`u.rent_id = ANY(${p(idsOf(f.rentId))}::int[])`);
  if (listOf(f.ruleType).length) where.push(`u.rule_type = ANY(${p(listOf(f.ruleType))})`);
  if (listOf(f.status).length) where.push(`u.status = ANY(${p(listOf(f.status))})`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM rent_rules u JOIN rent_master r ON r.rent_id = u.rent_id JOIN sd_master s ON s.sd_id = r.sd_id ${whereSql}`,
    params
  )).rows[0].n;
  let paging = '';
  if (pageSize > 0) {
    params.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const rows = (await pool.query(`${SELECT} ${whereSql} ORDER BY r.rent_code, u.rule_id ${paging}`, params)).rows;
  return { rows, total };
}

async function findById(id, db = pool) {
  return (await db.query(`${SELECT} WHERE u.rule_id = $1`, [id])).rows[0];
}

async function forRent(rentId, db = pool) {
  return (await db.query(`${SELECT} WHERE u.rent_id = $1 ORDER BY u.rule_id`, [rentId])).rows;
}

async function forRents(rentIds, db = pool) {
  if (!rentIds.length) return [];
  return (await db.query(`${SELECT} WHERE u.rent_id = ANY($1::int[]) ORDER BY u.rule_id`, [rentIds])).rows;
}

async function create(rec, by, { uploaded = false } = {}, db = pool) {
  const r = await db.query(
    `INSERT INTO rent_rules (rent_id, rule_type, escalation_months, from_date, to_date, percentage, component_code, status,
                             created_by, uploaded_by, uploaded_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING rule_id`,
    [rec.rent_id, rec.rule_type, rec.escalation_months, rec.from_date, rec.to_date, rec.percentage, rec.component_code, rec.status,
      by, uploaded ? by : null, uploaded ? new Date() : null]
  );
  return findById(r.rows[0].rule_id, db);
}

async function update(id, rec, by, { uploaded = false } = {}, db = pool) {
  await db.query(
    `UPDATE rent_rules SET rent_id = $2, rule_type = $3, escalation_months = $4, from_date = $5, to_date = $6, percentage = $7,
            component_code = $8, status = $9, modified_by = $10, modified_date = NOW(),
            uploaded_by = CASE WHEN $11 THEN $10 ELSE uploaded_by END,
            uploaded_date = CASE WHEN $11 THEN NOW() ELSE uploaded_date END
     WHERE rule_id = $1`,
    [id, rec.rent_id, rec.rule_type, rec.escalation_months, rec.from_date, rec.to_date, rec.percentage, rec.component_code, rec.status, by, uploaded]
  );
  return findById(id, db);
}

// Stores the calculated escalation dates of a Rent Code's LCD / RCD rules
async function saveEffectiveDates(rules, db = pool) {
  for (const r of rules) {
    await db.query('UPDATE rent_rules SET effective_date = $2 WHERE rule_id = $1', [r.rule_id, r.effective_date]);
  }
}

async function remove(id, db = pool) {
  await db.query('DELETE FROM rent_rules WHERE rule_id = $1', [id]);
}

module.exports = { SELECT, getAll, findById, forRent, forRents, create, update, saveEffectiveDates, remove };
