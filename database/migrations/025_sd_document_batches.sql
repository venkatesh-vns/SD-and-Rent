-- SD Document Upload: bulk upload of SD Master documents from a template
-- (S.No, SD Code / SD ID, Document Type, File Path). Each upload is a batch with a
-- status per row; an administrator can bulk delete a whole batch (or every batch
-- of a day) when it was uploaded wrongly.
CREATE SEQUENCE IF NOT EXISTS sd_document_batch_seq;

CREATE TABLE IF NOT EXISTS sd_document_batches (
    batch_id       SERIAL        PRIMARY KEY,
    batch_no       VARCHAR(20)   NOT NULL UNIQUE DEFAULT 'DOCB' || lpad(nextval('sd_document_batch_seq')::text, 6, '0'),
    template_name  VARCHAR(255)  NOT NULL,
    total_rows     INT           NOT NULL DEFAULT 0,
    success_rows   INT           NOT NULL DEFAULT 0,
    failed_rows    INT           NOT NULL DEFAULT 0,
    status         VARCHAR(15)   NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Completed', 'Deleted')),
    uploaded_by    VARCHAR(100)  NOT NULL,
    uploaded_date  TIMESTAMP     NOT NULL DEFAULT NOW(),
    completed_date TIMESTAMP     NULL,
    deleted_by     VARCHAR(100)  NULL,
    deleted_date   TIMESTAMP     NULL,
    delete_reason  VARCHAR(500)  NULL
);
CREATE INDEX IF NOT EXISTS ix_sd_document_batches_date ON sd_document_batches (uploaded_date DESC);

CREATE TABLE IF NOT EXISTS sd_document_batch_rows (
    batch_id       INT           NOT NULL REFERENCES sd_document_batches(batch_id) ON DELETE CASCADE,
    row_no         INT           NOT NULL,                 -- Excel row
    s_no           VARCHAR(20)   NULL,
    sd_ref         VARCHAR(50)   NULL,                     -- SD Code / SD ID as given
    sd_id          INT           NULL,
    sd_code        VARCHAR(20)   NULL,
    document_type  VARCHAR(40)   NULL,
    file_path      VARCHAR(1000) NULL,
    status         VARCHAR(10)   NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Success', 'Failed', 'Deleted')),
    message        VARCHAR(500)  NULL,
    document_id    INT           NULL REFERENCES sd_document_master(document_id),
    processed_date TIMESTAMP     NULL,
    PRIMARY KEY (batch_id, row_no)
);

-- Which bulk upload a document came from
ALTER TABLE sd_document_master ADD COLUMN IF NOT EXISTS batch_id INT NULL REFERENCES sd_document_batches(batch_id);
CREATE INDEX IF NOT EXISTS ix_sd_document_batch ON sd_document_master (batch_id) WHERE batch_id IS NOT NULL;

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('SD_DOCUMENT_UPLOAD', 'SD Document Upload', 'SD Transaction', 65)
ON CONFLICT (screen_code) DO NOTHING;
