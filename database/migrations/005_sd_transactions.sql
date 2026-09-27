-- ============================================================
-- 005 - SD Transactions (V1 plan, Phase 4)
--   * transactions against an SD Code; each has an auto Transaction No.
--     (TXN0000001) used for bulk updates, since several transactions can
--     share an SD Code and date
--   * SD Balance          = Agreement Value - Total SD Paid
--   * SD Balance Repayable = Total Paid - Transfer - Refund - Adjustment,
--     running totals ordered by transaction date (then entry order)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS sd_txn_no_seq;

CREATE TABLE IF NOT EXISTS sd_transactions (
    txn_id             SERIAL PRIMARY KEY,
    txn_no             VARCHAR(20)   NOT NULL UNIQUE
                       DEFAULT 'TXN' || lpad(nextval('sd_txn_no_seq')::text, 7, '0'),
    sd_id              INT           NOT NULL REFERENCES sd_master(sd_id) ON DELETE RESTRICT,
    sd_type            VARCHAR(30)   NOT NULL CHECK (sd_type IN (
                         'Landlord SD', 'Electricity SD', 'Additional Parking SD', 'Other SD',
                         'Fitout SD', 'CAM SD', 'Solar SD')),
    fy                 VARCHAR(9)    NOT NULL CHECK (
                         fy ~ '^\d{4}-\d{4}$' AND right(fy, 4)::int = left(fy, 4)::int + 1),
    txn_date           DATE          NOT NULL,
    agreement_status   VARCHAR(30)   NOT NULL CHECK (agreement_status IN (
                         'LOI', 'Agreement', 'Registered Agreement', 'Addendum Agreement', 'Mail Approval')),
    paid_amount        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    transfer_amount    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (transfer_amount >= 0),
    adjustment_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (adjustment_amount >= 0),
    refund_amount      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
    remarks            VARCHAR(1000) NULL,
    created_date       TIMESTAMP     NOT NULL DEFAULT NOW(),
    modified_date      TIMESTAMP     NULL,
    created_by         VARCHAR(100)  NULL,
    modified_by        VARCHAR(100)  NULL,
    uploaded_by        VARCHAR(100)  NULL,
    uploaded_date      TIMESTAMP     NULL,
    CONSTRAINT ck_sd_transactions_amount CHECK (
        paid_amount + transfer_amount + adjustment_amount + refund_amount > 0)
);

CREATE INDEX IF NOT EXISTS ix_sd_transactions_ledger ON sd_transactions (sd_id, txn_date, txn_id);
CREATE INDEX IF NOT EXISTS ix_sd_transactions_date   ON sd_transactions (txn_date);

-- Every transaction with running totals for its SD Code, in date order
CREATE OR REPLACE VIEW v_sd_ledger AS
SELECT t.*,
       s.sd_code,
       s.agreement_value,
       SUM(t.paid_amount) OVER w                                        AS running_paid,
       s.agreement_value - SUM(t.paid_amount) OVER w                    AS running_sd_balance,
       SUM(t.paid_amount - t.transfer_amount - t.refund_amount - t.adjustment_amount) OVER w
                                                                         AS running_repayable
FROM sd_transactions t
JOIN sd_master s ON s.sd_id = t.sd_id
WINDOW w AS (PARTITION BY t.sd_id ORDER BY t.txn_date, t.txn_id ROWS UNBOUNDED PRECEDING);

-- Totals and balances per SD Code (SD Codes without transactions included)
CREATE OR REPLACE VIEW v_sd_balance AS
SELECT s.sd_id,
       s.sd_code,
       s.agreement_value,
       COALESCE(SUM(t.paid_amount), 0)        AS total_paid,
       COALESCE(SUM(t.transfer_amount), 0)    AS total_transfer,
       COALESCE(SUM(t.adjustment_amount), 0)  AS total_adjustment,
       COALESCE(SUM(t.refund_amount), 0)      AS total_refund,
       s.agreement_value - COALESCE(SUM(t.paid_amount), 0) AS sd_balance,
       COALESCE(SUM(t.paid_amount - t.transfer_amount - t.refund_amount - t.adjustment_amount), 0)
                                               AS sd_balance_repayable,
       COUNT(t.txn_id)::int                    AS txn_count,
       MAX(t.txn_date)                         AS last_txn_date
FROM sd_master s
LEFT JOIN sd_transactions t ON t.sd_id = s.sd_id
GROUP BY s.sd_id, s.sd_code, s.agreement_value;
