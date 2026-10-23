-- Log retention: history of the nightly log clean-up (and "Run clean-up now")
CREATE TABLE IF NOT EXISTS maintenance_runs (
    run_id        SERIAL       PRIMARY KEY,
    job           VARCHAR(50)  NOT NULL,              -- 'Log retention'
    started_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMP    NULL,
    ok            BOOLEAN      NULL,
    started_by    VARCHAR(100) NULL,
    details       JSONB        NULL                   -- per table: archived / deleted / file
);
CREATE INDEX IF NOT EXISTS ix_maintenance_runs_started ON maintenance_runs (job, started_at DESC);

-- Date columns the clean-up filters on
CREATE INDEX IF NOT EXISTS ix_email_log_sent      ON email_log (sent_at);
CREATE INDEX IF NOT EXISTS ix_upload_batches_date ON upload_batches (uploaded_date);
CREATE INDEX IF NOT EXISTS ix_user_sessions_ended ON user_sessions (ended_at);
