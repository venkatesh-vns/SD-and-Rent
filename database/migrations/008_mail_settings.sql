-- ============================================================
-- 008 - Mail server (SMTP) and sender settings
--   * one row (setting_id = 1), edited by administrators on the
--     Email Notification Master screen
--   * a blank column means "use the value from server/.env"
--   * the SMTP password is stored encrypted (AES-256-GCM, key from
--     SETTINGS_SECRET or JWT_SECRET) and never sent to the browser
-- ============================================================

CREATE TABLE IF NOT EXISTS mail_settings (
    setting_id          SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (setting_id = 1),
    smtp_host           VARCHAR(255) NULL,
    smtp_port           INT          NULL CHECK (smtp_port IS NULL OR smtp_port BETWEEN 1 AND 65535),
    smtp_secure         BOOLEAN      NULL,   -- TRUE = SSL/TLS (usually 465); FALSE = STARTTLS / plain (587, 25)
    smtp_user           VARCHAR(255) NULL,
    smtp_password_enc   TEXT         NULL,
    from_name           VARCHAR(150) NULL,
    from_email          VARCHAR(255) NULL,
    default_recipients  TEXT         NULL,   -- used when a template's To is blank
    modified_date       TIMESTAMP    NULL,
    modified_by         VARCHAR(100) NULL
);
