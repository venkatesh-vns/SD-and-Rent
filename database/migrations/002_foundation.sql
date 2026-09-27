-- ============================================================
-- 002 - Foundation (V1 plan, Phase 1)
--   * admin flag + session versioning on users
--   * uploaded_by / uploaded_date audit fields on masters
--   * auto-generated Cost Center Code
--   * screens + user_rights (User Rights Master)
--   * upload_batches (bulk upload validation reports)
--   * email_log (every email the application sends)
--   * audit_log old/new values
-- ============================================================

-- ------------------------------------------------------------
-- users: admin flag, session version, upload audit fields
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin      BOOLEAN   NOT NULL DEFAULT FALSE;
-- Incremented on logout / password change / reset; a JWT carrying an
-- older version is rejected, which ends every session of that user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT       NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS uploaded_by   VARCHAR(100) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS uploaded_date TIMESTAMP    NULL;

UPDATE users SET is_admin = TRUE WHERE user_name = 'admin';

-- ------------------------------------------------------------
-- cost_centers: auto-generated code (CC0001, CC0002, ...)
-- Existing hand-typed codes are kept; the sequence starts after
-- the highest existing CCnnn code.
-- ------------------------------------------------------------
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS uploaded_by   VARCHAR(100) NULL;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS uploaded_date TIMESTAMP    NULL;

CREATE SEQUENCE IF NOT EXISTS cost_center_code_seq;
SELECT setval(
  'cost_center_code_seq',
  COALESCE((SELECT MAX(substring(cost_center_code FROM '^CC(\d+)$')::int) FROM cost_centers), 0) + 1,
  false
);
ALTER TABLE cost_centers
  ALTER COLUMN cost_center_code SET DEFAULT 'CC' || lpad(nextval('cost_center_code_seq')::text, 4, '0');

-- ------------------------------------------------------------
-- screens: every menu entry that User Rights can control
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS screens (
    screen_code  VARCHAR(50)  PRIMARY KEY,
    screen_name  VARCHAR(100) NOT NULL,
    menu_group   VARCHAR(50)  NOT NULL,
    sort_order   INT          NOT NULL DEFAULT 0
);

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('COST_CENTER',    'Cost Center Master', 'Masters',      10),
  ('USER',           'User Master',        'Masters',      20),
  ('USER_RIGHTS',    'User Rights Master', 'Masters',      30),
  ('LOCATION',       'Location Master',    'Masters',      40),
  ('SD_MASTER',      'SD Master',          'Masters',      50),
  ('SD_TRANSACTION', 'SD Transaction',     'Transactions', 60)
ON CONFLICT (screen_code) DO NOTHING;

-- ------------------------------------------------------------
-- user_rights: View / Add / Edit / Delete / Upload per user per screen
-- Admin users (users.is_admin) bypass this table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_rights (
    user_right_id  SERIAL PRIMARY KEY,
    user_id        INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    screen_code    VARCHAR(50)  NOT NULL REFERENCES screens(screen_code),
    can_view       BOOLEAN      NOT NULL DEFAULT FALSE,
    can_add        BOOLEAN      NOT NULL DEFAULT FALSE,
    can_edit       BOOLEAN      NOT NULL DEFAULT FALSE,
    can_delete     BOOLEAN      NOT NULL DEFAULT FALSE,
    can_upload     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_date   TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date  TIMESTAMP    NULL,
    created_by     VARCHAR(100) NULL,
    modified_by    VARCHAR(100) NULL,
    CONSTRAINT uq_user_rights_user_screen UNIQUE (user_id, screen_code)
);

-- Existing non-admin users keep the access they had before rights
-- existed (full access to the two masters that were already built).
INSERT INTO user_rights (user_id, screen_code, can_view, can_add, can_edit, can_delete, can_upload, created_by)
SELECT u.user_id, s.screen_code, TRUE, TRUE, TRUE, TRUE, TRUE, 'migration-002'
FROM users u
CROSS JOIN screens s
WHERE s.screen_code IN ('COST_CENTER', 'USER')
  AND u.is_admin = FALSE
ON CONFLICT (user_id, screen_code) DO NOTHING;

-- ------------------------------------------------------------
-- upload_batches: one row per Excel upload, with its row-level report
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_batches (
    batch_id       SERIAL PRIMARY KEY,
    screen_code    VARCHAR(50)  NOT NULL REFERENCES screens(screen_code),
    file_name      VARCHAR(255) NULL,
    total_rows     INT          NOT NULL DEFAULT 0,
    passed_rows    INT          NOT NULL DEFAULT 0,
    failed_rows    INT          NOT NULL DEFAULT 0,
    report         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    uploaded_by    VARCHAR(100) NULL,
    uploaded_date  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- email_log: every email the application sends (or fails to send)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_log (
    email_log_id       SERIAL PRIMARY KEY,
    sd_code            VARCHAR(30)  NULL,
    notification_type  VARCHAR(50)  NOT NULL,
    recipient          VARCHAR(255) NOT NULL,
    subject            VARCHAR(255) NOT NULL,
    trigger_event      VARCHAR(255) NULL,
    status             VARCHAR(10)  NOT NULL CHECK (status IN ('Sent', 'Failed')),
    error_message      TEXT         NULL,
    sent_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_email_log_sd_code ON email_log(sd_code);

-- ------------------------------------------------------------
-- audit_log: keep before/after values of each change
-- ------------------------------------------------------------
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS old_values JSONB NULL;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS new_values JSONB NULL;

CREATE INDEX IF NOT EXISTS ix_audit_log_record ON audit_log(table_name, record_id);
