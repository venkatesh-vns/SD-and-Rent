const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');

const SELECT = `
  SELECT w.*, r.rent_code, r.landlord_name, r.schedule_to_month, s.sd_code, s.floor, cc.cost_center_name,
         s.lease_commencement_date AS lcd, s.rent_commencement_date AS rcd, s.lease_end_date AS led
  FROM rent_waivers w
  JOIN rent_master r ON r.rent_id = w.rent_id
  JOIN sd_master s ON s.sd_id = r.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id`;

async function getAll(f = {}, { page = 1, pageSize = 50 } = {}) {
  const params = [];
  const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (f.search) {
    const s = p(`%${f.search}%`);
    where.push(`(r.rent_code ILIKE ${s} OR s.sd_code ILIKE ${s} OR r.landlord_name ILIKE ${s} OR w.remark ILIKE ${s})`);
  }
  if (idsOf(f.rentId).length) where.push(`w.rent_id = ANY(${p(idsOf(f.rentId))}::int[])`);
  if (listOf(f.waiverStatus).length) where.push(`w.waiver_status = ANY(${p(listOf(f.waiverStatus))})`);
  if (f.dateFrom) where.push(`w.to_date >= ${p(f.dateFrom)}::date`);
  if (f.dateTo) where.push(`w.from_date <= ${p(f.dateTo)}::date`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM rent_waivers w JOIN rent_master r ON r.rent_id = w.rent_id JOIN sd_master s ON s.sd_id = r.sd_id ${whereSql}`,
    params
  )).rows[0].n;
  let paging = '';
  if (pageSize > 0) {
    params.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const rows = (await pool.query(`${SELECT} ${whereSql} ORDER BY r.rent_code, w.from_date ${paging}`, params)).rows;
  return { rows, total };
}

async function findById(id, db = pool) {
  return (await db.query(`${SELECT} WHERE w.waiver_id = $1`, [id])).rows[0];
}

async function forRents(rentIds, db = pool) {
  if (!rentIds.length) return [];
  return (await db.query(`${SELECT} WHERE w.rent_id = ANY($1::int[]) ORDER BY w.from_date`, [rentIds])).rows;
}

// Active (Status Yes) waivers of a Rent Code overlapping from-to and sharing a
// component (no list = all components), except one waiver
async function overlapping(rentId, from, to, componentCodes, exceptId, db = pool) {
  return (await db.query(
    `SELECT waiver_id, from_date, to_date FROM rent_waivers
     WHERE rent_id = $1 AND waiver_status = 'Yes' AND from_date <= $3::date AND to_date >= $2::date
       AND waiver_id <> COALESCE($5, 0)
       AND (component_codes IS NULL OR $4::varchar[] IS NULL OR component_codes && $4::varchar[])`,
    [rentId, from, to, componentCodes && componentCodes.length ? componentCodes : null, exceptId]
  )).rows;
}

async function create(rec, by, { uploaded = false } = {}, db = pool) {
  const r = await db.query(
    `INSERT INTO rent_waivers (rent_id, from_date, to_date, waiver_status, component_codes, remark, created_by, uploaded_by, uploaded_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING waiver_id`,
    [rec.rent_id, rec.from_date, rec.to_date, rec.waiver_status, rec.component_codes, rec.remark, by, uploaded ? by : null, uploaded ? new Date() : null]
  );
  return findById(r.rows[0].waiver_id, db);
}

async function update(id, rec, by, { uploaded = false } = {}, db = pool) {
  await db.query(
    `UPDATE rent_waivers SET rent_id = $2, from_date = $3, to_date = $4, waiver_status = $5, component_codes = $6, remark = $7,
            modified_by = $8, modified_date = NOW(),
            uploaded_by = CASE WHEN $9 THEN $8 ELSE uploaded_by END,
            uploaded_date = CASE WHEN $9 THEN NOW() ELSE uploaded_date END
     WHERE waiver_id = $1`,
    [id, rec.rent_id, rec.from_date, rec.to_date, rec.waiver_status, rec.component_codes, rec.remark, by, uploaded]
  );
  return findById(id, db);
}

async function remove(id, db = pool) {
  await db.query('DELETE FROM rent_waivers WHERE waiver_id = $1', [id]);
}

module.exports = { SELECT, getAll, findById, forRents, overlapping, create, update, remove };
