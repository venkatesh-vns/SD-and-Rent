-- ============================================================
-- 010 - Rent Management module (Rent Transaction menu)
--   * rent_master                 Rent Code per SD Code + landlord (RENT0001...)
--   * rent_agreements             agreement header per Rent Code
--   * rent_agreement_components   the nine rent / charge components
--   * rent_rules                  escalation rules (RCD, LCD, Normal Day)
--   * rent_waivers                rent-free periods
--   * rent_schedule_lines         generated month-wise rent per component
--   * rent_schedule_runs          audit of each generation / regeneration
-- Cost Center, Floor, LCD, RCD and LED are read from SD Master (not copied).
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS rent_code_seq;

-- RENT0001 ... RENT9999, then RENT10000 (never truncated)
CREATE OR REPLACE FUNCTION next_rent_code() RETURNS VARCHAR AS $$
  SELECT 'RENT' || CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END
  FROM nextval('rent_code_seq') AS n
$$ LANGUAGE sql;

CREATE TABLE IF NOT EXISTS rent_master (
    rent_id            SERIAL PRIMARY KEY,
    rent_code          VARCHAR(20)  NOT NULL UNIQUE DEFAULT next_rent_code(),
    sd_id              INT          NOT NULL REFERENCES sd_master(sd_id) ON DELETE RESTRICT,
    landlord_name      VARCHAR(200) NOT NULL,
    ll_status          VARCHAR(10)  NOT NULL DEFAULT 'Active' CHECK (ll_status IN ('Active', 'Inactive')),
    inactive_end_date  DATE         NULL,
    -- Cost Center Name | SD Code | Floor | Landlord Name (upper-cased, trimmed)
    business_key       VARCHAR(600) NOT NULL UNIQUE,
    -- Last month the schedule has been generated up to (automatic regeneration goes as far)
    schedule_to_month  DATE         NULL,
    created_date       TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date      TIMESTAMP    NULL,
    created_by         VARCHAR(100) NULL,
    modified_by        VARCHAR(100) NULL,
    uploaded_by        VARCHAR(100) NULL,
    uploaded_date      TIMESTAMP    NULL,
    CONSTRAINT ck_rent_master_inactive CHECK (ll_status = 'Active' OR inactive_end_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_rent_master_sd ON rent_master (sd_id);

CREATE TABLE IF NOT EXISTS rent_agreements (
    agreement_id             SERIAL PRIMARY KEY,
    rent_id                  INT          NOT NULL REFERENCES rent_master(rent_id) ON DELETE RESTRICT,
    agreement_status         VARCHAR(20)  NOT NULL CHECK (agreement_status IN ('Individual', 'Transfer')),
    status                   VARCHAR(10)  NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    -- Transfer: configuration taken over from another Rent Code from this date
    transfer_from_rent_id    INT          NULL REFERENCES rent_master(rent_id) ON DELETE RESTRICT,
    transfer_effective_date  DATE         NULL,
    remark                   VARCHAR(500) NULL,
    created_date             TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date            TIMESTAMP    NULL,
    created_by               VARCHAR(100) NULL,
    modified_by              VARCHAR(100) NULL,
    uploaded_by              VARCHAR(100) NULL,
    uploaded_date            TIMESTAMP    NULL,
    CONSTRAINT ck_rent_agreement_transfer CHECK (
        agreement_status = 'Individual'
        OR (transfer_from_rent_id IS NOT NULL AND transfer_effective_date IS NOT NULL AND transfer_from_rent_id <> rent_id)
    )
);
-- Only one active configuration per Rent Code + Agreement Status
CREATE UNIQUE INDEX IF NOT EXISTS ux_rent_agreement_active
    ON rent_agreements (rent_id, agreement_status) WHERE status = 'Active';

CREATE TABLE IF NOT EXISTS rent_agreement_components (
    component_id    SERIAL PRIMARY KEY,
    agreement_id    INT           NOT NULL REFERENCES rent_agreements(agreement_id) ON DELETE CASCADE,
    component_code  VARCHAR(30)   NOT NULL CHECK (component_code IN (
                      'ADDITIONAL_PARKING', 'FITOUTS', 'CAFE', 'CAR_PARK', 'OFFICE',
                      'SIGNAGE', 'SOLAR', 'TERRACE', 'MAINTENANCE')),
    quantity        NUMERIC(15,3) NULL CHECK (quantity IS NULL OR quantity > 0),  -- Sq.Ft or No.; NULL for Signage / Solar
    rate            NUMERIC(15,2) NOT NULL CHECK (rate > 0),                      -- per Sq.Ft / per No. / per month
    percentage      NUMERIC(9,4)  NOT NULL CHECK (percentage > 0),
    UNIQUE (agreement_id, component_code)
);

CREATE TABLE IF NOT EXISTS rent_rules (
    rule_id            SERIAL PRIMARY KEY,
    rent_id            INT          NOT NULL REFERENCES rent_master(rent_id) ON DELETE RESTRICT,
    rule_type          VARCHAR(12)  NOT NULL CHECK (rule_type IN ('LCD', 'RCD', 'Normal Day')),
    escalation_months  INT          NULL CHECK (escalation_months IS NULL OR escalation_months BETWEEN 1 AND 600),
    from_date          DATE         NULL,
    to_date            DATE         NULL,
    percentage         NUMERIC(9,4) NOT NULL CHECK (percentage >= -100 AND percentage <= 1000),
    component_code     VARCHAR(30)  NULL,  -- NULL = all components of the Rent Code
    status             VARCHAR(10)  NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    effective_date     DATE         NULL,  -- calculated escalation date (LCD / RCD rules)
    created_date       TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date      TIMESTAMP    NULL,
    created_by         VARCHAR(100) NULL,
    modified_by        VARCHAR(100) NULL,
    uploaded_by        VARCHAR(100) NULL,
    uploaded_date      TIMESTAMP    NULL,
    CONSTRAINT ck_rent_rule_shape CHECK (
        (rule_type IN ('LCD', 'RCD') AND escalation_months IS NOT NULL)
        OR (rule_type = 'Normal Day' AND from_date IS NOT NULL AND to_date IS NOT NULL AND from_date <= to_date)
    )
);
CREATE INDEX IF NOT EXISTS ix_rent_rules_rent ON rent_rules (rent_id);

CREATE TABLE IF NOT EXISTS rent_waivers (
    waiver_id       SERIAL PRIMARY KEY,
    rent_id         INT          NOT NULL REFERENCES rent_master(rent_id) ON DELETE RESTRICT,
    from_date       DATE         NOT NULL,
    to_date         DATE         NOT NULL,
    waiver_status   VARCHAR(3)   NOT NULL CHECK (waiver_status IN ('Yes', 'No')),
    component_code  VARCHAR(30)  NULL,  -- NULL = all components
    remark          VARCHAR(500) NULL,
    created_date    TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date   TIMESTAMP    NULL,
    created_by      VARCHAR(100) NULL,
    modified_by     VARCHAR(100) NULL,
    uploaded_by     VARCHAR(100) NULL,
    uploaded_date   TIMESTAMP    NULL,
    CONSTRAINT ck_rent_waiver_dates CHECK (from_date <= to_date)
);
CREATE INDEX IF NOT EXISTS ix_rent_waivers_rent ON rent_waivers (rent_id);

CREATE TABLE IF NOT EXISTS rent_schedule_runs (
    run_id        SERIAL PRIMARY KEY,
    trigger       VARCHAR(100) NOT NULL,          -- 'Generate', or what changed for an automatic regeneration
    from_month    DATE         NOT NULL,
    to_month      DATE         NOT NULL,
    filters       JSONB        NULL,
    rent_codes    INT          NOT NULL DEFAULT 0,
    lines         INT          NOT NULL DEFAULT 0,
    messages      JSONB        NULL,              -- Rent Codes skipped and why
    run_by        VARCHAR(100) NULL,
    run_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rent_schedule_lines (
    line_id           BIGSERIAL PRIMARY KEY,
    rent_id           INT           NOT NULL REFERENCES rent_master(rent_id) ON DELETE CASCADE,
    agreement_id      INT           NOT NULL REFERENCES rent_agreements(agreement_id) ON DELETE CASCADE,
    component_code    VARCHAR(30)   NOT NULL,
    rent_month        DATE          NOT NULL,     -- first day of the month
    period_from       DATE          NOT NULL,     -- first day charged in the month
    period_to         DATE          NOT NULL,     -- last day charged in the month
    days_charged      INT           NOT NULL,
    base_amount       NUMERIC(15,2) NOT NULL,     -- monthly amount from Rent Agreement Master
    rule_percentage   NUMERIC(9,4)  NULL,         -- latest rule in force in the month
    escalated_amount  NUMERIC(15,2) NOT NULL,     -- pro-rated amount after rules
    waiver_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    final_amount      NUMERIC(15,2) NOT NULL,
    run_id            INT           NULL REFERENCES rent_schedule_runs(run_id) ON DELETE SET NULL,
    generated_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
    generated_by      VARCHAR(100)  NULL,
    UNIQUE (agreement_id, component_code, rent_month)
);
CREATE INDEX IF NOT EXISTS ix_rent_schedule_month ON rent_schedule_lines (rent_month);
CREATE INDEX IF NOT EXISTS ix_rent_schedule_rent ON rent_schedule_lines (rent_id, rent_month);

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('RENT_MASTER',    'Rent Master',           'Rent Transaction', 100),
  ('RENT_AGREEMENT', 'Rent Agreement Master', 'Rent Transaction', 110),
  ('RENT_RULE',      'Rule Master',           'Rent Transaction', 120),
  ('RENT_WAIVER',    'Waiver Master',         'Rent Transaction', 130),
  ('RENT_SCHEDULE',  'Rent Schedule',         'Rent Transaction', 140)
ON CONFLICT (screen_code) DO NOTHING;
