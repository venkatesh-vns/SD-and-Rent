-- SD Master: Lease ID and Agreement No. may repeat across SD records.
-- Drops the unique Lease ID + Agreement No. + Floor key; each SD record keeps its own SD Code.
DROP INDEX IF EXISTS ux_sd_master_business_key;

-- Plain index for searching by Lease ID / Agreement No.
CREATE INDEX IF NOT EXISTS ix_sd_master_lease_agreement ON sd_master (LOWER(lease_id), LOWER(agreement_no));
