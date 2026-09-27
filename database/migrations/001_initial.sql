-- ============================================================
-- SD Maintenance Application - Database Schema (PostgreSQL)
-- Applied by `npm run migrate` (server/scripts/migrate.js). Idempotent,
-- so it is safe on a database created from the original schema.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Table: users  (User Master / Authentication table)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id         SERIAL PRIMARY KEY,
    user_name        VARCHAR(100)  NOT NULL UNIQUE,
    user_email       VARCHAR(150)  NOT NULL UNIQUE,
    password_hash    VARCHAR(255)  NOT NULL,
    status           VARCHAR(10)   NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
    -- Audit fields
    created_date     TIMESTAMP     NOT NULL DEFAULT NOW(),
    modified_date    TIMESTAMP     NULL,
    created_by       VARCHAR(100)  NULL,
    modified_by      VARCHAR(100)  NULL
);

-- ------------------------------------------------------------
-- Table: password_reset_tokens (Forgot Password flow)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id        SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id),
    token           VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMP NOT NULL,
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    created_date    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Table: cost_centers (Cost Center Master)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_centers (
    cost_center_id    SERIAL PRIMARY KEY,
    cost_center_code  VARCHAR(50)  NOT NULL UNIQUE,
    cost_center_name  VARCHAR(150) NOT NULL UNIQUE,
    status            VARCHAR(10)  NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
    -- Audit fields
    created_date      TIMESTAMP    NOT NULL DEFAULT NOW(),
    modified_date     TIMESTAMP    NULL,
    created_by        VARCHAR(100) NULL,
    modified_by       VARCHAR(100) NULL
);

-- ------------------------------------------------------------
-- Table: audit_log (generic audit trail for all masters)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id        SERIAL PRIMARY KEY,
    table_name      VARCHAR(100) NOT NULL,
    record_id       INT NOT NULL,
    action          VARCHAR(20) NOT NULL, -- INSERT / UPDATE / DELETE
    action_by       VARCHAR(100) NULL,
    action_date     TIMESTAMP NOT NULL DEFAULT NOW(),
    details         TEXT NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS ix_users_status ON users(status);
CREATE INDEX IF NOT EXISTS ix_cost_centers_status ON cost_centers(status);
