const { pool } = require('../config/db');
const { filterClause } = require('./sdMasterModel');
const { listOf } = require('../utils/filters');

/**
 * SD Balance report: one entry per SD Code (its Agreement Value counted once)
 * with a line per Agreement Status of its transactions.
 *
 * Filters: those of the SD Master list (search, costCenterId, l1Id, l2Id,
 * l3Id, landlordStatus, buildingStatus, leaseEndFrom, leaseEndTo), plus
 *   agreementStatus  one or more; only transactions with those statuses are
 *                    added up, and only SD Codes that have such transactions are listed
 *   balanceDue       SD Balance > 0;  repayableDue  SD Balance Repayable > 0
 *
 * Each row: SD details, agreement_value, totals of the (filtered) transactions
 * (total_payments, total_reversal, total_paid = net, total_transfer, ...),
 * sd_balance = Agreement Value - net SD Paid, sd_balance_repayable, and
 * lines: [{ agreement_status, total_payments, total_reversal, total_paid, ..., sd_balance_repayable }].
 * Returns { rows, total, totals } - totals cover every filtered SD Code, with
 * each Agreement Value once.
 */
async function sdBalance(filters = {}, { page = 1, pageSize = 50 } = {}) {
  const { sql, params } = filterClause(filters);
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const statuses = listOf(filters.agreementStatus);
  const statusCond = statuses.length ? `AND t.agreement_status = ANY(${p(statuses)})` : '';

  const outer = [];
  if (statuses.length) outer.push('b.txn_count > 0');
  if (filters.balanceDue === 'true') outer.push('b.sd_balance > 0');
  if (filters.repayableDue === 'true') outer.push('b.sd_balance_repayable > 0');

  const ctes = `
    WITH sdf AS (SELECT s.* FROM sd_master s ${sql}),
    lines AS (
      SELECT t.sd_id, t.agreement_status,
             COALESCE(SUM(t.paid_amount) FILTER (WHERE t.paid_amount > 0), 0) AS total_payments,
             COALESCE(SUM(t.paid_amount) FILTER (WHERE t.paid_amount < 0), 0) AS total_reversal,
             SUM(t.paid_amount) AS total_paid,
             SUM(t.transfer_amount) AS total_transfer,
             SUM(t.adjustment_amount) AS total_adjustment,
             SUM(t.refund_amount) AS total_refund,
             SUM(t.paid_amount - t.transfer_amount - t.adjustment_amount - t.refund_amount) AS sd_balance_repayable,
             COUNT(*)::int AS txn_count,
             MAX(t.txn_date) AS last_txn_date
      FROM sd_transactions t JOIN sdf ON sdf.sd_id = t.sd_id
      WHERE TRUE ${statusCond}
      GROUP BY t.sd_id, t.agreement_status
    ),
    b AS (
      SELECT sdf.sd_id, sdf.agreement_value,
             COALESCE(SUM(l.total_payments), 0) AS total_payments,
             COALESCE(SUM(l.total_reversal), 0) AS total_reversal,
             COALESCE(SUM(l.total_paid), 0) AS total_paid,
             COALESCE(SUM(l.total_transfer), 0) AS total_transfer,
             COALESCE(SUM(l.total_adjustment), 0) AS total_adjustment,
             COALESCE(SUM(l.total_refund), 0) AS total_refund,
             sdf.agreement_value - COALESCE(SUM(l.total_paid), 0) AS sd_balance,
             COALESCE(SUM(l.sd_balance_repayable), 0) AS sd_balance_repayable,
             COALESCE(SUM(l.txn_count), 0)::int AS txn_count,
             MAX(l.last_txn_date) AS last_txn_date
      FROM sdf LEFT JOIN lines l ON l.sd_id = sdf.sd_id
      GROUP BY sdf.sd_id, sdf.agreement_value
    ),
    picked AS (SELECT b.* FROM b ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''})`;

  const totals = (await pool.query(
    `${ctes}
     SELECT COUNT(*)::int AS count,
            COALESCE(SUM(agreement_value), 0) AS agreement_value,
            COALESCE(SUM(total_payments), 0) AS total_payments,
            COALESCE(SUM(total_reversal), 0) AS total_reversal,
            COALESCE(SUM(total_paid), 0) AS total_paid,
            COALESCE(SUM(total_transfer), 0) AS total_transfer,
            COALESCE(SUM(total_adjustment), 0) AS total_adjustment,
            COALESCE(SUM(total_refund), 0) AS total_refund,
            COALESCE(SUM(sd_balance), 0) AS sd_balance,
            COALESCE(SUM(sd_balance_repayable), 0) AS sd_balance_repayable,
            (SELECT COUNT(*) FROM sd_transactions t JOIN picked ON picked.sd_id = t.sd_id
              WHERE t.paid_amount < 0 ${statusCond})::int AS reversal_count
     FROM picked`,
    params
  )).rows[0];

  const q = [...params];
  let paging = '';
  if (pageSize > 0) {
    q.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${q.length - 1} OFFSET $${q.length}`;
  }
  const rows = (await pool.query(
    `${ctes}
     SELECT s.sd_id, s.sd_code, s.lease_id, s.agreement_no, s.landlord_name, s.floor,
            s.landlord_status, s.building_status,
            s.lease_commencement_date, s.rent_commencement_date, s.lease_end_date,
            cc.cost_center_code, cc.cost_center_name, l1.l1_name, l2.l2_name, l3.l3_name,
            picked.*,
            COALESCE(lj.lines, '[]') AS lines
     FROM picked
     -- each SD Code's status lines, built once for all (a look-up per SD Code
     -- re-read every line and grew with the square of the data)
     LEFT JOIN (
       SELECT l.sd_id, json_agg(json_build_object(
                'agreement_status', l.agreement_status, 'total_payments', l.total_payments,
                'total_reversal', l.total_reversal, 'total_paid', l.total_paid,
                'total_transfer', l.total_transfer, 'total_adjustment', l.total_adjustment,
                'total_refund', l.total_refund, 'sd_balance_repayable', l.sd_balance_repayable,
                'txn_count', l.txn_count) ORDER BY l.agreement_status) AS lines
       FROM lines l GROUP BY l.sd_id
     ) lj ON lj.sd_id = picked.sd_id
     JOIN sd_master s ON s.sd_id = picked.sd_id
     JOIN cost_centers cc ON cc.cost_center_id = s.cost_center_id
     JOIN location_l1 l1 ON l1.l1_id = s.l1_id
     JOIN location_l2 l2 ON l2.l2_id = s.l2_id
     JOIN location_l3 l3 ON l3.l3_id = s.l3_id
     ORDER BY s.sd_code ${paging}`,
    q
  )).rows;
  return { rows, total: totals.count, totals };
}

module.exports = { sdBalance };
