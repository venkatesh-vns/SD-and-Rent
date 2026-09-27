-- ============================================================
-- 004 - SD Master (V1 plan, Phase 3)
--   * one row per lease, identified by an auto-generated SD Code (SD000001)
--   * cost center and Level 1-3 location are mandatory; referenced
--     masters cannot be deleted while SD records use them
--   * duplicate business key = Lease ID + Agreement No. + Floor, checked
--     when Lease ID or Agreement No. is filled in
--   * Landlord / Building Status changes are kept in sd_status_history
-- ============================================================

-- Lets sd_master reference a Level 3 together with its Level 2 and Level 1,
-- so the three always agree and follow the location when it is moved.
ALTER TABLE location_l3 DROP CONSTRAINT IF EXISTS uq_location_l3_path;
ALTER TABLE location_l3 ADD CONSTRAINT uq_location_l3_path UNIQUE (l3_id, l2_id, l1_id);

CREATE SEQUENCE IF NOT EXISTS sd_code_seq;

CREATE TABLE IF NOT EXISTS sd_master (
    sd_id                     SERIAL PRIMARY KEY,
    sd_code                   VARCHAR(20)   NOT NULL UNIQUE
                              DEFAULT 'SD' || lpad(nextval('sd_code_seq')::text, 6, '0'),
    lease_id                  VARCHAR(50)   NULL,
    agreement_no              VARCHAR(50)   NULL,
    cost_center_id            INT           NOT NULL REFERENCES cost_centers(cost_center_id) ON DELETE RESTRICT,
    l1_id                     INT           NOT NULL,
    l2_id                     INT           NOT NULL,
    l3_id                     INT           NOT NULL,
    landlord_name             VARCHAR(200)  NULL,
    landlord_status           VARCHAR(10)   NOT NULL DEFAULT 'Active' CHECK (landlord_status IN ('Active','Passive')),
    building_status           VARCHAR(10)   NOT NULL DEFAULT 'Active' CHECK (building_status IN ('Active','Passive')),
    floor                     VARCHAR(50)   NOT NULL,
    agreement_value           NUMERIC(15,2) NOT NULL CHECK (agreement_value > 0),
    lease_commencement_date   DATE          NULL,
    rent_commencement_date    DATE          NULL,
    lease_end_date            DATE          NULL,
    created_date              TIMESTAMP     NOT NULL DEFAULT NOW(),
    modified_date             TIMESTAMP     NULL,
    created_by                VARCHAR(100)  NULL,
    modified_by               VARCHAR(100)  NULL,
    uploaded_by               VARCHAR(100)  NULL,
    uploaded_date             TIMESTAMP     NULL,
    CONSTRAINT fk_sd_master_location FOREIGN KEY (l3_id, l2_id, l1_id)
        REFERENCES location_l3 (l3_id, l2_id, l1_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT ck_sd_master_lease_dates CHECK (
        lease_end_date IS NULL OR lease_commencement_date IS NULL OR lease_end_date >= lease_commencement_date
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sd_master_business_key
    ON sd_master (LOWER(COALESCE(lease_id, '')), LOWER(COALESCE(agreement_no, '')), LOWER(floor))
    WHERE lease_id IS NOT NULL OR agreement_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_sd_master_cost_center ON sd_master (cost_center_id);
CREATE INDEX IF NOT EXISTS ix_sd_master_location    ON sd_master (l1_id, l2_id, l3_id);
CREATE INDEX IF NOT EXISTS ix_sd_master_l3          ON sd_master (l3_id);

-- ------------------------------------------------------------
-- Landlord / Building Status history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sd_status_history (
    history_id    SERIAL PRIMARY KEY,
    sd_id         INT          NOT NULL REFERENCES sd_master(sd_id) ON DELETE CASCADE,
    status_type   VARCHAR(10)  NOT NULL CHECK (status_type IN ('Landlord','Building')),
    old_status    VARCHAR(10)  NULL,
    new_status    VARCHAR(10)  NOT NULL,
    changed_by    VARCHAR(100) NULL,
    changed_date  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_sd_status_history_sd ON sd_status_history (sd_id, changed_date DESC);
