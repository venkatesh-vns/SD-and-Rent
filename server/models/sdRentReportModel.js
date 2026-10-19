const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');
const { COMPONENTS } = require('../services/rentComponents');

/*
 * SD & Rent Transaction Summary Report: one list over
 *  - SD transactions   (Expense Category "Security Deposit", Expense Head = SD Type,
 *                       amount = Paid - Transfer - Adjustment - Refund), and
 *  - Rent Schedule lines (Expense Category "Rent" or "Maintenance", Expense Head =
 *                       component, amount = Final Rent Amount of the month).
 * Status: SD rows Active when Landlord and Building are Active, else Inactive;
 * Rent rows the Rent Code's LL Status.
 */
const SD_CATEGORY = 'Security Deposit';
const CATEGORIES = [SD_CATEGORY, 'Rent', 'Maintenance'];
const SD_TYPES = ['Landlord SD', 'Electricity SD', 'Additional Parking SD', 'Other SD', 'Fitout SD', 'CAM SD', 'Solar SD'];
const EXPENSE_HEADS = [...SD_TYPES, ...COMPONENTS.map((c) => c.label)];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const COMPONENT_LABEL_SQL = `CASE l.component_code ${COMPONENTS.map((c) => `WHEN ${q(c.code)} THEN ${q(c.label)}`).join(' ')} ELSE l.component_code END`;

const DATA = `
  SELECT 'SD' AS source, 'SD-' || t.txn_id AS row_key, ${q(SD_CATEGORY)} AS expense_category, t.sd_type AS expense_head,
         s.cost_center_id, cc.cost_center_name, s.sd_id, s.sd_code,
         COALESCE(NULLIF(TRIM(s.landlord_name), ''), '(Not given)') AS landlord_name, s.floor,
         NULL::varchar AS rent_code, NULL::int AS rent_id, s.agreement_no, t.txn_date AS effective_date,
         (t.paid_amount - t.transfer_amount - t.adjustment_amount - t.refund_amount)::numeric(15,2) AS amount,
         CASE WHEN s.landlord_status = 'Active' AND s.building_status = 'Active' THEN 'Active' ELSE 'Inactive' END AS status,
         t.txn_no AS reference,
         concat_ws(', ',
           CASE WHEN t.paid_amount > 0 THEN 'Paid ' || to_char(t.paid_amount, 'FM99,99,99,99,990.00') END,
           CASE WHEN t.paid_amount < 0 THEN 'Reversal (SD Paid) ' || to_char(t.paid_amount, 'FM99,99,99,99,990.00')
                || COALESCE(' of ' || (SELECT o.txn_no FROM sd_transactions o WHERE o.txn_id = t.reverses_txn_id), '') END,
           CASE WHEN t.transfer_amount > 0 THEN 'Transfer ' || to_char(t.transfer_amount, 'FM99,99,99,99,990.00') END,
           CASE WHEN t.adjustment_amount > 0 THEN 'Adjustment ' || to_char(t.adjustment_amount, 'FM99,99,99,99,990.00') END,
           CASE WHEN t.refund_amount > 0 THEN 'Refund ' || to_char(t.refund_amount, 'FM99,99,99,99,990.00') END) AS details
  FROM sd_transactions t
  JOIN sd_master s ON s.sd_id = t.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
  UNION ALL
  SELECT 'Rent', 'RENT-' || l.line_id, CASE WHEN l.component_code = 'MAINTENANCE' THEN 'Maintenance' ELSE 'Rent' END,
         ${COMPONENT_LABEL_SQL},
         s.cost_center_id, cc.cost_center_name, s.sd_id, s.sd_code, r.landlord_name, s.floor,
         r.rent_code, r.rent_id, s.agreement_no, l.period_from, l.final_amount, r.ll_status,
         to_char(l.rent_month, 'Mon-YYYY'),
         concat_ws(', ', a.agreement_status || ' agreement', l.days_charged || ' day(s)',
           CASE WHEN l.waiver_amount > 0 THEN 'Waiver ' || to_char(l.waiver_amount, 'FM99,99,99,99,990.00') END,
           CASE WHEN l.rule_percentage IS NOT NULL THEN 'Rule ' || (l.rule_percentage::float)::text || '%' END)
  FROM rent_schedule_lines l
  JOIN rent_master r ON r.rent_id = l.rent_id
  JOIN rent_agreements a ON a.agreement_id = l.agreement_id
  JOIN sd_master s ON s.sd_id = r.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id`;

// Filters: costCenterId, sdId, landlordName, floor, expenseHead, category, status,
// source ('SD' / 'Rent') - one or more each - and dateFrom / dateTo ('YYYY-MM-DD')
function filterClause(f) {
  const params = [];
  const where = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (idsOf(f.costCenterId).length) where.push(`d.cost_center_id = ANY(${p(idsOf(f.costCenterId))}::int[])`);
  if (idsOf(f.sdId).length) where.push(`d.sd_id = ANY(${p(idsOf(f.sdId))}::int[])`);
  if (listOf(f.landlordName).length) where.push(`d.landlord_name = ANY(${p(listOf(f.landlordName))})`);
  if (listOf(f.floor).length) where.push(`d.floor = ANY(${p(listOf(f.floor))})`);
  if (listOf(f.expenseHead).length) where.push(`d.expense_head = ANY(${p(listOf(f.expenseHead))})`);
  if (listOf(f.category).length) where.push(`d.expense_category = ANY(${p(listOf(f.category))})`);
  if (listOf(f.status).length) where.push(`d.status = ANY(${p(listOf(f.status))})`);
  if (listOf(f.source).length) where.push(`d.source = ANY(${p(listOf(f.source))})`);
  if (f.dateFrom) where.push(`d.effective_date >= ${p(f.dateFrom)}::date`);
  if (f.dateTo) where.push(`d.effective_date <= ${p(f.dateTo)}::date`);
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const TOTALS = `COUNT(*)::int AS lines,
  COALESCE(SUM(d.amount) FILTER (WHERE d.expense_category = ${q(SD_CATEGORY)}), 0) AS sd_amount,
  COALESCE(SUM(d.amount) FILTER (WHERE d.expense_category = 'Rent'), 0) AS rent_amount,
  COALESCE(SUM(d.amount) FILTER (WHERE d.expense_category = 'Maintenance'), 0) AS maintenance_amount,
  COALESCE(SUM(d.amount), 0) AS total_amount`;

async function getLines(f = {}, { page = 1, pageSize = 100 } = {}) {
  const { whereSql, params } = filterClause(f);
  const totals = (await pool.query(`SELECT ${TOTALS} FROM (${DATA}) d ${whereSql}`, params)).rows[0];
  const p = [...params];
  let paging = '';
  if (pageSize > 0) {
    p.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${p.length - 1} OFFSET $${p.length}`;
  }
  const rows = (await pool.query(
    `SELECT d.* FROM (${DATA}) d ${whereSql}
     ORDER BY d.cost_center_name, d.sd_code, d.effective_date, d.source, d.expense_head ${paging}`, p
  )).rows;
  return { rows, total: totals.lines, totals };
}

const GROUPS = {
  costCenter: 'd.cost_center_name',
  landlord: 'd.landlord_name',
  expenseHead: 'd.expense_head',
  category: 'd.expense_category',
  floor: 'd.floor',
  sdCode: 'd.sd_code',
  month: "to_char(d.effective_date, 'YYYY-MM')",
};

async function getSummary(f = {}, groupBy = 'costCenter') {
  const col = GROUPS[groupBy] || GROUPS.costCenter;
  const { whereSql, params } = filterClause(f);
  return (await pool.query(`SELECT ${col} AS group_key, ${TOTALS} FROM (${DATA}) d ${whereSql} GROUP BY 1 ORDER BY 1`, params)).rows;
}

// Choices for the filters (from both SD and Rent data)
async function getOptions() {
  const rows = (await pool.query(`SELECT DISTINCT landlord_name, floor FROM (${DATA}) d`)).rows;
  const sds = (await pool.query('SELECT sd_id AS id, sd_code AS name FROM sd_master ORDER BY sd_code')).rows;
  const extraLandlords = (await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(landlord_name), ''), '(Not given)') AS n FROM sd_master
     UNION SELECT landlord_name FROM rent_master`
  )).rows.map((r) => r.n);
  const floors = (await pool.query('SELECT DISTINCT floor FROM sd_master')).rows.map((r) => r.floor);
  const sort = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    landlords: sort([...rows.map((r) => r.landlord_name), ...extraLandlords]),
    floors: sort([...rows.map((r) => r.floor), ...floors]),
    sdCodes: sds,
    expenseHeads: EXPENSE_HEADS,
    categories: CATEGORIES,
  };
}

module.exports = { getLines, getSummary, getOptions, GROUPS, EXPENSE_HEADS, CATEGORIES };
