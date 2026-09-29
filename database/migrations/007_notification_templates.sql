-- ============================================================
-- 007 - Email Notification Master
--   * one editable template per SD notification: on/off, recipients,
--     CC, trigger days (date reminders), subject and body with
--     {{placeholders}}, optional SD details table
--   * rows are created from the application's default templates the
--     first time they are read (server/services/notificationTemplates.js)
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_templates (
    template_id        SERIAL PRIMARY KEY,
    notification_type  VARCHAR(50)  NOT NULL UNIQUE,
    is_enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    to_recipients      TEXT         NULL,   -- blank = NOTIFY_TO from the server .env
    cc_recipients      TEXT         NULL,
    days_before        INT          NULL CHECK (days_before IS NULL OR days_before BETWEEN 0 AND 365),
    subject            VARCHAR(255) NOT NULL,
    body               TEXT         NOT NULL,
    include_details    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_date       TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date      TIMESTAMP    NULL,
    created_by         VARCHAR(100) NULL,
    modified_by        VARCHAR(100) NULL
);

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('NOTIFICATION', 'Email Notification Master', 'Masters', 45)
ON CONFLICT (screen_code) DO NOTHING;
