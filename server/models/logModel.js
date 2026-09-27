const { pool } = require('../config/db');

// Shared paging: returns { rows, total }; pageSize 0 = all rows (export)
async function paged(select, from, where, params, order, { page = 1, pageSize = 50 } = {}) {
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await pool.query(`SELECT COUNT(*)::int AS n ${from} ${whereSql}`, params)).rows[0].n;
  const p = [...params];
  let paging = '';
  if (pageSize > 0) {
    p.push(pageSize, (Math.max(page, 1) - 1) * pageSize);
    paging = `LIMIT $${p.length - 1} OFFSET $${p.length}`;
  }
  const rows = (await pool.query(`${select} ${from} ${whereSql} ORDER BY ${order} ${paging}`, p)).rows;
  return { rows, total };
}

function builder() {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.split('?').join(`$${params.length}`));
  };
  return { where, params, add };
}

// Filters: search (SD Code, recipient, subject), notificationType, status, dateFrom/dateTo ('YYYY-MM-DD')
async function getEmailLog(f = {}, paging) {
  const { where, params, add } = builder();
  if (f.search) add('(e.sd_code ILIKE ? OR e.recipient ILIKE ? OR e.subject ILIKE ?)', `%${f.search}%`);
  if (f.notificationType) add('e.notification_type = ?', f.notificationType);
  if (f.status) add('e.status = ?', f.status);
  if (f.dateFrom) add('e.sent_at >= ?::date', f.dateFrom);
  if (f.dateTo) add("e.sent_at < ?::date + 1", f.dateTo);
  return paged('SELECT e.*', 'FROM email_log e', where, params, 'e.sent_at DESC, e.email_log_id DESC', paging);
}

// Filters: search (who, details, record id), tableName, action, dateFrom/dateTo
async function getAuditLog(f = {}, paging) {
  const { where, params, add } = builder();
  if (f.search) {
    const text = `%${f.search}%`;
    params.push(text);
    const p = `$${params.length}`;
    const idMatch = /^\d+$/.test(f.search.trim()) ? ` OR a.record_id = ${Number(f.search.trim())}` : '';
    where.push(`(a.action_by ILIKE ${p} OR a.details ILIKE ${p} OR a.new_values::text ILIKE ${p} OR a.old_values::text ILIKE ${p}${idMatch})`);
  }
  if (f.tableName) add('a.table_name = ?', f.tableName);
  if (f.action) add('a.action = ?', f.action);
  if (f.dateFrom) add('a.action_date >= ?::date', f.dateFrom);
  if (f.dateTo) add('a.action_date < ?::date + 1', f.dateTo);
  return paged('SELECT a.*', 'FROM audit_log a', where, params, 'a.action_date DESC, a.audit_id DESC', paging);
}

module.exports = { getEmailLog, getAuditLog };
