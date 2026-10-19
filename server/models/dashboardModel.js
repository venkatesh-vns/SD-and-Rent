const { pool } = require('../config/db');
const { listOf, idsOf } = require('../utils/filters');

/*
 * SD Dashboard queries. Filters come in two kinds:
 *  - SD filters narrow the SD records: sdId, costCenterId, l1Id, l2Id, l3Id,
 *    landlordName, landlordStatus, buildingStatus (each one or more values);
 *  - transaction filters narrow the transactions that are added up: sdType,
 *    fy, agreementStatus (one or more) and dateFrom / dateTo ('YYYY-MM-DD').
 *    While any is set, only SD records with a matching transaction count.
 * Every query starts from the same CTEs: sd (filtered SD records), tx (their
 * filtered transactions) and bal (one row per SD with its totals).
 */
function baseCtes(f) {
  const params = [];
  const p = (value) => { params.push(value); return `$${params.length}`; };

  const sdWhere = [];
  const ids = (col, v) => { if (idsOf(v).length) sdWhere.push(`${col} = ANY(${p(idsOf(v))}::int[])`); };
  const any = (col, v) => { if (listOf(v).length) sdWhere.push(`${col} = ANY(${p(listOf(v))})`); };
  ids('s.sd_id', f.sdId);
  ids('s.cost_center_id', f.costCenterId);
  ids('s.l1_id', f.l1Id);
  ids('s.l2_id', f.l2Id);
  ids('s.l3_id', f.l3Id);
  any('s.landlord_status', f.landlordStatus);
  any('s.building_status', f.buildingStatus);
  if (listOf(f.landlordName).length) {
    sdWhere.push(`COALESCE(NULLIF(TRIM(s.landlord_name), ''), '(Not given)') = ANY(${p(listOf(f.landlordName))})`);
  }

  const txWhere = [];
  if (listOf(f.sdType).length) txWhere.push(`t.sd_type = ANY(${p(listOf(f.sdType))})`);
  if (listOf(f.fy).length) txWhere.push(`t.fy = ANY(${p(listOf(f.fy))})`);
  if (listOf(f.agreementStatus).length) txWhere.push(`t.agreement_status = ANY(${p(listOf(f.agreementStatus))})`);
  if (f.dateFrom) txWhere.push(`t.txn_date >= ${p(f.dateFrom)}::date`);
  if (f.dateTo) txWhere.push(`t.txn_date <= ${p(f.dateTo)}::date`);
  const txCond = txWhere.length ? txWhere.join(' AND ') : 'TRUE';
  if (txWhere.length) sdWhere.push(`EXISTS (SELECT 1 FROM sd_transactions t WHERE t.sd_id = s.sd_id AND ${txCond})`);

  const sql = `WITH sd AS (
      SELECT s.*, (s.landlord_status = 'Passive' OR s.building_status = 'Passive') AS is_passive
      FROM sd_master s ${sdWhere.length ? `WHERE ${sdWhere.join(' AND ')}` : ''}
    ),
    tx AS (
      SELECT t.* FROM sd_transactions t JOIN sd ON sd.sd_id = t.sd_id WHERE ${txCond}
    ),
    bal AS (
      SELECT sd.sd_id, sd.agreement_value,
             COALESCE(SUM(tx.paid_amount), 0) AS paid,
             COALESCE(SUM(tx.transfer_amount), 0) AS transfer,
             COALESCE(SUM(tx.adjustment_amount), 0) AS adjustment,
             COALESCE(SUM(tx.refund_amount), 0) AS refund,
             sd.agreement_value - COALESCE(SUM(tx.paid_amount), 0) AS balance,
             COALESCE(SUM(tx.paid_amount - tx.transfer_amount - tx.adjustment_amount - tx.refund_amount), 0) AS repayable
      FROM sd LEFT JOIN tx ON tx.sd_id = sd.sd_id
      GROUP BY sd.sd_id, sd.agreement_value
    )`;
  return { sql, params };
}

// Totals of the amount columns of bal, for GROUP BY summaries
const SUMS = `SUM(b.agreement_value) AS agreement_value, SUM(b.paid) AS paid, SUM(b.balance) AS balance,
  SUM(b.repayable) AS repayable, COUNT(*)::int AS sd_count`;

const ALERTS = [
  ['leaseCommencement', 'lease_commencement_date'],
  ['rentCommencement', 'rent_commencement_date'],
  ['leaseEnd', 'lease_end_date'],
];

/**
 * All dashboard sections for the filters. alertDays = how far ahead the
 * upcoming-date lists look (default 15).
 */
async function getDashboard(f = {}, { alertDays = 15 } = {}) {
  const { sql: ctes, params } = baseCtes(f);
  const q = async (body, extra = []) => (await pool.query(`${ctes} ${body}`, [...params, ...extra])).rows;
  const next = `$${params.length + 1}`; // placeholder for the first extra parameter

  const [kpi] = await q(`
    SELECT COALESCE(SUM(b.agreement_value), 0) AS agreement_value, COALESCE(SUM(b.paid), 0) AS paid,
           COALESCE(SUM(b.transfer), 0) AS transfer, COALESCE(SUM(b.adjustment), 0) AS adjustment,
           COALESCE(SUM(b.refund), 0) AS refund, COALESCE(SUM(b.balance), 0) AS balance,
           COALESCE(SUM(b.repayable), 0) AS repayable,
           COALESCE((SELECT -SUM(tx.paid_amount) FROM tx WHERE tx.paid_amount < 0), 0) AS reversal_amount,
           (SELECT COUNT(*) FROM tx WHERE tx.paid_amount < 0)::int AS reversal_count,
           COUNT(*)::int AS sd_count,
           COUNT(*) FILTER (WHERE NOT sd.is_passive)::int AS active_count,
           COUNT(*) FILTER (WHERE sd.is_passive)::int AS passive_count,
           COUNT(DISTINCT NULLIF(TRIM(sd.landlord_name), ''))::int AS landlord_count,
           COUNT(DISTINCT sd.cost_center_id)::int AS cost_center_count
    FROM bal b JOIN sd ON sd.sd_id = b.sd_id`);

  const alerts = {};
  for (const [key, col] of ALERTS) {
    alerts[key] = await q(`
      SELECT sd.sd_id, sd.sd_code, sd.lease_id, sd.agreement_no, sd.landlord_name, cc.cost_center_name,
             sd.${col} AS due_date, (sd.${col} - CURRENT_DATE)::int AS days_left,
             sd.landlord_status, sd.building_status
      FROM sd JOIN cost_centers cc ON cc.cost_center_id = sd.cost_center_id
      WHERE sd.${col} BETWEEN CURRENT_DATE AND CURRENT_DATE + ${next}::int
      ORDER BY sd.${col}, sd.sd_code`, [alertDays]);
  }

  const sdTypes = await q(`
    SELECT tx.sd_type, SUM(tx.paid_amount) AS paid, SUM(tx.transfer_amount) AS transfer,
           SUM(tx.adjustment_amount) AS adjustment, SUM(tx.refund_amount) AS refund,
           SUM(tx.paid_amount - tx.transfer_amount - tx.adjustment_amount - tx.refund_amount) AS repayable,
           COUNT(*)::int AS txn_count
    FROM tx GROUP BY tx.sd_type ORDER BY SUM(tx.paid_amount) DESC`);

  const locations = await q(`
    SELECT sd.l1_id, l1.l1_name, sd.l2_id, l2.l2_name, sd.l3_id, l3.l3_name, ${SUMS}
    FROM bal b JOIN sd ON sd.sd_id = b.sd_id
    JOIN location_l1 l1 ON l1.l1_id = sd.l1_id
    JOIN location_l2 l2 ON l2.l2_id = sd.l2_id
    JOIN location_l3 l3 ON l3.l3_id = sd.l3_id
    GROUP BY sd.l1_id, l1.l1_name, sd.l2_id, l2.l2_name, sd.l3_id, l3.l3_name
    ORDER BY l1.l1_name, l2.l2_name, l3.l3_name`);

  const costCenters = await q(`
    SELECT sd.cost_center_id, cc.cost_center_name, ${SUMS}
    FROM bal b JOIN sd ON sd.sd_id = b.sd_id JOIN cost_centers cc ON cc.cost_center_id = sd.cost_center_id
    GROUP BY sd.cost_center_id, cc.cost_center_name
    ORDER BY SUM(b.agreement_value) DESC, cc.cost_center_name`);

  const landlords = await q(`
    SELECT COALESCE(NULLIF(TRIM(sd.landlord_name), ''), '(Not given)') AS landlord_name, ${SUMS}
    FROM bal b JOIN sd ON sd.sd_id = b.sd_id
    GROUP BY 1 ORDER BY SUM(b.agreement_value) DESC, 1`);

  const recent = await q(`
    SELECT tx.txn_id, tx.txn_no, sd.sd_id, sd.sd_code, tx.txn_date, tx.sd_type, tx.paid_amount, tx.transfer_amount,
           tx.adjustment_amount, tx.refund_amount, tx.remarks, COALESCE(tx.created_by, tx.uploaded_by) AS created_by
    FROM tx JOIN sd ON sd.sd_id = tx.sd_id
    ORDER BY tx.txn_date DESC, tx.txn_id DESC LIMIT 10`);

  const pending = await q(`
    SELECT sd.sd_id, sd.sd_code, sd.lease_id, sd.landlord_name, cc.cost_center_name, b.agreement_value, b.repayable
    FROM bal b JOIN sd ON sd.sd_id = b.sd_id JOIN cost_centers cc ON cc.cost_center_id = sd.cost_center_id
    WHERE b.repayable > 0 ORDER BY b.repayable DESC, sd.sd_code`);

  const [status] = await q(`
    SELECT COUNT(*) FILTER (WHERE landlord_status = 'Active')::int AS landlord_active,
           COUNT(*) FILTER (WHERE landlord_status = 'Passive')::int AS landlord_passive,
           COUNT(*) FILTER (WHERE building_status = 'Active')::int AS building_active,
           COUNT(*) FILTER (WHERE building_status = 'Passive')::int AS building_passive
    FROM sd`);

  // Financial years (April-March): amounts from transactions in the FY;
  // Agreement Value from SD records whose Lease Commencement falls in it
  const fyTx = await q(`
    SELECT tx.fy, SUM(tx.paid_amount) AS paid, SUM(tx.transfer_amount) AS transfer,
           SUM(tx.adjustment_amount) AS adjustment, SUM(tx.refund_amount) AS refund
    FROM tx GROUP BY tx.fy`);
  const fyAgreement = await q(`
    SELECT CASE WHEN EXTRACT(MONTH FROM lease_commencement_date) >= 4
                THEN EXTRACT(YEAR FROM lease_commencement_date)::int
                ELSE EXTRACT(YEAR FROM lease_commencement_date)::int - 1 END AS start_year,
           SUM(agreement_value) AS agreement_value
    FROM sd WHERE lease_commencement_date IS NOT NULL GROUP BY 1`);
  const fyMap = new Map();
  const fyRow = (fy) => {
    if (!fyMap.has(fy)) fyMap.set(fy, { fy, agreement_value: 0, paid: 0, transfer: 0, adjustment: 0, refund: 0 });
    return fyMap.get(fy);
  };
  fyTx.forEach((r) => Object.assign(fyRow(r.fy), {
    paid: Number(r.paid), transfer: Number(r.transfer), adjustment: Number(r.adjustment), refund: Number(r.refund),
  }));
  fyAgreement.forEach((r) => { fyRow(`${r.start_year}-${r.start_year + 1}`).agreement_value = Number(r.agreement_value); });
  // SD Balance = closing balance at the FY end: Agreement Value - SD Paid, both cumulative
  const fyList = listOf(f.fy);
  let agreed = 0;
  let paidSoFar = 0;
  const financialYears = [...fyMap.values()]
    .sort((a, b) => a.fy.localeCompare(b.fy))
    .map((r) => {
      agreed += r.agreement_value;
      paidSoFar += r.paid;
      return { ...r, balance: agreed - paidSoFar };
    })
    .filter((r) => !fyList.length || fyList.includes(r.fy));

  const [notifications] = (await pool.query(`
    SELECT COUNT(*) FILTER (WHERE status = 'Sent')::int AS sent,
           COUNT(*) FILTER (WHERE status = 'Failed')::int AS failed,
           COUNT(*) FILTER (WHERE status = 'DryRun')::int AS dry_run
    FROM email_log WHERE sent_at >= CURRENT_DATE - 6`)).rows;

  return {
    kpi, alerts, alertDays, sdTypes, locations, costCenters, landlords, recent, pending, status, financialYears, notifications,
  };
}

// Choices for the SD Code and Landlord Name filters
async function getOptions() {
  const sdCodes = (await pool.query('SELECT sd_id AS id, sd_code AS name FROM sd_master ORDER BY sd_code')).rows;
  const landlords = (await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(TRIM(landlord_name), ''), '(Not given)') AS name FROM sd_master ORDER BY 1`
  )).rows.map((r) => r.name);
  return { sdCodes, landlords };
}

module.exports = { getDashboard, getOptions };
