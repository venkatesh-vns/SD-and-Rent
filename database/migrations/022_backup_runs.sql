-- Database backups (nightly and "Back up now"): one row per run, for System Health
CREATE TABLE IF NOT EXISTS backup_runs (
    backup_id     SERIAL       PRIMARY KEY,
    started_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMP    NULL,
    reason        VARCHAR(50)  NOT NULL,              -- 'Nightly' / 'Manual'
    file_path     VARCHAR(500) NULL,
    size_bytes    BIGINT       NULL,
    verified      BOOLEAN      NOT NULL DEFAULT FALSE, -- pg_restore could read the file back
    ok            BOOLEAN      NULL,
    message       VARCHAR(1000) NULL,
    started_by    VARCHAR(100) NULL
);
CREATE INDEX IF NOT EXISTS ix_backup_runs_started ON backup_runs (started_at DESC);
