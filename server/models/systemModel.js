// Database figures for System Health (administrators)
const { pool } = require('../config/db');

async function databaseHealth() {
  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  const t0 = Date.now();
  const [info] = await q(`SELECT current_database() AS name, split_part(version(), ',', 1) AS version,
                                 pg_database_size(current_database()) AS size_bytes,
                                 EXTRACT(EPOCH FROM NOW() - pg_postmaster_start_time())::int AS uptime_seconds`);
  const pingMs = Date.now() - t0;
  const [stats] = await q(`SELECT blks_hit, blks_read, xact_commit, xact_rollback, deadlocks, temp_bytes
                           FROM pg_stat_database WHERE datname = current_database()`);
  const connections = await q(`SELECT COALESCE(state, 'other') AS state, COUNT(*)::int AS n FROM pg_stat_activity
                               WHERE datname = current_database() GROUP BY 1 ORDER BY 2 DESC`);
  const settings = Object.fromEntries((await q(`SELECT name, setting, unit FROM pg_settings
    WHERE name IN ('max_connections', 'shared_buffers', 'work_mem', 'effective_cache_size', 'maintenance_work_mem', 'random_page_cost', 'log_min_duration_statement')`))
    .map((s) => [s.name, s.unit === '8kB' ? `${Math.round((Number(s.setting) * 8) / 1024)} MB` : s.unit === 'kB' ? `${Math.round(Number(s.setting) / 1024)} MB` : `${s.setting}${s.unit && s.unit !== '' ? ` ${s.unit}` : ''}`]));
  const tables = await q(`SELECT relname AS table_name, n_live_tup::bigint AS rows, pg_total_relation_size(relid) AS size_bytes,
                                 GREATEST(last_vacuum, last_autovacuum) AS last_vacuum, GREATEST(last_analyze, last_autoanalyze) AS last_analyze
                          FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10`);
  const longRunning = await q(`SELECT pid, state, EXTRACT(EPOCH FROM NOW() - query_start)::int AS seconds, LEFT(query, 160) AS query
                               FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()
                                 AND query_start < NOW() - interval '5 seconds' ORDER BY query_start LIMIT 10`);
  const [business] = await q(`SELECT (SELECT COUNT(*) FROM cost_centers)::int AS cost_centers,
                                     (SELECT COUNT(DISTINCT landlord_name) FROM rent_master)::int AS landlords,
                                     (SELECT COUNT(*) FROM sd_master)::int AS sd_records,
                                     (SELECT COUNT(*) FROM sd_transactions)::int AS sd_transactions,
                                     (SELECT COUNT(*) FROM rent_master)::int AS rent_codes,
                                     (SELECT COUNT(*) FROM rent_agreements)::int AS agreements,
                                     (SELECT COUNT(*) FROM rent_schedule_lines)::bigint AS schedule_lines,
                                     (SELECT COUNT(*) FROM audit_log)::bigint AS audit_entries`);
  const hit = Number(stats.blks_hit);
  const read = Number(stats.blks_read);
  return {
    ...info, pingMs,
    cacheHitPercent: hit + read ? +((hit / (hit + read)) * 100).toFixed(2) : 100,
    commits: Number(stats.xact_commit), rollbacks: Number(stats.xact_rollback), deadlocks: Number(stats.deadlocks), tempBytes: Number(stats.temp_bytes),
    connections, settings, tables, longRunning, business,
  };
}

module.exports = { databaseHealth };
