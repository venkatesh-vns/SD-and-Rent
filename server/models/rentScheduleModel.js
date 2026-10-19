const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');

const FROM = `
  FROM rent_schedule_lines l
  JOIN rent_master r ON r.rent_id = l.rent_id
  JOIN rent_agreements a ON a.agreement_id = l.agreement_id
  JOIN sd_master s ON s.sd_id = r.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id`;

// Filters: Cost Center, Floor, Landlord Name, LL Status, Rent Code, Agreement Status,
// Agreement Header (component) - one or more each - and fromMonth / toMonth
function filterClause(f) {
  const params = [];
  const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (idsOf(f.costCenterId).length) where.push(`s.cost_center_id = ANY(${p(idsOf(f.costCenterId))}::int[])`);
  if (listOf(f.floor).length) where.push(`s.floor = ANY(${p(listOf(f.floor))})`);
  if (listOf(f.landlordName).length) where.push(`r.landlord_name = ANY(${p(listOf(f.landlordName))})`);
  if (listOf(f.llStatus).length) where.push(`r.ll_status = ANY(${p(listOf(f.llStatus))})`);
  if (idsOf(f.rentId).length) where.push(`l.rent_id = ANY(${p(idsOf(f.rentId))}::int[])`);
  if (listOf(f.agreementStatus).length) where.push(`a.agreement_status = ANY(${p(listOf(f.agreementStatus))})`);
  if (listOf(f.componentCode).length) where.push(`l.component_code = ANY(${p(listOf(f.componentCode))})`);
  if (f.fromMonth) where.push(`l.rent_month >= ${p(f.fromMonth)}::date`);
  if (f.toMonth) where.push(`l.rent_month <= ${p(f.toMonth)}::date`);
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const TOTALS = `COUNT(*)::int AS lines, COALESCE(SUM(l.base_amount), 0) AS base_amount,
  COALESCE(SUM(l.escalated_amount), 0) AS escalated_amount, COALESCE(SUM(l.waiver_amount), 0) AS waiver_amount,
  COALESCE(SUM(l.final_amount), 0) AS final_amount`;

async function getLines(f = {}, { page = 1, pageSize = 100 } = {}) {
  const { whereSql, params } = filterClause(f);
  const totals = (await pool.query(`SELECT ${TOTALS} ${FROM} ${whereSql}`, params)).rows[0];
  const p = [...params];
  let paging = '';
  if (pageSize > 0) {
    p.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${p.length - 1} OFFSET $${p.length}`;
  }
  const rows = (await pool.query(
    `SELECT l.*, r.rent_code, r.landlord_name, r.ll_status, r.inactive_end_date, a.agreement_status,
            s.sd_code, s.floor, cc.cost_center_name,
            s.lease_commencement_date AS lcd, s.rent_commencement_date AS rcd, s.lease_end_date AS led
     ${FROM} ${whereSql}
     ORDER BY r.rent_code, l.rent_month, l.agreement_id, l.component_code ${paging}`, p
  )).rows;
  return { rows, total: totals.lines, totals };
}

// Totals grouped for reporting: by component (Agreement Header), cost center, landlord, Rent Code or month
const GROUPS = {
  component: 'l.component_code',
  costCenter: 'cc.cost_center_name',
  landlord: 'r.landlord_name',
  rentCode: 'r.rent_code',
  month: "to_char(l.rent_month, 'YYYY-MM')",
};

async function getSummary(f = {}, groupBy = 'component') {
  const col = GROUPS[groupBy] || GROUPS.component;
  const { whereSql, params } = filterClause(f);
  return (await pool.query(
    `SELECT ${col} AS group_key, ${TOTALS} ${FROM} ${whereSql} GROUP BY 1 ORDER BY 1`, params
  )).rows;
}

async function createRun(run, db = pool) {
  return (await db.query(
    `INSERT INTO rent_schedule_runs (trigger, from_month, to_month, filters, rent_codes, lines, messages, run_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [run.trigger, run.fromMonth, run.toMonth, run.filters ? JSON.stringify(run.filters) : null, run.rentCodes, run.lines,
      run.messages ? JSON.stringify(run.messages) : null, run.by]
  )).rows[0];
}

async function recentRuns(limit = 20) {
  return (await pool.query('SELECT * FROM rent_schedule_runs ORDER BY run_id DESC LIMIT $1', [limit])).rows;
}

/**
 * Replaces stored lines of the given agreements for fromMonth..toMonth.
 * Lines of inactive agreements before keepPastBefore (the current month)
 * are left alone, so history stays available for audit.
 */
async function replaceLines({ rentIds, agreementIds, fromMonth, toMonth, keepPastBefore, lines, runId, by }, db) {
  await db.query(
    `DELETE FROM rent_schedule_lines l
     USING rent_agreements a
     WHERE a.agreement_id = l.agreement_id AND l.rent_id = ANY($1::int[])
       AND l.rent_month BETWEEN $2::date AND $3::date
       AND (l.agreement_id = ANY($4::int[]) OR (a.status = 'Inactive' AND l.rent_month >= $5::date))`,
    [rentIds, fromMonth, toMonth, agreementIds, keepPastBefore]
  );
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500);
    const values = [];
    const params = [];
    chunk.forEach((l) => {
      const base = params.length;
      params.push(l.rent_id, l.agreement_id, l.component_code, l.rent_month, l.period_from, l.period_to, l.days_charged,
        l.base_amount, l.rule_percentage, l.escalated_amount, l.waiver_amount, l.final_amount, runId, by);
      values.push(`(${Array.from({ length: 14 }, (_, k) => `$${base + k + 1}`).join(', ')})`);
    });
    await db.query(
      `INSERT INTO rent_schedule_lines (rent_id, agreement_id, component_code, rent_month, period_from, period_to, days_charged,
                                        base_amount, rule_percentage, escalated_amount, waiver_amount, final_amount, run_id, generated_by)
       VALUES ${values.join(', ')}`,
      params
    );
  }
}

// Latest month each Rent Code's schedule has been generated up to
async function lastMonths(rentIds, db = pool) {
  if (!rentIds.length) return {};
  const rows = (await db.query(
    'SELECT rent_id, schedule_to_month AS last_month FROM rent_master WHERE rent_id = ANY($1::int[]) AND schedule_to_month IS NOT NULL',
    [rentIds]
  )).rows;
  return Object.fromEntries(rows.map((r) => [r.rent_id, r.last_month]));
}

async function markGenerated(rentIds, toMonth, db) {
  if (!rentIds.length) return;
  await db.query(
    'UPDATE rent_master SET schedule_to_month = GREATEST(COALESCE(schedule_to_month, $2::date), $2::date) WHERE rent_id = ANY($1::int[])',
    [rentIds, toMonth]
  );
}

// Generated lines of a Rent Code from fromMonth to toMonth (null = no end):
// { lines, first_month, last_month }, or null when there are none
async function linesWithin(rentId, fromMonth, toMonth = null, db = pool) {
  const row = (await db.query(
    `SELECT COUNT(*)::int AS lines, MIN(rent_month) AS first_month, MAX(rent_month) AS last_month
     FROM rent_schedule_lines
     WHERE rent_id = $1 AND rent_month >= $2::date AND ($3::date IS NULL OR rent_month <= $3::date)`,
    [rentId, fromMonth, toMonth]
  )).rows[0];
  return row.lines ? row : null;
}

/**
 * Deletes the lines matching the schedule filters and month range, then resets
 * each affected Rent Code's "generated up to" month to its last remaining line.
 * Returns { lines, rentIds }.
 */
async function deleteLines(f, db) {
  const { whereSql, params } = filterClause(f);
  const deleted = (await db.query(
    `DELETE FROM rent_schedule_lines WHERE line_id IN (SELECT l.line_id ${FROM} ${whereSql}) RETURNING rent_id`, params
  )).rows;
  const rentIds = [...new Set(deleted.map((d) => d.rent_id))];
  if (rentIds.length) {
    await db.query(
      `UPDATE rent_master r SET schedule_to_month = (SELECT MAX(l.rent_month) FROM rent_schedule_lines l WHERE l.rent_id = r.rent_id)
       WHERE r.rent_id = ANY($1::int[])`,
      [rentIds]
    );
  }
  return { lines: deleted.length, rentIds };
}

module.exports = { getLines, getSummary, createRun, recentRuns, replaceLines, lastMonths, markGenerated, linesWithin, deleteLines, GROUPS };
