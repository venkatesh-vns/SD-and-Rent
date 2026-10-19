-- SD Master duplicate rule: the same Lease ID + Agreement No. is allowed only for a
-- different Cost Center, Location (Level 1-3), Floor or Landlord Name.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sd_master_duplicate_key
    ON sd_master (
        cost_center_id, l1_id, l2_id, l3_id, LOWER(floor),
        LOWER(COALESCE(landlord_name, '')), LOWER(COALESCE(lease_id, '')), LOWER(COALESCE(agreement_no, ''))
    )
    WHERE lease_id IS NOT NULL OR agreement_no IS NOT NULL;
