-- ============================================================================
-- SD and Rent UAT - Database upgrade script
-- UAT Release 1 (2.0.0-uat.1, changes 001-012)  ->  UAT Release 2 (2.0.0-uat.2, changes 013-025)
-- ============================================================================
-- The UAT 2 application applies these changes BY ITSELF on its first start, right after
-- taking a verified backup (%APPDATA%\SD and Rent UAT\backups\pre-upgrade\*.dump).
-- This script is the same set of changes, for review by IT / a DBA or to apply by hand:
--   "C:\Program Files\SD and Rent UAT\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p <port>
--       -U sdadmin -d sd_maintenance -f UAT2_Database_Upgrade.sql
--   (port and password: %APPDATA%\SD and Rent UAT\config.json, server.pgPort / server.dbPassword)
--
-- Safe for existing data (backward-compatible):
--   * Only adds tables, columns (with defaults), indexes, triggers, menu entries and rules that
--     the existing rows already meet. No business row (masters, SD, rent, users, rights,
--     logs) is updated or deleted. 013 only renames the menu group "Transactions" to
--     "SD Transaction" in the screens list.
--   * 017 (SD Master duplicate key) contains every column of the UAT 1 key, so data valid in
--     UAT 1 is valid here.
--   * Each change runs once: it is skipped when schema_migrations records it already, and it
--     runs in its own transaction (all of it or nothing). The script stops at the first error.
--   * Tested: a UAT 1 database with test data upgraded; all 22 data tables identical after.
-- Changes: 013_sd_transaction_menu.sql, 014_sd_paid_reversal.sql, 015_sd_balance_reversals.sql, 016_sd_master_allow_duplicate_lease.sql, 017_sd_master_duplicate_key.sql, 018_rent_other_charges.sql, 019_performance_indexes.sql, 020_user_sessions.sql, 021_cache_security_maintenance.sql, 022_backup_runs.sql, 023_log_retention.sql, 024_sd_document_master.sql, 025_sd_document_batches.sql
-- ============================================================================
\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT NOW());

-- ----------------------------------------------------------------------------
-- 013_sd_transaction_menu.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '013_sd_transaction_menu.sql') AS todo \gset
\if :todo
BEGIN;
-- ============================================================
-- 013 - Menu: "Transactions" renamed "SD Transaction"; SD Master moves under it
--   SD Transaction > SD Master, SD Transactions
--   (screen codes and user rights are unchanged)
-- ============================================================

UPDATE screens SET menu_group = 'SD Transaction', sort_order = 55 WHERE screen_code = 'SD_MASTER';
UPDATE screens SET menu_group = 'SD Transaction', screen_name = 'SD Transactions', sort_order = 60 WHERE screen_code = 'SD_TRANSACTION';
INSERT INTO schema_migrations (filename) VALUES ('013_sd_transaction_menu.sql');
COMMIT;
\echo 'Applied 013_sd_transaction_menu.sql'
\else
\echo 'Already applied: 013_sd_transaction_menu.sql'
\endif

-- ----------------------------------------------------------------------------
-- 014_sd_paid_reversal.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '014_sd_paid_reversal.sql') AS todo \gset
\if :todo
BEGIN;
-- ============================================================
-- 014 - SD Paid negative (reversal / credit note) entries
--   * SD Paid Amount may be negative: a reversal of an earlier, wrong payment.
--     Transfer, Adjustment and Refund stay 0 or more.
--   * reverses_txn_id optionally links a reversal to the payment it corrects.
--   * New right "SD Negative Entry": only users with its Add right (and admins)
--     may save negative SD Paid amounts.
-- Balances stay as before (SD Balance = Agreement - Paid; Repayable =
-- Paid - Transfer - Adjustment - Refund), now netting the reversals.
-- ============================================================

ALTER TABLE sd_transactions DROP CONSTRAINT IF EXISTS sd_transactions_paid_amount_check;
ALTER TABLE sd_transactions DROP CONSTRAINT IF EXISTS ck_sd_transactions_amount;
ALTER TABLE sd_transactions ADD CONSTRAINT ck_sd_transactions_amount CHECK (
    paid_amount <> 0 OR transfer_amount > 0 OR adjustment_amount > 0 OR refund_amount > 0);
-- A reversal is an entry of its own: negative SD Paid only
ALTER TABLE sd_transactions ADD CONSTRAINT ck_sd_transactions_reversal CHECK (
    paid_amount >= 0 OR (transfer_amount = 0 AND adjustment_amount = 0 AND refund_amount = 0));

ALTER TABLE sd_transactions ADD COLUMN IF NOT EXISTS reverses_txn_id INT NULL
    REFERENCES sd_transactions(txn_id) ON DELETE RESTRICT;
ALTER TABLE sd_transactions ADD CONSTRAINT ck_sd_transactions_reverses CHECK (
    reverses_txn_id IS NULL OR paid_amount < 0);
CREATE INDEX IF NOT EXISTS ix_sd_transactions_reverses ON sd_transactions (reverses_txn_id);

-- The ledger view lists t.*; re-create it so it includes the new column
DROP VIEW IF EXISTS v_sd_ledger;
CREATE VIEW v_sd_ledger AS
SELECT t.*,
       s.sd_code,
       s.agreement_value,
       SUM(t.paid_amount) OVER w                                        AS running_paid,
       s.agreement_value - SUM(t.paid_amount) OVER w                    AS running_sd_balance,
       SUM(t.paid_amount - t.transfer_amount - t.refund_amount - t.adjustment_amount) OVER w
                                                                         AS running_repayable
FROM sd_transactions t
JOIN sd_master s ON s.sd_id = t.sd_id
WINDOW w AS (PARTITION BY t.sd_id ORDER BY t.txn_date, t.txn_id ROWS UNBOUNDED PRECEDING);

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('SD_NEGATIVE_ENTRY', 'SD Negative Entry (SD Paid reversal)', 'SD Transaction', 62)
ON CONFLICT (screen_code) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('014_sd_paid_reversal.sql');
COMMIT;
\echo 'Applied 014_sd_paid_reversal.sql'
\else
\echo 'Already applied: 014_sd_paid_reversal.sql'
\endif

-- ----------------------------------------------------------------------------
-- 015_sd_balance_reversals.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '015_sd_balance_reversals.sql') AS todo \gset
\if :todo
BEGIN;
-- ============================================================
-- 015 - Reversal (negative SD Paid) entries shown in balances
--   v_sd_balance keeps its columns (total_paid stays NET of reversals, so
--   SD Balance and Repayable already include them) and adds:
--     total_payments  - sum of the positive SD Paid entries
--     total_reversal  - sum of the negative SD Paid entries (0 or less)
--     reversal_count  - number of reversal entries
-- ============================================================

CREATE OR REPLACE VIEW v_sd_balance AS
SELECT s.sd_id,
       s.sd_code,
       s.agreement_value,
       COALESCE(SUM(t.paid_amount), 0)        AS total_paid,
       COALESCE(SUM(t.transfer_amount), 0)    AS total_transfer,
       COALESCE(SUM(t.adjustment_amount), 0)  AS total_adjustment,
       COALESCE(SUM(t.refund_amount), 0)      AS total_refund,
       s.agreement_value - COALESCE(SUM(t.paid_amount), 0) AS sd_balance,
       COALESCE(SUM(t.paid_amount - t.transfer_amount - t.refund_amount - t.adjustment_amount), 0)
                                               AS sd_balance_repayable,
       COUNT(t.txn_id)::int                    AS txn_count,
       MAX(t.txn_date)                         AS last_txn_date,
       COALESCE(SUM(t.paid_amount) FILTER (WHERE t.paid_amount > 0), 0) AS total_payments,
       COALESCE(SUM(t.paid_amount) FILTER (WHERE t.paid_amount < 0), 0) AS total_reversal,
       COUNT(t.txn_id) FILTER (WHERE t.paid_amount < 0)::int            AS reversal_count
FROM sd_master s
LEFT JOIN sd_transactions t ON t.sd_id = s.sd_id
GROUP BY s.sd_id, s.sd_code, s.agreement_value;
INSERT INTO schema_migrations (filename) VALUES ('015_sd_balance_reversals.sql');
COMMIT;
\echo 'Applied 015_sd_balance_reversals.sql'
\else
\echo 'Already applied: 015_sd_balance_reversals.sql'
\endif

-- ----------------------------------------------------------------------------
-- 016_sd_master_allow_duplicate_lease.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '016_sd_master_allow_duplicate_lease.sql') AS todo \gset
\if :todo
BEGIN;
-- SD Master: Lease ID and Agreement No. may repeat across SD records.
-- Drops the unique Lease ID + Agreement No. + Floor key; each SD record keeps its own SD Code.
DROP INDEX IF EXISTS ux_sd_master_business_key;

-- Plain index for searching by Lease ID / Agreement No.
CREATE INDEX IF NOT EXISTS ix_sd_master_lease_agreement ON sd_master (LOWER(lease_id), LOWER(agreement_no));
INSERT INTO schema_migrations (filename) VALUES ('016_sd_master_allow_duplicate_lease.sql');
COMMIT;
\echo 'Applied 016_sd_master_allow_duplicate_lease.sql'
\else
\echo 'Already applied: 016_sd_master_allow_duplicate_lease.sql'
\endif

-- ----------------------------------------------------------------------------
-- 017_sd_master_duplicate_key.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '017_sd_master_duplicate_key.sql') AS todo \gset
\if :todo
BEGIN;
-- SD Master duplicate rule: the same Lease ID + Agreement No. is allowed only for a
-- different Cost Center, Location (Level 1-3), Floor or Landlord Name.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sd_master_duplicate_key
    ON sd_master (
        cost_center_id, l1_id, l2_id, l3_id, LOWER(floor),
        LOWER(COALESCE(landlord_name, '')), LOWER(COALESCE(lease_id, '')), LOWER(COALESCE(agreement_no, ''))
    )
    WHERE lease_id IS NOT NULL OR agreement_no IS NOT NULL;
INSERT INTO schema_migrations (filename) VALUES ('017_sd_master_duplicate_key.sql');
COMMIT;
\echo 'Applied 017_sd_master_duplicate_key.sql'
\else
\echo 'Already applied: 017_sd_master_duplicate_key.sql'
\endif

-- ----------------------------------------------------------------------------
-- 018_rent_other_charges.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '018_rent_other_charges.sql') AS todo \gset
\if :todo
BEGIN;
-- Rent Agreement: new "Rent Other Charges" component (Rate / Month x %, from the RCD),
-- like "Rent to Landlord - Solar". Usable in Rule Master, Waiver Master and Rent Schedule.
ALTER TABLE rent_agreement_components DROP CONSTRAINT IF EXISTS rent_agreement_components_component_code_check;
ALTER TABLE rent_agreement_components ADD CONSTRAINT rent_agreement_components_component_code_check
    CHECK (component_code IN (
        'ADDITIONAL_PARKING', 'FITOUTS', 'CAFE', 'CAR_PARK', 'OFFICE',
        'SIGNAGE', 'SOLAR', 'TERRACE', 'MAINTENANCE', 'OTHER_CHARGES'));
INSERT INTO schema_migrations (filename) VALUES ('018_rent_other_charges.sql');
COMMIT;
\echo 'Applied 018_rent_other_charges.sql'
\else
\echo 'Already applied: 018_rent_other_charges.sql'
\endif

-- ----------------------------------------------------------------------------
-- 019_performance_indexes.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '019_performance_indexes.sql') AS todo \gset
\if :todo
BEGIN;
-- Performance: indexes for the code lookups used by every upload row and screen
-- (they compare UPPER(code) / LOWER(name), which a plain unique index cannot serve),
-- and for the larger lists and reports.
CREATE INDEX IF NOT EXISTS ix_sd_master_code_upper        ON sd_master (UPPER(sd_code));
CREATE INDEX IF NOT EXISTS ix_sd_transactions_no_upper    ON sd_transactions (UPPER(txn_no));
CREATE INDEX IF NOT EXISTS ix_rent_master_code_upper      ON rent_master (UPPER(rent_code));
CREATE INDEX IF NOT EXISTS ix_cost_centers_code_upper     ON cost_centers (UPPER(cost_center_code));
CREATE INDEX IF NOT EXISTS ix_cost_centers_name_lower     ON cost_centers (LOWER(cost_center_name));
CREATE INDEX IF NOT EXISTS ix_sd_master_landlord          ON sd_master (landlord_name);
CREATE INDEX IF NOT EXISTS ix_rent_master_landlord        ON rent_master (landlord_name);
CREATE INDEX IF NOT EXISTS ix_rent_agreements_rent        ON rent_agreements (rent_id);
CREATE INDEX IF NOT EXISTS ix_rent_agreements_transfer    ON rent_agreements (transfer_from_rent_id) WHERE transfer_from_rent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_rent_schedule_agreement     ON rent_schedule_lines (agreement_id);
CREATE INDEX IF NOT EXISTS ix_rent_schedule_period_from   ON rent_schedule_lines (period_from);  -- SD & Rent report dates
CREATE INDEX IF NOT EXISTS ix_audit_log_action            ON audit_log (table_name, action_date DESC);
CREATE INDEX IF NOT EXISTS ix_upload_batches_screen       ON upload_batches (screen_code);

ANALYZE;
INSERT INTO schema_migrations (filename) VALUES ('019_performance_indexes.sql');
COMMIT;
\echo 'Applied 019_performance_indexes.sql'
\else
\echo 'Already applied: 019_performance_indexes.sql'
\endif

-- ----------------------------------------------------------------------------
-- 020_user_sessions.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '020_user_sessions.sql') AS todo \gset
\if :todo
BEGIN;
-- One login session per User ID: a second login (another browser, PC or the
-- desktop app) is refused while the first session is live. A session stays live
-- while its browser sends a heartbeat (closed browsers stop after a few minutes)
-- and the user has been active within the idle timeout (30 minutes).
-- Administrators can end a session from User Master.
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id        UUID          PRIMARY KEY,
    user_id           INT           NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    started_at        TIMESTAMP     NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMP     NOT NULL DEFAULT NOW(),   -- any request or heartbeat
    last_activity_at  TIMESTAMP     NOT NULL DEFAULT NOW(),   -- user activity (not idle)
    ip_address        VARCHAR(64)   NULL,
    user_agent        VARCHAR(400)  NULL,
    client_label      VARCHAR(100)  NULL,                      -- e.g. 'Chrome on Windows'
    ended_at          TIMESTAMP     NULL,
    end_reason        VARCHAR(100)  NULL,                      -- Logged out, Idle timeout, Ended by administrator, ...
    ended_by          VARCHAR(100)  NULL
);
CREATE INDEX IF NOT EXISTS ix_user_sessions_open ON user_sessions (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_user_sessions_started ON user_sessions (started_at DESC);
INSERT INTO schema_migrations (filename) VALUES ('020_user_sessions.sql');
COMMIT;
\echo 'Applied 020_user_sessions.sql'
\else
\echo 'Already applied: 020_user_sessions.sql'
\endif

-- ----------------------------------------------------------------------------
-- 021_cache_security_maintenance.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '021_cache_security_maintenance.sql') AS todo \gset
\if :todo
BEGIN;
-- 1) Cache invalidation: a change to a business table announces itself on the
--    'app_data_changed' channel (delivered when the transaction commits). Every
--    web worker listens and drops its cached results that depend on that table.
CREATE OR REPLACE FUNCTION notify_data_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('app_data_changed', TG_TABLE_NAME);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cost_centers', 'location_l1', 'location_l2', 'location_l3', 'sd_master', 'sd_status_history', 'sd_transactions',
    'rent_master', 'rent_agreements', 'rent_agreement_components', 'rent_rules', 'rent_waivers', 'rent_schedule_lines',
    'email_log', 'notification_templates', 'users']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_notify_changed ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_notify_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed()', t);
  END LOOP;
END $$;

-- 2) Account lockout after repeated wrong passwords
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INT       NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until  TIMESTAMP NULL;

-- 3) Long-term upkeep of the tables that grow every month: vacuum and refresh
--    statistics after 5% / 2% of rows change (defaults 20% / 10%), so plans stay
--    good as the tables reach millions of rows
ALTER TABLE rent_schedule_lines SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE sd_transactions     SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE audit_log           SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE user_sessions       SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
INSERT INTO schema_migrations (filename) VALUES ('021_cache_security_maintenance.sql');
COMMIT;
\echo 'Applied 021_cache_security_maintenance.sql'
\else
\echo 'Already applied: 021_cache_security_maintenance.sql'
\endif

-- ----------------------------------------------------------------------------
-- 022_backup_runs.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '022_backup_runs.sql') AS todo \gset
\if :todo
BEGIN;
-- Database backups (nightly and "Back up now"): one row per run, for System Health
CREATE TABLE IF NOT EXISTS backup_runs (
    backup_id     SERIAL       PRIMARY KEY,
    started_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMP    NULL,
    reason        VARCHAR(50)  NOT NULL,              -- 'Nightly' / 'Manual'
    file_path     VARCHAR(500) NULL,
    size_bytes    BIGINT       NULL,
    verified      BOOLEAN      NOT NULL DEFAULT FALSE, -- pg_restore could read the file back
    ok            BOOLEAN      NULL,
    message       VARCHAR(1000) NULL,
    started_by    VARCHAR(100) NULL
);
CREATE INDEX IF NOT EXISTS ix_backup_runs_started ON backup_runs (started_at DESC);
INSERT INTO schema_migrations (filename) VALUES ('022_backup_runs.sql');
COMMIT;
\echo 'Applied 022_backup_runs.sql'
\else
\echo 'Already applied: 022_backup_runs.sql'
\endif

-- ----------------------------------------------------------------------------
-- 023_log_retention.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '023_log_retention.sql') AS todo \gset
\if :todo
BEGIN;
-- Log retention: history of the nightly log clean-up (and "Run clean-up now")
CREATE TABLE IF NOT EXISTS maintenance_runs (
    run_id        SERIAL       PRIMARY KEY,
    job           VARCHAR(50)  NOT NULL,              -- 'Log retention'
    started_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMP    NULL,
    ok            BOOLEAN      NULL,
    started_by    VARCHAR(100) NULL,
    details       JSONB        NULL                   -- per table: archived / deleted / file
);
CREATE INDEX IF NOT EXISTS ix_maintenance_runs_started ON maintenance_runs (job, started_at DESC);

-- Date columns the clean-up filters on
CREATE INDEX IF NOT EXISTS ix_email_log_sent      ON email_log (sent_at);
CREATE INDEX IF NOT EXISTS ix_upload_batches_date ON upload_batches (uploaded_date);
CREATE INDEX IF NOT EXISTS ix_user_sessions_ended ON user_sessions (ended_at);
INSERT INTO schema_migrations (filename) VALUES ('023_log_retention.sql');
COMMIT;
\echo 'Applied 023_log_retention.sql'
\else
\echo 'Already applied: 023_log_retention.sql'
\endif

-- ----------------------------------------------------------------------------
-- 024_sd_document_master.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '024_sd_document_master.sql') AS todo \gset
\if :todo
BEGIN;
-- SD Document Master: PDF / Word documents attached to an SD Code, with versions.
-- One row per version. A document is the group of its versions (group_id = the
-- document_id of version 1); exactly one version per document is the latest.
-- The file itself is stored on disk (DOCUMENT_DIR), not in the database, so the
-- database and its backups stay small; stored_path is relative to DOCUMENT_DIR.
-- Deleting a document only marks it Deleted (files and rows are kept for audit).
CREATE TABLE IF NOT EXISTS sd_document_master (
    document_id    SERIAL        PRIMARY KEY,
    sd_id          INT           NOT NULL REFERENCES sd_master(sd_id) ON DELETE CASCADE,
    group_id       INT           NOT NULL,
    version_no     INT           NOT NULL CHECK (version_no >= 1),
    is_latest      BOOLEAN       NOT NULL DEFAULT TRUE,
    document_type  VARCHAR(40)   NOT NULL,
    title          VARCHAR(200)  NOT NULL,
    remarks        VARCHAR(500)  NULL,
    file_name      VARCHAR(255)  NOT NULL,                -- name of the uploaded file
    file_ext       VARCHAR(5)    NOT NULL CHECK (file_ext IN ('pdf', 'doc', 'docx')),
    mime_type      VARCHAR(100)  NOT NULL,
    size_bytes     BIGINT        NOT NULL CHECK (size_bytes > 0),
    sha256         CHAR(64)      NOT NULL,
    stored_path    VARCHAR(500)  NOT NULL,
    status         VARCHAR(10)   NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Deleted')),
    uploaded_by    VARCHAR(100)  NOT NULL,
    uploaded_date  TIMESTAMP     NOT NULL DEFAULT NOW(),
    deleted_by     VARCHAR(100)  NULL,
    deleted_date   TIMESTAMP     NULL,
    delete_reason  VARCHAR(500)  NULL,
    CONSTRAINT uq_sd_document_version UNIQUE (group_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sd_document_latest ON sd_document_master (group_id) WHERE is_latest;
CREATE INDEX IF NOT EXISTS ix_sd_document_sd ON sd_document_master (sd_id, status) WHERE is_latest;
CREATE INDEX IF NOT EXISTS ix_sd_document_hash ON sd_document_master (sd_id, sha256);

DROP TRIGGER IF EXISTS trg_notify_changed ON sd_document_master;
CREATE TRIGGER trg_notify_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON sd_document_master
  FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed();
INSERT INTO schema_migrations (filename) VALUES ('024_sd_document_master.sql');
COMMIT;
\echo 'Applied 024_sd_document_master.sql'
\else
\echo 'Already applied: 024_sd_document_master.sql'
\endif

-- ----------------------------------------------------------------------------
-- 025_sd_document_batches.sql
-- ----------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '025_sd_document_batches.sql') AS todo \gset
\if :todo
BEGIN;
-- SD Document Upload: bulk upload of SD Master documents from a template
-- (S.No, SD Code / SD ID, Document Type, File Path). Each upload is a batch with a
-- status per row; an administrator can bulk delete a whole batch (or every batch
-- of a day) when it was uploaded wrongly.
CREATE SEQUENCE IF NOT EXISTS sd_document_batch_seq;

CREATE TABLE IF NOT EXISTS sd_document_batches (
    batch_id       SERIAL        PRIMARY KEY,
    batch_no       VARCHAR(20)   NOT NULL UNIQUE DEFAULT 'DOCB' || lpad(nextval('sd_document_batch_seq')::text, 6, '0'),
    template_name  VARCHAR(255)  NOT NULL,
    total_rows     INT           NOT NULL DEFAULT 0,
    success_rows   INT           NOT NULL DEFAULT 0,
    failed_rows    INT           NOT NULL DEFAULT 0,
    status         VARCHAR(15)   NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Completed', 'Deleted')),
    uploaded_by    VARCHAR(100)  NOT NULL,
    uploaded_date  TIMESTAMP     NOT NULL DEFAULT NOW(),
    completed_date TIMESTAMP     NULL,
    deleted_by     VARCHAR(100)  NULL,
    deleted_date   TIMESTAMP     NULL,
    delete_reason  VARCHAR(500)  NULL
);
CREATE INDEX IF NOT EXISTS ix_sd_document_batches_date ON sd_document_batches (uploaded_date DESC);

CREATE TABLE IF NOT EXISTS sd_document_batch_rows (
    batch_id       INT           NOT NULL REFERENCES sd_document_batches(batch_id) ON DELETE CASCADE,
    row_no         INT           NOT NULL,                 -- Excel row
    s_no           VARCHAR(20)   NULL,
    sd_ref         VARCHAR(50)   NULL,                     -- SD Code / SD ID as given
    sd_id          INT           NULL,
    sd_code        VARCHAR(20)   NULL,
    document_type  VARCHAR(40)   NULL,
    file_path      VARCHAR(1000) NULL,
    status         VARCHAR(10)   NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Success', 'Failed', 'Deleted')),
    message        VARCHAR(500)  NULL,
    document_id    INT           NULL REFERENCES sd_document_master(document_id),
    processed_date TIMESTAMP     NULL,
    PRIMARY KEY (batch_id, row_no)
);

-- Which bulk upload a document came from
ALTER TABLE sd_document_master ADD COLUMN IF NOT EXISTS batch_id INT NULL REFERENCES sd_document_batches(batch_id);
CREATE INDEX IF NOT EXISTS ix_sd_document_batch ON sd_document_master (batch_id) WHERE batch_id IS NOT NULL;

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('SD_DOCUMENT_UPLOAD', 'SD Document Upload', 'SD Transaction', 65)
ON CONFLICT (screen_code) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('025_sd_document_batches.sql');
COMMIT;
\echo 'Applied 025_sd_document_batches.sql'
\else
\echo 'Already applied: 025_sd_document_batches.sql'
\endif

\echo 'UAT 2 database upgrade complete.'
