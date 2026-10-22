-- Recommended PostgreSQL settings for the SD Maintenance server PC
-- (the desktop app's own database gets these automatically on every start).
--
-- For a separately installed PostgreSQL (e.g. the office server), a DBA runs this
-- once as the postgres superuser, then restarts the PostgreSQL service:
--   psql -U postgres -f postgresql_performance.sql
--   (Windows) Services > postgresql-x64-18 > Restart
-- Values are for a PC with 16 GB RAM and an SSD; scale shared_buffers (25% of RAM,
-- up to 1-2 GB on Windows) and effective_cache_size (about half of RAM) to the PC.
-- These settings apply to every database on that PostgreSQL server.

ALTER SYSTEM SET max_connections = 100;            -- 4 web workers x 10 connections + tools
ALTER SYSTEM SET shared_buffers = '1GB';           -- default 128MB
ALTER SYSTEM SET effective_cache_size = '8GB';     -- planner hint: OS file cache
ALTER SYSTEM SET work_mem = '16MB';                -- per sort / hash (reports, dashboard)
ALTER SYSTEM SET maintenance_work_mem = '256MB';   -- index builds, VACUUM
ALTER SYSTEM SET random_page_cost = 1.1;           -- SSD
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET log_min_duration_statement = '2s';-- log slow statements for review

-- After the restart, check:  SHOW shared_buffers;  SHOW work_mem;
