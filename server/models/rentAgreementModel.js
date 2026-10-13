const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');

// Agreement header with its Rent Code / SD details and components as JSON
const SELECT = `
  SELECT a.*, r.rent_code, r.landlord_name, r.ll_status, r.sd_id, s.sd_code, s.floor, cc.cost_center_name,
         s.lease_commencement_date AS lcd, s.rent_commencement_date AS rcd, s.lease_end_date AS led,
         src.rent_code AS transfer_from_rent_code,
         COALESCE((SELECT json_agg(json_build_object('component_code', c.component_code, 'quantity', c.quantity,
                                                     'rate', c.rate, 'percentage', c.percentage) ORDER BY c.component_id)
                   FROM rent_agreement_components c WHERE c.agreement_id = a.agreement_id), '[]') AS components
  FROM rent_agreements a
  JOIN rent_master r ON r.rent_id = a.rent_id
  JOIN sd_master s ON s.sd_id = r.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
  LEFT JOIN rent_master src ON src.rent_id = a.transfer_from_rent_id`;

async function getAll(f = {}, { page = 1, pageSize = 50 } = {}) {
  const params = [];
  const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (f.search) {
    const s = p(`%${f.search}%`);
    where.push(`(r.rent_code ILIKE ${s} OR s.sd_code ILIKE ${s} OR r.landlord_name ILIKE ${s} OR a.remark ILIKE ${s})`);
  }
  if (idsOf(f.rentId).length) where.push(`a.rent_id = ANY(${p(idsOf(f.rentId))}::int[])`);
  if (idsOf(f.costCenterId).length) where.push(`s.cost_center_id = ANY(${p(idsOf(f.costCenterId))}::int[])`);
  if (listOf(f.agreementStatus).length) where.push(`a.agreement_status = ANY(${p(listOf(f.agreementStatus))})`);
  if (listOf(f.status).length) where.push(`a.status = ANY(${p(listOf(f.status))})`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM rent_agreements a JOIN rent_master r ON r.rent_id = a.rent_id
     JOIN sd_master s ON s.sd_id = r.sd_id ${whereSql}`, params
  )).rows[0].n;
  let paging = '';
  if (pageSize > 0) {
    params.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const rows = (await pool.query(`${SELECT} ${whereSql} ORDER BY a.agreement_id DESC ${paging}`, params)).rows;
  return { rows, total };
}

async function findById(id, db = pool) {
  return (await db.query(`${SELECT} WHERE a.agreement_id = $1`, [id])).rows[0];
}

// All agreements of the given Rent Codes (any status), oldest first
async function forRents(rentIds, db = pool) {
  if (!rentIds.length) return [];
  return (await db.query(`${SELECT} WHERE a.rent_id = ANY($1::int[]) ORDER BY a.agreement_id`, [rentIds])).rows;
}

// The active agreement of a Rent Code + Agreement Status, if any
async function findActive(rentId, agreementStatus, db = pool) {
  return (await db.query(
    `${SELECT} WHERE a.rent_id = $1 AND a.agreement_status = $2 AND a.status = 'Active'`, [rentId, agreementStatus]
  )).rows[0];
}

async function saveComponents(agreementId, components, db) {
  await db.query('DELETE FROM rent_agreement_components WHERE agreement_id = $1', [agreementId]);
  for (const c of components) {
    await db.query(
      `INSERT INTO rent_agreement_components (agreement_id, component_code, quantity, rate, percentage)
       VALUES ($1, $2, $3, $4, $5)`,
      [agreementId, c.component_code, c.quantity, c.rate, c.percentage]
    );
  }
}

async function create(rec, by, { uploaded = false } = {}, db = pool) {
  const r = await db.query(
    `INSERT INTO rent_agreements (rent_id, agreement_status, status, transfer_from_rent_id, transfer_effective_date, remark,
                                  created_by, uploaded_by, uploaded_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING agreement_id`,
    [rec.rent_id, rec.agreement_status, rec.status, rec.transfer_from_rent_id, rec.transfer_effective_date, rec.remark,
      by, uploaded ? by : null, uploaded ? new Date() : null]
  );
  await saveComponents(r.rows[0].agreement_id, rec.components, db);
  return findById(r.rows[0].agreement_id, db);
}

async function update(id, rec, by, { uploaded = false } = {}, db = pool) {
  await db.query(
    `UPDATE rent_agreements SET rent_id = $2, agreement_status = $3, status = $4, transfer_from_rent_id = $5,
            transfer_effective_date = $6, remark = $7, modified_by = $8, modified_date = NOW(),
            uploaded_by = CASE WHEN $9 THEN $8 ELSE uploaded_by END,
            uploaded_date = CASE WHEN $9 THEN NOW() ELSE uploaded_date END
     WHERE agreement_id = $1`,
    [id, rec.rent_id, rec.agreement_status, rec.status, rec.transfer_from_rent_id, rec.transfer_effective_date, rec.remark, by, uploaded]
  );
  await saveComponents(id, rec.components, db);
  return findById(id, db);
}

// Status / remark only (the only change allowed once an agreement is in use)
async function setStatus(id, status, remark, by, db = pool) {
  await db.query(
    'UPDATE rent_agreements SET status = $2, remark = $3, modified_by = $4, modified_date = NOW() WHERE agreement_id = $1',
    [id, status, remark, by]
  );
  return findById(id, db);
}

async function remove(id, db = pool) {
  await db.query('DELETE FROM rent_agreements WHERE agreement_id = $1', [id]);
}

// In use = its Rent Code has Rule Master entries, or a schedule was generated from it
async function usage(agreement, db = pool) {
  return (await db.query(
    `SELECT (SELECT COUNT(*) FROM rent_rules WHERE rent_id = $1)::int AS rules,
            (SELECT COUNT(*) FROM rent_schedule_lines WHERE agreement_id = $2)::int AS schedule_lines,
            (SELECT COUNT(*) FROM rent_agreements WHERE transfer_from_rent_id = $1 AND status = 'Active')::int AS transfers_out`,
    [agreement.rent_id, agreement.agreement_id]
  )).rows[0];
}

module.exports = { SELECT, getAll, findById, forRents, findActive, create, update, setStatus, remove, usage };
