const { pool } = require('../config/db');
const { filterClause } = require('./sdMasterModel');

const SELECT = `
  SELECT s.sd_id, s.sd_code, s.lease_id, s.agreement_no, s.landlord_name, s.floor,
         s.landlord_status, s.building_status,
         s.lease_commencement_date, s.rent_commencement_date, s.lease_end_date,
         cc.cost_center_code, cc.cost_center_name, l1.l1_name, l2.l2_name, l3.l3_name,
         b.agreement_value, b.total_paid, b.total_transfer, b.total_adjustment, b.total_refund,
         b.sd_balance, b.sd_balance_repayable, b.txn_count, b.last_txn_date,
         b.total_payments, b.total_reversal, b.reversal_count`;

const FROM = `
  FROM sd_master s
  JOIN v_sd_balance b ON b.sd_id = s.sd_id
  JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
  JOIN location_l1 l1 ON l1.l1_id = s.l1_id
  JOIN location_l2 l2 ON l2.l2_id = s.l2_id
  JOIN location_l3 l3 ON l3.l3_id = s.l3_id`;

/**
 * SD Balance report: one row per SD Code with its totals and balances.
 * Filters: those of the SD Master list (search, costCenterId, l1Id, l2Id,
 * l3Id, landlordStatus, buildingStatus, leaseEndFrom, leaseEndTo) plus
 * balanceDue (SD Balance > 0) and repayableDue (SD Balance Repayable > 0).
 * Returns { rows, total, totals } - totals cover every filtered row.
 */
async function sdBalance(filters = {}, { page = 1, pageSize = 50 } = {}) {
  const { sql, params } = filterClause(filters);
  const extra = [];
  if (filters.balanceDue === 'true') extra.push('b.sd_balance > 0');
  if (filters.repayableDue === 'true') extra.push('b.sd_balance_repayable > 0');
  const where = [sql.replace(/^WHERE /, ''), ...extra].filter(Boolean);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totals = (await pool.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(b.agreement_value), 0) AS agreement_value,
            COALESCE(SUM(b.total_paid), 0) AS total_paid,
            COALESCE(SUM(b.total_payments), 0) AS total_payments,
            COALESCE(SUM(b.total_reversal), 0) AS total_reversal,
            COALESCE(SUM(b.reversal_count), 0)::int AS reversal_count,
            COALESCE(SUM(b.total_transfer), 0) AS total_transfer,
            COALESCE(SUM(b.total_adjustment), 0) AS total_adjustment,
            COALESCE(SUM(b.total_refund), 0) AS total_refund,
            COALESCE(SUM(b.sd_balance), 0) AS sd_balance,
            COALESCE(SUM(b.sd_balance_repayable), 0) AS sd_balance_repayable
     ${FROM} ${whereSql}`,
    params
  )).rows[0];

  const p = [...params];
  let paging = '';
  if (pageSize > 0) {
    p.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${p.length - 1} OFFSET $${p.length}`;
  }
  const rows = (await pool.query(`${SELECT} ${FROM} ${whereSql} ORDER BY s.sd_code ${paging}`, p)).rows;
  return { rows, total: totals.count, totals };
}

module.exports = { sdBalance };
