-- SD Document Master: PDF / Word documents attached to an SD Code, with versions.
-- One row per version. A document is the group of its versions (group_id = the
-- document_id of version 1); exactly one version per document is the latest.
-- The file itself is stored on disk (DOCUMENT_DIR), not in the database, so the
-- database and its backups stay small; stored_path is relative to DOCUMENT_DIR.
-- Deleting a document only marks it Deleted (files and rows are kept for audit).
CREATE TABLE IF NOT EXISTS sd_document_master (
    document_id    SERIAL        PRIMARY KEY,
    sd_id          INT           NOT NULL REFERENCES sd_master(sd_id) ON DELETE CASCADE,
    group_id       INT           NOT NULL,
    version_no     INT           NOT NULL CHECK (version_no >= 1),
    is_latest      BOOLEAN       NOT NULL DEFAULT TRUE,
    document_type  VARCHAR(40)   NOT NULL,
    title          VARCHAR(200)  NOT NULL,
    remarks        VARCHAR(500)  NULL,
    file_name      VARCHAR(255)  NOT NULL,                -- name of the uploaded file
    file_ext       VARCHAR(5)    NOT NULL CHECK (file_ext IN ('pdf', 'doc', 'docx')),
    mime_type      VARCHAR(100)  NOT NULL,
    size_bytes     BIGINT        NOT NULL CHECK (size_bytes > 0),
    sha256         CHAR(64)      NOT NULL,
    stored_path    VARCHAR(500)  NOT NULL,
    status         VARCHAR(10)   NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Deleted')),
    uploaded_by    VARCHAR(100)  NOT NULL,
    uploaded_date  TIMESTAMP     NOT NULL DEFAULT NOW(),
    deleted_by     VARCHAR(100)  NULL,
    deleted_date   TIMESTAMP     NULL,
    delete_reason  VARCHAR(500)  NULL,
    CONSTRAINT uq_sd_document_version UNIQUE (group_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sd_document_latest ON sd_document_master (group_id) WHERE is_latest;
CREATE INDEX IF NOT EXISTS ix_sd_document_sd ON sd_document_master (sd_id, status) WHERE is_latest;
CREATE INDEX IF NOT EXISTS ix_sd_document_hash ON sd_document_master (sd_id, sha256);

DROP TRIGGER IF EXISTS trg_notify_changed ON sd_document_master;
CREATE TRIGGER trg_notify_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON sd_document_master
  FOR EACH STATEMENT EXECUTE FUNCTION notify_data_changed();
