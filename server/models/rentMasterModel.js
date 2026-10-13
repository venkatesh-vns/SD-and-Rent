const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');

// Rent Master with the fields it shows from SD Master (Cost Center, Floor, LCD, RCD, LED)
const SELECT = `
  SELECT r.*, s.sd_code, s.floor, s.cost_center_id, cc.cost_center_name,
         s.lease_commencement_date AS lcd, s.rent_commencement_date AS rcd, s.lease_end_date AS led,
         s.landlord_name AS sd_landlord_name
  FROM rent_master r
  JOIN sd_master s ON s.sd_id = r.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id`;

// Filters: search (Rent Code, SD Code, landlord, floor, cost center); costCenterId,
// llStatus, rentId, floor, landlordName accept one or more values
function filterClause(f, params) {
  const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (f.search) {
    const s = p(`%${f.search}%`);
    where.push(`(r.rent_code ILIKE ${s} OR s.sd_code ILIKE ${s} OR r.landlord_name ILIKE ${s} OR s.floor ILIKE ${s} OR cc.cost_center_name ILIKE ${s})`);
  }
  if (idsOf(f.costCenterId).length) where.push(`s.cost_center_id = ANY(${p(idsOf(f.costCenterId))}::int[])`);
  if (idsOf(f.rentId).length) where.push(`r.rent_id = ANY(${p(idsOf(f.rentId))}::int[])`);
  if (listOf(f.llStatus).length) where.push(`r.ll_status = ANY(${p(listOf(f.llStatus))})`);
  if (listOf(f.floor).length) where.push(`s.floor = ANY(${p(listOf(f.floor))})`);
  if (listOf(f.landlordName).length) where.push(`r.landlord_name = ANY(${p(listOf(f.landlordName))})`);
  return where;
}

async function getAll(filters = {}, { page = 1, pageSize = 50 } = {}) {
  const params = [];
  const where = filterClause(filters, params);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM rent_master r JOIN sd_master s ON s.sd_id = r.sd_id JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id ${whereSql}`,
    params
  )).rows[0].n;
  let paging = '';
  if (pageSize > 0) {
    params.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const rows = (await pool.query(`${SELECT} ${whereSql} ORDER BY r.rent_id DESC ${paging}`, params)).rows;
  return { rows, total };
}

// Ids of the Rent Codes matching the filters (used by Rent Schedule)
async function findIds(filters = {}) {
  const params = [];
  const where = filterClause(filters, params);
  const sql = `SELECT r.rent_id FROM rent_master r JOIN sd_master s ON s.sd_id = r.sd_id
               JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.rent_code`;
  return (await pool.query(sql, params)).rows.map((r) => r.rent_id);
}

async function findById(id, db = pool) {
  return (await db.query(`${SELECT} WHERE r.rent_id = $1`, [id])).rows[0];
}

async function findByCode(code, db = pool) {
  return (await db.query(`${SELECT} WHERE UPPER(r.rent_code) = UPPER($1)`, [String(code || '').trim()])).rows[0];
}

async function findByBusinessKey(key, db = pool) {
  return (await db.query('SELECT rent_id, rent_code FROM rent_master WHERE business_key = $1', [key])).rows[0];
}

async function create(rec, by, { uploaded = false } = {}, db = pool) {
  const r = await db.query(
    `INSERT INTO rent_master (sd_id, landlord_name, ll_status, inactive_end_date, business_key, created_by, uploaded_by, uploaded_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING rent_id`,
    [rec.sd_id, rec.landlord_name, rec.ll_status, rec.inactive_end_date, rec.business_key, by, uploaded ? by : null, uploaded ? new Date() : null]
  );
  return findById(r.rows[0].rent_id, db);
}

async function update(id, rec, by, { uploaded = false } = {}, db = pool) {
  await db.query(
    `UPDATE rent_master SET sd_id = $2, landlord_name = $3, ll_status = $4, inactive_end_date = $5, business_key = $6,
            modified_by = $7, modified_date = NOW(),
            uploaded_by = CASE WHEN $8 THEN $7 ELSE uploaded_by END,
            uploaded_date = CASE WHEN $8 THEN NOW() ELSE uploaded_date END
     WHERE rent_id = $1`,
    [id, rec.sd_id, rec.landlord_name, rec.ll_status, rec.inactive_end_date, rec.business_key, by, uploaded]
  );
  return findById(id, db);
}

async function remove(id, db = pool) {
  await db.query('DELETE FROM rent_master WHERE rent_id = $1', [id]);
}

// What already uses a Rent Code (blocks delete and SD Code changes)
async function usage(id, db = pool) {
  return (await db.query(
    `SELECT (SELECT COUNT(*) FROM rent_agreements WHERE rent_id = $1)::int AS agreements,
            (SELECT COUNT(*) FROM rent_agreements WHERE transfer_from_rent_id = $1)::int AS transfers,
            (SELECT COUNT(*) FROM rent_rules WHERE rent_id = $1)::int AS rules,
            (SELECT COUNT(*) FROM rent_waivers WHERE rent_id = $1)::int AS waivers,
            (SELECT COUNT(*) FROM rent_schedule_lines WHERE rent_id = $1)::int AS schedule_lines`,
    [id]
  )).rows[0];
}

// Choices for pickers and filters
async function options() {
  const rows = (await pool.query(
    `SELECT r.rent_id AS id, r.rent_code, r.landlord_name, r.ll_status, s.sd_code, s.floor, cc.cost_center_name
     FROM rent_master r JOIN sd_master s ON s.sd_id = r.sd_id JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
     ORDER BY r.rent_code`
  )).rows;
  return rows;
}

module.exports = { SELECT, getAll, findIds, findById, findByCode, findByBusinessKey, create, update, remove, usage, options };
