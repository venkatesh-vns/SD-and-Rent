-- ============================================================
-- 006 - Notifications, logs and reports (V1 plan, Phase 5)
--   * email_log gains a 'DryRun' status (EMAIL_DRY_RUN=true: messages are
--     built and logged but not sent - for test / UAT environments)
--   * new screens controlled by User Rights: SD Balance Report, Email Log,
--     Audit Log (View gives read + export)
-- ============================================================

ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_status_check CHECK (status IN ('Sent', 'Failed', 'DryRun'));

-- Reminder de-duplication looks up (sd_code, notification_type, trigger_event)
CREATE INDEX IF NOT EXISTS ix_email_log_dedupe ON email_log (sd_code, notification_type, trigger_event);
CREATE INDEX IF NOT EXISTS ix_email_log_sent_at ON email_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_date ON audit_log (action_date DESC);

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('SD_REPORT', 'SD Balance Report', 'Reports',        70),
  ('EMAIL_LOG', 'Email Log',         'Administration', 80),
  ('AUDIT_LOG', 'Audit Log',         'Administration', 90)
ON CONFLICT (screen_code) DO NOTHING;
