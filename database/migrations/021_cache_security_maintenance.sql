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
