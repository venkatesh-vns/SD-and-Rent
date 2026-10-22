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
