-- ============================================================
-- 003 - Location Master (V1 plan, Phase 2)
-- Three-level hierarchy: Level 1 > Level 2 > Level 3
--   * codes auto-generated (L1-0001, L2-0001, L3-0001)
--   * Level 1 names unique; Level 2 unique within Level 1;
--     Level 3 unique within Level 2 (case-insensitive)
--   * a parent in use cannot be deleted (FK RESTRICT) - make it Inactive
--   * Level 3 stores both parents; the composite FK guarantees its
--     Level 2 really belongs to its Level 1
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS location_l1_code_seq;
CREATE SEQUENCE IF NOT EXISTS location_l2_code_seq;
CREATE SEQUENCE IF NOT EXISTS location_l3_code_seq;

CREATE TABLE IF NOT EXISTS location_l1 (
    l1_id          SERIAL PRIMARY KEY,
    l1_code        VARCHAR(20)  NOT NULL UNIQUE
                   DEFAULT 'L1-' || lpad(nextval('location_l1_code_seq')::text, 4, '0'),
    l1_name        VARCHAR(150) NOT NULL,
    status         VARCHAR(10)  NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
    created_date   TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date  TIMESTAMP    NULL,
    created_by     VARCHAR(100) NULL,
    modified_by    VARCHAR(100) NULL,
    uploaded_by    VARCHAR(100) NULL,
    uploaded_date  TIMESTAMP    NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_location_l1_name ON location_l1 (LOWER(l1_name));

CREATE TABLE IF NOT EXISTS location_l2 (
    l2_id          SERIAL PRIMARY KEY,
    l2_code        VARCHAR(20)  NOT NULL UNIQUE
                   DEFAULT 'L2-' || lpad(nextval('location_l2_code_seq')::text, 4, '0'),
    l2_name        VARCHAR(150) NOT NULL,
    l1_id          INT          NOT NULL REFERENCES location_l1(l1_id) ON DELETE RESTRICT,
    status         VARCHAR(10)  NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
    created_date   TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date  TIMESTAMP    NULL,
    created_by     VARCHAR(100) NULL,
    modified_by    VARCHAR(100) NULL,
    uploaded_by    VARCHAR(100) NULL,
    uploaded_date  TIMESTAMP    NULL,
    CONSTRAINT uq_location_l2_id_l1 UNIQUE (l2_id, l1_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_location_l2_name ON location_l2 (l1_id, LOWER(l2_name));
CREATE INDEX IF NOT EXISTS ix_location_l2_l1 ON location_l2 (l1_id);

CREATE TABLE IF NOT EXISTS location_l3 (
    l3_id          SERIAL PRIMARY KEY,
    l3_code        VARCHAR(20)  NOT NULL UNIQUE
                   DEFAULT 'L3-' || lpad(nextval('location_l3_code_seq')::text, 4, '0'),
    l3_name        VARCHAR(150) NOT NULL,
    l1_id          INT          NOT NULL REFERENCES location_l1(l1_id) ON DELETE RESTRICT,
    l2_id          INT          NOT NULL,
    status         VARCHAR(10)  NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
    created_date   TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date  TIMESTAMP    NULL,
    created_by     VARCHAR(100) NULL,
    modified_by    VARCHAR(100) NULL,
    uploaded_by    VARCHAR(100) NULL,
    uploaded_date  TIMESTAMP    NULL,
    CONSTRAINT fk_location_l3_l2 FOREIGN KEY (l2_id, l1_id)
        REFERENCES location_l2 (l2_id, l1_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_location_l3_name ON location_l3 (l2_id, LOWER(l3_name));
CREATE INDEX IF NOT EXISTS ix_location_l3_l2 ON location_l3 (l2_id);
