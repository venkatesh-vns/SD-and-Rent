-- One login session per User ID: a second login (another browser, PC or the
-- desktop app) is refused while the first session is live. A session stays live
-- while its browser sends a heartbeat (closed browsers stop after a few minutes)
-- and the user has been active within the idle timeout (30 minutes).
-- Administrators can end a session from User Master.
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id        UUID          PRIMARY KEY,
    user_id           INT           NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    started_at        TIMESTAMP     NOT NULL DEFAULT NOW(),
    last_seen_at      TIMESTAMP     NOT NULL DEFAULT NOW(),   -- any request or heartbeat
    last_activity_at  TIMESTAMP     NOT NULL DEFAULT NOW(),   -- user activity (not idle)
    ip_address        VARCHAR(64)   NULL,
    user_agent        VARCHAR(400)  NULL,
    client_label      VARCHAR(100)  NULL,                      -- e.g. 'Chrome on Windows'
    ended_at          TIMESTAMP     NULL,
    end_reason        VARCHAR(100)  NULL,                      -- Logged out, Idle timeout, Ended by administrator, ...
    ended_by          VARCHAR(100)  NULL
);
CREATE INDEX IF NOT EXISTS ix_user_sessions_open ON user_sessions (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_user_sessions_started ON user_sessions (started_at DESC);
